// =============================================================================
// Caché del catálogo del explorador (main, pura): esquemas, objetos, detalle, fuentes y nombres por conexión, sin
// caducidad por tiempo, LRU por conexión y con las cargas en vuelo atadas a su generación.
// Es la única caché autoritativa: emite `dbx:ev:catalogo` al invalidar y el renderer solo se invalida con él.
// Decisiones: docs/decisiones/bd/explorador-cache-catalogo.md
// =============================================================================

import type { DbEventoCatalogo } from '../../../shared/db-explorador-ipc.ts'

/**
 * Entradas por conexión. 300 cubre de sobra una sesión de trabajo intensa (una
 * docena de esquemas con sus carpetas y el detalle de las tablas abiertas); por
 * encima se expulsa lo menos usado, que es lo que el usuario ya no está mirando.
 */
export const MAX_ENTRADAS_POR_CONEXION = 300

/** Qué guarda una entrada. `publicos` son los sinónimos PUBLIC de Oracle. */
export type FamiliaCache =
  | 'esquemas'
  | 'conteos'
  | 'objetos'
  | 'detalle'
  | 'fuente'
  | 'resolver'
  | 'nombres'
  | 'publicos'
  | 'fks'
  /** Las bases del nivel «Bases» (SQL Server sin base fija). */
  | 'bases'

/**
 * Familias cuyo dato CRUZA esquemas: se borran con la invalidación de CUALQUIER
 * esquema de la conexión, no solo del suyo. Las claves ajenas que ENTRAN en `A.T`
 * las crea un DDL en el esquema de la tabla hija, que puede ser `B`: invalidando solo
 * `B`, el autocompletado de JOIN de `A.T` seguiría sin la FK nueva hasta un
 * «Refrescar». El precio es recargar las FK de las tablas que se estén usando tras
 * cualquier DDL de la conexión, que es barato (una consulta por tabla, bajo demanda).
 */
export const FAMILIAS_ENTRE_ESQUEMAS: readonly FamiliaCache[] = ['fks']

export interface ClaveCache {
  familia: FamiliaCache
  /** Esquema al que pertenece la entrada (lo usa la invalidación por esquema). */
  esquema?: string | null
  /** Lo que distingue entradas de la misma familia y esquema (objeto, tipo, parte…). */
  resto?: readonly string[]
  /**
   * La BASE del nivel «Bases» (SQL Server sin base fija): el mismo esquema
   * (`dbo`) existe en cada base. Ausente = la de la sesión, y la clave es la de siempre.
   */
  base?: string
}

export interface InvalidacionCache {
  /** Solo las entradas de este esquema. Sin él, TODA la conexión. */
  esquema?: string
  /**
   * Solo las entradas de esta base (con `esquema`, las de ese esquema en ella). Sin
   * ella, las de TODAS las bases (un esquema invalida el suyo en cada base: de más, nunca de
   * menos).
   */
  base?: string
  motivo: DbEventoCatalogo['motivo']
  /** Restringe a estas familias (por defecto, todas). */
  familias?: readonly FamiliaCache[]
}

export interface OpcionesCacheCatalogo {
  /** Emite `dbx:ev:catalogo`. Se llama SIEMPRE que se invalida, aunque no hubiera nada. */
  emitir: (evento: DbEventoCatalogo) => void
  maxPorConexion?: number
}

interface Entrada {
  esquema: string | null
  familia: FamiliaCache
  valor: unknown
  /** La base, si la entrada es de una del nivel «Bases». */
  base?: string
}

interface CacheConexion {
  entradas: Map<string, Entrada>
  /** Cada carga recuerda la generación en la que empezó: solo se comparte dentro de ella. */
  enVuelo: Map<string, { promesa: Promise<unknown>; generacion: number }>
  /** Sube con cada invalidación: una carga empezada antes ni se guarda ni se comparte. */
  generacion: number
}

function claveTexto(c: ClaveCache): string {
  // La base va como un OBJETO al final (el resto son textos): no puede chocar con ninguno, y
  // sin base la clave es la de siempre.
  if (c.base !== undefined) return JSON.stringify([c.familia, c.esquema ?? null, ...(c.resto ?? []), { base: c.base }])
  return JSON.stringify([c.familia, c.esquema ?? null, ...(c.resto ?? [])])
}

export class CacheCatalogo {
  private readonly porConexion = new Map<string, CacheConexion>()
  private readonly emitirEvento: (evento: DbEventoCatalogo) => void
  private readonly max: number

  constructor(opciones: OpcionesCacheCatalogo) {
    this.emitirEvento = opciones.emitir
    this.max = Math.max(1, opciones.maxPorConexion ?? MAX_ENTRADAS_POR_CONEXION)
  }

  private conexion(conexionId: string): CacheConexion {
    let c = this.porConexion.get(conexionId)
    if (!c) {
      c = { entradas: new Map(), enVuelo: new Map(), generacion: 0 }
      this.porConexion.set(conexionId, c)
    }
    return c
  }

  /** Valor guardado (y lo marca como recién usado), o `undefined`. */
  obtener<T>(conexionId: string, clave: ClaveCache): T | undefined {
    const c = this.porConexion.get(conexionId)
    if (!c) return undefined
    const k = claveTexto(clave)
    const e = c.entradas.get(k)
    if (!e) return undefined
    // LRU: el Map conserva el orden de inserción; reinsertar lleva al final.
    c.entradas.delete(k)
    c.entradas.set(k, e)
    return e.valor as T
  }

  guardar<T>(conexionId: string, clave: ClaveCache, valor: T): void {
    const c = this.conexion(conexionId)
    const k = claveTexto(clave)
    c.entradas.delete(k)
    const entrada: Entrada = { esquema: clave.esquema ?? null, familia: clave.familia, valor }
    if (clave.base !== undefined) entrada.base = clave.base
    c.entradas.set(k, entrada)
    while (c.entradas.size > this.max) {
      const primera = c.entradas.keys().next()
      if (primera.done) break
      c.entradas.delete(primera.value)
    }
  }

  /**
   * Devuelve lo guardado o lo carga UNA vez (las peticiones simultáneas comparten
   * la carga, salvo si hubo una invalidación entre medias: ver la cabecera).
   * `refrescar` ignora lo guardado y lo que esté en vuelo.
   */
  memo<T>(conexionId: string, clave: ClaveCache, cargar: () => Promise<T>, refrescar = false): Promise<T> {
    const c = this.conexion(conexionId)
    const k = claveTexto(clave)
    if (!refrescar) {
      const guardado = this.obtener<T>(conexionId, clave)
      if (guardado !== undefined) return Promise.resolve(guardado)
      const vuelo = c.enVuelo.get(k)
      if (vuelo && vuelo.generacion === c.generacion) return vuelo.promesa as Promise<T>
    }
    const generacion = c.generacion
    // `Promise.resolve().then(cargar)`: aunque `cargar` lanzara de forma síncrona, el
    // fallo llega como rechazo y el `finally` ya ve `promesa` asignada.
    const promesa: Promise<T> = Promise.resolve()
      .then(cargar)
      .then((valor) => {
        // Si entre medias se invalidó la conexión, el dato puede ser el viejo.
        if (this.porConexion.get(conexionId) === c && c.generacion === generacion) {
          this.guardar(conexionId, clave, valor)
        }
        return valor
      })
      .finally(() => {
        // La carga vieja no borra la que la sustituyó tras una invalidación.
        if (c.enVuelo.get(k)?.promesa === promesa) c.enVuelo.delete(k)
      })
    c.enVuelo.set(k, { promesa, generacion })
    return promesa
  }

  /**
   * Borra lo que corresponda y emite `dbx:ev:catalogo` (siempre: el renderer tiene
   * su propia caché y no sabe qué había aquí). Síncrono a propósito: el llamador
   * lo invoca antes de devolver la respuesta del invoke.
   */
  invalidar(conexionId: string, inv: InvalidacionCache): void {
    const c = this.porConexion.get(conexionId)
    if (c) {
      c.generacion++
      for (const [k, e] of [...c.entradas]) {
        const cruza = FAMILIAS_ENTRE_ESQUEMAS.indexOf(e.familia) >= 0
        if (inv.esquema !== undefined && e.esquema !== inv.esquema && !cruza) continue
        if (inv.base !== undefined && e.base !== inv.base && !cruza) continue
        if (inv.familias && inv.familias.indexOf(e.familia) < 0) continue
        c.entradas.delete(k)
      }
    }
    const evento: DbEventoCatalogo = { conexionId, motivo: inv.motivo }
    if (inv.esquema !== undefined) evento.esquema = inv.esquema
    this.emitirEvento(evento)
  }

  /** Solo el evento: lo que cambió no está guardado aquí (p. ej. los esquemas visibles). */
  notificar(evento: DbEventoCatalogo): void {
    this.emitirEvento(evento)
  }

  /** La conexión se borró: fuera todo, sin evento (el renderer poda por la lista). */
  olvidarConexion(conexionId: string): void {
    this.porConexion.delete(conexionId)
  }

  /** Entradas guardadas de una conexión (tests y diagnóstico). */
  tamano(conexionId: string): number {
    return this.porConexion.get(conexionId)?.entradas.size ?? 0
  }
}
