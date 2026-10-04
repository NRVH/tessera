// =============================================================================
// Transacciones de consola: COMMIT/ROLLBACK, cambio de modo, cierre y esquema, siempre por la
// máquina (`transicion`) y ejecutando sus efectos en su orden; y la resolución en bloque de
// desconectar y de la salida de la app.
// Decisiones: docs/decisiones/bd/transacciones-maquina-de-estados.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { DbErrorSql, DbEstadoSesion, DbResolverTx, DbRespuesta, DbTxModo } from '../../../../shared/db-explorador-ipc.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import { txInicialDePeticion } from '../../../../shared/ajustesBd.ts'
import { exigeConfirmacion, mensajeProduccion } from '../produccion.ts'
import { accionEnBloque, type EfectoSesion, type EventoSesion, MENSAJES, tieneTxPendiente } from '../maquinaSesion.ts'
import { esFalloTrabajador } from '../protocoloTrabajador.ts'
import { motorExplorador } from '../motores/index.ts'
import type { Apertura } from './apertura.ts'
import { ErrorGestor, motivoDeRechazo } from './errores.ts'
import type { EsquemaConsola } from './esquemaConsola.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import type { Procesos } from './procesos.ts'
import { capacidades, efectoTx, listaConProcesoVivo, rechazoDe } from './reglas.ts'
import type { Proceso, RefConsola, ResolucionEnBloque, Sesion } from './tipos.ts'

/** Transacciones y estado de las consolas. */
export class Transacciones {
  private readonly n: NucleoSesiones
  private readonly proc: Procesos
  private readonly esq: EsquemaConsola
  private readonly ap: Apertura

  constructor(n: NucleoSesiones, proc: Procesos, esq: EsquemaConsola, ap: Apertura) {
    this.n = n
    this.proc = proc
    this.esq = esq
    this.ap = ap
  }

  private rechazo(s: Sesion, r: Extract<EfectoSesion, { tipo: 'rechazar' }>): { ok: false; error: DbErrorSql } {
    const error: DbErrorSql = { motivo: motivoDeRechazo(r.motivo), mensaje: r.mensaje }
    if (error.motivo === 'txPendiente') error.txPendientes = [s.ref]
    return { ok: false, error }
  }

  /**
   * Ejecuta el efecto `tx` (COMMIT/ROLLBACK) y responde a la máquina con el estado
   * REAL. Si falla, la sesión vuelve a `lista` con la tx leída y SIN aplicar lo que
   * venía detrás (cambio de modo, cierre): el usuario decide otra vez. Privado: fuera de
   * aquí se entra por `txConsola`/`resolverEnBloque`, que pasan por la máquina.
   */
  private async ejecutarTx(s: Sesion, ef: Extract<EfectoSesion, { tipo: 'tx' }>): Promise<string[]> {
    const p = s.proceso
    if (!p || !p.trabajador.vivo) {
      // El COMMIT NO salió: la sesión se llevó la transacción y el servidor la revirtió.
      this.n.perder(s)
      throw new ErrorGestor('sesionPerdida', MENSAJES.perdidaConTx)
    }
    // El esquema ANTES de revertir: decide si la reversión deshizo el elegido.
    const esquemaAntes = s.estado.esquema
    // Un COMMIT con cambios pendientes que se pierde en camino NO se sabe si se aplicó. El de
    // una tx `abierta` (PG, sin cambios) no tiene nada que confirmar.
    const enCamino = ef.accion === 'commit' && s.estado.tx === 'pendiente'
    if (enCamino) s.commitEnCamino = 'commit'
    try {
      const r = await p.trabajador.enviar<'tx'>({ op: 'tx', sesion: s.idTrabajador, accion: ef.accion })
      const evento: EventoSesion = { tipo: 'txResuelta', ahora: this.n.ahora(), tx: r.tx }
      if (ef.tras) evento.tras = ef.tras
      if (ef.accion === 'rollback' && !ef.tras?.cerrar) {
        const esquema = await this.esq.esquemaTrasRollback(s, p, esquemaAntes)
        if (esquema !== undefined) evento.esquema = esquema
      }
      const ef2 = this.n.aplicar(s, evento)
      const avisos = [...(r.avisos ?? []), ...(await this.n.efectos(s, ef2))]
      for (const a of avisos) this.n.log(`aviso de tx en ${s.conexionId}: ${a}`)
      return avisos
    } catch (e) {
      const fatal = this.falloFatalDeTx(s, p, e, enCamino)
      if (fatal) throw fatal
      const tx = (await this.ap.sondaTx(s, p)) ?? s.estado.tx
      this.n.aplicar(s, { tipo: 'txResuelta', ahora: this.n.ahora(), tx })
      throw this.ap.aErrorGestor(e)
    } finally {
      delete s.commitEnCamino
    }
  }

  /**
   * La pérdida o el plazo vencido de un COMMIT/ROLLBACK: el error a lanzar, que con el COMMIT
   * en camino dice que no se sabe si se aplicó; null si la sesión sigue viva.
   */
  private falloFatalDeTx(s: Sesion, p: Proceso, e: unknown, enCamino: boolean): ErrorGestor | null {
    if (esFalloTrabajador(e) && e.error.clase === 'perdida') {
      // `perder` (o `alSalirProceso`, que llega antes) ya avisa con la duda.
      this.n.perder(s)
      const base = enCamino ? (e.error.codigo === 'TESSERA-PROCESO' ? MENSAJES.caidaEnCommit : MENSAJES.perdidaEnCommit) : MENSAJES.perdidaConTx
      return new ErrorGestor('sesionPerdida', base, e.error.codigo ? { codigo: e.error.codigo } : {})
    }
    if (esFalloTrabajador(e) && e.error.codigo === 'TESSERA-PLAZO') {
      this.n.perder(s, true)
      this.proc.matarColgado(p)
      const eg = this.ap.aErrorGestor(e)
      // El proceso se mata con el COMMIT dentro: tampoco se sabe si llegó a aplicarse.
      if (enCamino) eg.error.mensaje = `${MENSAJES.caidaEnCommit} (${eg.error.mensaje})`
      return eg
    }
    return null
  }

  /**
   * Commit / Rollback de una consola. En PRODUCCIÓN, el COMMIT exige `confirmado`;
   * el ROLLBACK no (deshacer no escribe). Una conexión de solo lectura no
   * llega a pedirlo: la máquina rechaza el COMMIT con su motivo.
   */
  async txConsola(ref: RefConsola, accion: DbResolverTx, confirmado?: boolean): Promise<DbRespuesta<DbEstadoSesion>> {
    if (accion !== 'commit' && accion !== 'rollback') {
      return { ok: false, error: { motivo: 'interno', mensaje: 'Acción de transacción desconocida.' } }
    }
    let s: Sesion
    try {
      const con = this.n.conexionDeConsola(ref)
      if (accion === 'commit' && exigeConfirmacion(con, this.n.ro(con), confirmado)) {
        return { ok: false, error: { motivo: 'produccion', mensaje: mensajeProduccion(con.alias, 'commit') } }
      }
      s = this.n.sesionDe({ rol: 'consola', perfilId: ref.perfilId, consolaId: ref.consolaId }, con, txInicialDePeticion(ref.txInicial))
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
    if (s.operacionUsuario !== null) return { ok: false, error: { motivo: 'ocupada', mensaje: 'La consola está ejecutando.' } }
    s.operacionUsuario = `tx:${accion}`
    try {
      return await s.cola.correr(
        async (): Promise<DbRespuesta<DbEstadoSesion>> => {
          const ef = this.n.aplicar(s, { tipo: accion, ahora: this.n.ahora() })
          const r = rechazoDe(ef)
          if (r) return this.rechazo(s, r)
          const t = efectoTx(ef)
          if (t) await this.ejecutarTx(s, t)
          return { ok: true, valor: this.n.dto(s) }
        },
        { prioridad: 'alta' }
      )
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    } finally {
      s.operacionUsuario = null
    }
  }

  /** Cambia el modo de transacción (Manual -> Auto con tx viva exige `resolver`). */
  async modoTx(ref: RefConsola, modo: DbTxModo, resolver?: DbResolverTx): Promise<DbRespuesta<DbEstadoSesion>> {
    if (modo !== 'auto' && modo !== 'manual') {
      return { ok: false, error: { motivo: 'interno', mensaje: 'Modo de transacción desconocido.' } }
    }
    if (resolver !== undefined && resolver !== 'commit' && resolver !== 'rollback') {
      return { ok: false, error: { motivo: 'interno', mensaje: 'Resolución de transacción desconocida.' } }
    }
    let s: Sesion
    try {
      const con = this.n.conexionDeConsola(ref)
      s = this.n.sesionDe({ rol: 'consola', perfilId: ref.perfilId, consolaId: ref.consolaId }, con, txInicialDePeticion(ref.txInicial))
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
    if (s.operacionUsuario !== null) return { ok: false, error: { motivo: 'ocupada', mensaje: 'La consola está ejecutando.' } }
    s.operacionUsuario = `modo:${modo}`
    try {
      return await s.cola.correr(
        async (): Promise<DbRespuesta<DbEstadoSesion>> => {
          const evento: EventoSesion = { tipo: 'cambioModo', ahora: this.n.ahora(), modo }
          if (resolver) evento.resolver = resolver
          const ef = this.n.aplicar(s, evento)
          const r = rechazoDe(ef)
          if (r) return this.rechazo(s, r)
          const t = efectoTx(ef)
          if (t) await this.ejecutarTx(s, t)
          return { ok: true, valor: this.n.dto(s) }
        },
        { prioridad: 'alta' }
      )
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    } finally {
      s.operacionUsuario = null
    }
  }

  /**
   * Estado de la sesión de una consola; null si todavía no tiene. NO se inventa una
   * sesión con el modo con el que nacería: el renderer la leería una vez y se quedaría
   * con ella aunque la conexión cambiase después. Sin sesión,
   * la barra pinta ese modo en vivo con `modoTxInicial` sobre la conexión que tiene.
   */
  estadoConsola(perfilId: string, consolaId: string): DbEstadoSesion | null {
    const s = this.n.sesionDeConsola(perfilId, consolaId)
    return s && !s.eliminada ? this.n.dto(s) : null
  }

  /**
   * Cerrar la pestaña de la consola: cierra su sesión y OLVIDA su estado (modo incluido).
   *
   * NO es una resolución en bloque, aunque la use también «Eliminar consola»: es UNA
   * sesión y un diálogo que para una fallida ya ofrece solo «Revertir». Por eso aquí
   * `resolver: 'commit'` sobre una fallida se sigue RECHAZANDO (`txFallida`) en vez de
   * revertirse en silencio, igual que el botón Commit (ver `resolverEnBloque`).
   */
  async cerrarSesionConsola(perfilId: string, consolaId: string, resolver?: DbResolverTx): Promise<DbRespuesta<void>> {
    if (resolver !== undefined && resolver !== 'commit' && resolver !== 'rollback') {
      return { ok: false, error: { motivo: 'interno', mensaje: 'Resolución de transacción desconocida.' } }
    }
    const s = this.n.sesionDeConsola(perfilId, consolaId)
    if (!s || s.eliminada) return { ok: true, valor: undefined }
    if (s.operacionUsuario !== null) return { ok: false, error: { motivo: 'ocupada', mensaje: 'La consola está ejecutando.' } }
    s.operacionUsuario = 'cerrar'
    try {
      return await s.cola.correr(
        async (): Promise<DbRespuesta<void>> => {
          const evento: EventoSesion = { tipo: 'cierre', ahora: this.n.ahora(), motivo: 'usuario' }
          if (resolver) evento.resolver = resolver
          const ef = this.n.aplicar(s, evento)
          const r = rechazoDe(ef)
          if (r) return this.rechazo(s, r)
          const t = efectoTx(ef)
          if (t) await this.ejecutarTx(s, t)
          else this.n.efectosSincronos(s, ef)
          if (s.estado.fase !== 'cerrada') {
            return { ok: false, error: { motivo: 'txPendiente', mensaje: MENSAJES.txPendiente, txPendientes: [s.ref] } }
          }
          this.n.olvidarSesion(s)
          return { ok: true, valor: undefined }
        },
        { prioridad: 'alta' }
      )
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    } finally {
      s.operacionUsuario = null
    }
  }

  /**
   * Esquema de la consola (`CONSOLA_ESQUEMA`; `null` = el de la conexión). El llamador
   * ya lo validó contra el catálogo y lo guarda en el índice cuando esto responde bien.
   * Por la cola de la consola (`ocupada` si está ejecutando). Con la sesión abierta se
   * aplica YA —como una sentencia de clase `sesion`, que no cuenta en la transacción
   * y pasa en solo lectura—; cerrada o perdida, solo cambia lo que ve el selector y se
   * aplicará al reabrirla (lo pide `esquemaDeConsola`). `anterior`: el elegido que
   * había (null = el de la conexión), al que se vuelve si PG salta el nuevo.
   */
  async fijarEsquemaConsola(
    ref: RefConsola,
    esquema: string | null,
    anterior: string | null = null
  ): Promise<DbRespuesta<DbEstadoSesion>> {
    let con: DbConnection
    let s: Sesion
    try {
      con = this.n.conexionDeConsola(ref)
      s = this.n.sesionDe({ rol: 'consola', perfilId: ref.perfilId, consolaId: ref.consolaId }, con, txInicialDePeticion(ref.txInicial))
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    }
    if (s.operacionUsuario !== null) return { ok: false, error: { motivo: 'ocupada', mensaje: 'La consola está ejecutando.' } }
    s.operacionUsuario = 'esquema'
    const d = dialectoDeMotor(con.motor)
    try {
      return await s.cola.correr(() => this.correrEsquema(s, con, d, esquema, anterior), { prioridad: 'alta' })
    } catch (e) {
      return this.ap.respuestaDeFallo(e)
    } finally {
      s.operacionUsuario = null
    }
  }

  private async correrEsquema(
    s: Sesion,
    con: DbConnection,
    d: DialectoSql,
    esquema: string | null,
    anterior: string | null
  ): Promise<DbRespuesta<DbEstadoSesion>> {
    if (!listaConProcesoVivo(s)) {
      this.n.aplicar(s, { tipo: 'esquema', ahora: this.n.ahora(), esquema: esquema ?? s.esquemaConexion })
      return { ok: true, valor: this.n.dto(s) }
    }
    const p = await this.ap.empezar(s, null)
    let leido: string | null = null
    let ok = false
    try {
      leido = await this.esq.enviarEsquema(s, p, d, esquema)
      // Oracle (`fijarEsquemaValida`): el ALTER solo vuelve bien si el esquema existe, así que
      // una relectura que no llegó no lo desmiente (ver `trasReaplicarEsquema`).
      if (capacidades(d).fijarEsquemaValida && leido === null) leido = esquema ?? s.esquemaConexion
      ok = true
    } catch (e) {
      this.ap.tratarFallo(s, p, e)
      throw this.ap.aErrorGestor(e)
    } finally {
      if (s.estado.fase === 'ocupada') {
        this.n.terminar(s, ok ? { clase: 'sesion', ok, esquema: leido } : { clase: 'sesion', ok })
      }
    }
    if (esquema !== null && leido !== esquema) {
      // PG acepta un search_path con un esquema que no existe o sin USAGE, y lo salta: se
      // vuelve al elegido ANTERIOR (el que el controlador restaura en su mapa), no al de la
      // conexión, o la sesión y el selector quedarían en desacuerdo.
      try {
        const p2 = await this.ap.empezar(s, null)
        let vuelta: string | null = null
        try {
          vuelta = await this.esq.enviarEsquema(s, p2, d, anterior)
        } finally {
          if (s.estado.fase === 'ocupada') this.n.terminar(s, { clase: 'sesion', ok: true, esquema: vuelta })
        }
      } catch {
        // queda como esté; el error de abajo lo explica
      }
      // La causa (no existe, o sin USAGE) es del motor, y el mensaje también.
      const mensaje = motorExplorador(con.motor).sesion.mensajeEsquemaNoAplicado(esquema)
      return { ok: false, error: { motivo: 'servidor', mensaje } }
    }
    return { ok: true, valor: this.n.dto(s) }
  }

  /**
   * Resuelve la tx de UNA sesión como parte de una resolución EN BLOQUE (desconectar,
   * el diálogo de salida). Aquí, y solo aquí, «Confirmar» sobre una tx `fallida` la
   * REVIERTE en vez de rechazarse (`accionEnBloque`). Los caminos de UNA consola —`txConsola`, `modoTx`,
   * `cerrarSesionConsola`— aplican sus eventos directamente y siguen rechazando.
   */
  async resolverEnBloque(s: Sesion, pedida: DbResolverTx): Promise<ResolucionEnBloque> {
    let revertidaPorFallida = false
    try {
      const error = await s.cola.correr(
        async (): Promise<DbErrorSql | null> => {
          // DENTRO de la cola y con el estado de ahora: lo que se pintó en el diálogo
          // pudo cambiar mientras esta tarea esperaba su turno.
          const decidida = accionEnBloque(s.estado, pedida)
          revertidaPorFallida = decidida.revertidaPorFallida
          const ef = this.n.aplicar(s, { tipo: decidida.accion, ahora: this.n.ahora() })
          const r = rechazoDe(ef)
          if (r) return this.rechazo(s, r).error
          const t = efectoTx(ef)
          if (t) await this.ejecutarTx(s, t)
          if (tieneTxPendiente(s.estado)) return { motivo: 'txPendiente', mensaje: 'La transacción sigue pendiente.' }
          return null
        },
        { prioridad: 'alta' }
      )
      // Solo cuenta como revertida si el ROLLBACK fue bien: si falló, es un error más.
      return { error, revertidaPorFallida: error === null && revertidaPorFallida }
    } catch (e) {
      return { error: this.ap.aErrorGestor(e).error, revertidaPorFallida: false }
    }
  }
}
