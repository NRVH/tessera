// =============================================================================
// Lectura de blobs para el diff: de un commit, del índice o del disco, como texto decodificado
// o como bytes. Los que salen de git van en UN `cat-file --batch` por repo y lote, con tope.
// Depende de `NucleoGit` y del adaptador del proceso. Lo usan `GitService` y el comparador de comprimidos.
// Decisiones: docs/decisiones/git/main-lecturas-y-cache.md
// =============================================================================

import { promises as fs } from 'node:fs'
import { decodeText, detectEncoding, isBinaryBuffer } from '../files/textCodec'
import type { BlobBytesRequest, BlobBytesResult, BlobResult } from '../../shared/git-ipc'
import type { BlobBruto } from './adaptadores/catFileLote'
import { leerLoteCatFile } from './adaptadores/procesoCatFile'
import { isEnoent } from './errores'
import type { NucleoGit } from './NucleoGit'
import { resolveInsideRepo, toRepoPath } from './rutasRepo'
import type { RepoCtx } from './tipos'

/** Tope del blob de TEXTO para el diff (2 MiB, como el editor): protege a Monaco. */
const MAX_BLOB_BYTES = 2 * 1024 * 1024

/** Tope de las lecturas BINARIAS de un lado del diff (50 MiB, como FileService): protege la memoria del renderer. */
const MAX_BLOB_BYTES_BINARY = 50 * 1024 * 1024

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
  async blobAtCommit(hash: string, relPosix: string, repo?: string): Promise<BlobResult> {
    const ctx = repo !== undefined ? await this.n.ctxForRepo(repo) : await this.n.ctxForPath(relPosix)
    if (!ctx) return { exists: false, content: '' }
    const repoPath = toRepoPath(relPosix, ctx)
    return this.gitBlob(`${hash}:${repoPath}`, ctx)
  }

  /** Contenido de un archivo en el ÍNDICE (versión staged): `git show :<path>`. */
  async indexBlob(relPosix: string): Promise<BlobResult> {
    const ctx = await this.n.ctxForPath(relPosix)
    if (!ctx) return { exists: false, content: '' }
    const repoPath = toRepoPath(relPosix, ctx)
    return this.gitBlob(`:${repoPath}`, ctx)
  }

  /**
   * Contenido ACTUAL en disco de un archivo del working-tree (lado «after» del diff). Lee del
   * disco y no de git porque incluye cambios sin preparar; el path resuelto DEBE quedar dentro del repo.
   */
  async workingBlob(relPosix: string): Promise<BlobResult> {
    const ctx = await this.n.ctxForPath(relPosix)
    if (!ctx) return { exists: false, content: '' }

    const repoPath = toRepoPath(relPosix, ctx)
    const abs = resolveInsideRepo(repoPath, ctx)
    if (abs === null) return { exists: false, content: '' }
    try {
      // `stat` primero para no leer megabytes en vano.
      const st = await fs.stat(abs)
      // Una CARPETA (un submódulo) no se lee con readFile: se responde con un resultado, no con EISDIR.
      if (st.isDirectory()) return { exists: true, content: '', isDirectory: true }
      if (st.size > MAX_BLOB_BYTES) return { exists: true, content: '', truncated: true }
      // En BYTES con codificación detectada: es el archivo real y el lado editable del diff,
      // guardar con otra codificación lo corrompería.
      const bytes = await fs.readFile(abs)
      if (isBinaryBuffer(bytes)) return { exists: true, content: '', binary: true }
      const encoding = detectEncoding(bytes)
      return { exists: true, content: decodeText(bytes, encoding), encoding }
    } catch (err) {
      if (isEnoent(err)) return { exists: false, content: '' }
      throw err
    }
  }

  /** BYTES de un lado del diff, venga de un commit, del índice o del disco (tope de 50 MiB). */
  async blobBytes(req: BlobBytesRequest): Promise<BlobBytesResult> {
    const [uno] = await this.blobsBytesLote([req], MAX_BLOB_BYTES_BINARY)
    return uno
  }

  /**
   * Bytes de VARIOS lados a la vez: los que salen de git, en UN `cat-file --batch` por repo
   * (en Windows el coste está en arrancar git). El resultado va en el orden de la petición y un
   * lado cuyo repo no se resuelve sale como «no existe» en su hueco. `maxBytes` lo decide quien llama.
   */
  async blobsBytesLote(
    reqs: readonly BlobBytesRequest[],
    maxBytes: number = MAX_BLOB_BYTES_BINARY
  ): Promise<BlobBytesResult[]> {
    const NO_EXISTE: BlobBytesResult = { exists: false, size: 0, truncated: false }
    const salida: BlobBytesResult[] = new Array(reqs.length).fill(NO_EXISTE)
    // Agrupadas por REPO: un `cat-file` corre con un `cwd` concreto.
    const grupos = new Map<string, { ctx: RepoCtx; items: { i: number; rev: string }[] }>()
    // El repo de cada lado se resuelve en PARALELO y el disco se lee a la vez que arranca git.
    const ctxs = await Promise.all(reqs.map((req) => this.n.ctxForPath(req.path)))
    const tareas: Promise<void>[] = []

    for (let i = 0; i < reqs.length; i++) {
      const req = reqs[i]
      const ctx = ctxs[i]
      if (!ctx) continue
      const repoPath = toRepoPath(req.path, ctx)

      if (req.source === 'worktree') {
        tareas.push(
          this.bytesDeDisco(repoPath, ctx, maxBytes).then((r) => {
            salida[i] = r
          })
        )
        continue
      }
      // ':<path>' es el índice; '<hash>:<path>', un commit.
      const rev = req.source === 'index' ? `:${repoPath}` : `${req.hash}:${repoPath}`
      const grupo = grupos.get(ctx.root) ?? { ctx, items: [] }
      grupo.items.push({ i, rev })
      grupos.set(ctx.root, grupo)
    }

    for (const grupo of grupos.values()) {
      tareas.push(
        this.gitBlobBuffers(
          grupo.items.map((x) => x.rev),
          grupo.ctx,
          maxBytes
        ).then((brutos) => {
          for (let k = 0; k < grupo.items.length; k++) {
            const raw = brutos[k]
            const i = grupo.items[k].i
            if (!raw.exists) continue
            salida[i] = raw.truncated
              ? { exists: true, size: raw.size, truncated: true }
              : { exists: true, bytes: raw.bytes as Buffer, size: raw.size, truncated: false }
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
  private async gitBlob(rev: string, ctx: RepoCtx): Promise<BlobResult> {
    const raw = await this.gitBlobBuffer(rev, ctx, MAX_BLOB_BYTES)
    if (!raw.exists) return { exists: false, content: '' }
    if (raw.truncated) return { exists: true, content: '', truncated: true }
    const bytes = raw.bytes as Buffer
    // Un blob son BYTES: se decodifica con el MISMO códec que FileService, para que ambos caminos den lo mismo.
    if (isBinaryBuffer(bytes)) return { exists: true, content: '', binary: true }
    // Sin `truncated`: el buffer está COMPLETO, no se tolera un multibyte cortado al final.
    const encoding = detectEncoding(bytes)
    return { exists: true, content: decodeText(bytes, encoding), encoding }
  }

  /** UN objeto de git en bytes, con el tope que decida quien llama; fachada de `gitBlobBuffers`. */
  private async gitBlobBuffer(rev: string, ctx: RepoCtx, maxBytes: number): Promise<BlobBruto> {
    const [uno] = await this.gitBlobBuffers([rev], ctx, maxBytes)
    return uno
  }

  /**
   * N revisiones en UN proceso. Si un objeto pasa de `maxBytes` hay que MATAR el proceso y se
   * pierden las respuestas de detrás: se marca ese como truncado y el resto se pide en otra tanda.
   */
  private async gitBlobBuffers(
    revs: readonly string[],
    ctx: RepoCtx,
    maxBytes: number
  ): Promise<BlobBruto[]> {
    if (revs.length === 0) return []
    const tanda = await leerLoteCatFile(revs, ctx.root, maxBytes)
    if (tanda.cortadoEn < 0) return tanda.resultados
    const resto = await this.gitBlobBuffers(revs.slice(tanda.cortadoEn + 1), ctx, maxBytes)
    return [...tanda.resultados, ...resto]
  }

  /** Bytes de un archivo del DISCO, con las guardas de `workingBlob` (no pasa por `cat-file`: puede no estar en git). */
  private async bytesDeDisco(repoPath: string, ctx: RepoCtx, maxBytes: number): Promise<BlobBytesResult> {
    const abs = resolveInsideRepo(repoPath, ctx)
    if (abs === null) return { exists: false, size: 0, truncated: false }
    try {
      const st = await fs.stat(abs)
      // Una carpeta no se lee con readFile (EISDIR): pasa con los submódulos.
      if (st.isDirectory()) return { exists: false, size: 0, truncated: false }
      if (st.size > maxBytes) return { exists: true, size: st.size, truncated: true }
      const bytes = await fs.readFile(abs)
      return { exists: true, bytes, size: bytes.length, truncated: false }
    } catch (err) {
      if (isEnoent(err)) return { exists: false, size: 0, truncated: false }
      throw err
    }
  }
}
