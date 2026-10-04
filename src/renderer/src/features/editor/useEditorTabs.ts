// =============================================================================
// Puente entre el modelo puro `editorTabsModel` y el store del editor (`pestanasPorTarget`).
// Las pestañas viven por target (perfil, proyecto): al cerrar un proyecto se poda su entrada, y
// `allPanes` expone las de todos los targets válidos para que App las monte a la vez (keep-alive).
// Si una acción no cambia nada, el Map es el mismo y el store no avisa a nadie.
// Sin IPC, sin Monaco, sin efectos de carga.
// =============================================================================

import { useCallback, useEffect, useMemo } from 'react'
import {
  closeTab as closeTabAction,
  getActiveTab,
  initialEditorTabsState,
  nextUntitledNumber,
  openTab as openTabAction,
  replaceTab as replaceTabAction,
  setActiveTab as setActiveTabAction,
  type EditorTab,
  type EditorTabsState
} from './editorTabsModel'
import type { CenterPane } from './centerPane'
import { actualizarPestanas, actualizarTarget, useStoreEditor } from './store'

/** Una tab abierta junto al target (perfil+proyecto) al que pertenece. */
export interface OpenEditorPaneRef {
  /** Clave del target dueño de la tab (editorTargetKey). */
  targetKey: string
  /** La tab: id estable + su pane (file|diff). */
  tab: EditorTab
}

/** Superficie que el hook expone a la UI: rebanada activa + todas las tabs. */
export interface UseEditorTabs {
  /** Colección ORDENADA de tabs del target ACTIVO (lo que pinta la tira). */
  tabs: EditorTab[]
  /** Id de la tab activa del target activo, o null si no tiene tabs. */
  activeId: string | null
  /** La tab activa del target activo, o null si no hay ninguna. */
  activeTab: EditorTab | null
  /** TODAS las tabs de TODOS los targets válidos (keep-alive: App las monta todas). */
  allPanes: OpenEditorPaneRef[]
  /** Abre un pane en el target ACTIVO (o activa su tab); `efimera` la abre como vista previa. */
  openTab: (pane: CenterPane, efimera?: boolean) => void
  /** Activa la tab `id` dentro del target ACTIVO; no-op si no existe. */
  setActiveTab: (id: string) => void
  /** Cierra la tab `id` del target ACTIVO; si era la activa, hereda una vecina. */
  closeTab: (id: string) => void
  /** Reemplaza en su sitio el pane de la tab `id` del target ACTIVO (guardar un sin título). */
  replaceTab: (id: string, pane: CenterPane) => void
  /** Menor número libre para el próximo "Sin título-N" del target ACTIVO. */
  nextUntitledNumber: () => number
}

/** Poda la entrada de los targets que ya no están abiertos (efecto, no render: evita setState en render). */
function usePodaDeTargets(validSet: ReadonlySet<string>): void {
  useEffect(() => {
    actualizarPestanas((prev) => {
      let changed = false
      for (const k of prev.keys()) {
        if (!validSet.has(k)) {
          changed = true
          break
        }
      }
      if (!changed) return prev
      const next = new Map<string, EditorTabsState>()
      for (const [k, v] of prev) if (validSet.has(k)) next.set(k, v)
      return next
    })
  }, [validSet])
}

/** Las cuatro acciones sobre las pestañas del target activo; sin target no hacen nada. */
function useAccionesPestanas(
  activeTargetKey: string | null
): Pick<UseEditorTabs, 'openTab' | 'setActiveTab' | 'closeTab' | 'replaceTab'> {
  const openTab = useCallback(
    (pane: CenterPane, efimera = false) => {
      if (activeTargetKey === null) return // sin proyecto activo no hay dónde abrir
      actualizarPestanas((prev) =>
        actualizarTarget(prev, activeTargetKey, (s) => openTabAction(s, pane, efimera))
      )
    },
    [activeTargetKey]
  )

  const setActiveTab = useCallback(
    (id: string) => {
      if (activeTargetKey === null) return
      actualizarPestanas((prev) => actualizarTarget(prev, activeTargetKey, (s) => setActiveTabAction(s, id)))
    },
    [activeTargetKey]
  )

  const closeTab = useCallback(
    (id: string) => {
      if (activeTargetKey === null) return
      actualizarPestanas((prev) => actualizarTarget(prev, activeTargetKey, (s) => closeTabAction(s, id)))
    },
    [activeTargetKey]
  )

  const replaceTab = useCallback(
    (id: string, pane: CenterPane) => {
      if (activeTargetKey === null) return
      actualizarPestanas((prev) => actualizarTarget(prev, activeTargetKey, (s) => replaceTabAction(s, id, pane)))
    },
    [activeTargetKey]
  )

  return { openTab, setActiveTab, closeTab, replaceTab }
}

/** Pestañas del editor por target sobre el store del editor (misma vía que los demás stores). */
export function useEditorTabs(
  activeTargetKey: string | null,
  validTargetKeys: readonly string[]
): UseEditorTabs {
  const byTarget = useStoreEditor((s) => s.pestanasPorTarget)

  // Memo por el contenido: la lista viene de un memo de `useEditorApp`.
  const validSet = useMemo(() => new Set(validTargetKeys), [validTargetKeys])

  usePodaDeTargets(validSet)
  const { openTab, setActiveTab, closeTab, replaceTab } = useAccionesPestanas(activeTargetKey)

  // Rebanada activa: la entrada del target confirmado (o vacía si aún no tiene tabs).
  const active = (activeTargetKey !== null && byTarget.get(activeTargetKey)) || initialEditorTabsState

  // Todas las tabs de los targets válidos (keep-alive); el filtro evita montar un target ya
  // cerrado mientras la poda corre.
  const allPanes = useMemo(() => {
    const out: OpenEditorPaneRef[] = []
    for (const [targetKey, st] of byTarget) {
      if (!validSet.has(targetKey)) continue
      for (const tab of st.tabs) out.push({ targetKey, tab })
    }
    return out
  }, [byTarget, validSet])

  return {
    tabs: active.tabs,
    activeId: active.activeId,
    activeTab: getActiveTab(active),
    allPanes,
    openTab,
    setActiveTab,
    closeTab,
    replaceTab,
    // Se lee al crear la pestaña, no en render: función, no valor.
    nextUntitledNumber: () => nextUntitledNumber(active)
  }
}
