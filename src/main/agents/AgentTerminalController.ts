// =============================================================================
// Terminal del agente (Claude Code, Codex): un pty interactivo por sesión, en el
// contenedor del perfil con su credencial montada durante toda la sesión, o nativo en
// el host. Fachada sobre las piezas de `terminalAgente/`, que comparten un solo estado;
// orquesta el SandboxManager compartido y su propio TerminalService.
// Lo compone `src/main/agents/componer.ts`; sus canales los registra `agents/ipc.ts`.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import type { Agente, Profile } from '../profiles/types'
import type {
  AgentActivityMessage,
  AgentDetenerVariasResult,
  AgentFlowMessage,
  AgentHibernarInactivosRequest,
  AgentHibernarInactivosResult,
  AgentOpenRequest,
  AgentOpenResult,
  AgentResizeMessage,
  AgentWriteMessage
} from '../../shared/agent-terminal-ipc'
import type { SesionNativa } from '../../shared/agentes-nativos-ipc'
import type { TerminalService } from '../terminals/TerminalService'
import { abrir } from './terminalAgente/apertura'
import { recargar } from './terminalAgente/recarga'
import { cerrar, cerrarDonde, closeAllSessions, detenerVarias, disposeAll } from './terminalAgente/cierre'
import { pidsNativos, saveImage, sesionesNativas, stageFile } from './terminalAgente/nativas'
import { anclarPorEntrada, snapshotActividad } from './terminalAgente/turnos'
import { aplicarSegundoPlanoDeSesion, hibernarInactivos, marcarEs } from './terminalAgente/hibernacion'
import type { CambioSegundoPlano } from '../transcripts/tareasSegundoPlano'
import {
  ACTIVITY_RESIZE_GRACE_MS,
  crearNucleo,
  errMsg,
  type AgentTerminalControllerOptions,
  type NucleoAgente,
  type OpenAgentSession
} from './terminalAgente/tipos'

export type { AgentTerminalControllerOptions } from './terminalAgente/tipos'

/** Sesiones del CLI del agente: apertura, reinicio, cierre, entrada y consultas. */
export class AgentTerminalController {
  private readonly n: NucleoAgente

  constructor(opts: AgentTerminalControllerOptions) {
    this.n = crearNucleo(opts)
  }

  // Las pruebas leen el mapa de sesiones y sustituyen el servicio de terminales.
  private get sessions(): Map<string, OpenAgentSession> {
    return this.n.sessions
  }

  private get terminals(): TerminalService {
    return this.n.terminals
  }

  private set terminals(t: TerminalService) {
    this.n.terminals = t
  }

  /** Entrega a la sesión la marca de turno leída de su transcript; cerrada, se ignora. */
  aplicarMarcaTurno(sessionId: string, marca: { tipo: 'abre' | 'cierra'; at: number }): void {
    this.sessions.get(sessionId)?.activity.onTurnMark(marca)
  }

  /** Entrega a la sesión lo que su transcript dice de las tareas en segundo plano. */
  aplicarSegundoPlano(sessionId: string, cambios: readonly CambioSegundoPlano[]): void {
    aplicarSegundoPlanoDeSesion(this.n, sessionId, cambios)
  }

  /** Una ronda de hibernación por inactividad: decide y suelta en el mismo tick. */
  hibernarInactivos(req: AgentHibernarInactivosRequest): AgentHibernarInactivosResult {
    return hibernarInactivos(this.n, req)
  }

  /** Estado de actividad crudo de todas las sesiones vivas. */
  snapshotActividad(): AgentActivityMessage[] {
    return snapshotActividad(this.n)
  }

  /** Sesiones nativas con el proceso vivo, para el botón de los agentes nativos. */
  sesionesNativas(): Array<Omit<SesionNativa, 'atrasada'>> {
    return sesionesNativas(this.n)
  }

  /** Pids de los ptys de las sesiones nativas de un agente. */
  pidsNativos(agente: Agente): number[] {
    return pidsNativos(this.n, agente)
  }

  /** Para varias sesiones nativas de una vez (todas o ninguna), conservándolas. */
  detenerVarias(sessionIds: readonly string[]): Promise<AgentDetenerVariasResult> {
    return detenerVarias(this.n, sessionIds)
  }

  /** Reemplaza el registro de perfiles conocido (tras un CRUD de perfiles). */
  updateProfiles(profiles: Profile[]): void {
    this.n.profiles.clear()
    for (const p of profiles) this.n.profiles.set(p.id, p)
  }

  /**
   * Entrada del usuario: el rastreador la ve primero (el Enter arma el turno y cada tecla
   * congela la detección del eco), luego el ancla y por último el pty.
   */
  escribir(msg: AgentWriteMessage): void {
    try {
      const open = this.sessions.get(msg.sessionId)
      open?.activity.onInput(msg.data)
      if (open) anclarPorEntrada(this.n, open, msg.data)
      // Lo tecleado es actividad aunque el CLI no conteste: retrasa la hibernación.
      marcarEs(this.n, msg.sessionId)
      this.terminals.write(msg.sessionId, msg.data)
    } catch (err) {
      this.n.log(`WRITE error: ${errMsg(err)}`)
    }
  }

  /** Resize del pty; el repintado que provoca no cuenta como trabajo. */
  redimensionar(msg: AgentResizeMessage): void {
    try {
      this.sessions.get(msg.sessionId)?.activity.suppress(ACTIVITY_RESIZE_GRACE_MS)
      this.terminals.resize(msg.sessionId, msg.cols, msg.rows)
    } catch (err) {
      this.n.log(`RESIZE error: ${errMsg(err)}`)
    }
  }

  /** Contrapresión del pty; mientras dura, el silencio no cierra el turno. */
  flujo(msg: AgentFlowMessage): void {
    try {
      this.sessions.get(msg.sessionId)?.activity.setPaused(msg.paused)
      this.terminals.setPaused(msg.sessionId, msg.paused)
    } catch (err) {
      this.n.log(`FLOW error: ${errMsg(err)}`)
    }
  }

  /** Copia un archivo del host a la sesión y devuelve la ruta que verá el CLI. */
  stageFile(sessionId: string, hostPath: string): Promise<string | null> {
    return stageFile(this.n, sessionId, hostPath)
  }

  /** Vuelca la imagen del portapapeles para la sesión y devuelve la ruta que verá el CLI. */
  saveImage(sessionId: string): Promise<string | null> {
    return saveImage(this.n, sessionId)
  }

  /** Abre una sesión de agente, en contenedor o nativa. */
  open(req: AgentOpenRequest): Promise<AgentOpenResult> {
    return abrir(this.n, req)
  }

  /** Relanza el proceso de una sesión conservando su id y su conversación. */
  reload(sessionId: string, dbConnectionIds?: string[], resumeSessionId?: string): Promise<AgentOpenResult> {
    return recargar(this.n, sessionId, dbConnectionIds, resumeSessionId)
  }

  /** Cierra la sesión y desmonta su credencial si era la última; el contenedor sigue vivo. */
  close(sessionId: string): Promise<void> {
    return cerrar(this.n, sessionId)
  }

  /** Mata ya los ptys del agente (antes de instalar una actualización); devuelve cuántos. */
  forceKillPtys(): number {
    return this.terminals.killAllPtysNow()
  }

  /** Cierra todas las sesiones sin parar contenedores (tras un fallo del renderer). */
  closeAllSessions(): Promise<void> {
    return closeAllSessions(this.n)
  }

  /** Cierra todas las sesiones al salir de la app. */
  disposeAll(): Promise<void> {
    return disposeAll(this.n)
  }

  /** Cierra todas las sesiones de un perfil (hibernar). */
  closeSessionsForProfile(profileId: string): Promise<string[]> {
    return cerrarDonde(this.n, (s) => s.profileId === profileId)
  }

  /** Cierra todas las sesiones de una cuenta en cualquier perfil (logout o borrado). */
  closeSessionsForAccount(accountId: string): Promise<string[]> {
    return cerrarDonde(this.n, (s) => s.accountId === accountId)
  }

  /** Ids de las sesiones de agente abiertas. */
  liveSessionIds(): string[] {
    return [...this.sessions.keys()]
  }
}
