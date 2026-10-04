// =============================================================================
// Ejecuta la actualización de los agentes nativos en tres fases: instalar con las
// sesiones vivas (A), instalar parándolas antes (B) y relanzarlas de tres en tres (C).
// Lógica pura: el main y los panes entran por `deps`, así su test corre bajo `node`.
// Lo que se promete antes de ejecutar vive en `planActualizacion.ts`.
// Decisiones: docs/decisiones/agentes/actualizacion-nativa.md
// =============================================================================

import type { AgentKind } from '../../../../shared/agent-terminal-ipc.ts'
import type { EstadoAgentesNativos, InstalarResultado, SesionNativa } from '../../../../shared/agentes-nativos-ipc.ts'
import { ColaConcurrencia } from '../../../../shared/colaConcurrencia.ts'
import { ETIQUETA_AGENTE } from '../../../../shared/etiquetasAgente.ts'
import {
  bannerPara,
  cliDe,
  mensaje,
  MOTIVO,
  motivoPorOtra,
  motivoSaltoEnC,
  planificar,
  textoCausa,
  type OpcionesActualizacion
} from './planActualizacion.ts'
import type {
  ApiAgentePane,
  DepsActualizacion,
  EventoActualizacion,
  InstalacionPlaneada,
  PlanActualizacion,
  ResultadoRelanzar,
  ResultadoSesion,
  ResumenActualizacion
} from './tipos.ts'

/** Cómo se nombra cada agente; se reexporta para el popover y la vista del botón. */
export { ETIQUETA_AGENTE }
export { MOTIVO, planificar, type OpcionesActualizacion }

/** Relanzamientos en vuelo a la vez. */
export const TOPE_RELANZAMIENTOS = 3

/** Lo que queda de una ejecución: sus resultados y los panes que siguen preparados. */
class EjecucionActualizacion {
  private readonly forzado: boolean
  private readonly instalaciones: InstalarResultado[] = []
  private readonly porAgente = new Map<AgentKind, InstalarResultado>()
  private readonly resultados = new Map<string, ResultadoSesion>()
  /** Panes con `preparar()` hecho y sin `relanzar()` terminado: el `finally` los suelta. */
  private readonly preparados = new Map<string, ApiAgentePane>()
  /** Paradas por el main en B: se relanzan SIEMPRE. */
  private readonly detenidas = new Set<string>()
  /** `instalar` rompió en B: en C pasan por su parada y la respuesta resuelve la duda. */
  private readonly inciertas = new Set<string>()
  private readonly fichas = new Map<string, SesionNativa>()
  /** Foto del re-sondeo; null si no lo hubo. */
  private estado2: EstadoAgentesNativos | null = null
  private sesiones2 = new Map<string, SesionNativa>()

  private readonly opts: OpcionesActualizacion
  private readonly deps: DepsActualizacion

  constructor(opts: OpcionesActualizacion, deps: DepsActualizacion) {
    this.opts = opts
    this.deps = deps
    this.forzado = opts.forzado === true
  }

  private emitir(ev: EventoActualizacion): void {
    try {
      this.deps.onEvento(ev)
    } catch {
      // Un oyente roto no puede dejar la actualización a medias.
    }
  }

  private localizar(id: string): ApiAgentePane | null {
    let lista: readonly ApiAgentePane[]
    try {
      lista = this.deps.panes()
    } catch {
      return null
    }
    for (const api of lista) {
      try {
        if (api.hostMode() && api.sessionId() === id) return api
      } catch {
        // Un pane desmontándose a medias no es el que buscamos.
      }
    }
    return null
  }

  /** La ficha de una sesión: la del plan, o la que se pueda reconstruir del pane. */
  private ficha(id: string, agente: AgentKind): SesionNativa {
    const conocida = this.fichas.get(id)
    if (conocida) return conocida
    const api = this.localizar(id)
    const nueva: SesionNativa = {
      sessionId: id,
      profileId: api?.profileId ?? '',
      projectHostPath: api?.projectHostPath ?? '',
      agente: api?.agente ?? agente,
      versionLanzada: null,
      atrasada: false,
      trabajando: false,
      esperandoRespuesta: false,
      puedeTenerTextoSinEnviar: false
    }
    this.fichas.set(id, nueva)
    return nueva
  }

  private anotar(s: SesionNativa, resultado: ResultadoSesion['resultado'], motivo?: string): void {
    if (this.resultados.has(s.sessionId)) return
    const r: ResultadoSesion = {
      sessionId: s.sessionId,
      agente: s.agente,
      profileId: s.profileId,
      projectHostPath: s.projectHostPath,
      resultado,
      ...(motivo !== undefined ? { motivo } : {})
    }
    this.resultados.set(s.sessionId, r)
    this.emitir({ tipo: 'sesion', sesion: r })
  }

  private soltar(id: string): void {
    const api = this.preparados.get(id)
    if (!api) return
    this.preparados.delete(id)
    try {
      api.liberar()
    } catch {
      // Nada más que hacer: el pane ya no responde.
    }
  }

  private preparar(id: string, api: ApiAgentePane): void {
    const previo = this.preparados.get(id)
    // Una incierta llega a C ya preparada desde B: una vez basta.
    if (previo === api) return
    // Otro pane con el mismo id (se remontó): el viejo no se queda bloqueado.
    if (previo) this.soltar(id)
    // Se apunta ANTES de llamar: si `preparar` rompe a medias, el `finally` lo deshace.
    this.preparados.set(id, api)
    try {
      api.preparar()
    } catch {
      // El bloqueo de la UI es una cortesía: parar y relanzar funcionan sin él.
    }
  }

  private registrar(r: InstalarResultado, agente: AgentKind): void {
    this.instalaciones.push(r)
    this.porAgente.set(r.agente, r)
    this.emitir({ tipo: 'instalacion', resultado: r })
    // Lo que el main paró se relanza siempre, aunque no se pidiera parar nada.
    for (const id of r.detenidas) {
      this.ficha(id, agente)
      this.detenidas.add(id)
    }
  }

  private async instalarSeguro(
    inst: InstalacionPlaneada,
    detener: string[]
  ): Promise<{ r: InstalarResultado; incierto: boolean }> {
    try {
      const r = await this.deps.instalar({ agente: inst.agente, detener })
      return { r: { ...r, detenidas: Array.isArray(r.detenidas) ? r.detenidas : [] }, incierto: false }
    } catch (e) {
      // `despues` = lo que había: nada confirmó un cambio, y null diría «el CLI ya no
      // responde», que tampoco se sabe.
      return {
        r: {
          ok: false,
          agente: inst.agente,
          antes: inst.de,
          despues: inst.de,
          motivo: 'fallo',
          detalle: `No se pudo pedir la instalación: ${mensaje(e)}`,
          detenidas: []
        },
        incierto: true
      }
    }
  }

  private cerrar(abortado: string | null): ResumenActualizacion {
    this.emitir({ tipo: 'fase', fase: 'terminado' })
    const sesiones = [...this.resultados.values()]
    return {
      ok:
        abortado === null &&
        this.instalaciones.every((i) => i.ok) &&
        !sesiones.some((s) => s.resultado === 'fallo'),
      abortado,
      instalaciones: this.instalaciones,
      sesiones
    }
  }

  /** Compuerta con foto FRESCA, las tres fases y, pase lo que pase, ningún pane preparado. */
  async correr(): Promise<ResumenActualizacion> {
    this.emitir({ tipo: 'fase', fase: 'comprobando' })
    let estado: EstadoAgentesNativos
    try {
      estado = await this.deps.comprobar()
    } catch (e) {
      return this.cerrar(`No se pudieron comprobar las versiones: ${mensaje(e)}`)
    }
    const plan = planificar(estado, this.opts)
    if (!plan.puedeEjecutar) return this.cerrar(plan.motivoNoEjecutar ?? 'No se puede actualizar ahora')
    for (const s of plan.reiniciar) this.fichas.set(s.sessionId, s)

    try {
      await this.faseA(plan)
      await this.faseB(plan)
      await this.resondear(estado)
      await this.faseC(plan)
      this.anotarNoTocadas(plan)
    } finally {
      for (const id of [...this.preparados.keys()]) this.soltar(id)
    }
    return this.cerrar(null)
  }

  private async faseA(plan: PlanActualizacion): Promise<void> {
    for (const inst of plan.instalar) {
      if (inst.fase !== 'A') continue
      this.emitir({ tipo: 'fase', fase: 'instalando', agente: inst.agente })
      const { r } = await this.instalarSeguro(inst, [])
      this.registrar(r, inst.agente)
    }
  }

  private async faseB(plan: PlanActualizacion): Promise<void> {
    for (const inst of plan.instalar) {
      if (inst.fase !== 'B') continue
      this.emitir({ tipo: 'fase', fase: 'deteniendo', agente: inst.agente })
      const ids: string[] = []
      for (const s of plan.reiniciar) {
        if (s.agente !== inst.agente) continue
        const api = this.localizar(s.sessionId)
        if (!api) continue
        this.preparar(s.sessionId, api)
        ids.push(s.sessionId)
      }
      this.emitir({ tipo: 'fase', fase: 'instalando', agente: inst.agente })
      const { r, incierto } = await this.instalarSeguro(inst, ids)
      this.registrar(r, inst.agente)
      if (incierto) {
        // Siguen preparadas y van a C, que las para antes de relanzarlas.
        for (const id of ids) if (!this.detenidas.has(id)) this.inciertas.add(id)
        continue
      }
      this.soltarNoDetenidas(ids, r, inst.agente)
    }
  }

  /**
   * Preparadas y no paradas: se sueltan ya. Si el lote se rechazó porque alguna
   * trabajaba o esperaba tu respuesta, ninguna de este agente se reinicia en esta pasada.
   */
  private soltarNoDetenidas(ids: readonly string[], r: InstalarResultado, agente: AgentKind): void {
    for (const id of ids) {
      if (this.detenidas.has(id)) continue
      this.soltar(id)
      if (r.motivo === 'trabajando') {
        const rechazo = r.rechazos?.find((x) => x.sessionId === id)
        const causa = rechazo ? textoCausa(rechazo.causa) : motivoPorOtra(agente, r.rechazos)
        this.anotar(this.ficha(id, agente), 'saltada', causa)
      }
    }
  }

  /**
   * Sin re-sondeo, «atrasada» sale de la foto de la compuerta y la comprobación de
   * «trabajando» queda sólo en la parada atómica del main.
   */
  private async resondear(estado: EstadoAgentesNativos): Promise<void> {
    this.emitir({ tipo: 'fase', fase: 'comprobando' })
    try {
      this.estado2 = await this.deps.comprobar()
    } catch (e) {
      this.emitir({ tipo: 'aviso', texto: `No se pudieron volver a comprobar las versiones: ${mensaje(e)}` })
    }
    const foto = this.estado2 ?? estado
    this.sesiones2 = new Map(foto.sesiones.map((s) => [s.sessionId, s] as const))
  }

  private instaladaAhora(agente: AgentKind): string | null {
    return this.estado2 ? cliDe(this.estado2, agente).instalada : null
  }

  /** Las sesiones que se relanzan: las del plan paradas, inciertas o atrasadas, y las paradas fuera de él. */
  private conjuntoC(plan: PlanActualizacion): string[] {
    const conjunto: string[] = []
    const enConjunto = new Set<string>()
    const incluir = (id: string): void => {
      if (enConjunto.has(id) || this.resultados.has(id)) return
      enConjunto.add(id)
      conjunto.push(id)
    }
    for (const s of plan.reiniciar) {
      const id = s.sessionId
      if (this.detenidas.has(id) || this.inciertas.has(id) || this.forzado || this.sesiones2.get(id)?.atrasada) {
        incluir(id)
      }
    }
    // Paradas fuera del plan (el main no debería devolverlas): antes vivas que muertas.
    for (const id of this.detenidas) incluir(id)
    return conjunto
  }

  private async faseC(plan: PlanActualizacion): Promise<void> {
    const conjunto = this.conjuntoC(plan)
    this.emitir({ tipo: 'fase', fase: 'relanzando' })
    const cola = new ColaConcurrencia(TOPE_RELANZAMIENTOS)
    await Promise.all(
      conjunto.map((id) =>
        cola.correr(() => this.relanzarUna(id)).catch((e: unknown) => {
          this.anotar(this.fichas.get(id) ?? this.ficha(id, 'claude-code'), 'fallo', mensaje(e))
        })
      )
    )
  }

  private async relanzarUna(id: string): Promise<void> {
    const s = this.fichas.get(id) ?? this.ficha(id, 'claude-code')
    const api = this.localizar(id)
    if (!api) {
      this.anotar(s, 'saltada', MOTIVO.panelCambio)
      return
    }
    if (!this.detenidas.has(id)) {
      // Sin re-sondeo no hay «ahora»: la comprobación queda sólo en la parada del main.
      const salto = motivoSaltoEnC(s, this.estado2 ? this.sesiones2.get(id) : undefined)
      if (salto !== null) {
        this.soltar(id)
        this.anotar(s, 'saltada', salto)
        return
      }
      // Toda sesión que no se sabe parada se para aquí, también las inciertas.
      this.preparar(id, api)
      const motivoRechazo = await this.detenerUna(id)
      if (motivoRechazo !== null) {
        this.soltar(id)
        this.anotar(s, 'saltada', motivoRechazo)
        return
      }
    }
    await this.relanzarPreparada(id, s, api)
  }

  /** Para una sesión antes de relanzarla; devuelve por qué no se pudo, o null. */
  private async detenerUna(id: string): Promise<string | null> {
    try {
      const d = await this.deps.detener([id])
      if (d.ok) return null
      const causa = d.rechazos.find((x) => x.sessionId === id)?.causa ?? d.rechazos[0]?.causa
      // Una incierta «ocupada» es una que el main SÍ paró en B: se relanza. En cualquier
      // otra, «ocupada» es otro reinicio en marcha, y ése no es nuestro.
      if (this.inciertas.has(id) && causa === 'ocupada') return null
      return causa ? textoCausa(causa) : 'no se pudo detener'
    } catch (e) {
      return `no se pudo detener: ${mensaje(e)}`
    }
  }

  private async relanzarPreparada(id: string, s: SesionNativa, api: ApiAgentePane): Promise<void> {
    const { banner, error } = bannerPara(s, this.porAgente.get(s.agente), this.instaladaAhora(s.agente), this.forzado)
    let res: ResultadoRelanzar
    try {
      res = await api.relanzar({ banner, error })
    } catch (e) {
      // Se queda en `preparados`: el `finally` la suelta.
      this.anotar(s, 'fallo', `${MOTIVO.noArranco}: ${mensaje(e)}`)
      return
    }
    // `relanzar` deja el pane liberado sea cual sea el resultado.
    this.preparados.delete(id)
    if (res === 'ok') this.anotar(s, 'relanzada')
    else if (res === 'fallo') this.anotar(s, 'fallo', MOTIVO.noArranco)
    else this.anotar(s, 'saltada', MOTIVO.panelCambio)
  }

  /** Lo prometido que no se tocó sale en el resumen con su porqué. */
  private anotarNoTocadas(plan: PlanActualizacion): void {
    for (const s of plan.reiniciar) {
      if (this.resultados.has(s.sessionId)) continue
      this.anotar(s, 'saltada', this.motivoNoTocada(s))
    }
  }

  private motivoNoTocada(s: SesionNativa): string {
    const inst = this.porAgente.get(s.agente)
    const s2 = this.sesiones2.get(s.sessionId)
    if (this.estado2 === null) return MOTIVO.sinResondeo
    if (!s2) return MOTIVO.cerrada
    if (inst && !inst.ok) return `no se pudo actualizar ${ETIQUETA_AGENTE[s.agente]}`
    if (s2.versionLanzada === null) return MOTIVO.versionDesconocida
    return MOTIVO.alDia
  }
}

/**
 * Ejecuta el plan en tres fases. Nunca rechaza: todo fallo queda en el resumen, y todo
 * pane preparado sale liberado o relanzado.
 */
export function ejecutar(opts: OpcionesActualizacion, deps: DepsActualizacion): Promise<ResumenActualizacion> {
  return new EjecucionActualizacion(opts, deps).correr()
}
