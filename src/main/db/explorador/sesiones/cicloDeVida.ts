// =============================================================================
// Ciclo de vida: barrido por inactividad, pendientes y resolución de todas (salida de la app),
// cierre y reanudación, y los ganchos de editar o borrar una conexión y de cambiar un driver.
// Decisiones: docs/decisiones/bd/transacciones-produccion-y-manual.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { DbEstadoTx, DbRefSesion, DbResolverTx } from '../../../../shared/db-explorador-ipc.ts'
import { esProduccion, txModoInicialConsola } from '../produccion.ts'
import { estadoInicial, tieneTxPendiente } from '../maquinaSesion.ts'
import { CIERRE_TRABAJADORES_MS, PROCESO_SIN_SESIONES_MS, umbralInactividadMs } from '../limites.ts'
import { mensajeDe } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import type { Procesos } from './procesos.ts'
import { abierta, esperar } from './reglas.ts'
import type { ErrorResolucion, ResolucionEnBloque, ResolucionTodas, Sesion, SesionResuelta } from './tipos.ts'
import type { Transacciones } from './transacciones.ts'

/** Barrido, salida de la app y ganchos de conexión y driver. */
export class CicloDeVida {
  private readonly n: NucleoSesiones
  private readonly proc: Procesos
  private readonly tx: Transacciones

  constructor(n: NucleoSesiones, proc: Procesos, tx: Transacciones) {
    this.n = n
    this.proc = proc
    this.tx = tx
  }

  /**
   * Barrido periódico (cada `BARRIDO_MS`): cierra por inactividad (la máquina
   * NUNCA cierra con tx pendiente o fallida), cierra con rollback lo de conexiones
   * que ya no existen y deja salir los procesos sin sesiones. Solo toca sesiones con
   * la cola vacía.
   */
  barrer(ahora: number = this.n.ahora()): void {
    this.barrerSesiones(ahora)
    this.barrerProcesos(ahora)
  }

  /** Solo toca sesiones con la cola vacía; la máquina NUNCA cierra con tx pendiente o fallida. */
  private barrerSesiones(ahora: number): void {
    for (const s of [...this.n.sesiones()]) {
      if (s.eliminada || !s.cola.vacia() || s.operacionUsuario !== null) continue
      if (!this.n.deps.conexion(s.conexionId)) {
        const ef = this.n.aplicar(s, { tipo: 'cierre', ahora, motivo: 'conexionBorrada', resolver: 'rollback' })
        this.n.efectosSincronos(s, ef)
        this.n.olvidarSesion(s)
        continue
      }
      const ef = this.n.aplicar(s, {
        tipo: 'inactividad',
        ahora,
        umbralMs: umbralInactividadMs(s.rol, this.n.ajustes().inactividadConsolaMs)
      })
      if (ef.length) this.n.log(`cierre por inactividad: ${s.rol} de ${s.conexionId}`)
      this.n.efectosSincronos(s, ef)
    }
  }

  /** Deja salir los procesos sin sesiones (tras `PROCESO_SIN_SESIONES_MS`) y los de conexiones borradas. */
  private barrerProcesos(ahora: number): void {
    for (const p of [...this.n.procesos()]) {
      if (p.retirado || p.salido || !p.listo) continue
      const vivas = this.n.sesionesDe(p).filter(abierta)
      if (vivas.length > 0 || p.trabajador.pendientes > 0) {
        p.sinSesionesDesde = null
        continue
      }
      if (!this.n.deps.conexion(p.conexionId)) {
        void this.proc.retirar(p, 'conexionBorrada')
        continue
      }
      if (p.sinSesionesDesde === null) p.sinSesionesDesde = ahora
      else if (ahora - p.sinSesionesDesde >= PROCESO_SIN_SESIONES_MS) void this.proc.retirar(p, 'usuario')
    }
  }

  /**
   * Sesiones con cambios sin confirmar o una transacción fallida sin resolver. Con
   * su `tx`: el diálogo de salida marca las fallidas, que no se pueden confirmar
   * (el COMMIT de PG sobre una tx en 'E' es un ROLLBACK) y se revertirán igual.
   */
  pendientes(): Array<{ ref: DbRefSesion; conexionId: string; tx: DbEstadoTx }> {
    return [...this.n.sesiones()]
      .filter((s) => !s.eliminada && tieneTxPendiente(s.estado))
      .map((s) => ({ ref: s.ref, conexionId: s.conexionId, tx: s.estado.tx }))
  }

  hayTxPendiente(conexionId?: string): boolean {
    return [...this.n.sesiones()].some(
      (s) => !s.eliminada && (conexionId === undefined || s.conexionId === conexionId) && tieneTxPendiente(s.estado)
    )
  }

  /**
   * Confirma o revierte TODAS las transacciones pendientes (diálogo de salida). Es un
   * bloque: con `commit`, las fallidas se REVIERTEN en vez de fallar y vuelven en
   * `revertidas`; en `errores` solo queda lo que falló de verdad (un COMMIT que el
   * servidor rechazó, el plazo). Así «Confirmar y salir» ya no acaba en «¿Salir
   * revirtiendo?» por una fallida que el primer diálogo ya marcaba «se revertirá».
   */
  async resolverTodas(accion: DbResolverTx, plazoMs?: number): Promise<ResolucionTodas> {
    const pendientes = [...this.n.sesiones()].filter((s) => !s.eliminada && tieneTxPendiente(s.estado))
    const errores: ErrorResolucion[] = []
    const revertidas: SesionResuelta[] = []
    await Promise.all(
      pendientes.map(async (s) => {
        if (accion === 'rollback' && s.enTrabajador !== null && s.proceso?.trabajador.vivo) {
          // Una sentencia en curso bloquearía el ROLLBACK en la cola: se interrumpe.
          s.proceso.trabajador.enviar<'cancelar'>({ op: 'cancelar', sesion: s.idTrabajador }).catch(() => {})
        }
        const trabajo = this.tx.resolverEnBloque(s, accion)
        const r =
          plazoMs !== undefined
            ? await Promise.race([
                trabajo,
                esperar(plazoMs).then(
                  (): ResolucionEnBloque => ({
                    error: { motivo: 'timeout', mensaje: 'El servidor no respondió a tiempo.' },
                    revertidaPorFallida: false
                  })
                )
              ])
            : await trabajo
        if (r.error) errores.push({ ref: s.ref, conexionId: s.conexionId, mensaje: r.error.mensaje })
        else if (r.revertidaPorFallida) revertidas.push({ ref: s.ref, conexionId: s.conexionId })
      })
    )
    return { ok: errores.length === 0, errores, revertidas }
  }

  /**
   * Cierre de la app: `salir` a cada proceso (rollback + close + exit), espera hasta
   * `plazoMs` y después SIGKILL (lo hace `ProcesoTrabajador.salir`). No admite nada
   * nuevo desde que empieza.
   */
  async cerrarTodo(plazoMs: number = CIERRE_TRABAJADORES_MS): Promise<void> {
    this.n.empezarCierre()
    for (const s of this.n.sesiones()) s.cola.descartarTodas()
    const procesos = [...this.n.procesos()]
    await Promise.all(
      procesos.map((p) => {
        p.retirado = true
        return p.trabajador.salir(plazoMs).catch((e: unknown) => this.n.log(`salir falló: ${mensajeDe(e)}`))
      })
    )
    this.n.log(`cerrarTodo: ${procesos.length} proceso(s)`)
  }

  /**
   * Deshace el pestillo de `cerrarTodo` cuando el cierre se ABORTA y la app vuelve al
   * usuario (el «plan C» de una actualización que no pudo lanzarse). Sin esto, cada
   * despliegue del árbol, tabla o consola fallaba con «Tessera se está cerrando»
   * hasta reiniciar, justo cuando la ventana acaba de decir «Cierre cancelado». No
   * hay nada más que reabrir: los procesos viejos ya salieron o están retirados, sus
   * sesiones quedaron `perdida` (el servidor revirtió) y se reabren solas en la
   * siguiente operación, como tras cualquier pérdida.
   */
  reanudarTrasCierreAbortado(): void {
    if (!this.n.cancelarCierre()) return
    this.n.log('cierre abortado: el explorador vuelve a aceptar operaciones')
  }

  /**
   * La conexión se editó (el plan bloquea editar con tx pendiente). Sus procesos se
   * retiran: las sesiones ociosas se cierran con aviso `editada` y se reabren con
   * los datos nuevos; una consulta en curso se detiene (la UI ya lo avisó).
   */
  alCambiarConexion(previo: DbConnection, nuevo: DbConnection): void {
    for (const p of [...this.n.procesos()]) {
      if (p.conexionId === nuevo.id && !p.salido) void this.proc.retirar(p, 'editada')
    }
    // El «solo lectura» de antes y de ahora es el que IMPONE el explorador (`ro`), no la
    // casilla de los agentes: marcarla o desmarcarla no mueve el modo de ninguna consola.
    const roPrevio = this.n.ro(previo)
    const roNuevo = this.n.ro(nuevo)
    const motivo = this.motivoManual(previo, nuevo, roPrevio, roNuevo)
    // Las sesiones sin proceso toman ya el nuevo «solo lectura» (y con él, Auto).
    for (const s of this.n.sesionesDeConexion(nuevo.id)) this.alCambiarSuConexion(s, motivo, roNuevo)
  }

  /**
   * Por qué pasan a Manual las consolas de la conexión editada, o null. 'produccion': PASÓ a
   * producción de escritura (solo al pasar: editar el alias no deshace un Auto elegido, y salir
   * de producción no decide por el usuario). 'preferencia': DEJÓ de ser de solo lectura fuera
   * de producción y «Transacción al abrir» es Manual: su Auto era el forzado, no una elección.
   */
  private motivoManual(
    previo: DbConnection,
    nuevo: DbConnection,
    roPrevio: boolean,
    roNuevo: boolean
  ): 'produccion' | 'preferencia' | null {
    const aProduccion = txModoInicialConsola(nuevo, roNuevo) === 'manual' && (roPrevio || !esProduccion(previo))
    const aPreferencia =
      !aProduccion && roPrevio && !roNuevo && txModoInicialConsola(nuevo, roNuevo, this.n.ajustes().txInicial) === 'manual'
    return aProduccion ? 'produccion' : aPreferencia ? 'preferencia' : null
  }

  private alCambiarSuConexion(s: Sesion, motivo: 'produccion' | 'preferencia' | null, roNuevo: boolean): void {
    const f = s.estado.fase
    const aManual = motivo !== null && s.rol === 'consola' && s.estado.txModo !== 'manual'
    if (f !== 'cerrada' && f !== 'perdida') {
      // Una consola ocupada, abriendo o con algo en su cola (que `retirar` no cierra) no puede
      // cambiar de modo ahora: se apunta y se aplica en cuanto se pueda, con la conexión de ESE
      // momento. A TODAS sus consolas, también a las que hoy dicen Manual: una que estaba
      // confirmando el paso de Manual a Auto acabaría en Auto contra producción.
      if (motivo !== null && s.rol === 'consola') {
        s.manualPendiente = motivo
        if (f === 'lista') {
          this.n.aplicarManualPendiente(s)
          this.n.emitir(s)
        }
      }
      return
    }
    const cambiaRo = s.estado.soloLectura !== roNuevo
    if (!cambiaRo && !aManual) return
    const base = estadoInicial({
      soloLectura: roNuevo,
      ahora: s.estado.ultimoUso,
      txModo: aManual ? 'manual' : s.estado.txModo
    })
    s.estado = { ...base, fase: f, esquema: s.estado.esquema, ...(s.estado.aviso ? { aviso: s.estado.aviso } : {}) }
    this.n.emitir(s)
  }

  /** La conexión se borró: fuera sus sesiones (el `salir` revierte) y su proceso. */
  alBorrarConexion(conexionId: string): void {
    for (const s of this.n.sesionesDeConexion(conexionId)) this.n.olvidarSesion(s)
    for (const p of [...this.n.procesos()]) {
      if (p.conexionId === conexionId && !p.salido) void this.proc.retirar(p, 'conexionBorrada')
    }
  }

  /**
   * Antes de instalar u olvidar un cliente de BD: cierra los procesos que lo tienen
   * cargado (si no, en Windows el cambio de archivos da EBUSY). Con transacciones
   * pendientes LANZA: no se pierde trabajo por instalar un driver.
   */
  async cerrarProcesosDelDriver(packId: string): Promise<void> {
    const afectados = [...this.n.procesos()].filter((p) => !p.salido && p.driverId === packId)
    const conTx = afectados.flatMap((p) => this.n.sesionesDe(p)).filter((s) => tieneTxPendiente(s.estado))
    if (conTx.length > 0) {
      throw new Error(
        `Hay ${conTx.length === 1 ? 'una consola' : `${conTx.length} consolas`} con transacciones pendientes que usan este cliente: confírmalas o revierte antes de cambiarlo.`
      )
    }
    await Promise.all(afectados.map((p) => this.proc.retirar(p, 'usuario')))
  }

  /** Procesos lanzados que aún no han salido (tests y diagnóstico). */
  procesosVivos(): number {
    return [...this.n.procesos()].filter((p) => !p.salido).length
  }
}
