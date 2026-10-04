// =============================================================================
// `MOTORES_EXPLORADOR`: el código por motor del explorador (el SQL de su catálogo y de su sesión)
// en un Record exhaustivo, gemelo en el main de `MOTORES` (`src/shared/motores/`): un motor
// nuevo no compila hasta tener su catálogo y su sesión. Se usa dentro de funciones, nunca a
// nivel superior, y los archivos por motor no lo importan.
// Decisiones: docs/decisiones/bd/motores-codigo-por-motor.md
// =============================================================================

import type { DbMotor, DbMotorSql } from '../../../../shared/db-ipc.ts'
import { CATALOGO_ORACLE } from './catalogoOracle.ts'
import { CATALOGO_POSTGRES } from './catalogoPostgres.ts'
import { CATALOGO_SQLITE } from './catalogoSqlite.ts'
import { SESION_ORACLE } from './sesionOracle.ts'
import { SESION_POSTGRES } from './sesionPostgres.ts'
import { SESION_SQLITE } from './sesionSqlite.ts'
import { CATALOGO_SQLSERVER } from './catalogoSqlserver.ts'
import { SESION_SQLSERVER } from './sesionSqlserver.ts'
import type { MotorExplorador } from './tipos.ts'
import { descriptorSql, esMotor, esMotorSql } from '../../../../shared/motores/index.ts'

export type {
  BindsCatalogo,
  CatalogoExplorador,
  ConsultaCatalogo,
  DialectoCatalogo,
  FilaCatalogo,
  MotorExplorador,
  SesionExplorador
} from './tipos.ts'

/** Solo motores SQL: MongoDB y Redis no tienen catálogo de esquemas ni sesión SQL. */
export const MOTORES_EXPLORADOR: Readonly<Record<DbMotorSql, MotorExplorador>> = {
  oracle: { catalogo: CATALOGO_ORACLE, sesion: SESION_ORACLE },
  postgres: { catalogo: CATALOGO_POSTGRES, sesion: SESION_POSTGRES },
  sqlite: { catalogo: CATALOGO_SQLITE, sesion: SESION_SQLITE },
  sqlserver: { catalogo: CATALOGO_SQLSERVER, sesion: SESION_SQLSERVER }
}

/**
 * El código por motor de `motor`. Lanza con un motor que no está en el registro (el
 * mismo criterio que `descriptor()` de shared: nunca seguir con otro sin decirlo).
 */
export function motorExplorador(motor: DbMotor): MotorExplorador {
  // Un motor del registro que NO es SQL (MongoDB, Redis) lanza diciendo
  // cuál y por qué («MongoDB no es un motor SQL.», de `descriptorSql`), no «Motor
  // desconocido», que haría buscar un registro roto. Uno desconocido, como siempre.
  if (esMotor(motor) && !esMotorSql(motor)) descriptorSql(motor)
  if (typeof motor !== 'string' || !Object.prototype.hasOwnProperty.call(MOTORES_EXPLORADOR, motor)) {
    throw new Error(`Motor desconocido: "${String(motor)}".`)
  }
  return MOTORES_EXPLORADOR[motor as DbMotorSql]
}
