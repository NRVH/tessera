// =============================================================================
// Store de los agentes: agente, cuenta y modo elegidos, estado de sesión que reportan los
// panes, actividad (trabajando / terminó sin ver), qué targets tienen agente vivo y los
// hibernados que no son pestaña.
// Los efectos que lo alimentan viven en useAgentesApp y useActividadAgentes. Una acción
// que no cambia nada devuelve el mismo estado: con `{}` se avisaría a todos los oyentes.
// =============================================================================
import { create } from 'zustand'
import type { DefinicionAgente, IdAgente, SelectorAgentes } from '../../../../shared/agentesManuales'
import type { AgentPaneStatus } from './agentPaneTipos'
import { emptyActivityState, type ActivityState } from './agentActivity.ts'
import type { ModoAgente } from './modoAgente.ts'

/** Estado de los agentes de todos los perfiles. */
export interface EstadoAgentes {
  /** Agente elegido por perfil; sin entrada, o si ya no es de ese proyecto, el primero disponible. */
  selectedAgentByProfile: Record<string, IdAgente>
  /** Agentes manuales de los proyectos nativos (de todo el equipo); se persisten. */
  agentesNativos: DefinicionAgente[]
  /** Agentes manuales de los proyectos Docker, por perfil; se persisten. */
  agentesDockerPorPerfil: Record<string, DefinicionAgente[]>
  /** Agentes ocultos (de serie o manuales), por perfil; se persisten. */
  agentesOcultosPorPerfil: Record<string, IdAgente[]>
  /** Orden de los agentes elegido por el usuario, por perfil; se persiste. */
  ordenAgentesPorPerfil: Record<string, IdAgente[]>
  /** Pestañas o desplegable en la cabecera del agente (ajuste global); se persiste. */
  selectorAgentes: SelectorAgentes
  /** Cuenta elegida por target de agente; se persiste. */
  accountByTarget: Record<string, string | null>
  /** Nativo o Docker elegido por target de agente; sin entrada, nativo. Se persiste. */
  modoPorTarget: Record<string, ModoAgente>
  agentStatus: Record<string, AgentPaneStatus>
  activity: ActivityState
  /** Targets con un agente de verdad en marcha, según los propios panes. */
  vivos: ReadonlySet<string>
  /** Cada incremento abre el panel del botón de agentes nativos. */
  tokenAbrirAgentes: number
  /**
   * Targets que NO son pestaña (el agente de datos y el de la terminal) cuya sesión cerró el main al
   * hibernar su perfil. Las pestañas lo llevan en su modelo; estos, aquí.
   */
  hibernadosFueraDePestanas: ReadonlySet<string>
}

/** Estado de los agentes. */
export const useStoreAgentes = create<EstadoAgentes>()(() => ({
  selectedAgentByProfile: {},
  agentesNativos: [],
  agentesDockerPorPerfil: {},
  agentesOcultosPorPerfil: {},
  ordenAgentesPorPerfil: {},
  selectorAgentes: 'pestanas',
  accountByTarget: {},
  modoPorTarget: {},
  agentStatus: {},
  activity: emptyActivityState,
  vivos: new Set(),
  tokenAbrirAgentes: 0,
  hibernadosFueraDePestanas: new Set()
}))

/** Elige el agente de un perfil. */
export function selectAgent(profileId: string, agente: IdAgente): void {
  useStoreAgentes.setState((s) =>
    s.selectedAgentByProfile[profileId] === agente
      ? s
      : { selectedAgentByProfile: { ...s.selectedAgentByProfile, [profileId]: agente } }
  )
}

/** Dónde vive un agente manual: la lista nativa (de todo el equipo) o la Docker de un perfil. */
export type DestinoAgenteManual = { nativo: true } | { nativo: false; profileId: string }

function conLista(s: EstadoAgentes, destino: DestinoAgenteManual, f: (l: DefinicionAgente[]) => DefinicionAgente[]): Partial<EstadoAgentes> {
  if (destino.nativo) return { agentesNativos: f(s.agentesNativos) }
  const actual = s.agentesDockerPorPerfil[destino.profileId] ?? []
  return { agentesDockerPorPerfil: { ...s.agentesDockerPorPerfil, [destino.profileId]: f(actual) } }
}

/** Añade un agente manual o sustituye el que tenga su id (editar). */
export function guardarAgenteManual(destino: DestinoAgenteManual, def: DefinicionAgente): void {
  useStoreAgentes.setState((s) =>
    conLista(s, destino, (l) => (l.some((d) => d.id === def.id) ? l.map((d) => (d.id === def.id ? def : d)) : [...l, def]))
  )
}

/**
 * Quita un agente manual de su lista, y de los ocultos y el orden de los perfiles donde ya no existe:
 * uno nuevo con el mismo nombre (y el mismo id) no debe nacer oculto ni en el sitio del viejo.
 */
export function eliminarAgenteManual(destino: DestinoAgenteManual, id: IdAgente): void {
  useStoreAgentes.setState((s) => {
    const listas = conLista(s, destino, (l) => l.filter((d) => d.id !== id))
    const sinElId = (porPerfil: Record<string, IdAgente[]>): Record<string, IdAgente[]> => {
      const copia = { ...porPerfil }
      const perfiles = destino.nativo ? Object.keys(copia) : [destino.profileId]
      for (const p of perfiles) if (copia[p]?.includes(id)) copia[p] = copia[p].filter((x) => x !== id)
      return copia
    }
    return { ...listas, agentesOcultosPorPerfil: sinElId(s.agentesOcultosPorPerfil), ordenAgentesPorPerfil: sinElId(s.ordenAgentesPorPerfil) }
  })
}

/** Oculta o vuelve a mostrar un agente (de serie o manual) en un perfil. */
export function ocultarAgente(profileId: string, agente: IdAgente, ocultar: boolean): void {
  useStoreAgentes.setState((s) => {
    const actual = s.agentesOcultosPorPerfil[profileId] ?? []
    if (actual.includes(agente) === ocultar) return s
    const siguiente = ocultar ? [...actual, agente] : actual.filter((a) => a !== agente)
    return { agentesOcultosPorPerfil: { ...s.agentesOcultosPorPerfil, [profileId]: siguiente } }
  })
}

/** Fija el orden de los agentes de un perfil (la lista completa del perfil). */
export function fijarOrdenAgentes(profileId: string, orden: IdAgente[]): void {
  useStoreAgentes.setState((s) => ({ ordenAgentesPorPerfil: { ...s.ordenAgentesPorPerfil, [profileId]: orden } }))
}

/** Pestañas o desplegable en la cabecera del agente. */
export function fijarSelectorAgentes(selector: SelectorAgentes): void {
  useStoreAgentes.setState((s) => (s.selectorAgentes === selector ? s : { selectorAgentes: selector }))
}

/** Elige la cuenta de un target de agente. */
export function selectAccount(targetKey: string, accountId: string | null): void {
  useStoreAgentes.setState((s) =>
    s.accountByTarget[targetKey] === accountId
      ? s
      : { accountByTarget: { ...s.accountByTarget, [targetKey]: accountId } }
  )
}

/**
 * Elige nativo o Docker para un agente de un proyecto, y con Docker su cuenta, en el MISMO turno: el
 * pane se remonta con el modo nuevo y tiene que encontrar ya la cuenta con la que abrir.
 */
export function elegirModoAgente(targetKey: string, modo: ModoAgente, accountId?: string): void {
  useStoreAgentes.setState((s) => {
    const cuentaIgual = accountId === undefined || s.accountByTarget[targetKey] === accountId
    if (s.modoPorTarget[targetKey] === modo && cuentaIgual) return s
    return {
      modoPorTarget: { ...s.modoPorTarget, [targetKey]: modo },
      ...(cuentaIgual ? {} : { accountByTarget: { ...s.accountByTarget, [targetKey]: accountId } })
    }
  })
}

/** Anota el estado de sesión que reporta un pane (sin cambios si es el mismo). */
export function handleTargetStatus(key: string, status: AgentPaneStatus): void {
  useStoreAgentes.setState((s) =>
    s.agentStatus[key] === status ? s : { agentStatus: { ...s.agentStatus, [key]: status } }
  )
}

/** Anota si un target tiene un agente vivo (sin cambios si ya lo decía). */
export function handleTargetVivo(key: string, vivo: boolean): void {
  useStoreAgentes.setState((s) => {
    if (s.vivos.has(key) === vivo) return s
    const next = new Set(s.vivos)
    if (vivo) next.add(key)
    else next.delete(key)
    return { vivos: next }
  })
}

/** Aplica una transformación pura al estado de actividad. */
export function actualizarActividad(f: (s: ActivityState) => ActivityState): void {
  useStoreAgentes.setState((s) => ({ activity: f(s.activity) }))
}

/**
 * Aplica una transformación pura (las de `hibernacionFueraDePestanas.ts`) a los targets que no son
 * pestaña marcados como hibernados. Sin cambio (mismo conjunto), no avisa a nadie.
 */
export function actualizarHibernadosFueraDePestanas(f: (m: ReadonlySet<string>) => ReadonlySet<string>): void {
  useStoreAgentes.setState((s) => {
    const m = f(s.hibernadosFueraDePestanas)
    return m === s.hibernadosFueraDePestanas ? s : { hibernadosFueraDePestanas: m }
  })
}
