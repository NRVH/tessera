// =============================================================================
// El registro de escritura de SQL: `ESCRITURA_SQL`, un `Record<DbMotor, EscrituraSqlMotor>`, y
// `escrituraSql()`, que lanza con un motor que no está en él. Lo piden `formatosFilas.ts` y
// `sql/dmlRejilla.ts`; los archivos de cada motor no lo importan. Neutral y ES2020.
// Decisiones: docs/decisiones/bd/escritura-sql-contrato-por-motor.md
// =============================================================================

import type { DbMotor, DbMotorSql } from '../db-ipc.ts'
import type { EscrituraSqlMotor } from './tipos.ts'
import { nunca } from '../nunca.ts'
import { ESCRITURA_ORACLE } from './oracle.ts'
import { ESCRITURA_POSTGRES } from './postgres.ts'
import { ESCRITURA_SQLITE } from './sqlite.ts'
import { ESCRITURA_SQLSERVER } from './sqlserver.ts'

export type { EscrituraSqlMotor, TerminadorSql, VistaDml } from './tipos.ts'

/**
 * Cómo escribe SQL cada motor SQL. Un motor SQL nuevo no compila sin su fila; uno de otra
 * familia (MongoDB, Redis) no puede tenerla.
 */
export const ESCRITURA_SQL: Readonly<Record<DbMotorSql, EscrituraSqlMotor>> = {
  oracle: ESCRITURA_ORACLE,
  postgres: ESCRITURA_POSTGRES,
  sqlite: ESCRITURA_SQLITE,
  sqlserver: ESCRITURA_SQLSERVER
}

/**
 * La escritura de SQL de un motor. `contexto` dice quién la pide, para el mensaje de un
 * motor que no está en el registro.
 */
export function escrituraSql(motor: DbMotor, contexto: string): EscrituraSqlMotor {
  if (!Object.prototype.hasOwnProperty.call(ESCRITURA_SQL, motor)) return nunca(motor as never, contexto)
  return ESCRITURA_SQL[motor as DbMotorSql]
}
