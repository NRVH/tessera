// =============================================================================
// El diff de un .jar/.war/.ear/.zip entre dos revisiones: resta los directorios centrales de los
// dos lados en el main y sirve al renderer el índice restado y, a demanda, el texto o la fuente
// descompilada de UNA entrada. Los bytes del contenedor nunca cruzan el IPC. Depende de
// `GitService` (los blobs), de `zipRandom` y `JarIndexCache`, y del `Decompiler` compartido con
// el visor de clases. Los canales se registran en `ipc.ts`.
// Decisiones: docs/decisiones/comprimidos/diff-de-contenedores.md
// =============================================================================

import {
  type CompararRequest,
  type CompararResult,
  type EntradaRequest,
  type EntradaResult,
  type LadoComprimido,
  type LadoEntrada,
  type ProcedenciaJava
} from '../../shared/comprimidos-ipc.ts'
import { componerRutaArchivo, MAX_ANIDAMIENTO } from '../../shared/jarPath.ts'
import {
  abrirLectorDeArchivo,
  lectorDeBuffer,
  leerEntrada,
  leerIndice,
  ErrorZip,
  MAX_ENTRADA_BYTES,
  type EntradaZip,
  type IndiceZip,
  type LectorRango
} from '../java/zipRandom.ts'
import { compararIndices } from './compararIndices.ts'
import { JarIndexCache } from '../java/JarIndexCache.ts'
import { MAX_JAR_ANIDADO_BYTES } from '../java/JarService.ts'
import type { Decompiler, HermanasDeClase } from '../java/Decompiler.ts'
import type { GitService } from '../git/GitService.ts'
import { detectEncoding, decodeText, isBinaryBuffer } from '../files/textCodec.ts'

/**
 * Tope de un contenedor que hay que materializar entero en memoria. Es el MISMO
 * que el de un jar anidado (`MAX_JAR_ANIDADO_BYTES`) y por la misma razón: en los
 * dos casos no hay `pread` posible y el buffer vive en el main. No se usa el tope
 * de `git:blobBytes` (50 MiB) porque aquél protege la memoria del RENDERER, y aquí
 * los bytes no llegan a salir de este proceso.
 */
const MAX_CONTENEDOR_REVISION = MAX_JAR_ANIDADO_BYTES

/** Contenedores distintos en caché a la vez. Cuatro = los dos lados de la
 *  comparación actual y los dos de la anterior (volver atrás es gratis). */
const CACHE_MAX_ENTRADAS = 4

/**
 * Presupuesto de bytes de la caché.
 *
 * TIENE QUE DAR PARA LOS DOS LADOS DE UNA COMPARACIÓN EN EL PEOR CASO, o el tope se
 * vuelve en contra: con 192 MiB y dos .ear de 100 MiB, guardar el segundo lado
 * desalojaba el primero, y cada clic en una entrada relanzaba `git cat-file` sobre
 * el lado que acababa de tirarse — el ping-pong que la caché existe para evitar. Por
 * eso es `2 × MAX_CONTENEDOR_REVISION`: el número que hace cierta la frase de
 * arriba. Las cuatro ranuras sólo se llenan de verdad con contenedores normales (un
 * jar de proyecto son megas, no cientos), que es el caso que se da a diario.
 */
const CACHE_MAX_BYTES = 2 * MAX_CONTENEDOR_REVISION

/**
 * Tope del texto de UNA entrada. El mismo del diff de texto de Monaco: un solo
 * criterio de truncado en toda la app, y además acota lo que se infla de una vez.
 */
const MAX_TEXTO_ENTRADA = 2 * 1024 * 1024

/**
 * Panes de los que se recuerda su último token. Un usuario puede tener abiertos
 * varios diffs de comprimidos a la vez (keep-alive por proyecto), pero no docenas.
 */
const MAX_PANES_VIVOS = 16

/** Un contenedor abierto y listo para leer. */
interface Abierto {
  lector: LectorRango
  indice: IndiceZip
  cerrar(): Promise<void>
}

/** De dónde sale el contenedor de PRIMER nivel de un lado. */
type FuenteNivel0 =
  | { tipo: 'nada' }
  | { tipo: 'archivo'; abs: string }
  | { tipo: 'buffer'; bytes: Buffer; clave: string | null }
  | { tipo: 'error'; mensaje: string }

export interface ComprimidosServiceOptions {
  git: GitService
  decompiler: Decompiler
  /** `FileService.resolveProyecto`: traduce una ruta del renderer a una absoluta. */
  resolver: (relPosix: string) => string
  log?: (msg: string) => void
}

export class ComprimidosService {
  private readonly git: GitService
  private readonly decompiler: Decompiler
  private readonly resolver: (relPosix: string) => string
  private readonly log: (msg: string) => void
  private readonly cache = new JarIndexCache({
    maxEntradas: CACHE_MAX_ENTRADAS,
    maxBytes: CACHE_MAX_BYTES
  })
  /**
   * Último token pedido por cada pane. Ver "una descompilación viva por pane".
   *
   * Con tope: la clave la pone el renderer (una por pestaña de cada proyecto de cada
   * perfil) y nadie avisa cuando un pane se desmonta, así que sin él es un mapa que
   * sólo crece. Es diminuto por entrada, pero un mapa sin límite alimentado desde
   * fuera no se deja quieto. Se desaloja la más antigua, que es la que menos
   * probable es que vuelva a pedir nada.
   */
  private readonly tokenPorPane = new Map<string, number>()

  constructor(o: ComprimidosServiceOptions) {
    this.git = o.git
    this.decompiler = o.decompiler
    this.resolver = o.resolver
    this.log = o.log ?? ((m) => console.log(`[comprimidos] ${m}`))
  }

  dispose(): void {
    this.cache.vaciar()
    this.tokenPorPane.clear()
  }

  // -------------------------------------------------------------------------
  // COMPARAR
  // -------------------------------------------------------------------------

  /** `comprimidos:comparar`: el índice restado de los dos lados. Nunca rechaza: devuelve `error`. */
  async comparar(req: CompararRequest): Promise<CompararResult> {
    const vacio: CompararResult = {
      entradas: [],
      iguales: 0,
      truncado: false,
      avisos: [],
      error: ''
    }
    let antes: Abierto | null = null
    let despues: Abierto | null = null
    try {
      const [fa, fd] = await this.fuentesNivel0([req.antes, req.despues])
      antes = await this.abrir(fa, req.dentro)
      despues = await this.abrir(fd, req.dentro)
      if (antes === null && despues === null) {
        return { ...vacio, error: this.mensajeDeFuentes(fa, fd) }
      }
      const res = compararIndices(antes?.indice ?? null, despues?.indice ?? null)
      const avisos = [...(antes?.indice.avisos ?? []), ...(despues?.indice.avisos ?? [])]
      return {
        entradas: res.entradas,
        iguales: res.iguales,
        truncado: res.truncado,
        // Los avisos de los dos lados suelen ser el mismo texto; repetirlo dos veces
        // no informa de nada.
        avisos: [...new Set(avisos)],
        error: ''
      }
    } catch (err) {
      this.log(`no se pudo comparar ${req.despues.path || req.antes.path}: ${mensajeDeError(err)}`)
      return { ...vacio, error: mensajeDeError(err) }
    } finally {
      await antes?.cerrar()
      await despues?.cerrar()
    }
  }

  // -------------------------------------------------------------------------
  // ENTRADA
  // -------------------------------------------------------------------------

  /** `comprimidos:entrada`: el contenido de UNA entrada por los dos lados, como texto o fuente Java. */
  async entrada(req: EntradaRequest): Promise<EntradaResult> {
    this.tokenPorPane.delete(req.paneKey) // re-insertar lo mueve al final (LRU)
    this.tokenPorPane.set(req.paneKey, req.token)
    while (this.tokenPorPane.size > MAX_PANES_VIVOS) {
      const vieja = this.tokenPorPane.keys().next()
      if (vieja.done === true) break
      this.tokenPorPane.delete(vieja.value)
    }
    const base: EntradaResult = {
      paneKey: req.paneKey,
      token: req.token,
      nombre: req.nombre,
      antes: ladoVacio(),
      despues: ladoVacio(),
      descartado: false
    }
    let antes: Abierto | null = null
    let despues: Abierto | null = null
    try {
      const [fa, fd] = await this.fuentesNivel0([req.antes, req.despues])
      antes = await this.abrir(fa, req.dentro)
      despues = await this.abrir(fd, req.dentro)

      const bytesAntes = await this.bytesDeEntrada(antes, req.nombre)
      const bytesDespues = await this.bytesDeEntrada(despues, req.nombre)

      if (req.como === 'texto') {
        return { ...base, antes: aTexto(bytesAntes), despues: aTexto(bytesDespues) }
      }

      // Java: la ruta CANÓNICA (sin marca de revisión) es la que hace que dos
      // revisiones con los mismos bytes compartan acierto de caché.
      const rutaCanonica = componerRutaArchivo(req.antes.path || req.despues.path, [
        ...req.dentro,
        req.nombre
      ])
      const ladoA = await this.descompilarLado(req, rutaCanonica, bytesAntes, antes)
      if (ladoA === null) return { ...base, descartado: true }
      const ladoD = await this.descompilarLado(req, rutaCanonica, bytesDespues, despues)
      if (ladoD === null) return { ...base, descartado: true }

      return {
        ...base,
        antes: ladoA.lado,
        despues: ladoD.lado,
        java: { antes: ladoA.procedencia, despues: ladoD.procedencia }
      }
    } catch (err) {
      const mensaje = mensajeDeError(err)
      return {
        ...base,
        antes: { ...ladoVacio(), estado: 'no-legible', mensaje },
        despues: { ...ladoVacio(), estado: 'no-legible', mensaje }
      }
    } finally {
      await antes?.cerrar()
      await despues?.cerrar()
    }
  }

  /**
   * Descompila un lado. Devuelve null si la petición fue SUPERADA mientras tanto:
   * la comprobación va justo antes de arrancar el motor, que es lo que impide que
   * se forme una cola de JVM (ver cabecera).
   */
  private async descompilarLado(
    req: EntradaRequest,
    rutaCanonica: string,
    bytes: { bytes: Buffer | null; tamano: number; estado: LadoEntrada['estado']; mensaje: string },
    abierto: Abierto | null
  ): Promise<{ lado: LadoEntrada; procedencia: ProcedenciaJava | null } | null> {
    if (bytes.bytes === null || abierto === null) {
      return {
        lado: { texto: '', tamano: bytes.tamano, estado: bytes.estado, truncado: false, mensaje: bytes.mensaje },
        procedencia: null
      }
    }
    if (this.tokenPorPane.get(req.paneKey) !== req.token) return null

    const r = await this.decompiler.descompilar({
      path: rutaCanonica,
      motor: 'auto',
      targetKey: req.paneKey,
      token: req.token,
      origen: { tipo: 'bytes', bytes: bytes.bytes, hermanas: hermanasDelZip(abierto, req.nombre) },
      // Vacío en los DOS lados, a propósito (ver cabecera).
      contexto: []
    })

    const procedencia: ProcedenciaJava = {
      estado: r.estado,
      motor: r.motor,
      motorVersion: r.motorVersion,
      javaMajor: r.javaMajor,
      bytecode: r.bytecode,
      sinNombresLocales: r.sinNombresLocales,
      ms: r.ms,
      diagnostico: r.diagnostico
    }
    const ok = r.estado === 'ok' || r.estado === 'cache'
    return {
      lado: {
        texto: ok ? r.fuente : '',
        tamano: bytes.tamano,
        estado: ok ? 'ok' : 'no-legible',
        truncado: r.truncado,
        mensaje: r.mensaje
      },
      procedencia
    }
  }

  // -------------------------------------------------------------------------
  // Lectura de contenedores
  // -------------------------------------------------------------------------

  /**
   * Resuelve los contenedores de PRIMER nivel de varios lados a la vez: los que
   * salen de git se piden en un solo `cat-file --batch` y los del disco no pasan
   * por git. Los que ya están en caché no se vuelven a pedir.
   */
  private async fuentesNivel0(lados: readonly LadoComprimido[]): Promise<FuenteNivel0[]> {
    const salida: FuenteNivel0[] = lados.map(() => ({ tipo: 'nada' }))
    const porPedir: { i: number; clave: string }[] = []

    for (let i = 0; i < lados.length; i++) {
      const lado = lados[i]
      if (lado.source === 'empty' || lado.path === '') continue

      if (lado.source === 'worktree') {
        try {
          salida[i] = { tipo: 'archivo', abs: this.resolver(lado.path) }
        } catch (err) {
          salida[i] = { tipo: 'error', mensaje: mensajeDeError(err) }
        }
        continue
      }

      // Sólo los de COMMIT tienen clave estable: su oid no cambia nunca. El índice
      // es mutable, así que se lee cada vez.
      const clave =
        lado.source === 'commit' ? `commit:${lado.hash ?? ''}:${lado.path}` : ''
      const enCache = clave === '' ? undefined : this.cache.get(clave)
      if (enCache?.buffer !== undefined) {
        salida[i] = { tipo: 'buffer', bytes: enCache.buffer, clave }
        continue
      }
      porPedir.push({ i, clave })
    }

    if (porPedir.length > 0) {
      const brutos = await this.git.blobsBytesLote(
        porPedir.map((p) => ({
          source: lados[p.i].source as 'commit' | 'index',
          hash: lados[p.i].hash,
          path: lados[p.i].path
        })),
        MAX_CONTENEDOR_REVISION
      )
      for (let k = 0; k < porPedir.length; k++) {
        const { i, clave } = porPedir[k]
        const bruto = brutos[k]
        if (!bruto.exists) continue // sigue siendo 'nada': ese lado no tiene el archivo
        if (bruto.truncated || bruto.bytes === undefined) {
          salida[i] = {
            tipo: 'error',
            mensaje: `«${lados[i].path}» ocupa ${Math.round(bruto.size / 1024 / 1024)} MB en esa revisión y supera lo que Tessera puede abrir de una vez.`
          }
          continue
        }
        salida[i] = { tipo: 'buffer', bytes: Buffer.from(bruto.bytes), clave: clave || null }
      }
    }

    return salida
  }

  /** Abre un lado y baja por la cadena de contenedores anidados. */
  private async abrir(fuente: FuenteNivel0, dentro: readonly string[]): Promise<Abierto | null> {
    if (fuente.tipo === 'nada') return null
    if (fuente.tipo === 'error') throw new ErrorZip(fuente.mensaje)
    if (dentro.length > MAX_ANIDAMIENTO) {
      // El tope existe en `jarPath` y hasta ahora era una promesa que nadie cumplía.
      // Pasarse no sólo es caro (cada nivel materializa hasta MAX_CONTENEDOR_REVISION
      // en memoria): la ruta que se compone deja de poder parsearse, y el
      // descompilador acaba escribiendo la clase FUERA de su paquete sin avisar.
      throw new ErrorZip(
        `Sólo se puede bajar ${MAX_ANIDAMIENTO} niveles dentro de un archivo comprimido.`
      )
    }

    let lector: LectorRango
    let claveNivel: string | null = null
    if (fuente.tipo === 'archivo') {
      lector = await abrirLectorDeArchivo(fuente.abs)
    } else {
      lector = lectorDeBuffer(fuente.bytes)
      claveNivel = fuente.clave
    }

    // TODO lo que sigue puede lanzar —un zip corrupto, una entrada con compresión
    // rara, un contenedor que se está reescribiendo mientras se lee— y, si lo hace,
    // el llamador nunca llega a asignar su variable, así que su `finally` no tiene
    // qué cerrar. El descriptor quedaba abierto: en Windows eso además MANTIENE
    // BLOQUEADO el .jar contra el `mvn package` que lo está regenerando, y el
    // watcher vuelve a intentarlo con cada cambio, así que fugaba uno por intento.
    let abierto: Abierto | null = null
    try {
      abierto = {
        lector,
        indice: await this.indiceDe(lector, claveNivel, fuente),
        cerrar: () => lector.cerrar()
      }

      for (const nombre of dentro) {
        const entrada = abierto.indice.entradas.find((e) => e.nombre === nombre)
        if (entrada === undefined) {
          await abierto.cerrar()
          abierto = null
          return null // ese contenedor anidado no existe en esta revisión
        }
        const bytes = await leerEntrada(abierto.lector, entrada, {
          maxBytes: MAX_CONTENEDOR_REVISION
        })
        await abierto.cerrar()
        abierto = null
        claveNivel = claveNivel === null ? null : `${claveNivel}!/${nombre}`
        const dentroLector = lectorDeBuffer(bytes)
        abierto = {
          lector: dentroLector,
          indice: await this.indiceDe(dentroLector, claveNivel, {
            tipo: 'buffer',
            bytes,
            clave: claveNivel
          }),
          cerrar: () => dentroLector.cerrar()
        }
      }

      const salida = abierto
      abierto = null // ya es del llamador: su `finally` lo cierra
      return salida
    } finally {
      // Sólo queda algo aquí si se salió por una excepción a medio camino.
      if (abierto !== null) await abierto.cerrar().catch(() => undefined)
    }
  }

  /** Índice de un contenedor, cacheado sólo si su clave es inmutable. */
  private async indiceDe(
    lector: LectorRango,
    clave: string | null,
    fuente: FuenteNivel0
  ): Promise<IndiceZip> {
    if (clave !== null && clave !== '') {
      const hit = this.cache.get(clave)
      if (hit !== undefined) return hit.indice
    }
    const indice = await leerIndice(lector)
    if (clave !== null && clave !== '' && fuente.tipo === 'buffer') {
      this.cache.set(clave, {
        indice,
        buffer: fuente.bytes,
        bytes: fuente.bytes.length + indice.entradas.length * 200
      })
    }
    return indice
  }

  /** Bytes de una entrada, con su estado ya clasificado. */
  private async bytesDeEntrada(
    abierto: Abierto | null,
    nombre: string
  ): Promise<{
    bytes: Buffer | null
    tamano: number
    estado: LadoEntrada['estado']
    mensaje: string
  }> {
    if (abierto === null) {
      return { bytes: null, tamano: 0, estado: 'no-existe', mensaje: '' }
    }
    const entrada = abierto.indice.entradas.find((e) => e.nombre === nombre && !e.esDir)
    if (entrada === undefined) {
      return { bytes: null, tamano: 0, estado: 'no-existe', mensaje: '' }
    }
    if (entrada.tamano > MAX_TEXTO_ENTRADA) {
      return {
        bytes: null,
        tamano: entrada.tamano,
        estado: 'demasiado-grande',
        mensaje: `«${nombre}» ocupa ${Math.round(entrada.tamano / 1024)} KB descomprimida y supera el máximo que se puede comparar.`
      }
    }
    try {
      const bytes = await leerEntrada(abierto.lector, entrada, { maxBytes: MAX_ENTRADA_BYTES })
      return { bytes, tamano: entrada.tamano, estado: 'ok', mensaje: '' }
    } catch (err) {
      return { bytes: null, tamano: entrada.tamano, estado: 'no-legible', mensaje: mensajeDeError(err) }
    }
  }

  /** Mensaje que explica por qué no se pudo comparar ningún lado. */
  private mensajeDeFuentes(a: FuenteNivel0, b: FuenteNivel0): string {
    if (a.tipo === 'error') return a.mensaje
    if (b.tipo === 'error') return b.mensaje
    return 'Este archivo comprimido no existe en ninguna de las dos revisiones.'
  }
}

// ---------------------------------------------------------------------------
// Auxiliares puros
// ---------------------------------------------------------------------------

function ladoVacio(): LadoEntrada {
  return { texto: '', tamano: 0, estado: 'no-existe', truncado: false, mensaje: '' }
}

/** Bytes de una entrada -> texto listo para el diff, o el aviso que corresponda. */
function aTexto(r: {
  bytes: Buffer | null
  tamano: number
  estado: LadoEntrada['estado']
  mensaje: string
}): LadoEntrada {
  if (r.bytes === null) {
    return { texto: '', tamano: r.tamano, estado: r.estado, truncado: false, mensaje: r.mensaje }
  }
  if (isBinaryBuffer(r.bytes)) {
    return {
      texto: '',
      tamano: r.tamano,
      estado: 'binario',
      truncado: false,
      mensaje: 'Esta entrada tiene bytes nulos: no hay diff de texto que mostrar.'
    }
  }
  // El MISMO códec que usan el editor y los blobs de git: un archivo latin-1 dentro
  // de un jar tiene que verse igual que fuera de él.
  const encoding = detectEncoding(r.bytes)
  return {
    texto: decodeText(r.bytes, encoding),
    tamano: r.tamano,
    estado: 'ok',
    truncado: false,
    mensaje: ''
  }
}

/**
 * Las hermanas de una clase DENTRO de un contenedor ya abierto. Es la misma forma
 * que construye el descompilador para un jar de disco, pero sobre este lector: los
 * nombres van relativos a la carpeta de la clase y el sello es el CRC32 que el
 * directorio central ya trae (cero lecturas).
 */
function hermanasDelZip(abierto: Abierto, nombreEntrada: string): HermanasDeClase {
  const barra = nombreEntrada.lastIndexOf('/')
  const prefijo = barra < 0 ? '' : nombreEntrada.slice(0, barra + 1)
  const porNombre = new Map<string, EntradaZip>()
  for (const e of abierto.indice.entradas) {
    if (e.esDir || !e.nombre.startsWith(prefijo)) continue
    const relativo = e.nombre.slice(prefijo.length)
    if (!porNombre.has(relativo)) porNombre.set(relativo, e)
  }
  return {
    nombres: [...porNombre.keys()],
    leer: async (n) => {
      const e = porNombre.get(n)
      if (e === undefined) throw new ErrorZip(`«${n}» ya no está en el contenedor.`)
      return leerEntrada(abierto.lector, e, { maxBytes: MAX_ENTRADA_BYTES })
    },
    sello: (n) => String(porNombre.get(n)?.crc32 ?? '')
  }
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
