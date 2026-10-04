// =============================================================================
// La frontera entre familias de motor (sql, documentos, claves) en el main: qué responde cada camino cuando le llega
// una conexión que no es de su familia, con las mismas palabras en todos. Puro, sin electron ni drivers.
// Decisiones: docs/decisiones/bd/explorador-familias.md
// =============================================================================

import type { DbConnection, DbMotor } from '../../../shared/db-ipc.ts'
import type { DbErrorSql } from '../../../shared/db-explorador-ipc.ts'
import { descriptor, esMotor, familiaDe, type FamiliaMotor } from '../../../shared/motores/index.ts'
import { nunca } from '../../../shared/nunca.ts'

/** «Todavía no se puede conectar a <etiqueta> desde esta versión.» (ver la cabecera). */
export function mensajeTodaviaNo(motor: DbMotor): string {
  return `Todavía no se puede conectar a ${descriptor(motor).etiqueta} desde esta versión.`
}

/** La respuesta de un canal a un motor que esta versión aún no sabe abrir (ver la cabecera). */
export function falloTodaviaNo(motor: DbMotor): { ok: false; error: DbErrorSql } {
  return { ok: false, error: { motivo: 'driver', mensaje: mensajeTodaviaNo(motor) } }
}

/** Cómo se nombra una familia en un mensaje: «SQL», «de documentos», «de claves». */
function nombreFamilia(f: FamiliaMotor): string {
  switch (f) {
    case 'sql':
      return 'SQL'
    case 'documentos':
      return 'de documentos'
    case 'claves':
      return 'de claves'
    default:
      return nunca(f, 'nombreFamilia')
  }
}

/**
 * La conexión de una petición a un canal de la familia `familia`, o el error clasificado:
 * que no existe (o no tiene un motor de esta versión), o que es de otra familia (ver la
 * cabecera). Es la PRIMERA comprobación de cada handler de los esqueletos.
 */
export function conexionDeFamilia(
  con: DbConnection | null | undefined,
  familia: FamiliaMotor
): { ok: true; con: DbConnection } | { ok: false; error: DbErrorSql } {
  if (!con) return { ok: false, error: { motivo: 'interno', mensaje: 'La conexión ya no existe.' } }
  if (!esMotor(con.motor)) return { ok: false, error: { motivo: 'interno', mensaje: `Motor desconocido: "${String(con.motor)}".` } }
  if (familiaDe(con.motor) !== familia) {
    return {
      ok: false,
      error: {
        motivo: 'interno',
        mensaje: `${descriptor(con.motor).etiqueta} no es un motor ${nombreFamilia(familia)}: esta petición no es para esta conexión.`
      }
    }
  }
  return { ok: true, con }
}

/** Lo que los controladores necesitan del registro de conexiones (`ConnectionStore.get`). */
export interface BuscadorConexiones {
  get(id: string): DbConnection | undefined
}

/**
 * La conexión que nombra una petición IPC (`conexionId`) a un canal de la familia `familia`,
 * o el error clasificado (`conexionDeFamilia`). Si la petición nombra además un perfil (las
 * de consola: `perfilId`), la conexión tiene que ser de ese perfil, como en el explorador SQL.
 * La forma del RESTO de la petición la valida quien la atiende (los pasos 3 y 4).
 */
export function conexionDePeticion(
  req: unknown,
  conexiones: BuscadorConexiones,
  familia: FamiliaMotor
): { ok: true; con: DbConnection } | { ok: false; error: DbErrorSql } {
  if (req === null || typeof req !== 'object') return { ok: false, error: { motivo: 'interno', mensaje: 'Petición inválida.' } }
  const r = req as Record<string, unknown>
  if (typeof r.conexionId !== 'string' || r.conexionId === '') {
    return { ok: false, error: { motivo: 'interno', mensaje: 'Petición inválida: falta «conexionId».' } }
  }
  const v = conexionDeFamilia(conexiones.get(r.conexionId), familia)
  if (!v.ok) return v
  if (r.perfilId !== undefined && r.perfilId !== v.con.profileId) {
    return { ok: false, error: { motivo: 'interno', mensaje: 'La consola no pertenece a este perfil.' } }
  }
  return v
}
