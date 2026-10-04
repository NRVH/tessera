// =============================================================================
// Navegar DENTRO de un .jar/.war/.ear/.aar como si fuera una carpeta, con el mismo contrato que
// el disco (`FileEntry[]`, `Buffer`) para que el explorador no sepa que existen los jars. Recibe
// la ruta absoluta ya resuelta y validada por `FileService.resolveSafe` (nunca traduce rutas) y
// abre, lee por rangos y cierra por operación. Depende de `zipRandom`, `jarListado` y
// `JarIndexCache`.
// Decisiones: docs/decisiones/comprimidos/contenedores-como-carpetas.md
// =============================================================================

import { promises as fs } from 'node:fs'
import {
  MAX_ANIDAMIENTO,
  contenedorEnDiscoDe,
  esNombreContenedor,
  normalizarRutaVirtual,
  parseRutaArchivo,
  type RutaArchivo
} from '../../shared/jarPath.ts'
import type { FileEntry } from '../../shared/files-ipc.ts'
import { listarNivel } from './jarListado.ts'
import { JarIndexCache } from './JarIndexCache.ts'
import {
  ErrorZip,
  abrirLectorDeArchivo,
  lectorDeBuffer,
  leerEntrada,
  leerIndice,
  type EntradaZip,
  type IndiceZip,
  type LectorRango
} from './zipRandom.ts'

/** Techo de cordura para un contenedor. No se lee entero, así que puede ser alto. */
export const MAX_CONTENEDOR_BYTES = 512 * 1024 * 1024

/** Techo para un contenedor ANIDADO, que sí vive inflado en memoria. */
export const MAX_JAR_ANIDADO_BYTES = 128 * 1024 * 1024

/** Cuántos contenedores se recuerdan a la vez, y cuánta memoria pueden ocupar. */
const CACHE_MAX_CONTENEDORES = 24
const CACHE_MAX_BYTES = 96 * 1024 * 1024

/** Coste aproximado de un índice en el presupuesto (los objetos JS de sus entradas). */
function costeIndice(indice: IndiceZip): number {
  let bytes = 0
  for (const e of indice.entradas) bytes += e.nombre.length * 2 + 80
  return bytes
}

/** Un contenedor abierto: su índice y cómo volver a leer sus bytes. */
interface ContenedorAbierto {
  indice: IndiceZip
  /** Crea un lector nuevo. El llamador lo cierra. */
  abrirLector: () => Promise<LectorRango>
  /**
   * Índice por nombre, construido una sola vez y memorizado.
   *
   * Sin él, cada búsqueda de entrada era un `find` lineal sobre hasta
   * MAX_ENTRADAS_INDICE entradas. Se nota porque descompilar UNA clase Swing con 25
   * listeners anónimos hace 25 búsquedas seguidas: en un jar grande son millones de
   * comparaciones de cadena para algo que un Map resuelve en O(1).
   */
  porNombre: () => Map<string, EntradaZip>
}

/**
 * Índices por nombre, memorizados POR ÍNDICE y no por apertura.
 *
 * Se probó colgar el memo de una clausura dentro del `ContenedorAbierto` y se
 * retiró: ese objeto se construye NUEVO en cada acierto de caché, así que el Map se
 * rehacía entero para consultar UNA sola clave y el memo moría con la petición.
 * Descompilar una clase Swing con 25 anónimas en un jar de 60 000 entradas
 * construía 25 Maps completos: medido, ~22x MÁS LENTO que el `find` lineal al que
 * venía a sustituir, y con 25 tablas hash grandes de basura para el GC.
 *
 * Colgado del `IndiceZip` —que es justo lo que la caché conserva— el Map sobrevive
 * entre peticiones, y no puede quedar obsoleto porque la clave de caché ya lleva
 * `mtime|size`: un jar reconstruido produce un índice nuevo, y con él un Map nuevo.
 * Al ser WeakMap no hay que contabilizar sus bytes en el presupuesto de la caché:
 * `podar()` suelta el índice y el GC se lleva el Map detrás.
 */
const indicesPorNombre = new WeakMap<IndiceZip, Map<string, EntradaZip>>()

/** Memoiza el Map por nombre de un índice (se construye al primer uso, no antes). */
function indexadorDe(indice: IndiceZip): () => Map<string, EntradaZip> {
  return () => {
    let mapa = indicesPorNombre.get(indice)
    if (mapa === undefined) {
      mapa = new Map()
      for (const e of indice.entradas) mapa.set(e.nombre, e)
      indicesPorNombre.set(indice, mapa)
    }
    return mapa
  }
}

export interface JarServiceOptions {
  log?: (msg: string) => void
}

export class JarService {
  private readonly cache = new JarIndexCache({
    maxEntradas: CACHE_MAX_CONTENEDORES,
    maxBytes: CACHE_MAX_BYTES
  })
  private readonly log: (msg: string) => void
  /** Aperturas en vuelo por clave: dos filas del árbol pidiendo el mismo jar a la
   *  vez comparten una sola lectura en vez de duplicarla. */
  private readonly enVuelo = new Map<string, Promise<ContenedorAbierto>>()

  constructor(opciones: JarServiceOptions = {}) {
    this.log = opciones.log ?? ((m) => console.log(`[jar] ${m}`))
  }

  /** Olvida lo cacheado de un contenedor (el watcher avisó de que cambió). */
  invalidar(abs: string): void {
    this.cache.invalidarPorRuta(abs)
  }

  dispose(): void {
    this.cache.vaciar()
    this.enVuelo.clear()
  }

  /**
   * Lista UN NIVEL dentro de un contenedor.
   *
   * @param absContenedor ruta de Windows del contenedor de disco, ya validada.
   * @param rutaVirtual   la ruta relativa del proyecto que pidió el renderer.
   */
  async listarDirectorio(absContenedor: string, rutaVirtual: string): Promise<FileEntry[]> {
    const partido = this.partirOEnRaiz(rutaVirtual)
    const { contenedor: abierto, entradaFinal } = await this.abrirCadena(absContenedor, partido)
    return listarNivel(abierto.indice.entradas, partido.contenedor, partido.entradas, entradaFinal)
  }

  /** Devuelve los bytes descomprimidos de una entrada. */
  async leerBytes(absContenedor: string, rutaVirtual: string): Promise<Buffer> {
    const partido = parseRutaArchivo(rutaVirtual)
    if (partido === null) {
      throw new ErrorZip('Esa ruta no apunta a nada dentro de un archivo comprimido.')
    }
    const { contenedor: abierto, entradaFinal } = await this.abrirCadena(absContenedor, partido)
    const entrada = this.buscarEntrada(abierto, entradaFinal, rutaVirtual)
    const lector = await abierto.abrirLector()
    try {
      return await leerEntrada(lector, entrada)
    } finally {
      await lector.cerrar()
    }
  }

  /** Metadatos de una entrada (sin leer sus bytes). */
  async statEntrada(absContenedor: string, rutaVirtual: string): Promise<EntradaZip> {
    const partido = parseRutaArchivo(rutaVirtual)
    if (partido === null) {
      throw new ErrorZip('Esa ruta no apunta a nada dentro de un archivo comprimido.')
    }
    const { contenedor: abierto, entradaFinal } = await this.abrirCadena(absContenedor, partido)
    return this.buscarEntrada(abierto, entradaFinal, rutaVirtual)
  }

  /** El índice completo (lo consumirá la ficha de identidad del jar). */
  async indiceDe(absContenedor: string, rutaVirtual: string): Promise<IndiceZip> {
    const partido = this.partirOEnRaiz(rutaVirtual)
    const { contenedor: abierto } = await this.abrirCadena(absContenedor, partido)
    return abierto.indice
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  /**
   * Parte la ruta para LISTAR, tratando todo contenedor como su propia raíz.
   *
   * Son dos casos, y los dos son "el árbol pide el primer nivel de un contenedor":
   *
   * · PELADO ("lib/x.jar", sin `!/`). `parseRutaArchivo` devuelve null por contrato,
   *   y sin esta rama expandir un .jar por primera vez no funcionaría nunca.
   *
   * · ANIDADO ("app.war!/WEB-INF/lib/dep.jar"). Ese SÍ parsea, pero lo hace como una
   *   ENTRADA del padre, no como raíz propia: `listarNivel` acababa filtrando las
   *   entradas del .war por el prefijo "WEB-INF/lib/dep.jar/" y el resultado era
   *   SIEMPRE vacío. Y vacío en silencio, que es lo peor: `listarNivel` marca esas
   *   filas con `contenedor:'jar'`, así que el árbol les pinta chevron y el usuario
   *   las despliega esperando ver algo. Añadir la entrada vacía es lo que hace que
   *   `abrirCadena` baje un nivel más y liste la raíz del jar anidado.
   */
  private partirOEnRaiz(rutaVirtual: string): RutaArchivo {
    const partido = parseRutaArchivo(rutaVirtual)
    if (partido === null) {
      // `normalizarRutaVirtual` y NO un `replace` a mano: aquí había uno que además
      // convertía `\` en `/`. En el espacio del renderer una barra invertida es un
      // carácter del NOMBRE (lo explica la cabecera de `jarPath.ts`), así que con una
      // carpeta `a\b` —legal en macOS— los hijos del jar salían con la ruta partida y
      // cada clic terminaba en ENOENT.
      return { contenedor: normalizarRutaVirtual(rutaVirtual), entradas: [''] }
    }
    const ultima = partido.entradas[partido.entradas.length - 1]
    if (ultima !== '' && esNombreContenedor(ultima)) {
      return { contenedor: partido.contenedor, entradas: [...partido.entradas, ''] }
    }
    return partido
  }

  /** Busca una entrada por su ruta interna, con un mensaje humano si no está. */
  private buscarEntrada(contenedor: ContenedorAbierto, interna: string, rutaVirtual: string): EntradaZip {
    const entrada = contenedor.porNombre().get(interna)
    if (entrada === undefined) {
      throw new ErrorZip(
        `«${interna}» ya no está dentro del archivo. ` +
          'Puede que se haya reconstruido desde la última vez que lo abriste.'
      )
    }
    void rutaVirtual
    return entrada
  }

  /**
   * Abre la cadena de contenedores de una ruta (el de disco y, si los hay, los
   * anidados) y devuelve el ÚLTIMO junto con la entrada que queda por resolver
   * dentro de él.
   */
  private async abrirCadena(
    absContenedor: string,
    partido: RutaArchivo
  ): Promise<{ contenedor: ContenedorAbierto; entradaFinal: string }> {
    if (partido.entradas.length > MAX_ANIDAMIENTO) {
      throw new ErrorZip('Hay demasiados archivos anidados unos dentro de otros.')
    }

    const stat = await fs.stat(absContenedor)
    if (!stat.isFile()) {
      // El desempate del que habla jarPath: una CARPETA real llamada "algo.jar" no
      // es un contenedor. Aquí se resuelve mirando el disco, que es lo único que
      // puede distinguirlo.
      throw new ErrorZip('Eso es una carpeta, no un archivo comprimido.')
    }
    if (stat.size > MAX_CONTENEDOR_BYTES) {
      throw new ErrorZip(
        `El archivo ocupa ${Math.round(stat.size / 1024 / 1024)} MB y supera el máximo que Tessera abre.`
      )
    }

    let clave = JarIndexCache.claveDisco(absContenedor, stat.mtimeMs, stat.size)
    let actual = await this.abrirDeDisco(absContenedor, clave)

    // Baja por los contenedores anidados: todas las entradas menos la última son
    // otros contenedores que hay que inflar y volver a indexar.
    for (let i = 0; i < partido.entradas.length - 1; i++) {
      const interna = partido.entradas[i]
      if (!esNombreContenedor(interna)) {
        throw new ErrorZip(`«${interna}» no es un archivo que Tessera pueda abrir por dentro.`)
      }
      const claveHija = JarIndexCache.claveAnidada(clave, interna)
      actual = await this.abrirAnidado(actual, interna, claveHija)
      clave = claveHija
    }

    return { contenedor: actual, entradaFinal: partido.entradas[partido.entradas.length - 1] }
  }

  /** Abre (o recupera de caché) el contenedor de PRIMER nivel, el que está en disco. */
  private async abrirDeDisco(abs: string, clave: string): Promise<ContenedorAbierto> {
    const cacheado = this.cache.get(clave)
    if (cacheado !== undefined) {
      return {
        indice: cacheado.indice,
        abrirLector: () => abrirLectorDeArchivo(abs),
        porNombre: indexadorDe(cacheado.indice)
      }
    }
    const enCurso = this.enVuelo.get(clave)
    if (enCurso !== undefined) return enCurso

    const tarea = (async (): Promise<ContenedorAbierto> => {
      const lector = await abrirLectorDeArchivo(abs)
      try {
        const t0 = Date.now()
        const indice = await leerIndice(lector)
        this.log(`índice de ${abs}: ${indice.entradas.length} entradas en ${Date.now() - t0} ms`)
        this.cache.set(clave, { indice, bytes: costeIndice(indice) })
        return { indice, abrirLector: () => abrirLectorDeArchivo(abs), porNombre: indexadorDe(indice) }
      } finally {
        await lector.cerrar()
      }
    })().finally(() => this.enVuelo.delete(clave))

    this.enVuelo.set(clave, tarea)
    return tarea
  }

  /** Infla un contenedor anidado y lo indexa, sin escribirlo a disco. */
  private async abrirAnidado(
    padre: ContenedorAbierto,
    interna: string,
    clave: string
  ): Promise<ContenedorAbierto> {
    const cacheado = this.cache.get(clave)
    if (cacheado?.buffer !== undefined) {
      const bytes = cacheado.buffer
      return {
        indice: cacheado.indice,
        abrirLector: async () => lectorDeBuffer(bytes),
        porNombre: indexadorDe(cacheado.indice)
      }
    }

    // Dedupe en vuelo, igual que en `abrirDeDisco`. Aquí importa MÁS: inflar un jar
    // anidado admite hasta MAX_JAR_ANIDADO_BYTES, así que dos peticiones a la vez
    // sobre el mismo `WEB-INF/lib/dep.jar` reservaban esa memoria por duplicado.
    const enCurso = this.enVuelo.get(clave)
    if (enCurso !== undefined) return enCurso

    const tarea = (async (): Promise<ContenedorAbierto> => {
      const entrada = padre.porNombre().get(interna)
      if (entrada === undefined) {
        throw new ErrorZip(`«${interna}» no está dentro del archivo que lo contiene.`)
      }
      if (entrada.tamano > MAX_JAR_ANIDADO_BYTES) {
        throw new ErrorZip(
          `El archivo anidado «${interna}» ocupa ${Math.round(entrada.tamano / 1024 / 1024)} MB y es demasiado grande para abrirlo por dentro.`
        )
      }

      const lectorPadre = await padre.abrirLector()
      let bytes: Buffer
      try {
        bytes = await leerEntrada(lectorPadre, entrada, { maxBytes: MAX_JAR_ANIDADO_BYTES })
      } finally {
        await lectorPadre.cerrar()
      }

      const indice = await leerIndice(lectorDeBuffer(bytes))
      this.cache.set(clave, { indice, buffer: bytes, bytes: bytes.length + costeIndice(indice) })
      return { indice, abrirLector: async () => lectorDeBuffer(bytes), porNombre: indexadorDe(indice) }
    })().finally(() => this.enVuelo.delete(clave))

    this.enVuelo.set(clave, tarea)
    return tarea
  }
}

/** Reexporta para que `FileService` no tenga que importar de dos sitios. */
export { contenedorEnDiscoDe, ErrorZip }
