// =============================================================================
// `SesionAgente`: el ÚNICO dueño del estado de la sesión de un pane del agente (la del
// momento, la apertura en vuelo, con qué cuenta se abrió, lo pedido para la próxima
// apertura y si hubo una antes). Los demás módulos lo leen y lo cambian por su API.
// Sin React ni DOM: lo que refleja fuera (estado del pane, terminal, main) entra inyectado.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import type { AgentPaneStatus } from './agentPaneTipos'

/** Lo que la sesión refleja fuera de sí al soltarse o adoptarse. */
export interface EspejoSesion {
  setSessionId: (id: string | null) => void
  setStatus: (estado: AgentPaneStatus) => void
  /** Sube la época de la conversación: el anillo de contexto relee. */
  nuevaConversacion: () => void
}

/** La terminal y el main, que la sesión toca al soltarse. */
export interface PuertosSesion {
  /** `flow.reset()` y `term.reset()`, en ese orden: la cola de xterm muere con el reset. */
  limpiarTerminal: () => void
  cerrar: (id: string) => Promise<void>
}

/** Por qué se suelta la sesión del momento. */
export type MotivoSoltar = 'conversacion' | 'cuenta' | 'logout' | 'eliminada' | 'hibernada' | 'desmontaje'

/** Qué hace soltar en cada caso. */
export interface PlanSoltar {
  /** Sin sesión viva no hace nada. */
  soloConSesion: boolean
  /** La cierra en el main; si no, ya la cerró él (logout, borrado, hibernación). */
  cerrar: boolean
  /** Avisa al estado del pane; al desmontar ya no hay a quién. */
  avisar: boolean
  booting: boolean
  /** Otros transcripts: el anillo relee. */
  conversacionNueva: boolean
  limpiar: boolean
  /** La próxima apertura no escribe el banner «reanudado». */
  sinBanner: boolean
  olvidarCuenta: boolean
}

/**
 * La conversación nueva o reanudada y el cambio de cuenta parten de cero; el logout
 * reabre la MISMA cuenta y conversación (de ahí el banner); borrar la cuenta limpia
 * aunque la sesión ya no estuviera; hibernar conserva el xterm para despertar.
 */
export const PLAN_SOLTAR: Readonly<Record<MotivoSoltar, Readonly<PlanSoltar>>> = Object.freeze({
  conversacion: { soloConSesion: false, cerrar: true, avisar: true, booting: true, conversacionNueva: true, limpiar: true, sinBanner: true, olvidarCuenta: false },
  cuenta: { soloConSesion: true, cerrar: true, avisar: true, booting: true, conversacionNueva: true, limpiar: true, sinBanner: true, olvidarCuenta: false },
  logout: { soloConSesion: true, cerrar: false, avisar: true, booting: true, conversacionNueva: false, limpiar: true, sinBanner: false, olvidarCuenta: false },
  eliminada: { soloConSesion: false, cerrar: false, avisar: true, booting: false, conversacionNueva: false, limpiar: true, sinBanner: true, olvidarCuenta: true },
  hibernada: { soloConSesion: true, cerrar: false, avisar: true, booting: false, conversacionNueva: false, limpiar: false, sinBanner: false, olvidarCuenta: false },
  desmontaje: { soloConSesion: false, cerrar: true, avisar: false, booting: false, conversacionNueva: false, limpiar: false, sinBanner: true, olvidarCuenta: false }
})

/** Lo pedido para la próxima apertura: reanudar una conversación concreta o empezar de cero. */
export interface PedidoApertura {
  reanudar: string | null
  deCero: boolean
}

const SIN_ESPEJO: EspejoSesion = {
  setSessionId: () => {},
  setStatus: () => {},
  nuevaConversacion: () => {}
}

/** Estado de la sesión de un pane del agente; vive lo que vive el pane. */
export class SesionAgente {
  private viva: string | null = null
  private enVuelo = false
  private cuenta: string | null = null
  private reanudar: string | null = null
  private deCero = false
  private abiertaAntes = false
  private espejo: EspejoSesion = SIN_ESPEJO
  private readonly puertos: PuertosSesion

  constructor(puertos: PuertosSesion) {
    this.puertos = puertos
  }

  /** Engancha el estado del pane (sus setters son estables: basta con hacerlo una vez). */
  conectar(espejo: EspejoSesion): void {
    this.espejo = espejo
  }

  /** La sesión del momento, o null. */
  id(): string | null {
    return this.viva
  }

  abriendo(): boolean {
    return this.enVuelo
  }

  /** Sin sesión y sin apertura en vuelo. */
  puedeAbrir(): boolean {
    return !this.enVuelo && this.viva === null
  }

  /** ¿La sesión (viva o la última) se abrió con esta cuenta? */
  abiertaCon(cuenta: string): boolean {
    return this.cuenta === cuenta
  }

  /** Hay una sesión viva abierta con otra cuenta que la elegida. */
  abiertaConOtraCuenta(elegida: string | null): boolean {
    return this.cuenta !== null && this.cuenta !== elegida && this.viva !== null
  }

  /** La próxima apertura reanuda esta conversación. */
  pedirReanudar(conversacionId: string): void {
    this.reanudar = conversacionId
  }

  /** La próxima apertura empieza una conversación nueva. */
  pedirNueva(): void {
    this.deCero = true
    this.reanudar = null
  }

  /**
   * Empieza una apertura con `cuenta`: la marca en vuelo y consume lo pedido. Null si ya
   * hay sesión o apertura. `banner`: ya hubo una sesión antes (es una re-apertura).
   */
  empezarApertura(cuenta: string): { banner: boolean; pedido: PedidoApertura } | null {
    if (!this.puedeAbrir()) return null
    this.enVuelo = true
    this.cuenta = cuenta
    const pedido = { reanudar: this.reanudar, deCero: this.deCero }
    this.reanudar = null
    this.deCero = false
    return { banner: this.abiertaAntes, pedido }
  }

  /** Un `open` que falló devuelve lo pedido: si no, el reintento reanudaría otra conversación. */
  devolverPedido(pedido: PedidoApertura): void {
    this.reanudar = pedido.reanudar
    this.deCero = pedido.deCero
  }

  /** Adopta la sesión que acaba de abrir el main. */
  adoptar(id: string): void {
    this.viva = id
    this.abiertaAntes = true
    this.espejo.setSessionId(id)
  }

  terminarApertura(): void {
    this.enVuelo = false
  }

  /**
   * Suelta la sesión del momento según `PLAN_SOLTAR[motivo]`. Devuelve el cierre en el
   * main si lo pidió, o null: quien lo espera no añade un turno cuando no hay nada que cerrar.
   */
  soltar(motivo: MotivoSoltar): Promise<void> | null {
    const plan = PLAN_SOLTAR[motivo]
    const id = this.viva
    if (plan.soloConSesion && id === null) return null
    this.viva = null
    if (id !== null && plan.avisar) this.espejo.setSessionId(null)
    if (plan.booting) this.espejo.setStatus('booting')
    if (plan.sinBanner) this.abiertaAntes = false
    if (plan.olvidarCuenta) this.cuenta = null
    if (plan.conversacionNueva) this.espejo.nuevaConversacion()
    if (plan.limpiar) this.puertos.limpiarTerminal()
    return plan.cerrar && id !== null ? this.puertos.cerrar(id) : null
  }
}
