// =============================================================================
// Visibilidad de la columna del agente en la vista normal, la del PERFIL que se ve: el oculto
// (su motivo, más la vista dividida del archivo activo y el agente DIFERIDO del proyecto, que se
// derivan en cada render) y el maximizado, que se pinta siempre COHERENTE con el oculto.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// Decisiones: docs/decisiones/agentes/agente-diferido.md
// =============================================================================
import { useCallback, useLayoutEffect, useMemo } from 'react'
import { columnaDe, fijarColumna, maximizadoCoherente, useStoreLayout } from '../layout'
import { alternarColumnaAgente, useStoreEditor, type EditorApp } from '../editor'
import { useStorePestanas, type UseTabs } from '../pestanas'
import { useStoreAgentes } from './store'
import { textosAgenteDiferido, type TextosAgenteDiferido } from './textosAgenteDiferido'
import { agenteAMostrar, pestanasDelProyecto } from './agentesDelProyecto'
import { useFuenteAgentes } from './useAgentesDelProyecto'

/** Cómo se llama el agente que arrancaría en el proyecto diferido: el elegido entre SUS pestañas. */
function useNombreAgenteDiferido(perfil: string | null): string | null {
  const fuente = useFuenteAgentes()
  const elegido = useStoreAgentes((s) => (perfil === null ? undefined : s.selectedAgentByProfile[perfil]))
  return useMemo(() => {
    if (perfil === null) return null
    const pestanas = pestanasDelProyecto(fuente, perfil)
    const id = agenteAMostrar(pestanas.map((x) => x.id), elegido)
    return pestanas.find((x) => x.id === id)?.nombre ?? null
  }, [fuente, perfil, elegido])
}

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

/** El proyecto que se ve, si tiene el agente DIFERIDO; se lee del proyecto vivo del modelo de pestañas. */
function useProyectoDiferido(visto: UseTabs['objetivoVisto']): { perfil: string; ruta: string } | null {
  const perfil = visto?.profileId ?? null
  const ruta = visto?.project.projectHostPath ?? null
  const diferido = useStorePestanas((s) =>
    perfil === null
      ? false
      : (s.tabs.byProfile[perfil]?.openProjects.some((p) => p.projectHostPath === ruta && p.agenteDiferido === true) ?? false)
  )
  return diferido && perfil !== null && ruta !== null ? { perfil, ruta } : null
}

/** ¿El archivo activo del editor está en vista dividida? */
function useVistaDividida(editor: Pick<EditorApp, 'activeEditorKey' | 'editorTabs' | 'paneKey'>): boolean {
  const { activeEditorKey, editorTabs, paneKey } = editor
  const pkActivo =
    activeEditorKey !== null && editorTabs.activeId !== null ? paneKey(activeEditorKey, editorTabs.activeId) : null
  return useStoreEditor((s) => (pkActivo === null ? undefined : s.modoVistaPorPane.get(pkActivo))) === 'dividida'
}

/** Oculto y maximizado de la columna del agente del perfil que se ve, con la corrección del maximizado rancio. */
export function useColumnaAgente(
  editor: Pick<EditorApp, 'activeEditorKey' | 'editorTabs' | 'paneKey'>,
  tabs: Pick<UseTabs, 'objetivoVisto' | 'activeProfile' | 'quitarAgenteDiferido'>
): ColumnaAgenteEstado {
  const { editorTabs } = editor
  const { quitarAgenteDiferido } = tabs
  // La columna es del PERFIL: cada uno vuelve como lo dejó, sin que lo de otro la cambie.
  const perfil = tabs.objetivoVisto?.profileId ?? tabs.activeProfile?.id ?? ''
  const columna = useStoreLayout((s) => columnaDe(s.columnaPorPerfil, perfil))
  // Ni la vista dividida ni el agente diferido se guardan como un motivo más del oculto: son del
  // archivo y del proyecto que se miran, no de la columna.
  const vistaDividida = useVistaDividida(editor)
  const diferido = useProyectoDiferido(tabs.objetivoVisto)
  const agenteDiferido = diferido !== null
  const ccHidden = columna.oculta !== 'no' || vistaDividida || agenteDiferido
  const coherente = maximizadoCoherente({ ccExpandido: columna.maximizada, ccOculto: ccHidden, hayPestanasEditor: editorTabs.tabs.length > 0 })
  // Se corrige el ESTADO del perfil antes de pintar: si no, el maximizado rancio resucitaría al irse
  // la dividida. Todo lo que lo vuelve incoherente es de este mismo perfil.
  useLayoutEffect(() => {
    if (coherente !== columna.maximizada) fijarColumna({ maximizada: coherente }, perfil)
  })
  const perfilDiferido = diferido?.perfil ?? null
  const rutaDiferida = diferido?.ruta ?? null
  const iniciarAgenteDiferido = useCallback(() => {
    if (perfilDiferido !== null && rutaDiferida !== null) quitarAgenteDiferido(perfilDiferido, rutaDiferida)
  }, [perfilDiferido, rutaDiferida, quitarAgenteDiferido])
  const toggleCcHidden = useCallback(() => {
    const paso = alternarColumnaAgente(columnaDe(useStoreLayout.getState().columnaPorPerfil, perfil).oculta, perfilDiferido !== null)
    if (paso.quitarDiferido) iniciarAgenteDiferido()
    // Ocultar y maximizar son excluyentes; al mostrar es un no-op.
    fijarColumna({ oculta: paso.ccOculto, maximizada: false }, perfil)
  }, [perfil, perfilDiferido, iniciarAgenteDiferido])
  // Estable: va a la cabecera del pane, y una identidad nueva por perfil lo repintaría.
  const alternarCcMaximizado = useCallback(() => fijarColumna((c) => ({ maximizada: !c.maximizada })), [])
  // El agente que arrancaría: el elegido del perfil entre las pestañas del proyecto. La plataforma llega por el preload.
  const nombreDiferido = useNombreAgenteDiferido(perfilDiferido)
  const textosDiferido = useMemo(
    () => (nombreDiferido === null ? null : textosAgenteDiferido(window.tessera.plataforma, nombreDiferido)),
    [nombreDiferido]
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
