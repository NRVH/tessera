// =============================================================================
// cacheMetaBd — la caché de CATÁLOGO del renderer (árbol, popover de esquemas y
// autocompletado), una sola para toda la vista de bases de datos: peticiones deduplicadas,
// invalidación solo por el evento `dbx:ev:catalogo` (marca obsoleto) y la instantánea que
// aplana el árbol. Sin React ni DOM: la API del main se inyecta (las pruebas usan una falsa);
// la instancia de la app la crea `cacheMetaBd()` sobre `window.tessera` al primer uso.
// Decisiones: docs/decisiones/bd/ui-arbol-cache-meta.md
// =============================================================================

import { ambitoEsquema, claveBd, partesDetalle } from './arbolBd.ts'
import { mensajeDeError } from './filasArbolBd.ts'
import { recorrerClaves, type RecorridoClaves } from './arbolClaves.ts'
import {
  ERROR_NOMBRES_MS,
  SEP,
  TIPOS_CON_COLUMNAS,
  afectaEvento,
  construirInstantanea,
  cubre,
  desplegarIndice,
  escaneoClaves,
  esRespuesta,
  fusionarDetalle,
  llamarFamilia,
  normalizarPartes,
  unir,
  type CargaFamilia
} from './cacheMetaBdPuro.ts'
import type { CargaBd } from './arbolBd.ts'
import type {
  DbBasesRespuesta,
  DbColumnaInfo,
  DbConteos,
  DbDetalle,
  DbErrorSql,
  DbEsquemasRespuesta,
  DbEventoCatalogo,
  DbIndiceNombres,
  DbObjeto,
  DbParteDetalle,
  DbRefObjeto,
  DbRelacionesFk,
  DbRespuesta,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import type {
  ApiCatalogoBd,
  ApiFamiliasBd,
  Entrada,
  ErrorGuardado,
  IndiceDesplegado,
  InstantaneaArbolBd,
  NombreIndexado,
  Vuelo
} from './cacheMetaBdTipos.ts'

export { ERROR_NOMBRES_MS } from './cacheMetaBdPuro.ts'
export type { ApiCatalogoBd, ApiFamiliasBd, NombreIndexado } from './cacheMetaBdTipos.ts'

/** La caché de catálogo: se le inyecta la API del main, un reloj y, opcional, la de documentos y claves. */
export class CacheMetaBd {
  private readonly datos = new Map<string, Entrada>()
  private readonly errores = new Map<string, ErrorGuardado>()
  private readonly vuelos = new Map<string, Vuelo>()
  private readonly oyentes = new Set<() => void>()
  private ver = 0
  private instantanea: { ver: number; valor: InstantaneaArbolBd } | null = null
  private readonly desplegados = new WeakMap<DbIndiceNombres, IndiceDesplegado>()
  // Campos explícitos y no "parameter properties": el type-stripping de `node` no las transforma.
  private readonly api: ApiCatalogoBd
  private readonly ahora: () => number
  private readonly familias: ApiFamiliasBd | null
  /** El patrón de cada base de claves filtrada, por `claveBd.kvBase`. */
  private readonly patronesKv = new Map<string, string>()
  /** Las bases con una «Cargar más» en vuelo, por `claveBd.kvBase`. */
  private readonly kvMas = new Set<string>()

  constructor(api: ApiCatalogoBd, ahora: () => number = () => Date.now(), familias: ApiFamiliasBd | null = null) {
    this.api = api
    this.ahora = ahora
    this.familias = familias
    api.onCatalogo((e) => this.invalidar(e))
  }

  // --- Suscripción (forma de `useSyncExternalStore`) --------------------------------

  /** Avisa de cualquier cambio. Devuelve la baja. Estable: se puede pasar tal cual. */
  readonly suscribir = (cb: () => void): (() => void) => {
    this.oyentes.add(cb)
    return () => {
      this.oyentes.delete(cb)
    }
  }

  /** Número que cambia con cada cambio (la instantánea de `useSyncExternalStore`). */
  readonly version = (): number => this.ver

  private notificar(): void {
    this.ver++
    for (const cb of [...this.oyentes]) cb()
  }

  // --- Núcleo: pedir con deduplicación ------------------------------------------------

  private pedir<T>(
    clave: string,
    claveVuelo: string,
    llamar: () => Promise<DbRespuesta<T>>,
    guardar: (valor: T, obsoleta: boolean) => void,
    registrarError: boolean
  ): Promise<DbRespuesta<T>> {
    const enVuelo = this.vuelos.get(claveVuelo)
    if (enVuelo && !enVuelo.obsoleta) return enVuelo.promesa as Promise<DbRespuesta<T>>
    const vuelo: Vuelo = { promesa: Promise.resolve({ ok: true, valor: null }), obsoleta: false }
    const promesa = (async (): Promise<DbRespuesta<T>> => {
      let r: DbRespuesta<T>
      try {
        const bruto: unknown = await llamar()
        r = esRespuesta(bruto)
          ? (bruto as DbRespuesta<T>)
          : { ok: false, error: { motivo: 'interno', mensaje: 'Respuesta inesperada del proceso principal.' } }
      } catch (err) {
        r = { ok: false, error: { motivo: 'interno', mensaje: mensajeDeError(err) } }
      }
      // Solo la ÚLTIMA petición de esta clave escribe: una anterior que llega tarde
      // traería datos de antes de la invalidación que la sustituyó.
      if (this.vuelos.get(claveVuelo) === vuelo) {
        this.vuelos.delete(claveVuelo)
        if (r.ok) {
          guardar(r.valor, vuelo.obsoleta)
          if (registrarError) this.errores.delete(clave)
        } else if (registrarError) {
          this.errores.set(clave, { error: r.error, en: this.ahora() })
          this.datos.delete(clave)
        }
        this.notificar()
      }
      return r
    })()
    vuelo.promesa = promesa as Promise<DbRespuesta<unknown>>
    this.vuelos.set(claveVuelo, vuelo)
    return promesa
  }

  /**
   * Lo fresco de `clave` sin viajar; si no, (con `recordarError`, el error reciente sin volver
   * a preguntar y si no) la petición deduplicada que guarda la respuesta en esa misma clave.
   */
  private cargarEn<T>(clave: string, llamar: () => Promise<DbRespuesta<T>>, registrarError: boolean, recordarError = false): Promise<DbRespuesta<T>> {
    const e = this.fresca(clave)
    if (e) return Promise.resolve({ ok: true, valor: e.valor as T })
    if (recordarError) {
      const err = this.errorReciente(clave)
      if (err) return Promise.resolve({ ok: false, error: err })
    }
    return this.pedir(clave, clave, llamar, (v, obsoleta) => this.datos.set(clave, { valor: v, obsoleta }), registrarError)
  }

  private fresca(clave: string): Entrada | null {
    const e = this.datos.get(clave)
    return e && !e.obsoleta ? e : null
  }

  private errorReciente(clave: string): DbErrorSql | null {
    const g = this.errores.get(clave)
    return g && this.ahora() - g.en < ERROR_NOMBRES_MS ? g.error : null
  }

  /** El valor guardado en `clave` (aunque esté obsoleto), o null. */
  private valor<T>(clave: string): T | null {
    const e = this.datos.get(clave)
    return e ? (e.valor as T) : null
  }

  // --- Árbol ---------------------------------------------------------------------------

  /**
   * Esquemas de la conexión (abre la sesión de catálogo si hace falta). Con `base` (nivel
   * «Bases»), los de ESA base, en la clave de su nodo; sin ella, la llamada de siempre.
   */
  cargarEsquemas(conexionId: string, base?: string): Promise<DbRespuesta<DbEsquemasRespuesta>> {
    const clave = base === undefined ? claveBd.conexion(conexionId) : claveBd.base(conexionId, base)
    return this.cargarEn(clave, () => (base === undefined ? this.api.esquemas(conexionId) : this.api.esquemas(conexionId, false, base)), true)
  }

  esquemas(conexionId: string, base?: string): DbEsquemasRespuesta | null {
    return this.valor(base === undefined ? claveBd.conexion(conexionId) : claveBd.base(conexionId, base))
  }

  /** Las bases de una conexión con nivel «Bases». */
  cargarBases(conexionId: string): Promise<DbRespuesta<DbBasesRespuesta>> {
    return this.cargarEn(claveBd.bases(conexionId), () => this.api.bases(conexionId), true)
  }

  bases(conexionId: string): DbBasesRespuesta | null {
    return this.valor(claveBd.bases(conexionId))
  }

  /** Conteos por tipo de un esquema (un solo viaje). */
  cargarResumen(conexionId: string, esquema: string, base?: string): Promise<DbRespuesta<DbConteos>> {
    return this.cargarEn(
      claveBd.esquema(conexionId, esquema, base),
      () => (base === undefined ? this.api.resumen(conexionId, esquema) : this.api.resumen(conexionId, esquema, false, base)),
      true
    )
  }

  resumen(conexionId: string, esquema: string, base?: string): DbConteos | null {
    return this.valor(claveBd.esquema(conexionId, esquema, base))
  }

  /** Objetos de un tipo en un esquema. */
  cargarObjetos(conexionId: string, esquema: string, tipo: DbTipoObjeto, base?: string): Promise<DbRespuesta<DbObjeto[]>> {
    return this.cargarEn(
      claveBd.carpeta(conexionId, esquema, tipo, base),
      () =>
        base === undefined
          ? this.api.objetos(conexionId, esquema, tipo)
          : this.api.objetos(conexionId, esquema, tipo, false, base),
      true
    )
  }

  objetos(conexionId: string, esquema: string, tipo: DbTipoObjeto, base?: string): readonly DbObjeto[] | null {
    return this.valor(claveBd.carpeta(conexionId, esquema, tipo, base))
  }

  /**
   * Detalle de un objeto, SOLO las `partes` pedidas (se fusionan con las que ya hubiera). Un
   * error solo se registra para el árbol si se pidieron todas las partes que pinta ese tipo.
   */
  cargarDetalle(
    conexionId: string,
    objeto: DbRefObjeto,
    partes: readonly DbParteDetalle[]
  ): Promise<DbRespuesta<DbDetalle>> {
    const clave = claveBd.objeto(conexionId, objeto.esquema, objeto.tipo, objeto.nombre, objeto.firma, objeto.base)
    const pedidas = normalizarPartes(partes)
    const e = this.fresca(clave)
    if (e && cubre(e.partes, pedidas)) return Promise.resolve({ ok: true, valor: e.valor as DbDetalle })
    const registrarError = cubre(new Set(pedidas), partesDetalle(objeto.tipo))
    return this.pedir(
      clave,
      unir([clave, '~', pedidas.join(',')]),
      () => this.api.detalle(conexionId, objeto, pedidas),
      (v, obsoleta) => this.datos.set(clave, fusionarDetalle(this.datos.get(clave), v, pedidas, obsoleta, objeto.tipo)),
      registrarError
    )
  }

  /** Detalle ya cargado si trae todas las `partes` (por defecto, las que pinta el árbol). */
  detalle(conexionId: string, objeto: DbRefObjeto, partes?: readonly DbParteDetalle[]): DbDetalle | null {
    const e = this.datos.get(claveBd.objeto(conexionId, objeto.esquema, objeto.tipo, objeto.nombre, objeto.firma, objeto.base))
    if (!e) return null
    return cubre(e.partes, normalizarPartes(partes ?? partesDetalle(objeto.tipo))) ? (e.valor as DbDetalle) : null
  }

  /** Columnas de una tabla o vista por nombre, SIN saber su tipo. null si no están en caché. */
  columnas(conexionId: string, esquema: string, nombre: string, base?: string): readonly DbColumnaInfo[] | null {
    const e = this.entradaColumnas(conexionId, esquema, nombre, base)
    return e ? ((e.valor as DbDetalle).columnas ?? null) : null
  }

  /**
   * ¿Las columnas que da `columnas()` están marcadas obsoletas? false si no hay ninguna. Lo mira
   * «Expandir columnas»: una lista de antes de un `ALTER TABLE … ADD` daría menos columnas.
   */
  columnasObsoletas(conexionId: string, esquema: string, nombre: string, base?: string): boolean {
    return this.entradaColumnas(conexionId, esquema, nombre, base)?.obsoleta === true
  }

  /** La entrada del detalle cuyas columnas lee `columnas()` (la de cualquier tipo que las tenga). */
  private entradaColumnas(conexionId: string, esquema: string, nombre: string, base?: string): Entrada | null {
    for (const tipo of TIPOS_CON_COLUMNAS) {
      const e = this.datos.get(claveBd.objeto(conexionId, esquema, tipo, nombre, undefined, base))
      if (e && e.partes && e.partes.has('columnas') && (e.valor as DbDetalle).columnas) return e
    }
    return null
  }

  /** Carga las columnas de un objeto (tabla por defecto: el catálogo las lee igual de una vista). */
  cargarColumnas(
    conexionId: string,
    esquema: string,
    nombre: string,
    tipo: DbTipoObjeto = 'tabla',
    base?: string
  ): Promise<DbRespuesta<DbDetalle>> {
    return this.cargarDetalle(conexionId, base === undefined ? { esquema, nombre, tipo } : { esquema, nombre, tipo, base }, ['columnas'])
  }

  // --- Sinónimos y claves ajenas ----------------------------------------------------------

  /** Destino de un sinónimo (hasta 3 saltos, en el main). Sin registrar el error: cada intento vuelve a preguntar. */
  cargarResolucion(conexionId: string, esquema: string, nombre: string): Promise<DbRespuesta<DbRefObjeto>> {
    return this.cargarEn(unir(['resolver', conexionId, esquema, nombre]), () => this.api.resolver(conexionId, esquema, nombre), false)
  }

  resolucion(conexionId: string, esquema: string, nombre: string): DbRefObjeto | null {
    return this.valor(unir(['resolver', conexionId, esquema, nombre]))
  }

  /**
   * Las FKs que salen de `esquema.tabla` y las que entran en ella. La clave NO lleva el tipo: una
   * vista no tiene FKs y la respuesta vacía también se guarda. Su error lo recuerda su cliente.
   */
  cargarFks(conexionId: string, objeto: DbRefObjeto): Promise<DbRespuesta<DbRelacionesFk>> {
    const clave = unir(['fks', conexionId, ambitoEsquema(objeto.esquema, objeto.base), objeto.nombre])
    return this.cargarEn(clave, () => this.api.fks(conexionId, objeto), false)
  }

  /** FKs ya cargadas de `esquema.tabla` (aunque estén obsoletas), o null. */
  fks(conexionId: string, esquema: string, tabla: string, base?: string): DbRelacionesFk | null {
    return this.valor(unir(['fks', conexionId, ambitoEsquema(esquema, base), tabla]))
  }

  /** ¿Las FKs guardadas están obsoletas? Las vuelve a pedir quien las usa: no tienen fila del árbol. */
  fksObsoletas(conexionId: string, esquema: string, tabla: string, base?: string): boolean {
    return this.datos.get(unir(['fks', conexionId, ambitoEsquema(esquema, base), tabla]))?.obsoleta === true
  }

  // --- Autocompletado ------------------------------------------------------------------

  private claveNombres(conexionId: string, esquemaActual: string | null | undefined, base?: string): string {
    // Con base, un elemento más al final; sin ella, la clave de siempre.
    return unir(base === undefined ? ['nombres', conexionId, esquemaActual ?? ''] : ['nombres', conexionId, esquemaActual ?? '', base])
  }

  /**
   * Índice de nombres de los esquemas visibles más `esquemaActual` (el de la sesión de la
   * consola); con `base`, el de ESA base. Un error reciente se devuelve sin volver a preguntar.
   */
  cargarNombres(conexionId: string, esquemaActual?: string | null, base?: string): Promise<DbRespuesta<DbIndiceNombres>> {
    return this.cargarEn(
      this.claveNombres(conexionId, esquemaActual, base),
      () =>
        base === undefined
          ? this.api.nombres(conexionId, esquemaActual ?? null)
          : this.api.nombres(conexionId, esquemaActual ?? null, false, base),
      true,
      true
    )
  }

  nombres(conexionId: string, esquemaActual?: string | null, base?: string): DbIndiceNombres | null {
    return this.valor(this.claveNombres(conexionId, esquemaActual, base))
  }

  /** El índice desplegado a objetos: los de `esquema`, o todos con null. [] sin índice. Se memoriza por índice. */
  objetosIndexados(
    conexionId: string,
    esquemaActual: string | null | undefined,
    esquema: string | null,
    base?: string
  ): readonly NombreIndexado[] {
    const indice = this.nombres(conexionId, esquemaActual, base)
    if (!indice) return []
    let d = this.desplegados.get(indice)
    if (!d) {
      d = desplegarIndice(indice)
      this.desplegados.set(indice, d)
    }
    return esquema === null ? d.todos : (d.porEsquema.get(esquema) ?? [])
  }

  /** Sinónimos PUBLIC (Oracle). Un error reciente se devuelve sin volver a preguntar. */
  cargarPublicos(conexionId: string): Promise<DbRespuesta<string[]>> {
    return this.cargarEn(unir(['publicos', conexionId]), () => this.api.nombresPublicos(conexionId), true, true)
  }

  publicos(conexionId: string): readonly string[] | null {
    return this.valor(unir(['publicos', conexionId]))
  }

  /**
   * Esquema por defecto de la conexión según lo cargado (la lista de esquemas o cualquier
   * índice de nombres), o null. El de la SESIÓN de una consola lo sabe `DbEstadoSesion.esquema`.
   */
  esquemaPorDefecto(conexionId: string): string | null {
    const resp = this.esquemas(conexionId)
    if (resp) return resp.porDefecto
    const prefijo = unir(['nombres', conexionId]) + SEP
    for (const [clave, e] of this.datos) {
      if (clave.indexOf(prefijo) === 0) return (e.valor as DbIndiceNombres).porDefecto
    }
    return null
  }

  // --- Estado por clave --------------------------------------------------------------

  /** ¿Lo que hay guardado en esta clave está marcado como obsoleto? */
  obsoleta(clave: string): boolean {
    return this.datos.get(clave)?.obsoleta === true
  }

  /** Error registrado para la clave de un nodo del árbol, o null. */
  error(clave: string): DbErrorSql | null {
    return this.errores.get(clave)?.error ?? null
  }

  /** ¿Hay una petición en vuelo para esta clave? */
  cargando(clave: string): boolean {
    for (const k of this.vuelos.keys()) if (k === clave || k.indexOf(clave + SEP + '~') === 0) return true
    return false
  }

  /** Pide la carga de un nodo del árbol (la que describe su marcador «Cargando…»). */
  readonly cargar = (carga: CargaBd): Promise<DbRespuesta<unknown>> => {
    switch (carga.tipo) {
      case 'esquemas':
        return this.cargarEsquemas(carga.conexionId, carga.base)
      case 'bases':
        return this.cargarBases(carga.conexionId)
      case 'resumen':
        return this.cargarResumen(carga.conexionId, carga.esquema, carga.base)
      case 'objetos':
        return this.cargarObjetos(carga.conexionId, carga.esquema, carga.tipoObjeto, carga.base)
      case 'detalle':
        return this.cargarDetalle(carga.conexionId, carga.objeto, carga.partes)
      case 'docBases':
      case 'colecciones':
      case 'kvBases':
      case 'kvClaves':
        return this.cargarFamilia(carga)
    }
  }

  // --- Documentos y claves ---------------------------------------------------------------

  /**
   * Una carga de documentos o claves (bases, colecciones o el recorrido de claves de una base),
   * en la clave de la carga, con la MISMA deduplicación, errores e invalidación que las SQL.
   */
  private cargarFamilia(carga: CargaFamilia): Promise<DbRespuesta<unknown>> {
    // El patrón se lee al llamar, como el resto de la petición.
    return this.cargarEn(carga.clave, () => llamarFamilia(this.familias, carga, () => this.patronesKv.get(carga.clave) ?? ''), true)
  }

  /**
   * «Cargar más claves» de una base: sigue su recorrido desde el cursor guardado. Sin recorrido,
   * o ya acabado, no pide nada; sobre uno OBSOLETO vuelve a empezar como la carga del marcador.
   */
  cargarMasClaves(conexionId: string, base: number): Promise<DbRespuesta<unknown>> {
    const clave = claveBd.kvBase(conexionId, base)
    const e = this.datos.get(clave)
    const f = this.familias
    if (!e || !f) return Promise.resolve({ ok: true, valor: e?.valor ?? null })
    if (e.obsoleta) return this.cargar({ tipo: 'kvClaves', clave, conexionId, base })
    const previo = e.valor as RecorridoClaves
    if (previo.cursor === '0') return Promise.resolve({ ok: true, valor: previo })
    const enVuelo = this.vuelos.get(clave)
    if (enVuelo && !enVuelo.obsoleta) return enVuelo.promesa
    const patron = this.patronesKv.get(clave) ?? ''
    this.kvMas.add(clave)
    this.notificar()
    const p = this.pedir(
      clave,
      clave,
      () => recorrerClaves((cursor) => f.kvEscanear(escaneoClaves(conexionId, base, patron, cursor)), previo, patron),
      (v, obsoleta) => this.datos.set(clave, { valor: v, obsoleta }),
      true
    )
    const fin = (): void => {
      if (this.kvMas.delete(clave)) this.notificar()
    }
    p.then(fin, fin)
    return p
  }

  /** El patrón de una base de claves ('' = sin filtro). */
  patronClaves(conexionId: string, base: number): string {
    return this.patronesKv.get(claveBd.kvBase(conexionId, base)) ?? ''
  }

  /**
   * Cambia el patrón de una base (`patronDeFiltro` ya aplicado; '' lo quita). Tira lo recorrido,
   * su error y la petición en vuelo (su respuesta sería del patrón viejo: sin su vuelo, `pedir`
   * ya no la guarda); el árbol, si la base está desplegada, pide el recorrido nuevo.
   */
  filtrarClaves(conexionId: string, base: number, patron: string): void {
    const clave = claveBd.kvBase(conexionId, base)
    if ((this.patronesKv.get(clave) ?? '') === patron) return
    if (patron === '') this.patronesKv.delete(clave)
    else this.patronesKv.set(clave, patron)
    this.datos.delete(clave)
    this.errores.delete(clave)
    this.vuelos.delete(clave)
    this.kvMas.delete(clave)
    this.notificar()
  }

  /** «Reintentar» de una fila de error: olvida el error (se pinta «Cargando…») y vuelve a pedir. */
  readonly reintentar = (carga: CargaBd): Promise<DbRespuesta<unknown>> => {
    if (this.errores.delete(carga.clave)) this.notificar()
    return this.cargar(carga)
  }

  /** Lo cargado para el árbol, con la forma de `EntradaArbolBd`. Misma identidad mientras no cambie nada. */
  instantaneaArbol(): InstantaneaArbolBd {
    if (this.instantanea && this.instantanea.ver === this.ver) return this.instantanea.valor
    const valor = construirInstantanea(this.datos, this.errores, this.patronesKv, this.kvMas)
    this.instantanea = { ver: this.ver, valor }
    return valor
  }

  // --- Invalidación (solo desde el evento del main) ------------------------------------

  /** Marca obsoleto lo que toca el evento (`afectaEvento`), olvida sus errores y marca sus vuelos. */
  invalidar(e: DbEventoCatalogo): void {
    let cambio = false
    for (const [clave, entrada] of this.datos) {
      if (!entrada.obsoleta && afectaEvento(e, clave)) {
        entrada.obsoleta = true
        cambio = true
      }
    }
    for (const clave of [...this.errores.keys()]) {
      if (afectaEvento(e, clave)) {
        this.errores.delete(clave)
        cambio = true
      }
    }
    for (const [clave, vuelo] of this.vuelos) {
      // La clave de vuelo del detalle lleva las partes detrás: su tupla empieza igual.
      if (afectaEvento(e, clave)) vuelo.obsoleta = true
    }
    if (cambio) this.notificar()
  }
}

// --- La instancia de la app ----------------------------------------------------------

let instancia: CacheMetaBd | null = null

/** La caché de la app, sobre `window.tessera.dbExplorador`; se crea (con su único listener) al primer uso. */
export function cacheMetaBd(): CacheMetaBd {
  if (!instancia) {
    const docs = window.tessera.dbDocumentos
    const kv = window.tessera.dbClaves
    instancia = new CacheMetaBd(window.tessera.dbExplorador, undefined, {
      docBases: (p) => docs.bases(p),
      docColecciones: (p) => docs.colecciones(p),
      kvBases: (p) => kv.bases(p),
      kvEscanear: (p) => kv.escanear(p)
    })
  }
  return instancia
}
