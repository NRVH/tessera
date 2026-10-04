// =============================================================================
// Esquema elegido en una consola: aplicarlo al (re)abrir la sesión, degradarlo solo ante la
// señal real de que ya no existe y volver a ponerlo tras un ROLLBACK que lo deshizo.
// Decisiones: docs/decisiones/bd/sesiones-esquema-de-consola.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { descriptorSql } from '../../../../shared/motores/index.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import { type BindsTrabajador, esFalloTrabajador } from '../protocoloTrabajador.ts'
import type { ConsultaCatalogo } from '../motores/tipos.ts'
import {
  avisoEsquemaPerdido,
  type IntentoReaplicar,
  sqlFijarEsquema,
  sqlLeerEsquema,
  trasReaplicarEsquema
} from '../consolaSql.ts'
import { mensajeDe } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import { capacidades } from './reglas.ts'
import type { Proceso, Sesion } from './tipos.ts'

/** Esquema de la sesión de una consola. */
export class EsquemaConsola {
  private readonly n: NucleoSesiones

  constructor(n: NucleoSesiones) {
    this.n = n
  }

  /** Esquema elegido en la consola de `s` (null = el de la conexión, o no es consola). */
  esquemaElegido(s: Sesion): string | null {
    if (s.ref.rol !== 'consola' || !this.n.deps.esquemaDeConsola) return null
    try {
      return this.n.deps.esquemaDeConsola(s.ref.perfilId, s.ref.consolaId)
    } catch {
      return null
    }
  }

  /**
   * Fija el esquema de la sesión en el trabajador y devuelve el que quedó (leído del
   * servidor). No toca la máquina: el llamador sabe en qué fase está. Lanza el fallo
   * del trabajador.
   */
  async enviarEsquema(s: Sesion, p: Proceso, d: DialectoSql, esquema: string | null): Promise<string | null> {
    const c = sqlFijarEsquema(d, esquema, s.esquemaConexion)
    if (!c) return s.esquemaConexion
    return this.sqlDeEsquema(s, p, c)
  }

  /** Solo LEE el esquema actual de la sesión (tras una reversión que no se reaplica). */
  private async releerEsquema(s: Sesion, p: Proceso, d: DialectoSql): Promise<string | null> {
    return this.sqlDeEsquema(s, p, sqlLeerEsquema(d))
  }

  /** SQL de Tessera sobre el esquema de la sesión; devuelve el que quedó (leído del servidor). */
  private async sqlDeEsquema(s: Sesion, p: Proceso, c: ConsultaCatalogo): Promise<string | null> {
    const r = await p.trabajador.enviar<'ejecutar'>({
      op: 'ejecutar',
      sesion: s.idTrabajador,
      sql: c.sql,
      binds: c.binds as BindsTrabajador,
      opciones: {
        // SQL de Tessera, fuera de la transacción: sin candado ni BEGIN, y no cuenta
        // como sentencia. En PG va fuera de cualquier envoltorio de solo lectura.
        proposito: 'catalogo',
        maxFilas: 1,
        candadoRO: false,
        sinBegin: true,
        comprobarTx: false,
        leerEsquema: true
      }
    })
    return typeof r.esquema === 'string' ? r.esquema : null
  }

  /**
   * Al (re)abrir una consola, vuelve a aplicar su esquema elegido. Si ya no existe
   * (Oracle: ORA-01435; PG no falla, pero `current_schema()` lo salta), se DEGRADA al
   * de la conexión: se olvida en el índice (`alPerderEsquema`) y se avisa en la Salida
   * del siguiente resultado (`avisosPendientes`, sin canal nuevo), además de con el
   * esquema que emite `dbx:ev:sesion`. SOLO la señal real degrada
   * (`trasReaplicarEsquema`): una pérdida, un plazo, un código de red fuera de los de
   * pérdida (ORA-12571) o una relectura que no llegó tras un ALTER que sí fue bien no
   * son culpa del esquema, y la próxima reapertura lo volverá a intentar. Antes
   * degradaba ante cualquier fallo y un corte de VPN borraba el esquema guardado para
   * siempre, con un «ya no existe» falso. Nunca lanza.
   */
  async reaplicarEsquema(
    s: Sesion,
    p: Proceso,
    con: DbConnection,
    actual: string | null
  ): Promise<string | null> {
    const elegido = this.esquemaElegido(s)
    if (elegido === null || elegido === actual || s.ref.rol !== 'consola') return actual
    const d = dialectoDeMotor(con.motor)
    let intento: IntentoReaplicar
    try {
      intento = { ok: true, leido: await this.enviarEsquema(s, p, d, elegido) }
    } catch (e) {
      intento = { ok: false, codigo: esFalloTrabajador(e) ? (e.error.codigo ?? null) : null }
    }
    const decision = trasReaplicarEsquema(d, elegido, intento, s.estado.fase === 'abriendo')
    if (decision.tipo === 'aplicado') return decision.esquema
    if (decision.tipo === 'conservar') {
      this.n.log(`no se pudo volver a aplicar el esquema de una consola de ${s.conexionId}; se reintentará al reabrir`)
      return actual
    }
    let final = actual
    // Donde fijar no valida (PG), el nombre que no existe SÍ se fijó y hay que volver al de
    // la conexión; donde valida (Oracle, ORA-01435) el ALTER falló y la sesión sigue en él.
    if (!capacidades(d).fijarEsquemaValida) {
      try {
        final = await this.enviarEsquema(s, p, d, null)
      } catch {
        // se queda con lo que haya: el aviso (si lo hay) lo dice igual
      }
    }
    if (decision.tipo === 'volver') {
      // PG sin relectura: no se sabe si existe. Esta sesión vuelve al de la conexión,
      // pero el elegido se conserva y la próxima reapertura lo reintenta.
      this.n.log(`consola de ${s.conexionId}: no se pudo confirmar su esquema; vuelve al de la conexión sin olvidarlo`)
      return final
    }
    s.avisosPendientes.push(avisoEsquemaPerdido(elegido, final))
    this.n.log(`consola de ${s.conexionId}: su esquema guardado ya no existe; vuelve al de la conexión`)
    try {
      this.n.deps.alPerderEsquema?.(s.ref.perfilId, s.ref.consolaId, elegido)
    } catch (e) {
      this.n.log(`alPerderEsquema falló: ${mensajeDe(e)}`)
    }
    return final
  }

  /**
   * PG, tras el botón Revertir: un ROLLBACK deshace el `SET search_path` que se
   * hiciera dentro de la transacción (el usuario eligió esquema con una abierta). Se
   * vuelve a aplicar el elegido solo si la sesión estaba en él ANTES (`antes`), la
   * misma regla que `reaplicarTrasTx`: un SET a mano manda (reaplicarlo siempre pisaría un
   * `SET compras` confirmado), y entonces solo se relee. Oracle no lo
   * necesita: ALTER SESSION no es transaccional (`esquemaTransaccional` del descriptor).
   * undefined = no se tocó.
   */
  async esquemaTrasRollback(s: Sesion, p: Proceso, antes: string | null): Promise<string | null | undefined> {
    const con = this.n.deps.conexion(s.conexionId)
    if (!con || !descriptorSql(con.motor).sesion.esquemaTransaccional) return undefined
    const d = dialectoDeMotor(con.motor)
    const elegido = this.esquemaElegido(s)
    try {
      // Estaba en el elegido: si lo había puesto Tessera dentro de la tx, la reversión
      // lo deshizo, y si no, volver a ponerlo no cambia nada (un viaje, como leerlo).
      if (elegido !== null && antes === elegido) return await this.enviarEsquema(s, p, d, elegido)
      // Lo movió un SET a mano y MANDA. Solo se relee: si lo hizo dentro de la tx, la
      // reversión lo deshizo, y la barra no puede quedarse con el valor viejo.
      return await this.releerEsquema(s, p, d)
    } catch {
      return undefined
    }
  }
}
