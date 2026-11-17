// =============================================================================
// Lectura de blobs para el diff: de un commit, del índice o del disco, como texto decodificado
// o como bytes. Los que salen de git van en UN `cat-file --batch` por repo y lote, con tope.
// Depende de `NucleoGit` y del adaptador del proceso. Lo usan `ServicioGit` y el comparador de comprimidos.
// Decisiones: docs/decisiones/git/main-lecturas-y-cache.md
// =============================================================================

import { promises as fs } from 'node:fs'
import { decodificarTexto, detectarEncoding, esBufferBinario } from '../archivos/codificacionTexto'
import type { PeticionBytesBlob, ResultadoBytesBlob, ResultadoBlob } from '../../shared/git-ipc'
import type { BlobBruto } from './adaptadores/catFileLote'
import { leerLoteObjetosGit } from './adaptadores/procesoCatFile'
import { esEnoent } from './errores'
import type { NucleoGit } from './NucleoGit'
import { resolverDentroDelRepo, aRutaRepo } from './rutasRepo'
import type { RepoCtx } from './tipos'

/** Tope del blob de TEXTO para el diff (2 MiB, como el editor): protege a Monaco. */
const MAX_BLOB_BYTES = 2 * 1024 * 1024

/** Tope de las lecturas BINARIAS de un lado del diff (50 MiB, como ServicioArchivos): protege la memoria del renderer. */
const MAX_BYTES_BLOB_BINARIO = 50 * 1024 * 1024

/** Blobs de git y de disco. */
export class Blobs {
  private readonly n: NucleoGit

  constructor(n: NucleoGit) {
    this.n = n
  }

  /**
   * Contenido de un archivo del proyecto en un commit. El repo sale de la RUTA (o de `repo`
   * si viene): el lado «before» de un diff staged se lee del repo dueño del archivo.
   */
  async leerBlobEnCommit(hash: string, relPosix: string, repo?: string): Promise<ResultadoBlob> {
    const ctx = repo !== undefined ? await this.n.obtenerCtxParaRepo(repo) : await this.n.obtenerCtxParaRuta(relPosix)
    if (!ctx) return { existe: false, contenido: '' }
    const rutaRepo = aRutaRepo(relPosix, ctx)
    return this.gitBlob(`${hash}:${rutaRepo}`, ctx)
  }

  /** Contenido de un archivo en el ÍNDICE (versión staged): `git show :<path>`. */
  async leerBlobIndice(relPosix: string): Promise<ResultadoBlob> {
    const ctx = await this.n.obtenerCtxParaRuta(relPosix)
    if (!ctx) return { existe: false, contenido: '' }
    const rutaRepo = aRutaRepo(relPosix, ctx)
    return this.gitBlob(`:${rutaRepo}`, ctx)
  }

  /**
   * Contenido ACTUAL en disco de un archivo del working-tree (lado «after» del diff). Lee del
   * disco y no de git porque incluye cambios sin preparar; el path resuelto DEBE quedar dentro del repo.
   */
  async leerBlobWorktree(relPosix: string): Promise<ResultadoBlob> {
    const ctx = await this.n.obtenerCtxParaRuta(relPosix)
    if (!ctx) return { existe: false, contenido: '' }

    const rutaRepo = aRutaRepo(relPosix, ctx)
    const abs = resolverDentroDelRepo(rutaRepo, ctx)
    if (abs === null) return { existe: false, contenido: '' }
    try {
      // `stat` primero para no leer megabytes en vano.
      const st = await fs.stat(abs)
      // Una CARPETA (un submódulo) no se lee con readFile: se responde con un resultado, no con EISDIR.
      if (st.isDirectory()) return { existe: true, contenido: '', esCarpeta: true }
      if (st.size > MAX_BLOB_BYTES) return { existe: true, contenido: '', truncado: true }
      // En BYTES con codificación detectada: es el archivo real y el lado editable del diff,
      // guardar con otra codificación lo corrompería.
      const bytes = await fs.readFile(abs)
      if (esBufferBinario(bytes)) return { existe: true, contenido: '', esBinario: true }
      const encoding = detectarEncoding(bytes)
      return { existe: true, contenido: decodificarTexto(bytes, encoding), encoding }
    } catch (err) {
      if (esEnoent(err)) return { existe: false, contenido: '' }
      throw err
    }
  }

  /** BYTES de un lado del diff, venga de un commit, del índice o del disco (tope de 50 MiB). */
  async blobBytes(req: PeticionBytesBlob): Promise<ResultadoBytesBlob> {
    const [uno] = await this.blobsBytesLote([req], MAX_BYTES_BLOB_BINARIO)
    return uno
  }

  /**
   * Bytes de VARIOS lados a la vez: los que salen de git, en UN `cat-file --batch` por repo
   * (en Windows el coste está en arrancar git). El resultado va en el orden de la petición y un
   * lado cuyo repo no se resuelve sale como «no existe» en su hueco. `maxBytes` lo decide quien llama.
   */
  async blobsBytesLote(
    reqs: readonly PeticionBytesBlob[],
    maxBytes: number = MAX_BYTES_BLOB_BINARIO
  ): Promise<ResultadoBytesBlob[]> {
    const NO_EXISTE: ResultadoBytesBlob = { existe: false, tamano: 0, truncado: false }
    const salida: ResultadoBytesBlob[] = new Array(reqs.length).fill(NO_EXISTE)
    // Agrupadas por REPO: un `cat-file` corre con un `cwd` concreto.
    const grupos = new Map<string, { ctx: RepoCtx; elementos: { i: number; rev: string }[] }>()
    // El repo de cada lado se resuelve en PARALELO y el disco se lee a la vez que arranca git.
    const ctxs = await Promise.all(reqs.map((req) => this.n.obtenerCtxParaRuta(req.ruta)))
    const tareas: Promise<void>[] = []

    for (let i = 0; i < reqs.length; i++) {
      const req = reqs[i]
      const ctx = ctxs[i]
      if (!ctx) continue
      const rutaRepo = aRutaRepo(req.ruta, ctx)

      if (req.origen === 'worktree') {
        tareas.push(
          this.bytesDeDisco(rutaRepo, ctx, maxBytes).then((r) => {
            salida[i] = r
          })
        )
        continue
      }
      // ':<path>' es el índice; '<hash>:<path>', un commit.
      const rev = req.origen === 'index' ? `:${rutaRepo}` : `${req.hash}:${rutaRepo}`
      const grupo = grupos.get(ctx.raiz) ?? { ctx, elementos: [] }
      grupo.elementos.push({ i, rev })
      grupos.set(ctx.raiz, grupo)
    }

    for (const grupo of grupos.values()) {
      tareas.push(
        this.buffersBlobGit(
          grupo.elementos.map((x) => x.rev),
          grupo.ctx,
          maxBytes
        ).then((brutos) => {
          for (let k = 0; k < grupo.elementos.length; k++) {
            const crudo = brutos[k]
            const i = grupo.elementos[k].i
            if (!crudo.existe) continue
            salida[i] = crudo.truncado
              ? { existe: true, tamano: crudo.tamano, truncado: true }
              : { existe: true, bytes: crudo.bytes as Buffer, tamano: crudo.tamano, truncado: false }
          }
        })
      )
    }

    await Promise.all(tareas)
    return salida
  }

  /**
   * Un blob de git (`<hash>:<path>`, o `:<path>` para el índice) como texto, con tope de 2 MiB:
   * si la cabecera del `cat-file` ya lo excede se corta antes de volcar el archivo entero.
   */
  private async gitBlob(rev: string, ctx: RepoCtx): Promise<ResultadoBlob> {
    const crudo = await this.gitBlobBuffer(rev, ctx, MAX_BLOB_BYTES)
    if (!crudo.existe) return { existe: false, contenido: '' }
    if (crudo.truncado) return { existe: true, contenido: '', truncado: true }
    const bytes = crudo.bytes as Buffer
    // Un blob son BYTES: se decodifica con el MISMO códec que ServicioArchivos, para que ambos caminos den lo mismo.
    if (esBufferBinario(bytes)) return { existe: true, contenido: '', esBinario: true }
    // Sin `truncado`: el buffer está COMPLETO, no se tolera un multibyte cortado al final.
    const encoding = detectarEncoding(bytes)
    return { existe: true, contenido: decodificarTexto(bytes, encoding), encoding }
  }

  /** UN objeto de git en bytes, con el tope que decida quien llama; fachada de `buffersBlobGit`. */
  private async gitBlobBuffer(rev: string, ctx: RepoCtx, maxBytes: number): Promise<BlobBruto> {
    const [uno] = await this.buffersBlobGit([rev], ctx, maxBytes)
    return uno
  }

  /**
   * N revisiones en UN proceso. Si un objeto pasa de `maxBytes` hay que MATAR el proceso y se
   * pierden las respuestas de detrás: se marca ese como truncado y el resto se pide en otra tanda.
   */
  private async buffersBlobGit(
    revs: readonly string[],
    ctx: RepoCtx,
    maxBytes: number
  ): Promise<BlobBruto[]> {
    if (revs.length === 0) return []
    const tanda = await leerLoteObjetosGit(revs, ctx.raiz, maxBytes)
    if (tanda.cortadoEn < 0) return tanda.resultados
    const resto = await this.buffersBlobGit(revs.slice(tanda.cortadoEn + 1), ctx, maxBytes)
    return [...tanda.resultados, ...resto]
  }

  /** Bytes de un archivo del DISCO, con las guardas de `leerBlobWorktree` (no pasa por `cat-file`: puede no estar en git). */
  private async bytesDeDisco(rutaRepo: string, ctx: RepoCtx, maxBytes: number): Promise<ResultadoBytesBlob> {
    const abs = resolverDentroDelRepo(rutaRepo, ctx)
    if (abs === null) return { existe: false, tamano: 0, truncado: false }
    try {
      const st = await fs.stat(abs)
      // Una carpeta no se lee con readFile (EISDIR): pasa con los submódulos.
      if (st.isDirectory()) return { existe: false, tamano: 0, truncado: false }
      if (st.size > maxBytes) return { existe: true, tamano: st.size, truncado: true }
      const bytes = await fs.readFile(abs)
      return { existe: true, bytes, tamano: bytes.length, truncado: false }
    } catch (err) {
      if (esEnoent(err)) return { existe: false, tamano: 0, truncado: false }
      throw err
    }
  }
}
