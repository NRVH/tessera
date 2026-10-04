// =============================================================================
// Lo que el autocompletado lee del catálogo (`FuenteCatalogo`, síncrona sobre la
// caché) y cómo resuelve contra él los nombres de la sentencia: qué esquemas son
// locales, de qué esquema es una tabla y qué hay detrás de `X.`.
// Puro: depende de `referenciasSql`, `clausulasSql` y `shared/`; la fuente real la
// implementa `catalogoAutocompletado.ts`.
// Decisiones: docs/decisiones/bd/ui-autocompletado-filtro-y-orden.md
// =============================================================================

import type { DbRelacionesFk, DbTipoObjeto } from '../../../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../../../shared/motores/index.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { mismoNombre } from '../../../../../shared/sql/identificadoresSql.ts'
import { TIPOS_RELACION } from './clausulasSql.ts'
import { admiteTresPartes, type RefTabla } from './referenciasSql.ts'

/** Una entrada del índice de nombres (una tupla de `DbIndiceNombres.objetos`, desplegada). */
export interface DbObjetoNombre {
  esquema: string
  nombre: string
  tipo: DbTipoObjeto
}

/**
 * Lo que el autocompletado lee del catálogo. SÍNCRONA: responde con lo que ya
 * está en caché; lo que falta lo pide el proveedor (`pendientesDeCarga`) y vuelve
 * a preguntar.
 */
export interface FuenteCatalogo {
  /**
   * Objetos indexados de `esquema`, o de TODOS los esquemas indexados con null. [] si no
   * están cargados. `base`: los de ESE esquema en OTRA base (un nombre de tres partes);
   * una fuente sin bases puede ignorarlo.
   */
  objetos(esquema: string | null, base?: string): readonly DbObjetoNombre[]
  /**
   * Columnas en el orden de la tabla; null si no están en caché. Con esquema
   * 'PUBLIC' (Oracle) la tabla es un sinónimo público que el adaptador resuelve.
   * `base`: la de un nombre de tres partes.
   */
  columnas(esquema: string, tabla: string, base?: string): readonly string[] | null
  /** Todos los esquemas de la conexión (la M de «N de M»). */
  esquemas(): readonly string[]
  /** Esquema actual de la sesión (o el por defecto de la conexión); null si aún no se sabe. */
  esquemaActual(): string | null
  /**
   * Sinónimos PUBLIC de Oracle; [] en PG o si aún no se cargaron. Las sugerencias solo
   * los leen si el motor tiene pseudo-esquema (`catalogo.pseudoEsquemaPublico`).
   */
  publicos(): readonly string[]
  /**
   * Claves ajenas de la tabla (las de su DESTINO si es un sinónimo); null si no están
   * en caché. Opcional: una fuente sin ellas no sugiere nada por FK.
   */
  fks?(esquema: string, tabla: string): DbRelacionesFk | null
  /** El objeto real detrás de un nombre (el destino de un sinónimo ya resuelto); por defecto, él mismo. */
  destino?(esquema: string, nombre: string): { esquema: string; nombre: string }
  /**
   * ¿Lo que dan `columnas()` o `fks()` está marcado obsoleto por una invalidación (un
   * DDL, «Refrescar»)? Se sigue leyendo, pero se vuelve a pedir; y «Expandir columnas»
   * no lo usa. Opcional: sin él, todo cuenta como al día.
   */
  obsoleto?(que: 'columnas' | 'fks', esquema: string, tabla: string): boolean
}

/**
 * ¿La tabla está FUERA del catálogo de la consola? Por un enlace (`emp@remota`) o en
 * OTRA base (`ventas.dbo.t`): sus FKs y su `*` no se pueden sacar de lo que la consola
 * tiene cargado (serían los de otra tabla).
 */
export function ajenaAlCatalogo(r: RefTabla): boolean {
  return r.remota === true || r.base !== undefined
}

/** Esquemas cuyos objetos se escriben sin calificar. */
export function esquemasLocales(fuente: FuenteCatalogo, d: DialectoSql): string[] {
  const actual = fuente.esquemaActual()
  const r: string[] = []
  if (actual) r.push(actual)
  // El que se ve sin calificar además del actual (PG: 'public'), de su descriptor.
  const implicito = descriptorSql(d).catalogo.esquemaImplicito
  if (implicito !== null && actual !== implicito) r.push(implicito)
  return r
}

/**
 * ¿Existe `nombre` en el catálogo de `esquema`? Con la comparación del motor
 * (`mismoNombre`): exacta en Oracle y PG (lo escrito ya llega plegado), sin caja ASCII
 * en SQLite, donde `clientes` es la tabla `Clientes`.
 */
function existeObjeto(
  fuente: FuenteCatalogo,
  esquema: string,
  nombre: string,
  d: DialectoSql,
  tipos?: readonly DbTipoObjeto[]
): boolean {
  return fuente.objetos(esquema).some((o) => mismoNombre(o.nombre, nombre, d) && (!tipos || tipos.indexOf(o.tipo) >= 0))
}

/**
 * Esquema de una tabla de la sentencia. Sin calificar: el local donde exista (o
 * cuyas columnas ya estén en caché); si no, un sinónimo PUBLIC de Oracle se
 * busca como 'PUBLIC'; si tampoco, el primero local (para que el proveedor
 * intente cargarla).
 */
export function esquemaDeRef(ref: RefTabla, fuente: FuenteCatalogo, d: DialectoSql): string | null {
  if (ref.esquema !== null) return ref.esquema
  const locales = esquemasLocales(fuente, d)
  for (const e of locales) {
    if (fuente.columnas(e, ref.nombre) !== null || existeObjeto(fuente, e, ref.nombre, d)) return e
  }
  const pseudo = descriptorSql(d).catalogo.pseudoEsquemaPublico
  if (pseudo !== null && fuente.publicos().indexOf(ref.nombre) >= 0) return pseudo
  return locales.length > 0 ? locales[0] : null
}

export type DestinoMiembro =
  /** `base`: la de un nombre de tres partes (`ventas.dbo.t.`). */
  | { tipo: 'columnas'; esquema: string; tabla: string; base?: string }
  | { tipo: 'objetos'; esquema: string }
  | { tipo: 'desconocido' }

/** `A.B.` es la tabla B del esquema A; `base.esquema.tabla.` solo en un motor de tres partes. */
function miembroCalificado(calificador: readonly string[], d: DialectoSql): DestinoMiembro {
  const n = calificador.length
  const x = calificador[n - 1]
  if (n >= 3 && admiteTresPartes(d)) return { tipo: 'columnas', esquema: calificador[n - 2], tabla: x, base: calificador[n - 3] }
  return { tipo: 'columnas', esquema: calificador[n - 2], tabla: x }
}

function destinoDeRef(r: RefTabla, fuente: FuenteCatalogo, d: DialectoSql): DestinoMiembro | null {
  const e = esquemaDeRef(r, fuente, d)
  if (e === null) return null
  return r.base !== undefined ? { tipo: 'columnas', esquema: e, tabla: r.nombre, base: r.base } : { tipo: 'columnas', esquema: e, tabla: r.nombre }
}

/** `X` como alias de una tabla de la sentencia y, si no, como su nombre. */
function miembroDeSentencia(x: string, tablas: readonly RefTabla[], fuente: FuenteCatalogo, d: DialectoSql): DestinoMiembro | null {
  for (const r of tablas) {
    if (r.alias !== x) continue
    const dm = destinoDeRef(r, fuente, d)
    if (dm) return dm
  }
  for (const r of tablas) {
    if (r.nombre !== x) continue
    const dm = destinoDeRef(r, fuente, d)
    if (dm) return dm
  }
  return null
}

/** `X` como tabla local y, si no, como esquema (el pseudo-esquema de los públicos incluido). */
function miembroDelCatalogo(x: string, fuente: FuenteCatalogo, d: DialectoSql): DestinoMiembro {
  for (const e of esquemasLocales(fuente, d)) {
    if (fuente.columnas(e, x) !== null || existeObjeto(fuente, e, x, d, TIPOS_RELACION)) {
      return { tipo: 'columnas', esquema: e, tabla: x }
    }
  }
  const pseudo = descriptorSql(d).catalogo.pseudoEsquemaPublico
  // Con la comparación del motor (`mismoNombre`): exacta en Oracle y PG; sin caja en SQLite
  // y SQL Server ('insensibleUnicode': `DBO.` es `dbo`).
  if ((pseudo !== null && x === pseudo) || fuente.esquemas().some((e) => mismoNombre(e, x, d))) return { tipo: 'objetos', esquema: x }
  return { tipo: 'desconocido' }
}

/**
 * Qué hay detrás de `X.`: alias de la sentencia -> columnas de su tabla; tabla
 * (de la sentencia o local) -> sus columnas; esquema -> sus objetos. `A.B.` es
 * siempre la tabla B del esquema A.
 */
export function resolverMiembro(
  calificador: readonly string[],
  tablas: readonly RefTabla[],
  fuente: FuenteCatalogo,
  d: DialectoSql
): DestinoMiembro {
  const n = calificador.length
  if (n === 0) return { tipo: 'desconocido' }
  if (n >= 2) return miembroCalificado(calificador, d)
  const x = calificador[0]
  return miembroDeSentencia(x, tablas, fuente, d) ?? miembroDelCatalogo(x, fuente, d)
}
