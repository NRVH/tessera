// =============================================================================
// ¿Se puede EXPLICAR esta sentencia? Una consulta o un DML; nunca un EXPLAIN escrito por el usuario
// (el ANALYZE ejecuta), SHOW, un bloqueo ni una unidad de SQL Server con `SET SHOWPLAN` dentro.
// La usan el botón del renderer y el main, que es la autoridad y vuelve a decidir. Puro, neutral, ES2020.
// Decisiones: docs/decisiones/bd/motores-explicar.md
// =============================================================================

import type { Clasificacion } from './clasificarSql.ts'
import { txSql } from './textosSql.ts'

/** Verbos de clase `consulta` que EXPLAIN no admite. */
const VERBOS_NO_EXPLICABLES = ['EXPLAIN', 'EXPLAIN ANALYZE', 'SHOW']

/** Por qué no se puede explicar la sentencia, o null si se puede. */
export function motivoNoExplicable(
  s: Pick<Clasificacion, 'clase' | 'verbo'> & { sesion?: Clasificacion['sesion'] }
): string | null {
  // El verbo PRIMERO: un `EXPLAIN ANALYZE DELETE …` tiene la clase de lo de dentro
  // (`dml`), y dejarlo pasar sería ejecutar el DELETE.
  if (VERBOS_NO_EXPLICABLES.indexOf(s.verbo) >= 0) {
    return s.verbo === 'SHOW' ? txSql().explicar.show : txSql().explicar.yaExplain
  }
  // Un SET SHOWPLAN_… dentro de la unidad (ver la cabecera). Solo SQL Server tiene
  // parámetros `showplan_*`; en los demás motores `sesion` nunca los lleva.
  if (s.sesion && s.sesion.parametros.some((p) => p.indexOf('showplan') === 0)) {
    return txSql().explicar.yaShowplan
  }
  if (s.clase === 'dml' || s.clase === 'consulta') return null
  return txSql().explicar.soloConsultas(s.verbo || txSql().explicar.otraCosa)
}
