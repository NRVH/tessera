// =============================================================================
// El estado de la ventana de agente: con qué nació (lo dice el main), los ajustes que lee SIN
// escribirlos nunca (apariencia, zoom, tamaño de la interfaz y los agentes manuales nativos; el
// archivo es de la ventana principal), los panes vivos, la conversación que reanuda al
// restaurarse y los encargos de la actualización nativa que le llegan de la principal.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DatosVentanaAgente, EncargoPaneRemoto } from '../../../../../shared/ventana-agente-ipc'
import type { IdAgente } from '../../../../../shared/agentesManuales'
import type { WorkspaceSettings } from '../../../../../shared/workspace-state-ipc'
import { DEFAULT_TERMINAL_APPEARANCE, type TerminalAppearance } from '../../../theme/terminalAppearance'
import { fontTitulo, normalizarUiFont, variablesCss } from '../../../theme/densidad'
import type { PestanaAgente } from '../agentesDelProyecto'
import type { ApiAgentePane } from '../tipos'
import { agenteInicial, conversacionAReanudar, elegirAgente, fuenteDeVentana, pestanasDeVentana, podarPanes, type PanesVentana } from './modeloVentana'

/** Lo que pinta la ventana. */
export interface ModeloVentanaAgente {
  /** null mientras llegan los datos y los ajustes. */
  datos: DatosVentanaAgente | null
  apariencia: TerminalAppearance
  pestanas: readonly PestanaAgente[]
  panes: PanesVentana
  /** El pane de este agente espera a fijar la conversación que reanuda antes de abrirse. */
  esperandoReanudar: (agente: IdAgente) => boolean
  /** Enseña (y si hace falta abre) el pane de ese agente. ESTABLE. */
  elegir: (perfil: string, agente: IdAgente) => void
  /** Registro de la API de cada pane (ESTABLE). */
  registrarApi: (clave: string, api: ApiAgentePane | null) => void
}

const SIN_PANES: PanesVentana = { abiertos: [], activo: null }

/** Zoom y tamaño de la interfaz de los ajustes: se aplican, nunca se guardan desde aquí. */
function aplicarAjustesVisuales(s: WorkspaceSettings): void {
  window.tessera.zoom.setLevel(s.zoomLevel)
  const ui = normalizarUiFont(s.uiFontSize ?? 0)
  for (const [k, v] of Object.entries(variablesCss(ui))) document.documentElement.style.setProperty(k, v)
  document.documentElement.style.setProperty('--ui-font-titulo', `${fontTitulo(ui)}px`)
}

/** Los ajustes que la ventana lee al nacer y cada vez que recupera el foco (pudieron cambiar en la principal). */
function useAjustesDeLectura(): WorkspaceSettings | null {
  const [ajustes, setAjustes] = useState<WorkspaceSettings | null>(null)
  useEffect(() => {
    let vivo = true
    const leer = (): void => {
      window.tessera.workspace
        .loadSettings()
        .then((s) => {
          if (!vivo) return
          aplicarAjustesVisuales(s)
          setAjustes(s)
        })
        .catch((err: unknown) => console.error('[ventana-agente] no se pudieron leer los ajustes:', err))
    }
    leer()
    window.addEventListener('focus', leer)
    return () => {
      vivo = false
      window.removeEventListener('focus', leer)
    }
  }, [])
  return ajustes
}

/** Atiende los encargos de la principal sobre sus panes (parar, relanzar y soltar para actualizar). */
function useEncargosRemotos(apis: React.MutableRefObject<Map<string, ApiAgentePane>>): void {
  useEffect(() => {
    const atender = async (e: EncargoPaneRemoto): Promise<void> => {
      const api = [...apis.current.values()].find((a) => a.sessionId() === e.sessionId)
      const responder = (resultado: 'ok' | 'fallo' | 'saltada' | null): void => window.tessera.ventanaAgente.responder({ id: e.id, resultado })
      if (!api) return responder(e.accion === 'relanzar' ? 'saltada' : null)
      if (e.accion === 'preparar') api.preparar()
      else if (e.accion === 'liberar') api.liberar()
      else return responder(await api.relanzar({ banner: e.banner ?? '', error: e.error }).catch(() => 'fallo' as const))
      responder(null)
    }
    return window.tessera.ventanaAgente.onEncargo((e) => void atender(e))
  }, [apis])
}

/** Estado y acciones de la ventana de agente. */
export function useVentanaAgente(): ModeloVentanaAgente {
  const [datos, setDatos] = useState<DatosVentanaAgente | null>(null)
  const ajustes = useAjustesDeLectura()
  const [panes, setPanes] = useState<PanesVentana>(SIN_PANES)
  const [reanudarPendiente, setReanudarPendiente] = useState<string | null>(null)
  const apis = useRef(new Map<string, ApiAgentePane>())
  useEffect(() => {
    void window.tessera.ventanaAgente.datos().then((d) => setDatos(d))
  }, [])
  const nativos = ajustes?.agentesNativos
  const pestanas = useMemo(() => pestanasDeVentana(fuenteDeVentana(nativos)), [nativos])
  // Al llegar datos y ajustes nace el primer pane; después, un manual borrado se poda.
  useEffect(() => {
    if (!datos || !ajustes) return
    if (panes.activo !== null) {
      const podados = podarPanes(panes, pestanas)
      if (podados !== panes) setPanes(podados)
      return
    }
    const inicial = agenteInicial(pestanas, datos.agente)
    if (inicial === null) return
    setReanudarPendiente(conversacionAReanudar(datos, inicial))
    setPanes({ abiertos: [inicial], activo: inicial })
  }, [datos, ajustes, pestanas, panes])
  useEffect(() => {
    if (panes.activo) window.tessera.ventanaAgente.fijarActivo(panes.activo)
  }, [panes.activo])
  useEncargosRemotos(apis)
  const pendienteRef = useRef<{ conversacion: string | null; agente: IdAgente | undefined }>({ conversacion: null, agente: undefined })
  pendienteRef.current = { conversacion: reanudarPendiente, agente: datos?.agente }
  const registrarApi = useCallback((clave: string, api: ApiAgentePane | null): void => {
    if (!api) {
      apis.current.delete(clave)
      return
    }
    apis.current.set(clave, api)
    // La conversación se fija ANTES de que el pane se mire (y abra su sesión).
    const { conversacion, agente } = pendienteRef.current
    if (conversacion && api.agente === agente) {
      api.reanudarCon(conversacion)
      setReanudarPendiente(null)
    }
  }, [])
  // Con la firma de `onSelectAgent` del pane (el perfil se ignora: la ventana no tiene).
  const elegir = useCallback((_perfil: string, agente: IdAgente) => setPanes((p) => elegirAgente(p, agente)), [])
  const esperandoReanudar = (agente: IdAgente): boolean => reanudarPendiente !== null && agente === datos?.agente
  const apariencia = useMemo<TerminalAppearance>(
    () => (ajustes ? { fontFamily: ajustes.agentFontFamily ?? '', fontSize: ajustes.agentFontSize ?? 0 } : DEFAULT_TERMINAL_APPEARANCE),
    [ajustes]
  )
  return { datos: ajustes ? datos : null, apariencia, pestanas, panes, esperandoReanudar, elegir, registrarApi }
}
