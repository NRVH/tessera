// =============================================================================
// Visibilidad de la columna del agente en la vista normal: el oculto (motivo del
// store, más la vista dividida del archivo activo y el agente DIFERIDO del proyecto
// activo, que se derivan en cada render) y el maximizado, que se pinta siempre
// COHERENTE con el oculto.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// Decisiones: docs/decisiones/agentes/agente-diferido.md
// =============================================================================
import { useCallback, useLayoutEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { maximizadoCoherente, useStoreLayout } from '../layout'
import { alternarColumnaAgente, useStoreEditor, type EditorApp } from '../editor'
import { useStorePestanas, type UseTabs } from '../pestanas'
import { resolveSelectedAgent } from './agenteElegido'
import { useStoreAgentes } from './store'
import { textosAgenteDiferido, type TextosAgenteDiferido } from './textosAgenteDiferido'

/** Estado derivado de la columna del agente. */
export interface ColumnaAgenteEstado {
  /** Maximizado coherente: el que ven todos los consumidores. */
  ccExpanded: boolean
  ccHidden: boolean
  /** La vista dividida esconde la columna y bloquea su interruptor. */
  vistaDividida: boolean
  /**
   * El proyecto activo se abrió desde el sistema para ver un archivo: su agente no arranca
   * y su columna va plegada, solo en ese proyecto, hasta que el usuario lo pide.
   */
  agenteDiferido: boolean
  /** Lo que dice la interfaz de ese agente diferido; null si el proyecto activo no lo está. */
  textosDiferido: TextosAgenteDiferido | null
  /** Quita esa marca del proyecto activo: su agente arranca. No toca el oculto de la ventana. */
  iniciarAgenteDiferido: () => void
  toggleCcHidden: () => void
  alternarCcMaximizado: () => void
}

/** Oculto y maximizado de la columna del agente, con la corrección del maximizado rancio. */
export function useColumnaAgente(
  editor: Pick<EditorApp, 'activeEditorKey' | 'editorTabs' | 'paneKey'>,
  tabs: Pick<UseTabs, 'confirmedTarget' | 'quitarAgenteDiferido'>
): ColumnaAgenteEstado {
  const { activeEditorKey, editorTabs, paneKey } = editor
  const { confirmedTarget, quitarAgenteDiferido } = tabs
  const { ccExpanded, ccOculto } = useStoreLayout(
    useShallow((s) => ({ ccExpanded: s.ccExpanded, ccOculto: s.ccOculto }))
  )
  const pkActivo =
    activeEditorKey !== null && editorTabs.activeId !== null ? paneKey(activeEditorKey, editorTabs.activeId) : null
  const modoActivo = useStoreEditor((s) => (pkActivo === null ? undefined : s.modoVistaPorPane.get(pkActivo)))
  // Ni la vista dividida ni el agente diferido se guardan como un motivo más del oculto:
  // el motivo es de la VENTANA, y estos dos son del archivo y del proyecto que se miran.
  const vistaDividida = modoActivo === 'dividida'
  // La marca se lee del proyecto VIVO y no de la foto del confirmado: un proyecto cerrado y
  // vuelto a abrir (ya diferido) mientras el backend re-apunta comparte clave con la foto vieja.
  const perfilConfirmado = confirmedTarget?.profileId ?? null
  const rutaConfirmada = confirmedTarget?.project.projectHostPath ?? null
  const agenteDiferido = useStorePestanas((s) =>
    perfilConfirmado === null
      ? false
      : (s.tabs.byProfile[perfilConfirmado]?.openProjects.some(
          (p) => p.projectHostPath === rutaConfirmada && p.agenteDiferido === true
        ) ?? false)
  )
  const ccHidden = ccOculto !== 'no' || vistaDividida || agenteDiferido
  const coherente = maximizadoCoherente({
    ccExpandido: ccExpanded,
    ccOculto: ccHidden,
    hayPestanasEditor: editorTabs.tabs.length > 0
  })
  // Se corrige el ESTADO antes de pintar: si no, el maximizado rancio resucitaría al irse la dividida.
  useLayoutEffect(() => {
    if (coherente !== useStoreLayout.getState().ccExpanded) useStoreLayout.setState({ ccExpanded: coherente })
  })
  const perfilDiferido = agenteDiferido ? perfilConfirmado : null
  const rutaDiferida = agenteDiferido ? rutaConfirmada : null
  const iniciarAgenteDiferido = useCallback(() => {
    if (perfilDiferido !== null && rutaDiferida !== null) quitarAgenteDiferido(perfilDiferido, rutaDiferida)
  }, [perfilDiferido, rutaDiferida, quitarAgenteDiferido])
  const toggleCcHidden = useCallback(() => {
    const paso = alternarColumnaAgente(useStoreLayout.getState().ccOculto, perfilDiferido !== null)
    if (paso.quitarDiferido) iniciarAgenteDiferido()
    // Ocultar y maximizar son excluyentes; al mostrar es un no-op.
    useStoreLayout.setState({ ccOculto: paso.ccOculto, ccExpanded: false })
  }, [perfilDiferido, iniciarAgenteDiferido])
  const alternarCcMaximizado = useCallback(() => useStoreLayout.setState((s) => ({ ccExpanded: !s.ccExpanded })), [])
  // El agente que arrancaría: el elegido del perfil. La plataforma llega por el preload.
  const agenteDelPerfil = useStoreAgentes((s) => resolveSelectedAgent(perfilDiferido, s.selectedAgentByProfile))
  const textosDiferido = useMemo(
    () => (agenteDelPerfil === null ? null : textosAgenteDiferido(window.tessera.plataforma, agenteDelPerfil)),
    [agenteDelPerfil]
  )
  return {
    ccExpanded: coherente,
    ccHidden,
    vistaDividida,
    agenteDiferido,
    textosDiferido,
    iniciarAgenteDiferido,
    toggleCcHidden,
    alternarCcMaximizado
  }
}
