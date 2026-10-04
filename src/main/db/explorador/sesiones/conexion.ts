// =============================================================================
// Stop, Forzar, desconectar y la lista de sesiones que ve el renderer. El Stop salta la cola
// por su clave; en un motor que no se interrumpe, parar es matar el proceso de la sesión.
// Decisiones: docs/decisiones/bd/sesiones-procesos-y-autoridad.md
// =============================================================================

import type {
  DbCancelar,
  DbEstadoSesion,
  DbRefSesion,
  DbResolucionBloque,
  DbResolverTx,
  DbRespuesta
} from '../../../../shared/db-explorador-ipc.ts'
import { MENSAJES, tieneTxPendiente } from '../maquinaSesion.ts'
import { CODIGO_DETENIDA, MENSAJE_DETENIDA } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import type { Procesos } from './procesos.ts'
import { procesoPorSesion } from './reglas.ts'
import type { Proceso, Sesion } from './tipos.ts'
import type { Transacciones } from './transacciones.ts'

/** Stop, Forzar y desconectar. */
export class ConexionSesiones {
  private readonly n: NucleoSesiones
  private readonly proc: Procesos
  private readonly tx: Transacciones

  constructor(n: NucleoSesiones, proc: Procesos, tx: Transacciones) {
    this.n = n
    this.proc = proc
    this.tx = tx
  }

  /** Stop. Se ignora si la clave no es la de la operación activa (o en espera). */
  cancelar(req: DbCancelar): void {
    let s: Sesion | undefined
    let clave: string
    if (req.rol === 'consola') {
      s = this.n.sesionDeConsola(req.perfilId, req.consolaId)
      clave = req.ejecucionId
    } else if (req.rol === 'datos') {
      clave = req.peticionId
      // Un «Contar» de un resultado de consola corre en la sesión de esa consola.
      s = this.n.sesionesDeConexion(req.conexionId).find(
        (x) => x.cola.claveEnCurso() === clave || x.cola.esperandoClave(clave)
      )
    } else {
      // Exportar: su lectura en vuelo está en `datos` (una tabla) o en la sesión de una
      // consola (una consulta), siempre con el `peticionId` como clave. El bucle de
      // páginas lo para el exportador; aquí solo se interrumpe la lectura.
      clave = req.peticionId
      s = [...this.n.sesiones()].find(
        (x) => !x.eliminada && (x.cola.claveEnCurso() === clave || x.cola.esperandoClave(clave))
      )
    }
    if (!s || typeof clave !== 'string' || !clave) return
    const corre = s.cola.cancelar(clave)
    if (!corre) return
    // «Enviar» corre varias sentencias en UNA tarea: el Stop que cae entre dos
    // no tiene nada que interrumpir en el trabajador, y el bucle lo mira aquí.
    if (s.pararEntreSentencias) s.cancelada = clave
    const p = s.proceso
    if (s.enTrabajador === clave && p && p.trabajador.vivo) {
      // Un motor que no se interrumpe (SQLite): parar es matar el proceso de la sesión.
      const con = this.n.deps.conexion(s.conexionId)
      if (con && procesoPorSesion(con)) {
        this.detenerMatando(s, p)
        return
      }
      this.n.log(`cancelar ${s.rol} de ${s.conexionId}`)
      p.trabajador.enviar<'cancelar'>({ op: 'cancelar', sesion: s.idTrabajador }).catch(() => {
        // si no llega, la UI ofrecerá «Forzar»
      })
    } else {
      // Aún abriendo la sesión: se apunta y no llegará a enviarse.
      s.cancelada = clave
    }
  }

  /**
   * El Stop de un motor que no se interrumpe (`procesoPorSesion`, SQLite):
   * node:sqlite es síncrono y no tiene interrupt, así que parar una consulta es MATAR el
   * proceso que la ejecuta (17 ms; se relanza al volver a usarlo, 62 ms). Cada consola tiene
   * el suyo, así que no se lleva nada más. NO se mata:
   *   - si la sesión tiene CAMBIOS PENDIENTES: se perderían, y eso lo decide el usuario con
   *     el «Forzar» de siempre, que dice qué transacciones se pierden;
   *   - si el proceso es el de la conexión (meta, datos, exportar, «Enviar») y otra sesión
   *     suya trabaja o tiene cambios: se llevaría lo que no se pidió parar. Una efímera de
   *     Tessera («Enviar», exportar) sí se para con su transacción: todo o nada, nada se
   *     confirmó.
   * Lo que estaba en vuelo vuelve `cancelada` (el motivo de `matar`), y la sesión pasa a
   * `detenida`: cerrada sin aviso, se reabre en la siguiente operación.
   */
  private detenerMatando(s: Sesion, p: Proceso): void {
    if (!s.interna && tieneTxPendiente(s.estado)) {
      this.n.log(`stop de ${s.rol} de ${s.conexionId}: tiene cambios pendientes, no se mata (queda «Forzar»)`)
      return
    }
    const otras = this.n.sesionesDe(p).filter((x) => x !== s)
    const ocupadas = otras.some(
      (x) =>
        x.estado.fase === 'ocupada' ||
        x.estado.fase === 'abriendo' ||
        !x.cola.vacia() ||
        x.operacionUsuario !== null ||
        tieneTxPendiente(x.estado)
    )
    if (ocupadas) {
      this.n.log(`stop de ${s.rol} de ${s.conexionId}: su proceso tiene más trabajo, no se mata (queda «Forzar»)`)
      return
    }
    this.n.log(`stop de ${s.rol} de ${s.conexionId}: se mata su proceso #${p.id}`)
    p.detenido = true
    this.n.retirarProceso(p)
    try {
      p.trabajador.matar({ clase: 'cancelada', codigo: CODIGO_DETENIDA, mensaje: MENSAJE_DETENIDA })
    } catch {
      // ya no está
    }
  }

  /**
   * Forzar: mata el proceso de la conexión (la UI ya confirmó lo que se pierde). Con
   * `consola`, en un motor con un proceso por consola (`procesoPorSesion`, SQLite),
   * mata SOLO el de esa consola: la UI confirmó perder únicamente su transacción, y los
   * demás procesos de la conexión (otras consolas, meta, datos) no se tocan. Si esa
   * consola no tiene proceso vivo propio no hay nada que forzar, y NO se cae al de la
   * conexión entera: sería llevarse lo que no se confirmó.
   */
  forzar(conexionId: string, consola?: { perfilId: string; consolaId: string }): void {
    const con = consola ? this.n.deps.conexion(conexionId) : null
    if (consola && con && procesoPorSesion(con)) {
      this.forzarConsola(conexionId, consola)
      return
    }
    for (const p of [...this.n.procesos()]) {
      if (p.conexionId !== conexionId || p.salido) continue
      this.n.log(`forzar: se mata el proceso #${p.id} de ${conexionId}`)
      this.matarForzado(p)
    }
  }

  /**
   * Solo el proceso PROPIO de esa consola: la UI confirmó perder únicamente su transacción. Sin
   * proceso propio vivo no hay nada que forzar, y NO se cae al de la conexión entera.
   */
  private forzarConsola(conexionId: string, consola: { perfilId: string; consolaId: string }): void {
    const s = this.n.sesionDeConsola(consola.perfilId, consola.consolaId)
    const p = s && s.conexionId === conexionId ? s.proceso : null
    if (!p || p.salido || p.clave === conexionId) {
      this.n.log(`forzar consola de ${conexionId}: no tiene proceso propio vivo, nada que matar`)
      return
    }
    this.n.log(`forzar: se mata el proceso #${p.id} de la consola de ${conexionId}`)
    this.matarForzado(p)
  }

  private matarForzado(p: Proceso): void {
    this.n.retirarProceso(p)
    try {
      p.trabajador.matar()
    } catch {
      // ya no está
    }
  }

  /** Cierra todas las sesiones y el proceso de una conexión. */
  async desconectar(conexionId: string, resolver?: DbResolverTx): Promise<DbRespuesta<DbResolucionBloque>> {
    if (resolver !== undefined && resolver !== 'commit' && resolver !== 'rollback') {
      return { ok: false, error: { motivo: 'interno', mensaje: 'Resolución de transacción desconocida.' } }
    }
    const sesiones = this.n.sesionesDeConexion(conexionId)
    const conTx = sesiones.filter((s) => tieneTxPendiente(s.estado))
    if (conTx.length > 0 && !resolver) {
      return {
        ok: false,
        error: { motivo: 'txPendiente', mensaje: MENSAJES.txPendiente, txPendientes: conTx.map((s) => s.ref) }
      }
    }
    const revertidas: DbRefSesion[] = []
    if (resolver === 'commit') {
      // Las FALLIDAS AL FINAL: si el COMMIT de una pendiente falla de verdad, se para
      // ahí —la conexión sigue conectada y el usuario ve el error— sin haber tocado
      // todavía ninguna fallida. Revertirlas no perdería nada (ya no se pueden
      // confirmar), pero lo que no hace falta tocar para informar de un fallo, no se toca.
      const orden = [...conTx.filter((s) => s.estado.tx !== 'fallida'), ...conTx.filter((s) => s.estado.tx === 'fallida')]
      for (const s of orden) {
        const r = await this.tx.resolverEnBloque(s, 'commit')
        if (r.error) return { ok: false, error: r.error }
        if (r.revertidaPorFallida) revertidas.push(s.ref)
      }
      if (revertidas.length > 0) this.n.log(`desconectar ${conexionId}: ${revertidas.length} transacción(es) fallida(s) revertida(s)`)
    }
    // `salir` revierte lo que quede (resolver 'rollback').
    const procesos = [...this.n.procesos()].filter((p) => p.conexionId === conexionId && !p.salido)
    await Promise.all(procesos.map((p) => this.proc.retirar(p, 'usuario')))
    return { ok: true, valor: revertidas.length > 0 ? { revertidasFallidas: revertidas } : {} }
  }

  /** Las sesiones que ve el renderer (sin las `interna`, que no conoce). */
  sesiones(): DbEstadoSesion[] {
    return [...this.n.sesiones()].filter((s) => !s.eliminada && !s.interna).map((s) => this.n.dto(s))
  }
}
