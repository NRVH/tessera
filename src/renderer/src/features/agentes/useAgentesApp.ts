// =============================================================================
// Targets de agente de la ventana: los de proyecto y los sintéticos de los espacios de datos y del
// agente de la terminal, cuál se ve (según layoutCentro), la restauración del agente de datos y del
// de la terminal, y los hibernados que ve la columna. También poda el estado de sesión y lleva a un
// (perfil, proyecto, agente).
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AGENTES_DISPONIBLES, type Agente } from '../../../../main/profiles/types'
import type { AgentPaneStatus } from './agentPaneTipos'
import { resolveSelectedAgent } from './agenteElegido'
import { selectAgent, useStoreAgentes } from './store'
import { useStoreAgenteTerminal } from './storeAgenteTerminal'
import type { ColumnaAgenteEstado } from './useColumnaAgente'
import { useRestaurarAgenteTerminal, type AgenteTerminalApp } from './useAgenteTerminal'
import { useHibernacionFueraDePestanas } from './useHibernacionFueraDePestanas'
import { agentTargetKey, useStorePestanas, type OpenAgentTarget, type UseTabs } from '../pestanas'
import {
  cambiarVistaSi,
  derivarLayoutCentro,
  pantallaCompletaCoherente,
  useStoreLayout,
  type SalidaLayoutCentro,
  type VistasPorPerfil
} from '../layout'
import { ocultarAgenteDb, useStoreBd, type EspaciosDatos } from '../bd'
import { useStoreMosaico } from '../mosaico'

/** Targets de agente, el que se ve y el layout del centro. */
export interface AgentesApp {
  activeTargetKey: string | null
  targetsAgente: OpenAgentTarget[]
  agenteDbVisible: boolean
  lay: SalidaLayoutCentro
  /** El target cuya columna se ve: del espacio en 'db', del agente de la terminal, del proyecto fuera, o ninguno. */
  activeTargetKeyEfectivo: string | null
  /** Los hibernados que ve la columna: los de las pestañas y los que no son pestaña de un perfil hibernado. */
  hibernatedTargetKeys: Set<string>
  openAgentTarget: (profileId: string, projectHostPath: string, agente: Agente) => void
}

/** Un target por agente para cada perfil abierto con su carpeta conocida (espacio de datos o agente de la terminal). */
function targetsDeCarpetas(abiertos: ReadonlySet<string>, rutas: Record<string, string>): OpenAgentTarget[] {
  const out: OpenAgentTarget[] = []
  for (const profileId of abiertos) {
    const ruta = rutas[profileId]
    if (!ruta) continue
    for (const agente of AGENTES_DISPONIBLES) {
      out.push({ profileId, projectHostPath: ruta, agente, key: agentTargetKey(profileId, ruta, agente) })
    }
  }
  return out
}

/** Targets sintéticos de los espacios de datos abiertos (uno por agente). */
function useTargetsEspacio(): OpenAgentTarget[] {
  const { espaciosAbiertos, dbWorkspacePaths } = useStoreBd(
    useShallow((s) => ({ espaciosAbiertos: s.espaciosAbiertos, dbWorkspacePaths: s.dbWorkspacePaths }))
  )
  return useMemo(() => targetsDeCarpetas(espaciosAbiertos, dbWorkspacePaths), [espaciosAbiertos, dbWorkspacePaths])
}

/** Targets sintéticos del agente de la terminal de los perfiles que lo tienen abierto (uno por agente). */
function useTargetsTerminal(): OpenAgentTarget[] {
  const { abiertos, rutas } = useStoreAgenteTerminal(useShallow((s) => ({ abiertos: s.abiertos, rutas: s.rutas })))
  return useMemo(() => targetsDeCarpetas(abiertos, rutas), [abiertos, rutas])
}

/** Al entrar en BD con la preferencia puesta, prepara el espacio; si falla, retira la preferencia. */
function useRestaurarAgenteDb(tabs: UseTabs, enConexiones: boolean, espacios: EspaciosDatos): void {
  const { dbAgenteVisiblePorPerfil, espaciosAbiertos } = useStoreBd(
    useShallow((s) => ({ dbAgenteVisiblePorPerfil: s.dbAgenteVisiblePorPerfil, espaciosAbiertos: s.espaciosAbiertos }))
  )
  const { asegurarEspacioDeDatos, preparandoEspacioRef } = espacios
  useEffect(() => {
    const perfil = tabs.activeProfile
    if (!enConexiones || !perfil) return
    if (dbAgenteVisiblePorPerfil[perfil.id] !== true || espaciosAbiertos.has(perfil.id)) return
    if (preparandoEspacioRef.current.has(perfil.id)) return
    preparandoEspacioRef.current.add(perfil.id)
    void asegurarEspacioDeDatos(perfil).then((ok) => {
      preparandoEspacioRef.current.delete(perfil.id)
      if (!ok) ocultarAgenteDb(perfil.id)
    })
  }, [enConexiones, tabs.activeProfile, dbAgenteVisiblePorPerfil, espaciosAbiertos, asegurarEspacioDeDatos, preparandoEspacioRef])
}

/** Poda el estado de sesión de los targets que ya no están abiertos. */
function usePodaEstadoSesion(targetsAgente: OpenAgentTarget[]): void {
  useEffect(() => {
    useStoreAgentes.setState((s) => {
      const prev = s.agentStatus
      const keys = Object.keys(prev)
      if (keys.length === 0) return {}
      const open = new Set(targetsAgente.map((t) => t.key))
      if (keys.every((k) => open.has(k))) return {}
      const next: Record<string, AgentPaneStatus> = {}
      for (const k of keys) if (open.has(k)) next[k] = prev[k]
      return { agentStatus: next }
    })
  }, [targetsAgente])
}

/** Layout del centro del perfil activo, el espacio de datos que le toca y si la terminal está a pantalla completa. */
function useLayoutDelCentro(
  tabs: UseTabs,
  vistas: Pick<VistasPorPerfil, 'activeView' | 'panelInferior'>,
  columna: ColumnaAgenteEstado,
  hayPestanasEditor: boolean
): {
  lay: SalidaLayoutCentro
  agenteDbVisible: boolean
  espacioActivoPath: string | undefined
  pantallaCompletaTerminal: boolean
} {
  const perfil = tabs.activeProfile
  const { espacioActivoPath, espacioAbierto, agenteDbVisible } = useStoreBd(
    useShallow((s) => ({
      espacioActivoPath: perfil ? s.dbWorkspacePaths[perfil.id] : undefined,
      espacioAbierto: perfil ? s.espaciosAbiertos.has(perfil.id) : false,
      agenteDbVisible: perfil ? s.dbAgenteVisiblePorPerfil[perfil.id] === true : false
    }))
  )
  const terminal = useStoreAgenteTerminal(
    useShallow((s) => ({
      visible: perfil ? s.visiblePorPerfil[perfil.id] === true : false,
      abierto: perfil ? s.abiertos.has(perfil.id) && s.rutas[perfil.id] !== undefined : false
    }))
  )
  const mosaicoActivo = useStoreMosaico((s) => s.mosaicoActivo)
  const pedida = useStoreLayout((s) => s.franjaPantallaCompleta)
  const lay = derivarLayoutCentro({
    vista: vistas.activeView,
    mosaico: mosaicoActivo,
    hayPestanasEditor,
    ccExpandido: columna.ccExpanded,
    ccOculto: columna.ccHidden,
    vistaDividida: columna.vistaDividida,
    agenteDbVisible,
    espacioAbierto: Boolean(perfil && espacioActivoPath && espacioAbierto),
    hayPerfil: perfil !== null,
    panelInferior: vistas.panelInferior,
    pantallaCompletaPedida: pedida,
    agenteTerminalVisible: terminal.visible,
    agenteTerminalAbierto: terminal.abierto
  })
  const pantallaCompletaTerminal = pantallaCompletaCoherente({ pedida, franja: lay.franja, mosaico: mosaicoActivo }) === 'terminal'
  return { lay, agenteDbVisible, espacioActivoPath, pantallaCompletaTerminal }
}

/**
 * El target cuya columna se ve. Ninguno en 'db' con el agente oculto: si no, su sesión arrancaría sin
 * que nadie la mirase. Tampoco con el agente DIFERIDO del proyecto: sin pane visible no hay sesión.
 * El agente de la terminal tiene su propio agente elegido, no el del perfil.
 */
function useClaveEfectiva(
  tabs: UseTabs,
  lay: SalidaLayoutCentro,
  espacioActivoPath: string | undefined,
  proyecto: { clave: string | null; diferido: boolean }
): string | null {
  const perfil = tabs.activeProfile
  const selectedAgentByProfile = useStoreAgentes((s) => s.selectedAgentByProfile)
  const { rutaTerminal, agenteTerminal } = useStoreAgenteTerminal(
    useShallow((s) => ({
      rutaTerminal: perfil ? s.rutas[perfil.id] : undefined,
      agenteTerminal: perfil ? s.agentePorPerfil[perfil.id] : undefined
    }))
  )
  if (lay.agente === 'terminal' && perfil && rutaTerminal) {
    return agentTargetKey(perfil.id, rutaTerminal, agenteTerminal ?? AGENTES_DISPONIBLES[0])
  }
  if (lay.agente === 'espacio' && perfil && espacioActivoPath) {
    return agentTargetKey(perfil.id, espacioActivoPath, resolveSelectedAgent(perfil.id, selectedAgentByProfile) ?? AGENTES_DISPONIBLES[0])
  }
  return lay.agente === 'proyecto' && !proyecto.diferido ? proyecto.clave : null
}

/** Lleva a un (perfil, proyecto, agente): restaura la columna y sale de BD en el perfil de destino. */
function useAbrirTargetAgente(tabs: UseTabs): AgentesApp['openAgentTarget'] {
  return useCallback(
    (profileId: string, projectHostPath: string, agente: Agente) => {
      selectAgent(profileId, agente)
      useStoreLayout.setState({ ccOculto: 'no' })
      cambiarVistaSi(profileId, 'db', 'files')
      // Quien pide ir a ESE agente lo quiere en marcha: deja de estar diferido.
      tabs.quitarAgenteDiferido(profileId, projectHostPath)
      tabs.setActiveProfile(profileId)
      tabs.setActiveProject(profileId, projectHostPath)
    },
    [tabs]
  )
}

/**
 * Un agente diferido que arranca por otra vía (una casilla del mosaico) deja de estarlo:
 * si no, al volver a la vista normal la columna diría «no se inicia hasta que lo pidas»
 * encima de una sesión viva.
 */
function useQuitarDiferidoAlArrancar(tabs: UseTabs): void {
  const vivos = useStoreAgentes((s) => s.vivos)
  // Una casilla del mosaico se mira, así que su agente arranca: cuenta desde que se elige,
  // sin esperar a que la sesión esté viva.
  const teselas = useStoreMosaico(useShallow((s) => (s.mosaicoActivo ? s.teselas : SIN_TESELAS)))
  const { allOpenTargets, quitarAgenteDiferido } = tabs
  useEffect(() => {
    // Casi nunca hay un proyecto diferido: se sale sin recorrer los targets.
    const diferidos = new Set<string>()
    for (const [profileId, t] of Object.entries(useStorePestanas.getState().tabs.byProfile)) {
      for (const p of t.openProjects) if (p.agenteDiferido) diferidos.add(`${profileId}|${p.projectHostPath}`)
    }
    if (diferidos.size === 0) return
    for (const t of allOpenTargets) {
      if (!diferidos.has(`${t.profileId}|${t.projectHostPath}`)) continue
      if (vivos.has(t.key) || teselas.includes(t.key)) quitarAgenteDiferido(t.profileId, t.projectHostPath)
    }
  }, [vivos, teselas, allOpenTargets, quitarAgenteDiferido])
}

const SIN_TESELAS: readonly string[] = []

/** Targets de agente, layout del centro y navegación a un agente concreto. */
export function useAgentesApp(
  tabs: UseTabs,
  vistas: Pick<VistasPorPerfil, 'activeView' | 'panelInferior' | 'enConexiones'>,
  columna: ColumnaAgenteEstado,
  espacios: EspaciosDatos,
  agenteTerminal: AgenteTerminalApp,
  hayPestanasEditor: boolean
): AgentesApp {
  const confirmed = tabs.confirmedTarget
  const selectedAgentByProfile = useStoreAgentes((s) => s.selectedAgentByProfile)
  const activeAgent = resolveSelectedAgent(confirmed?.profileId ?? null, selectedAgentByProfile)
  const activeTargetKey =
    confirmed && activeAgent ? agentTargetKey(confirmed.profileId, confirmed.project.projectHostPath, activeAgent) : null
  const espacioTargets = useTargetsEspacio()
  const terminalTargets = useTargetsTerminal()
  const fueraDePestanas = useMemo(() => [...espacioTargets, ...terminalTargets], [espacioTargets, terminalTargets])
  // La lista que monta la columna y la que usan las podas: con los targets que no son pestaña incluidos.
  const targetsAgente = useMemo(
    () => (fueraDePestanas.length ? [...tabs.allOpenTargets, ...fueraDePestanas] : tabs.allOpenTargets),
    [tabs.allOpenTargets, fueraDePestanas]
  )
  const { lay, agenteDbVisible, espacioActivoPath, pantallaCompletaTerminal } = useLayoutDelCentro(tabs, vistas, columna, hayPestanasEditor)
  const activeTargetKeyEfectivo = useClaveEfectiva(tabs, lay, espacioActivoPath, {
    clave: activeTargetKey,
    diferido: columna.agenteDiferido
  })
  const hibernatedTargetKeys = useHibernacionFueraDePestanas(tabs, fueraDePestanas, activeTargetKeyEfectivo)
  useQuitarDiferidoAlArrancar(tabs)
  useRestaurarAgenteDb(tabs, vistas.enConexiones, espacios)
  useRestaurarAgenteTerminal(tabs.activeProfile, pantallaCompletaTerminal, agenteTerminal)
  usePodaEstadoSesion(targetsAgente)
  const openAgentTarget = useAbrirTargetAgente(tabs)
  return { activeTargetKey, targetsAgente, agenteDbVisible, lay, activeTargetKeyEfectivo, hibernatedTargetKeys, openAgentTarget }
}
