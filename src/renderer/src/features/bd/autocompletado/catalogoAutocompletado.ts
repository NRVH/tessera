// =============================================================================
// Catálogo del autocompletado: la `FuenteCatalogo` montada sobre la caché del árbol
// (`cacheMetaBd`) para UNA consola y UNA pregunta de Monaco. No guarda datos del
// catálogo: lee lo que haya (síncrono), dispara las cargas de lo que falta, resuelve
// sinónimos a su destino y recuerda los fallos 30 s para no viajar en cada tecla.
// Sin React, DOM ni Monaco: la caché entra por el constructor y
// `test-proveedor-sql.mts` la construye sobre una API falsa.
// Decisiones: docs/decisiones/bd/ui-autocompletado-catalogo.md
// =============================================================================

import { ERROR_NOMBRES_MS, type CacheMetaBd, type NombreIndexado } from '../cacheMetaBd.ts'
// Los mismos tipos en los que la caché busca columnas: un sinónimo que apunta a otra cosa no las ofrece.
import { TIPOS_CON_COLUMNAS } from '../cacheMetaBdPuro.ts'
import type {
  DbColumnaInfo,
  DbEsquemasRespuesta,
  DbRefObjeto,
  DbRelacionesFk,
  DbRespuesta,
  DbTipoObjeto
} from '../../../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../../../shared/motores/index.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { claveDeNombre } from '../../../../../shared/sql/identificadoresSql.ts'
import type { DbObjetoNombre, FuenteCatalogo, PendientesCarga } from './sugerenciasSql.ts'

/** Lo que el adaptador necesita de la consola (un subconjunto de `RutaConsola`). */
export interface RutaCatalogo {
  conexionId: string
  dialecto: DialectoSql
  /** Esquema actual de la sesión de la consola; null si aún no hay sesión. */
  esquema(): string | null
  /**
   * La BASE de la consola en una conexión con nivel «Bases» (SQL Server sin base fija),
   * o null. Ausente = ninguna: las llamadas a la caché van sin base.
   */
  base?(): string | null
}

/** Separador de las claves de la memoria de fallos: NUL, como `claveBd`. */
const SEP = String.fromCharCode(0)
const unir = (partes: readonly string[]): string => partes.join(SEP)

const VACIO: readonly string[] = []
const SIN_OBJETOS: readonly DbObjetoNombre[] = []

/** Por encima de esto, la memoria de fallos poda lo caducado antes de crecer. */
const PODA_FALLOS = 256

/**
 * Cargas que fallaron hace menos de `ERROR_NOMBRES_MS`: no se repiten en cada tecla.
 * Clase y no un `Map` suelto para poder inyectar el reloj en el test.
 */
export class MemoriaFallos {
  private readonly fallos = new Map<string, number>()
  private readonly ahora: () => number

  constructor(ahora: () => number = () => Date.now()) {
    this.ahora = ahora
  }

  /** ¿Falló hace poco? Lo caducado se olvida al mirarlo. */
  reciente(clave: string): boolean {
    const en = this.fallos.get(clave)
    if (en === undefined) return false
    if (this.ahora() - en < ERROR_NOMBRES_MS) return true
    this.fallos.delete(clave)
    return false
  }

  anotar(clave: string): void {
    if (this.fallos.size >= PODA_FALLOS) {
      const t = this.ahora()
      for (const [k, en] of [...this.fallos]) if (t - en >= ERROR_NOMBRES_MS) this.fallos.delete(k)
    }
    this.fallos.set(clave, this.ahora())
  }

  /** Solo para tests. */
  tamano(): number {
    return this.fallos.size
  }
}

/** La de la app: una sola para todas las consolas (las claves llevan la conexión). */
const fallosApp = new MemoriaFallos()

// --- Memorias por IDENTIDAD de lo que hay en la caché --------------------------------
// La caché conserva la identidad de cada valor mientras no se recarga, así que lo que
// se deriva de él (nombres de columnas ordenados, tipos por nombre) se calcula una vez
// por valor y no en cada tecla. WeakMap: al sustituirse el valor, lo derivado se va.

const nombresDeColumnas = new WeakMap<readonly DbColumnaInfo[], readonly string[]>()
const nombresDeEsquemas = new WeakMap<DbEsquemasRespuesta, readonly string[]>()
const tiposPorNombre = new WeakMap<readonly NombreIndexado[], Map<string, DbTipoObjeto>>()

function nombresDe(cols: readonly DbColumnaInfo[]): readonly string[] {
  let r = nombresDeColumnas.get(cols)
  if (!r) {
    r = [...cols].sort((a, b) => a.posicion - b.posicion).map((c) => c.nombre)
    nombresDeColumnas.set(cols, r)
  }
  return r
}

/**
 * Qué tipo gana cuando un esquema tiene dos objetos con el mismo nombre (PG deja
 * una tabla y una función `x` en el mismo esquema): lo que tiene columnas, luego el
 * sinónimo, luego lo demás. Es lo que importa para resolver un alias.
 */
function prioridadTipo(t: DbTipoObjeto): number {
  if (TIPOS_CON_COLUMNAS.indexOf(t) >= 0) return 0
  return t === 'sinonimo' ? 1 : 2
}

function tiposDe(lista: readonly NombreIndexado[]): Map<string, DbTipoObjeto> {
  let m = tiposPorNombre.get(lista)
  if (!m) {
    m = new Map<string, DbTipoObjeto>()
    for (const o of lista) {
      const previo = m.get(o.nombre)
      if (previo === undefined || prioridadTipo(o.tipo) < prioridadTipo(previo)) m.set(o.nombre, o.tipo)
    }
    tiposPorNombre.set(lista, m)
  }
  return m
}

/**
 * Índice `claveDeNombre` → nombre de una lista del catálogo (esquemas u objetos), para
 * `nombreReal`/`esquemaReal`. Por IDENTIDAD de la lista, como `tiposDe`: se construye una
 * vez por lista que da la caché. Con dos nombres de la misma clave (no pasa en un motor
 * que compara sin caja: serían el mismo objeto), gana el primero.
 */
const porClavePorLista = new WeakMap<object, Map<string, string>>()
function porClave(lista: readonly (string | { nombre: string })[], d: DialectoSql): Map<string, string> {
  let m = porClavePorLista.get(lista)
  if (!m) {
    m = new Map<string, string>()
    for (const x of lista) {
      const n = typeof x === 'string' ? x : x.nombre
      const k = claveDeNombre(n, d)
      if (!m.has(k)) m.set(k, n)
    }
    porClavePorLista.set(lista, m)
  }
  return m
}

/**
 * `FuenteCatalogo` de una consola sobre `cacheMetaBd`. Se crea UNA por pregunta de
 * Monaco (es barata: no guarda datos, solo la clave del índice).
 */
export class CatalogoAutocompletado implements FuenteCatalogo {
  private readonly cache: CacheMetaBd
  private readonly conexionId: string
  /** Con qué compara nombres el motor (`claveDeNombre`: exacto en Oracle y PG, sin caja en SQLite). */
  private readonly dialecto: DialectoSql
  /**
   * El pseudo-esquema de los sinónimos públicos del motor ('PUBLIC' en Oracle), o null
   * si no lo tiene: de su descriptor (`catalogo.pseudoEsquemaPublico`).
   */
  private readonly pseudoPublico: string | null
  /** Esquema de la sesión al empezar la pregunta: la clave del índice de nombres. */
  private readonly sesion: string | null
  /**
   * La base de la consola en una conexión con nivel «Bases», o undefined (sin base).
   * Se lee UNA vez, como el esquema: es parte de la clave del índice.
   */
  private readonly base: string | undefined
  private readonly fallos: MemoriaFallos

  constructor(cache: CacheMetaBd, ruta: RutaCatalogo, fallos: MemoriaFallos = fallosApp) {
    this.cache = cache
    this.conexionId = ruta.conexionId
    this.dialecto = ruta.dialecto
    this.pseudoPublico = descriptorSql(ruta.dialecto).catalogo.pseudoEsquemaPublico
    this.sesion = ruta.esquema()
    this.base = ruta.base?.() ?? undefined
    this.fallos = fallos
  }

  // --- FuenteCatalogo: lectura síncrona -------------------------------------------------

  objetos(esquema: string | null, base?: string): readonly DbObjetoNombre[] {
    // `BASE.ESQ.` de un nombre de tres partes: el índice de ESA base.
    if (base !== undefined && base !== this.base) return this.objetosDeOtraBase(esquema, base)
    const esq = esquema === null ? null : this.esquemaReal(esquema)
    const lista = this.cache.objetosIndexados(this.conexionId, this.indiceLeido(), esq, this.base)
    if (esq === null || lista.length > 0) return lista
    // Un `ESQ.` fuera del índice de la consola se carga con su propio índice.
    return this.cache.objetosIndexados(this.conexionId, esq, esq, this.base)
  }

  columnas(esquemaEscrito: string, tablaEscrita: string, base?: string): readonly string[] | null {
    if (base !== undefined && base !== this.base) {
      // De otra base: el nombre del catálogo por su índice, sin sinónimos.
      const real = this.nombreEnOtraBase(esquemaEscrito, tablaEscrita, base)
      const cols = this.cache.columnas(this.conexionId, real.esquema, real.nombre, base)
      return cols ? nombresDe(cols) : null
    }
    const { esquema, nombre: tabla } = this.nombreReal(esquemaEscrito, tablaEscrita)
    if (this.esSinonimo(esquema, tabla)) {
      const destino = this.cache.resolucion(this.conexionId, esquema, tabla)
      if (!destino) return null
      if (TIPOS_CON_COLUMNAS.indexOf(destino.tipo) < 0) return VACIO
      const cols = this.cache.columnas(this.conexionId, destino.esquema, destino.nombre, destino.base ?? this.base)
      return cols ? nombresDe(cols) : null
    }
    const cols = this.cache.columnas(this.conexionId, esquema, tabla, this.base)
    return cols ? nombresDe(cols) : null
  }

  esquemas(): readonly string[] {
    const resp = this.cache.esquemas(this.conexionId, this.base)
    if (resp) {
      let r = nombresDeEsquemas.get(resp)
      if (!r) {
        r = resp.esquemas.filter((e) => !e.pseudo).map((e) => e.nombre)
        nombresDeEsquemas.set(resp, r)
      }
      return r
    }
    // Sin la lista (aún no llegó), al menos los del índice: bastan para `ESQ.`.
    const indice = this.cache.nombres(this.conexionId, this.indiceLeido(), this.base)
    return indice ? indice.esquemas : VACIO
  }

  esquemaActual(): string | null {
    if (this.sesion !== null) return this.sesion
    const indice = this.cache.nombres(this.conexionId, null, this.base)
    if (indice) return indice.porDefecto
    return this.cache.esquemaPorDefecto(this.conexionId)
  }

  publicos(): readonly string[] {
    if (this.pseudoPublico === null) return VACIO
    return this.cache.publicos(this.conexionId) ?? VACIO
  }

  fks(esquema: string, tabla: string): DbRelacionesFk | null {
    const real = this.real(esquema, tabla)
    if (!real) return null
    return this.cache.fks(this.conexionId, real.esquema, real.nombre, this.base)
  }

  destino(esquema: string, nombre: string): { esquema: string; nombre: string } {
    return this.real(esquema, nombre) ?? this.nombreReal(esquema, nombre)
  }

  /**
   * ¿Lo que dan `columnas()` o `fks()` para `esquema.tabla` está marcado obsoleto? Mira
   * la MISMA entrada que ellos (la del destino si es un sinónimo); false si no hay.
   */
  obsoleto(que: 'columnas' | 'fks', esquema: string, tabla: string): boolean {
    const real = this.real(esquema, tabla)
    if (!real) return false
    return que === 'fks'
      ? this.cache.fksObsoletas(this.conexionId, real.esquema, real.nombre, this.base)
      : this.cache.columnasObsoletas(this.conexionId, real.esquema, real.nombre, this.base)
  }

  // --- Cargas (disparan; quien quiera esperar, espera con su tope) ------------------------

  /**
   * Lo que casi toda pregunta necesita: la lista de esquemas (la M, para `ESQ.`), el
   * índice de nombres de la consola y, en Oracle, los sinónimos PUBLIC. Lo fresco no
   * viaja; nunca rechaza.
   */
  cargarBase(): Promise<void> {
    const c = this.conexionId
    const b = this.base
    const tareas: Array<Promise<unknown>> = [
      this.conMemoria(unir(b === undefined ? ['esquemas', c] : ['esquemas', c, b]), () => this.cache.cargarEsquemas(c, b)),
      // El índice y los públicos ya recuerdan sus errores en la caché.
      this.seguro(() => this.cache.cargarNombres(c, this.sesion, b))
    ]
    if (this.pseudoPublico !== null) tareas.push(this.seguro(() => this.cache.cargarPublicos(c)))
    return Promise.all(tareas).then(() => undefined)
  }

  /** Las cargas que pide `pendientesDeCarga`: columnas, esquemas de `ESQ.` y FKs. Nunca rechaza. */
  cargarPendientes(p: PendientesCarga): Promise<void> {
    const tareas: Array<Promise<unknown>> = []
    for (const x of p.columnas) {
      tareas.push(x.base !== undefined && x.base !== this.base ? this.cargarColumnasDeOtraBase(x.esquema, x.tabla, x.base) : this.cargarColumnasDe(x.esquema, x.tabla))
    }
    for (const esq of p.esquemas) {
      tareas.push(this.seguro(() => this.cache.cargarNombres(this.conexionId, this.esquemaReal(esq), this.base)))
    }
    // `BASE.ESQ.` de otra base: el índice de esa base con ese esquema.
    for (const x of p.deBase ?? []) tareas.push(this.seguro(() => this.cache.cargarNombres(this.conexionId, x.esquema, x.base)))
    for (const x of p.fks) tareas.push(this.cargarFksDe(x.esquema, x.tabla))
    return Promise.all(tareas).then(() => undefined)
  }

  /** Las FKs de una tabla (las de su destino si es un sinónimo). Nunca rechaza. */
  async cargarFksDe(esquemaEscrito: string, tablaEscrita: string): Promise<void> {
    const c = this.conexionId
    const { esquema, nombre: tabla } = this.nombreReal(esquemaEscrito, tablaEscrita)
    let real = this.real(esquema, tabla)
    if (!real) {
      const destino = await this.conMemoria<DbRefObjeto>(unir(['resolver', c, esquema, tabla]), () =>
        this.cache.cargarResolucion(c, esquema, tabla)
      )
      if (!destino) return
      real = { esquema: destino.esquema, nombre: destino.nombre }
    }
    const tipo = this.tipoEnIndice(real.esquema, real.nombre)
    const objeto: DbRefObjeto = { esquema: real.esquema, nombre: real.nombre, tipo: tipo ?? 'tabla' }
    if (this.base !== undefined) objeto.base = this.base
    const clave = ['fks', c, real.esquema, real.nombre]
    if (this.base !== undefined) clave.push(this.base)
    await this.conMemoria(unir(clave), () => this.cache.cargarFks(c, objeto))
  }

  // --- Internos ---------------------------------------------------------------------------

  /**
   * Clave del índice que se LEE: el de la sesión; mientras ese no ha llegado, el de
   * sin sesión si ya estaba cargado. Pasa justo al abrir la sesión de la consola (la
   * clave cambia de null a su esquema): son los mismos esquemas visibles, y sin esto
   * la lista se quedaba vacía hasta que llegaba el índice nuevo. Se recalcula en cada
   * lectura porque durante la espera el índice de la sesión puede llegar.
   */
  private indiceLeido(): string | null {
    if (this.sesion === null || this.cache.nombres(this.conexionId, this.sesion, this.base)) return this.sesion
    return this.cache.nombres(this.conexionId, null, this.base) ? null : this.sesion
  }

  /**
   * Los objetos de `esquema` en OTRA base (un nombre de tres partes): los de su
   * índice, que se carga con ese esquema como «actual» (`cargarPendientes`, `deBase`). El
   * esquema escrito se lleva al del catálogo con la comparación del motor, como en la base
   * de la consola. Sin esquema (no pasa: `BASE.` solo no es un contexto), [].
   */
  private objetosDeOtraBase(esquema: string | null, base: string): readonly DbObjetoNombre[] {
    if (esquema === null) return SIN_OBJETOS
    const indice = this.cache.nombres(this.conexionId, esquema, base)
    const esq = indice ? (porClave(indice.esquemas, this.dialecto).get(claveDeNombre(esquema, this.dialecto)) ?? esquema) : esquema
    return this.cache.objetosIndexados(this.conexionId, esquema, esq, base)
  }

  /** El `esquema.nombre` del catálogo de OTRA base para uno escrito. */
  private nombreEnOtraBase(esquema: string, nombre: string, base: string): { esquema: string; nombre: string } {
    const lista = this.objetosDeOtraBase(esquema, base)
    const esq = lista.length > 0 ? lista[0].esquema : esquema
    if (tiposDe(lista).has(nombre)) return { esquema: esq, nombre }
    const real = porClave(lista, this.dialecto).get(claveDeNombre(nombre, this.dialecto))
    return { esquema: esq, nombre: real ?? nombre }
  }

  /** Las columnas de una tabla de OTRA base. Nunca rechaza. */
  private async cargarColumnasDeOtraBase(esquemaEscrito: string, tablaEscrita: string, base: string): Promise<void> {
    const c = this.conexionId
    const { esquema, nombre: tabla } = this.nombreEnOtraBase(esquemaEscrito, tablaEscrita, base)
    await this.conMemoria(unir(['columnas', c, esquema, tabla, base]), () => this.cache.cargarColumnas(c, esquema, tabla, 'tabla', base))
  }

  /**
   * El esquema del CATÁLOGO para uno escrito en el SQL. Con un motor que compara SIN
   * CAJA (SQLite: `MAIN.t` es `main.t`) es el de la lista que casa por su
   * `claveDeNombre`; en Oracle y PG la clave es el propio nombre (lo escrito ya llega
   * plegado), así que es el mismo. Sin ninguno que case, tal cual.
   */
  private esquemaReal(esquema: string): string {
    const lista = this.esquemas()
    if (lista.includes(esquema)) return esquema
    return porClave(lista, this.dialecto).get(claveDeNombre(esquema, this.dialecto)) ?? esquema
  }

  /**
   * El `esquema.nombre` del CATÁLOGO para uno escrito en el SQL, por lo mismo que
   * `esquemaReal`: en SQLite, `select * from CLIENTES c where c.` tiene que dar las
   * columnas de `Clientes`. En Oracle y PG, lo mismo que se escribió.
   */
  private nombreReal(esquema: string, nombre: string): { esquema: string; nombre: string } {
    const esq = this.esquemaReal(esquema)
    const lista = this.objetos(esq)
    if (tiposDe(lista).has(nombre)) return { esquema: esq, nombre }
    const real = porClave(lista, this.dialecto).get(claveDeNombre(nombre, this.dialecto))
    return { esquema: esq, nombre: real ?? nombre }
  }

  /** Tipo de `nombre` en el índice (el de `esquema`), o null si no está indexado. */
  private tipoEnIndice(esquema: string, nombre: string): DbTipoObjeto | null {
    return tiposDe(this.objetos(esquema)).get(nombre) ?? null
  }

  private esSinonimo(esquema: string, nombre: string): boolean {
    if (this.pseudoPublico !== null && esquema === this.pseudoPublico) return true
    return this.tipoEnIndice(esquema, nombre) === 'sinonimo'
  }

  /**
   * El objeto real detrás de `esquema.nombre` (el del catálogo, ver `nombreReal`): él
   * mismo, o el destino del sinónimo si ya está resuelto en caché; null si es un sinónimo
   * aún sin resolver.
   */
  private real(esquemaEscrito: string, nombreEscrito: string): { esquema: string; nombre: string } | null {
    const { esquema, nombre } = this.nombreReal(esquemaEscrito, nombreEscrito)
    if (!this.esSinonimo(esquema, nombre)) return { esquema, nombre }
    const destino = this.cache.resolucion(this.conexionId, esquema, nombre)
    return destino ? { esquema: destino.esquema, nombre: destino.nombre } : null
  }

  private async cargarColumnasDe(esquemaEscrito: string, tablaEscrita: string): Promise<void> {
    const c = this.conexionId
    const { esquema, nombre: tabla } = this.nombreReal(esquemaEscrito, tablaEscrita)
    if (this.esSinonimo(esquema, tabla)) {
      const destino = await this.conMemoria<DbRefObjeto>(unir(['resolver', c, esquema, tabla]), () =>
        this.cache.cargarResolucion(c, esquema, tabla)
      )
      if (!destino || TIPOS_CON_COLUMNAS.indexOf(destino.tipo) < 0) return
      await this.conMemoria(unir(['columnas', c, destino.esquema, destino.nombre]), () =>
        this.cache.cargarColumnas(c, destino.esquema, destino.nombre, destino.tipo, destino.base ?? this.base)
      )
      return
    }
    // Con el tipo del índice, la entrada es la misma que usa el árbol; sin él (aún no
    // indexado, o no existe), como tabla: el catálogo las lee igual de una vista.
    const tipo = this.tipoEnIndice(esquema, tabla)
    const comoTipo = tipo !== null && TIPOS_CON_COLUMNAS.indexOf(tipo) >= 0 ? tipo : 'tabla'
    await this.conMemoria(unir(['columnas', c, esquema, tabla]), () =>
      this.cache.cargarColumnas(c, esquema, tabla, comoTipo, this.base)
    )
  }

  /** Carga salvo que haya fallado hace poco; anota el fallo. El valor, o null. */
  private async conMemoria<T>(clave: string, cargar: () => Promise<DbRespuesta<T>>): Promise<T | null> {
    if (this.fallos.reciente(clave)) return null
    const r = await this.seguro(cargar)
    if (r && r.ok) return r.valor
    this.fallos.anotar(clave)
    return null
  }

  /** La caché no lanza, pero una pregunta de Monaco no puede depender de eso. */
  private async seguro<T>(cargar: () => Promise<T>): Promise<T | null> {
    try {
      return await cargar()
    } catch {
      return null
    }
  }
}
