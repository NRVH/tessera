// =============================================================================
// Núcleo común de los gestores de las familias no SQL (documentos: MongoDB; claves: Redis): un proceso de sesión por
// conexión, cola por sesión, reapertura, cancelar, forzar, desconectar, barrido, topes y estado.
// Sus tipos y funciones puras están en `controlador/gestorFamiliaTipos.ts`. Sin `electron`: se prueba con un trabajador falso.
// Decisiones: docs/decisiones/bd/explorador-familias.md
// =============================================================================

import type { DbCancelar, DbErrorSql, DbEstadoSesion, DbFaseSesion, DbRefSesion, DbRespuesta } from '../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../shared/db-ipc.ts'
import { descriptor, familiaDe } from '../../../shared/motores/index.ts'
import { esErrorCola } from './colaSesion.ts'
import { avisoDePerdida, errorTrabajadorDe, estadoDeSesion, mensajeDe, MENSAJE_CERRANDO, MENSAJE_FORZADA, MENSAJE_SIN_LANZAR, procesoOciosoMasViejo, sesionNueva } from './controlador/gestorFamiliaTipos.ts'
import type { ConfigFamilia, DependenciasGestorFamilia, OpcionesOperar, OpFamilia, ProcesoFamilia, SesionFamilia } from './controlador/gestorFamiliaTipos.ts'
import { ErrorGestor } from './GestorSesiones.ts'
import { CIERRE_TRABAJADORES_MS, INACTIVIDAD_CONSOLA_MS, MAX_CONSOLAS_VIVAS_POR_CONEXION, MAX_PROCESOS, PROCESO_SIN_SESIONES_MS, TIMEOUT_SQL_META_MS, umbralInactividadMs } from './limites.ts'
import { PLAZOS_TRABAJADOR_MS, type ErrorTrabajador, type EventoTrabajador, type PeticionSinIdDe } from './protocoloTrabajador.ts'
import { sinSoloLecturaImpuesta } from './soloLecturaImpuesta.ts'

export { conexionTrabajadorFamilia, errorTrabajadorDe, mensajeDe } from './controlador/gestorFamiliaTipos.ts'
export type { ConfigFamilia, DependenciasGestorFamilia, OpcionesOperar, OpFamilia, ProcesoFamilia, SesionFamilia } from './controlador/gestorFamiliaTipos.ts'

// --- El gestor ---------------------------------------------------------------------------


/**
 * La base de los gestores de familia. `C` es el contexto de error de la familia; `P`, sus
 * peticiones (`{ operacion: … }`); `R`, la respuesta de cada operación.
 */
export class GestorFamilia<C, P extends { operacion: string }, R extends { [K in P['operacion']]: unknown }> {
  protected readonly deps: DependenciasGestorFamilia
  protected readonly cfg: ConfigFamilia<C>
  protected readonly procesos = new Map<string, ProcesoFamilia>()
  protected readonly sesionesPorClave = new Map<string, SesionFamilia>()
  private secuenciaProceso = 0
  protected cerrando = false

  constructor(deps: DependenciasGestorFamilia, cfg: ConfigFamilia<C>) {
    this.deps = deps
    this.cfg = cfg
  }

  // --- Ganchos de la familia (por defecto, nada) ------------------------------------------

  /** La sesión deja de estar abierta (antes de emitir su fase). */
  protected alSoltarSesion(_s: SesionFamilia): void {
    // nada
  }

  /** Se desconecta la conexión (antes de descartar sus sesiones). */
  protected alDesconectar(_conexionId: string): void {
    // nada
  }

  // --- Canales comunes con el SQL (delegados por `ExploradorController`) -----------------

  /**
   * `DBX_CHANNELS.CANCELAR`. Datos: por `peticionId` en las sesiones `meta` y `datos` de la
   * conexión (la primera consulta de una pestaña puede estar leyendo la muestra en `meta`).
   * Consola: por perfil + consola + `ejecucionId`. Lo que ESPERA sale de la cola; lo que
   * CORRE se aborta en el trabajador. Devuelve si encontró algo (para el test).
   */
  cancelar(c: DbCancelar): boolean {
    let hecho = false
    for (const s of this.sesionesPorClave.values()) {
      let clave: string
      if (c.rol === 'datos') {
        if (s.conexionId !== c.conexionId || s.rol === 'consola') continue
        clave = c.peticionId
      } else if (c.rol === 'consola') {
        if (s.ref.rol !== 'consola' || s.ref.perfilId !== c.perfilId || s.ref.consolaId !== c.consolaId) continue
        clave = c.ejecucionId
      } else {
        return false
      }
      const esperaba = s.cola.esperandoClave(clave)
      const corre = s.cola.cancelar(clave)
      if (esperaba) hecho = true
      if (corre && s.proceso && !s.proceso.salido) {
        hecho = true
        s.proceso.trabajador
          .enviar<'cancelar'>({ op: 'cancelar', sesion: s.id }, PLAZOS_TRABAJADOR_MS.cancelar)
          .catch((e: unknown) => this.log(`cancelar falló: ${mensajeDe(e)}`))
      }
    }
    return hecho
  }

  /** `DBX_CHANNELS.FORZAR`: MATA el proceso de la conexión (lo que corra falla con 'cancelada'). */
  forzar(conexionId: string): void {
    const p = this.procesos.get(conexionId)
    this.descartarSesionesDe(conexionId)
    if (!p) return
    p.retirado = true
    this.procesos.delete(conexionId)
    this.log(`forzar: proceso #${p.id} de ${conexionId}`)
    try {
      p.trabajador.matar({ clase: 'cancelada', mensaje: MENSAJE_FORZADA })
    } catch {
      // ya no está
    }
  }

  /** `DBX_CHANNELS.DESCONECTAR`: cierra las sesiones y el proceso de la conexión. */
  async desconectar(conexionId: string, plazoMs: number = CIERRE_TRABAJADORES_MS): Promise<void> {
    this.alDesconectar(conexionId)
    const p = this.procesos.get(conexionId)
    this.descartarSesionesDe(conexionId)
    if (p) await this.retirar(p, plazoMs)
  }

  /** Se borró la consola (o se cierra su pestaña para siempre): su sesión sobra. */
  async cerrarConsola(perfilId: string, consolaId: string): Promise<void> {
    for (const s of [...this.sesionesPorClave.values()]) {
      if (s.ref.rol !== 'consola' || s.ref.perfilId !== perfilId || s.ref.consolaId !== consolaId) continue
      await this.cerrarSesion(s, true)
    }
  }

  /** La conexión se editó: lo abierto usa la configuración vieja, así que se cierra. */
  alCambiarConexion(conexionId: string): void {
    void this.desconectar(conexionId).catch((e: unknown) => this.log(`desconectar tras editar falló: ${mensajeDe(e)}`))
  }

  /** La conexión se borró. */
  alBorrarConexion(conexionId: string): void {
    this.alCambiarConexion(conexionId)
  }

  /** `DBX_CHANNELS.SESIONES`: las de la familia, con `txModo: 'auto'` y `tx: 'ninguna'`. */
  sesiones(): DbEstadoSesion[] {
    const out: DbEstadoSesion[] = []
    for (const s of this.sesionesPorClave.values()) {
      if (s.fase === 'cerrada' && !s.aviso) continue
      out.push(this.estado(s))
    }
    return out
  }

  /** Barrido periódico (lo llama el del explorador): sesiones y procesos ociosos. */
  barrer(ahora: number = this.ahora()): void {
    const consolaMs = this.deps.inactividadConsolaMs?.() ?? INACTIVIDAD_CONSOLA_MS
    for (const s of [...this.sesionesPorClave.values()]) {
      if (!s.abierta || !s.cola.vacia()) continue
      if (ahora - s.ultimoUso <= umbralInactividadMs(s.rol, consolaMs)) continue
      this.log(`barrido: cierra ${s.id} de ${s.conexionId} por inactividad`)
      void this.cerrarSesion(s, false, 'inactividad')
    }
    for (const p of [...this.procesos.values()]) {
      const suyas = [...this.sesionesPorClave.values()].filter((s) => s.proceso === p)
      if (suyas.some((s) => s.abierta || !s.cola.vacia())) continue
      if (ahora - p.ultimoUso <= PROCESO_SIN_SESIONES_MS) continue
      void this.retirar(p, CIERRE_TRABAJADORES_MS)
    }
  }

  /** Cierre de la app: nada nuevo arranca y todos los procesos salen (con plazo). */
  async cerrarTodo(plazoMs: number = CIERRE_TRABAJADORES_MS): Promise<void> {
    this.cerrando = true
    for (const s of this.sesionesPorClave.values()) s.cola.descartarTodas()
    const procesos = [...this.procesos.values()]
    await Promise.all(procesos.map((p) => this.retirar(p, plazoMs)))
    this.log(`cerrarTodo: ${procesos.length} proceso(s) de ${this.cfg.etiqueta}`)
  }

  /** Quita el pestillo de `cerrarTodo` si la salida se abortó (como el gestor SQL). */
  reanudarTrasCierreAbortado(): void {
    this.cerrando = false
  }

  // --- Núcleo -----------------------------------------------------------------------------

  /** Cualquier fallo de una operación → `DbErrorSql` (la cola, el gestor, el trabajador). */
  protected errorDe(e: unknown, ctx?: C): DbErrorSql {
    if (e instanceof ErrorGestor) return e.error
    const et = errorTrabajadorDe(e)
    if (et) return this.cfg.error(et, ctx)
    if (esErrorCola(e)) {
      return e.motivo === 'vaciada'
        ? { motivo: 'interno', mensaje: 'La sesión se cerró antes de ejecutar la operación.' }
        : { motivo: 'cancelada', mensaje: e.message }
    }
    return { motivo: 'interno', mensaje: 'Error interno del explorador de bases de datos.' }
  }

  protected async respuesta<T>(fn: () => Promise<T>, ctx?: C): Promise<DbRespuesta<T>> {
    try {
      return { ok: true, valor: await fn() }
    } catch (e) {
      const error = this.errorDe(e, ctx)
      if (error.motivo === 'interno' && !(e instanceof ErrorGestor)) this.log(`fallo interno: ${mensajeDe(e).slice(0, 200)}`)
      return { ok: false, error }
    }
  }

  protected refMeta(conexionId: string): DbRefSesion {
    return { rol: 'meta', conexionId }
  }

  protected operar<O extends P['operacion']>(
    conexionId: string,
    ref: DbRefSesion,
    pet: Extract<P, { operacion: O }>,
    o: OpcionesOperar = {}
  ): Promise<R[O]> {
    return this.operarEn(this.sesionPara(conexionId, ref), pet, o)
  }

  /**
   * UNA operación en la cola de la sesión: abre (o reabre) la sesión si hace falta, manda la
   * op de la familia y deja la sesión lista. Con `reintentar`, una pérdida se reintenta una
   * vez en una sesión nueva (solo lecturas: ver la cabecera).
   */
  protected operarEn<O extends P['operacion']>(s: SesionFamilia, pet: Extract<P, { operacion: O }>, o: OpcionesOperar = {}): Promise<R[O]> {
    return s.cola.correr(
      async () => {
        for (let intento = 0; ; intento++) {
          const p = await this.asegurarAbierta(s)
          this.marcar(s, 'ocupada')
          try {
            const peticion = { op: this.cfg.op, sesion: s.id, ...pet } as unknown as PeticionSinIdDe<OpFamilia>
            const r = await p.trabajador.enviar(peticion, s.rol === 'meta' ? PLAZOS_TRABAJADOR_MS.meta : null)
            const ahora = this.ahora()
            s.ultimoUso = ahora
            p.ultimoUso = ahora
            if (s.fase === 'ocupada') this.marcar(s, 'lista')
            return r as R[O]
          } catch (e) {
            if (this.debeReintentar(s, p, e, o, intento)) continue
            throw e
          }
        }
      },
      { clave: o.clave, prioridad: o.prioridad }
    )
  }

  /** Tras un fallo de la operación: deja la sesión en su sitio y dice si se repite en una sesión nueva. */
  private debeReintentar(s: SesionFamilia, p: ProcesoFamilia, e: unknown, o: OpcionesOperar, intento: number): boolean {
    const et = errorTrabajadorDe(e)
    // Forzado, desconectado, expulsado o cerrando: lo decidió el main, sin reintento (la sesión ya se soltó).
    if (p.retirado) return false
    if (et?.clase === 'timeout') {
      // El trabajador sigue dentro de la operación: la sesión queda ocupada para siempre. Se mata el
      // proceso y la siguiente operación lanza otro.
      this.forzar(s.conexionId)
      return false
    }
    if (et?.clase === 'perdida' || s.proceso !== p || p.salido) {
      this.perderSesion(s, et)
      return !!o.reintentar && intento === 0 && !this.cerrando
    }
    if (s.fase === 'ocupada') this.marcar(s, 'lista')
    return false
  }

  /** La sesión del mapa para `ref` (la crea cerrada si no existe). */
  protected sesionPara(conexionId: string, ref: DbRefSesion): SesionFamilia {
    const id = ref.rol === 'consola' ? `consola:${ref.consolaId}` : ref.rol
    const clave = JSON.stringify([conexionId, id])
    const previa = this.sesionesPorClave.get(clave)
    if (previa) return previa
    if (ref.rol === 'consola') this.hacerSitioConsola(conexionId)
    const s = sesionNueva(clave, id, conexionId, ref, this.ahora())
    this.sesionesPorClave.set(clave, s)
    return s
  }

  /** Abre la sesión si no lo está (en un proceso vivo). Corre DENTRO de la cola. */
  private async asegurarAbierta(s: SesionFamilia): Promise<ProcesoFamilia> {
    if (s.abierta && s.proceso && !s.proceso.salido && !s.proceso.retirado) return s.proceso
    const con = this.deps.conexion(s.conexionId)
    if (!con) throw new ErrorGestor('interno', 'La conexión ya no existe.')
    if (familiaDe(con.motor) !== this.cfg.familia) {
      throw new ErrorGestor('interno', `${descriptor(con.motor).etiqueta} no es un motor de ${this.cfg.etiqueta}.`)
    }
    // El secreto ANTES de lanzar nada: sin él no hay nada que abrir.
    const secreto = this.secretoDe(con)
    // La impuesta por el explorador, no la casilla de los agentes (ver las dependencias).
    const soloLectura = (this.deps.soloLecturaImpuesta ?? sinSoloLecturaImpuesta)(con)
    const p = await this.procesoPara(con)
    s.abierta = false
    s.proceso = p
    this.marcar(s, 'abriendo')
    try {
      const r = await p.trabajador.enviar<'abrir'>(
        {
          op: 'abrir',
          sesion: s.id,
          rol: s.rol,
          conexion: { ...this.cfg.conexionTrabajador(con), readonly: soloLectura },
          secreto,
          ctx: this.deps.ctxDrivers(),
          opciones: { timeoutMs: s.rol === 'meta' ? TIMEOUT_SQL_META_MS : 0, accion: s.rol }
        },
        PLAZOS_TRABAJADOR_MS.abrir
      )
      s.abierta = true
      s.version = r.version
      s.soloLectura = soloLectura
      s.ultimoUso = this.ahora()
      delete s.aviso
      this.marcar(s, 'lista')
      this.deps.alAbrir?.(con.id)
      return p
    } catch (e) {
      s.proceso = null
      this.marcar(s, 'cerrada')
      throw e
    }
  }

  /** Secreto: opcional (ver la cabecera). */
  private secretoDe(con: DbConnection): string {
    if (!con.tieneSecreto) return ''
    const secreto = this.deps.secreto(con.id)
    if (secreto !== null) return secreto
    throw new ErrorGestor(
      'sinSecreto',
      'La contraseña guardada no se puede descifrar en este equipo. Edita la conexión y vuelve a escribirla.'
    )
  }

  private async procesoPara(con: DbConnection): Promise<ProcesoFamilia> {
    const actual = this.procesos.get(con.id)
    if (actual && !actual.salido && !actual.retirado) {
      await actual.arranque
      if (!actual.salido && !actual.retirado) return actual
    }
    if (this.cerrando) throw new ErrorGestor('interno', MENSAJE_CERRANDO)
    this.hacerSitioProceso()
    const trabajador = this.deps.lanzar(con)
    const p: ProcesoFamilia = {
      id: ++this.secuenciaProceso,
      conexionId: con.id,
      trabajador,
      arranque: Promise.resolve(),
      salido: false,
      retirado: false,
      ultimoUso: this.ahora(),
      bajas: []
    }
    this.procesos.set(con.id, p)
    p.bajas.push(trabajador.onEvento((e) => this.alEvento(p, e)))
    p.bajas.push(trabajador.onSalida((sal) => this.alSalir(p, sal)))
    this.log(`lanzar proceso de ${this.cfg.etiqueta} #${p.id} de ${con.id}`)
    p.arranque = trabajador.arrancar().then(
      () => undefined,
      (err: unknown) => {
        this.log(`el proceso #${p.id} de ${con.id} no arrancó: ${mensajeDe(err)}`)
        try {
          trabajador.matar()
        } catch {
          // ya no está
        }
        this.olvidarProceso(p)
        throw new ErrorGestor('interno', MENSAJE_SIN_LANZAR)
      }
    )
    await p.arranque
    return p
  }

  /** Al tope de procesos: expulsa el ocioso más antiguo, o `limite`. */
  private hacerSitioProceso(): void {
    const vivos = [...this.procesos.values()].filter((p) => !p.salido && !p.retirado)
    if (vivos.length < MAX_PROCESOS) return
    const victima = procesoOciosoMasViejo(vivos, [...this.sesionesPorClave.values()])
    if (!victima) {
      throw new ErrorGestor(
        'limite',
        `Hay ${MAX_PROCESOS} conexiones de ${this.cfg.etiqueta} trabajando a la vez. Espera a que termine alguna o desconecta una.`
      )
    }
    this.log(`tope de procesos: sale el de ${victima.conexionId}`)
    this.descartarSesionesDe(victima.conexionId)
    void this.retirar(victima, CIERRE_TRABAJADORES_MS)
  }

  /** Al tope de consolas vivas de una conexión: cierra la ociosa más antigua, o `limite`. */
  private hacerSitioConsola(conexionId: string): void {
    const consolas = [...this.sesionesPorClave.values()].filter((s) => s.conexionId === conexionId && s.rol === 'consola')
    if (consolas.length < MAX_CONSOLAS_VIVAS_POR_CONEXION) return
    const victima = consolas.filter((s) => s.cola.vacia()).sort((a, b) => a.ultimoUso - b.ultimoUso)[0]
    if (!victima) {
      throw new ErrorGestor(
        'limite',
        `Esta conexión ya tiene ${MAX_CONSOLAS_VIVAS_POR_CONEXION} consolas trabajando a la vez. Espera a que termine alguna.`
      )
    }
    void this.cerrarSesion(victima, true)
  }

  private alEvento(p: ProcesoFamilia, e: EventoTrabajador): void {
    if (e.ev === 'fatal') {
      this.log(`fatal en el proceso #${p.id}: ${e.mensaje.slice(0, 200)}`)
      return
    }
    for (const s of this.sesionesPorClave.values()) {
      if (s.proceso === p && s.id === e.sesion) this.perderSesion(s, e.error)
    }
  }

  private alSalir(p: ProcesoFamilia, sal: { codigo: number | null; senal: string | null }): void {
    if (p.salido) return
    const caida = !p.retirado
    this.olvidarProceso(p)
    this.log(`salió el proceso de ${this.cfg.etiqueta} #${p.id} de ${p.conexionId} (${sal.senal ? `señal ${sal.senal}` : `código ${String(sal.codigo)}`})`)
    for (const s of this.sesionesPorClave.values()) {
      if (s.proceso !== p) continue
      if (caida && s.abierta) {
        this.perderSesion(s, { clase: 'perdida', mensaje: 'El proceso de la conexión terminó inesperadamente.' }, 'caida')
      } else {
        this.soltar(s, 'cerrada')
      }
    }
  }

  private olvidarProceso(p: ProcesoFamilia): void {
    p.salido = true
    if (this.procesos.get(p.conexionId) === p) this.procesos.delete(p.conexionId)
    for (const baja of p.bajas.splice(0)) {
      try {
        baja()
      } catch {
        // nada
      }
    }
  }

  /** Retira un proceso: lo marca, suelta sus sesiones y le pide salir (nunca lanza). */
  private async retirar(p: ProcesoFamilia, plazoMs: number): Promise<void> {
    p.retirado = true
    if (this.procesos.get(p.conexionId) === p) this.procesos.delete(p.conexionId)
    for (const s of this.sesionesPorClave.values()) if (s.proceso === p) this.soltar(s, 'cerrada')
    await p.trabajador.salir(plazoMs).catch((e: unknown) => this.log(`salir falló: ${mensajeDe(e)}`))
  }

  /** Vacía la cola y QUITA del mapa las sesiones de una conexión (desconectar, forzar). */
  private descartarSesionesDe(conexionId: string): void {
    for (const s of [...this.sesionesPorClave.values()]) {
      if (s.conexionId !== conexionId) continue
      s.cola.descartarTodas()
      this.soltar(s, 'cerrada')
      this.sesionesPorClave.delete(s.clave)
    }
  }

  /**
   * Cierra UNA sesión en el trabajador (por su cola, detrás de lo que tenga) y la suelta.
   * `quitar`: además sale del mapa (una consola borrada o expulsada).
   */
  private async cerrarSesion(s: SesionFamilia, quitar: boolean, aviso?: 'inactividad'): Promise<void> {
    if (quitar) {
      s.cola.descartarTodas()
      this.sesionesPorClave.delete(s.clave)
    }
    const p = s.proceso
    if (s.abierta && p && !p.salido && !p.retirado) {
      try {
        await s.cola.correr(() => p.trabajador.enviar<'cerrar'>({ op: 'cerrar', sesion: s.id }, PLAZOS_TRABAJADOR_MS.cerrar), { prioridad: 'baja' })
      } catch (e) {
        this.log(`cerrar la sesión ${s.id} falló: ${mensajeDe(e)}`)
      }
    }
    if (aviso) s.aviso = { tipo: aviso, txPerdida: false, mensaje: 'La sesión se cerró por inactividad; se reabre al usarla.', en: this.ahora() }
    this.soltar(s, 'cerrada')
  }

  /** La sesión deja de estar abierta (y la familia suelta lo suyo: `alSoltarSesion`). */
  private soltar(s: SesionFamilia, fase: DbFaseSesion): void {
    s.abierta = false
    s.proceso = null
    this.alSoltarSesion(s)
    this.marcar(s, fase)
  }

  private perderSesion(s: SesionFamilia, et: ErrorTrabajador | null, tipo: 'perdida' | 'caida' = 'perdida'): void {
    s.aviso = avisoDePerdida(et, tipo, this.ahora())
    this.soltar(s, 'perdida')
  }

  // --- Estado para la interfaz ---------------------------------------------------------------

  private estado(s: SesionFamilia): DbEstadoSesion {
    return estadoDeSesion(s)
  }

  private marcar(s: SesionFamilia, fase: DbFaseSesion): void {
    if (fase === 'ocupada') s.ocupadaDesde = this.ahora()
    else delete s.ocupadaDesde
    if (s.fase === fase && fase !== 'ocupada') return
    s.fase = fase
    try {
      this.deps.emitirSesion?.(this.estado(s))
    } catch (e) {
      this.log(`emitir la sesión falló: ${mensajeDe(e)}`)
    }
  }

  protected ahora(): number {
    return (this.deps.ahora ?? Date.now)()
  }

  protected log(linea: string): void {
    this.deps.log?.(linea)
  }
}
