// =============================================================================
// Clasificación de una sentencia SQL a partir de sus tokens: qué es (consulta, DML, DDL, PL/SQL…),
// si escribe, su peligro, qué tabla lee, qué objeto crea y qué esquema invalida, y la guardia de
// solo lectura (lista blanca estricta que el main aplica como autoridad). Neutral y ES2020; los
// identificadores salen PLEGADOS como los guarda el motor. Las piezas viven en `clasificarSql*.ts`.
// Decisiones: docs/decisiones/bd/sql-solo-lectura-lista-blanca.md
// =============================================================================

import type { DialectoSql } from './dialectosSql.ts'
import { base, crearVista, lectura } from './clasificarSqlBase.ts'
import { clasificarDesde } from './clasificarSqlDesde.ts'
import { clasificarPlsql, esInicioBloquePlsql } from './clasificarSqlPlsql.ts'
import { clasificarUnidadTsql } from './clasificarSqlTsql.ts'
import type { Clasificacion } from './clasificarSqlTipos.ts'
import type { Token } from './lexicoSql.ts'

export type {
  ClaseSentencia,
  Clasificacion,
  ObjetoCreado,
  PeligroSentencia,
  PermisoSoloLectura,
  RefObjeto,
  SesionSentencia
} from './clasificarSqlTipos.ts'
export { PARAMETRO_USE } from './clasificarSqlTipos.ts'
export { esInicioBloquePlsql } from './clasificarSqlPlsql.ts'
export { esAlcanceDeLote } from './clasificarSqlTramos.ts'
export { MENSAJE_FORMATO_FIJADO, MENSAJE_VACUUM_INTO, formatoFijadoPorTessera, permitidaEnSoloLectura } from './clasificarSqlSoloLectura.ts'

/**
 * Clasifica UNA sentencia a partir de sus tokens (los comentarios se ignoran;
 * el terminador no debe venir). `texto` (el mismo que se tokenizó) permite
 * plegar los identificadores exactamente como el motor; sin él se usa el valor
 * del token.
 */
export function clasificar(tokens: readonly Token[], d: DialectoSql, texto?: string): Clasificacion {
  const v = crearVista(tokens, d, texto)
  const t0 = v.t[0]
  if (!t0) return base('')
  // T-SQL: la unidad entera, no su primera palabra.
  if (v.r.sinSeparadorSeEjecutanJuntas) return clasificarUnidadTsql(v)
  if (t0.tipo === 'lineaCliente') {
    const primera = t0.valor.split(/\s+/)[0] || t0.valor
    return lectura('cliente', primera.toUpperCase())
  }
  if (esInicioBloquePlsql(v.t, d)) return clasificarPlsql(v)
  return clasificarDesde(v, 0)
}
