// =============================================================================
// «Actualizar los agentes de tu equipo»: versiones instalada y última de Claude Code y
// Codex nativos, cómo se actualizan aquí, su instalación y el candado por agente que
// retiene las aperturas mientras tanto. Fachada sobre las piezas de `nativos/`, que
// comparten un solo estado; todas las dependencias entran inyectadas (sin Electron).
// Orquestar qué sesiones se paran y se relanzan es del renderer.
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import type { AgentKind } from '../../shared/agent-terminal-ipc.ts'
import type { EstadoAgentesNativos, InstalarRequest, InstalarResultado } from '../../shared/agentes-nativos-ipc.ts'
import { instalada } from './nativos/deteccion.ts'
import { estado, notificarSesiones } from './nativos/emision.ts'
import { esperarCandado, instalar } from './nativos/instalacion.ts'
import { alRecuperarFoco, comprobar, parar, start } from './nativos/refresco.ts'
import { crearNucleoNativos, type DepsAgentesNativos, type NucleoNativos } from './nativos/tipos.ts'

export {
  TIEMPOS_AGENTES_NATIVOS,
  type DepsAgentesNativos,
  type InfoSesionNativa,
  type TiemposAgentesNativos
} from './nativos/tipos.ts'
export {
  baseUrl,
  candidatosPaquetePlataforma,
  candidatosRaizCodexWindows,
  canalClaude,
  installMethodDe,
  parsearDistTags,
  raizCodexDesdeRuta,
  raizCodexDesdeShim,
  urlDistTags,
  versionCaskBrew
} from './nativos/urls.ts'

/** Servicio de los agentes nativos del equipo: versiones, instalación, candado y cadencia. */
export class AgentesNativos {
  private readonly e: NucleoNativos

  constructor(deps: DepsAgentesNativos) {
    this.e = crearNucleoNativos(deps)
  }

  /** Versión instalada medida ahora (null = no instalado o sonda fallida); con candado, la última medida. */
  instalada(agente: AgentKind): Promise<string | null> {
    return instalada(this.e, agente)
  }

  /** Resuelve cuando no hay una instalación de `agente` en curso. */
  esperarCandado(agente: AgentKind): Promise<void> {
    return esperarCandado(this.e, agente)
  }

  /** Foto actual, desde la caché (no lanza nada). */
  estado(): EstadoAgentesNativos {
    return estado(this.e)
  }

  /** Una sesión nativa cambió: una emisión rebotada. */
  notificarSesiones(): void {
    notificarSesiones(this.e)
  }

  /** Comprueba los dos CLIs y emite el estado; nunca rechaza. */
  comprobar(): Promise<EstadoAgentesNativos> {
    return comprobar(this.e)
  }

  /** Instala la versión nueva de un agente; nunca rechaza. */
  instalar(req: InstalarRequest): Promise<InstalarResultado> {
    return instalar(this.e, req)
  }

  /** Programa la primera comprobación (diferida) y las periódicas. Idempotente. */
  start(): void {
    start(this.e)
  }

  /** Cancela los temporizadores (cierre de la app). No interrumpe una instalación. */
  parar(): void {
    parar(this.e)
  }

  /** La ventana volvió a tener el foco: comprueba si la última comprobación es vieja. */
  alRecuperarFoco(): void {
    alRecuperarFoco(this.e)
  }
}
