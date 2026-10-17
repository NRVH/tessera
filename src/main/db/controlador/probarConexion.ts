// =============================================================================
// «Probar conexión»: decide si se puede probar, la lanza por `tdb test` y traduce su respuesta.
// El resultado habilita (o retira) montar la conexión en un proyecto: solo se monta lo que responde.
// Depende de `nombresSistema` (dónde guarda el sistema el secreto) y de `familias.ts`.
// =============================================================================
import type { DbConnection, DbTestResult } from '../../../shared/db-ipc.ts'
import { descriptor, esDeClaves, esDeDocumentos, esMotorSql, pideUsuarioYClave, usaOpcional } from '../../../shared/motores/index.ts'
import { nombresSistema } from '../../../shared/nombresSistema.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import type { ConnectionStore } from '../ConnectionStore.ts'
import { mensajeTodaviaNo } from '../explorador/familias.ts'
import { txDb } from '../textosDb.ts'

/** Lo que responde «Probar» si la conexión se guardó con otro destino mientras se probaba. */
export function mensajeCambioEnVuelo(): string {
  return txDb().probar.cambioEnVuelo
}

/** Lo que «Probar» necesita del resto del subsistema. */
export interface DependenciasPrueba {
  connections: Pick<ConnectionStore, 'get' | 'huellaPrueba' | 'setVerificada' | 'setDriver'>
  /** Lanza `tdb <args> --json` y devuelve el objeto que imprimió. */
  ejecutar: (con: DbConnection, args: string[]) => Promise<Record<string, unknown>>
  /** Avisa a las vistas de que el registro cambió. */
  avisarCambio: () => void
}

/** El motivo por el que la conexión no se puede probar todavía, o `null` si se puede lanzar `tdb`. */
function rechazoPrevio(con: DbConnection): DbTestResult | null {
  // Un motor que esta versión aún no sabe abrir no lanza nada y lo dice como el explorador.
  const d = descriptor(con.motor)
  if (!esMotorSql(con.motor) && !esDeDocumentos(d) && !esDeClaves(d)) return { ok: false, mensaje: mensajeTodaviaNo(con.motor) }
  // Sin credenciales (SQLite) o con usuario opcional (MongoDB, Redis) no se exige contraseña.
  if (pideUsuarioYClave(d) && !usaOpcional(d, 'user') && !con.tieneSecreto) {
    return { ok: false, mensaje: txDb().probar.sinContrasenaGuardada }
  }
  // Antes de gastar un subproceso: si el secreto no se descifra aquí, `tdb` diría «no hay contraseña».
  if (con.secretoIlegible) {
    return {
      ok: false,
      // El nombre del almacén sale de `nombresSistema` y cae detrás de un verbo: sus valores
      // traen artículo («el Llavero de macOS») y «atado a …» daría «atado a el Llavero».
      mensaje: txDb().probar.contrasenaIlegible(nombresSistema(plataformaActual()).almacenSecretos)
    }
  }
  return null
}

/** El resultado para el panel a partir de lo que respondió `tdb`; al éxito, recuerda el driver que resolvió. */
function resultadoDeTdb(res: Record<string, unknown>, id: string, connections: DependenciasPrueba['connections']): DbTestResult {
  if (res.ok === true) {
    connections.setDriver(id, typeof res.driverId === 'string' ? res.driverId : null)
    // Aviso de soporte (p. ej. un cliente Oracle no soportado para esa versión): conecta igual.
    const aviso = typeof res.aviso === 'string' && res.aviso ? `\n${res.aviso}` : ''
    return {
      ok: true,
      mensaje: txDb().probar.conectado(typeof res.ms === 'number' ? String(res.ms) : '?', String(res.modo ?? ''), aviso),
      servidor: typeof res.servidor === 'string' ? res.servidor : undefined,
      ms: typeof res.ms === 'number' ? res.ms : undefined
    }
  }
  const requiere = res.requiereDriver as DbTestResult['requiereDriver'] | undefined
  return {
    ok: false,
    // Error crudo a propósito: sirve para depurar una VPN caída o un ORA-12154.
    mensaje: typeof res.error === 'string' ? res.error : txDb().probar.falloDesconocido,
    requiereDriver: requiere
  }
}

/** Abre de verdad contra el servidor; si falta el driver, el resultado lo dice de forma estructurada. */
export async function probarConexion(deps: DependenciasPrueba, id: string): Promise<DbTestResult> {
  const con = deps.connections.get(id)
  if (!con) return { ok: false, mensaje: txDb().conexion.desconocida(id) }
  const rechazo = rechazoPrevio(con)
  if (rechazo) return rechazo
  const huella = deps.connections.huellaPrueba(id)
  const res = await deps.ejecutar(con, ['test', con.alias])
  // Guardada con otro destino o contraseña (o borrada) con la prueba en vuelo: el resultado es de la
  // conexión de antes, y apuntarlo dejaría verificada y montable una que nunca respondió.
  if (deps.connections.huellaPrueba(id) !== huella) return { ok: false, mensaje: mensajeCambioEnVuelo() }
  deps.connections.setVerificada(id, res.ok === true)
  deps.avisarCambio()
  return resultadoDeTdb(res, id, deps.connections)
}
