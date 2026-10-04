// =============================================================================
// Pestañas del editor de la ventana: el target (perfil y proyecto CONFIRMADOS), la
// colección keep-alive de useEditorTabs, el estado por pane del store y las
// acciones de abrir, cerrar, guardar y convertir. Fija el ámbito de la caché de
// blobs en el render. Lo llama App; depende de los stores de editor y layout.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorTabs, type UseEditorTabs } from './useEditorTabs'
import { deriveTabId, editorTargetKey, untitledName } from './editorTabsModel'
import { siguienteMotivoCcOculto, type CenterPane, type OpenFile, type UntitledFile } from './centerPane'
import { textModelKey, textModels } from './textModelRegistry'
import type { EditorMeta } from './EditorPane'
import type { DiffTarget } from './diffEditorTipos'
import { conMarca, podarConjunto, podarMapa, subirTokens, useStoreEditor } from './store'
import { fijarAmbito } from '../git'
import { useStoreLayout, type VistasPorPerfil } from '../layout'
import type { UseTabs } from '../pestanas'

/** Opciones de apertura de una pestaña del editor. */
export interface OpcionesApertura {
  /** `true` colapsa la columna del agente (un diff a pantalla completa). */
  colapsarAgente?: boolean
  revelar?: { linea: number; columna: number }
  /** Abre como vista previa: la siguiente efímera la sustituye en su hueco. */
  efimera?: boolean
}

/** Lo que el editor de la ventana expone a App y a sus paneles. */
export interface EditorApp {
  activeEditorKey: string | null
  editorTabs: UseEditorTabs
  paneKey: (targetKey: string, tabId: string) => string
  openFile: OpenFile | null
  activeDirtyIds: Set<string>
  activeBorradoIds: Set<string>
  activeEditorMeta: EditorMeta | null
  /** ¿El proyecto optimista y el confirmado coinciden? (no hay cambio de proyecto en vuelo). */
  proyectoAsentado: boolean
  openEditorTab: (pane: CenterPane, opts?: OpcionesApertura) => void
  closeEditorTab: (id: string) => void
  requestCloseTab: (id: string) => void
  abrirFuenteDelDiff: (target: DiffTarget, linea: number) => void
  requestSaveTab: (id: string) => void
  requestConvert: (payload: { encodingId?: string; eol?: 'CRLF' | 'LF' }) => void
  requestReopenEncoding: (encodingId: string) => void
  newUntitledTab: () => void
  saveUntitledPane: (tabId: string, untitled: UntitledFile, content: string) => Promise<boolean>
}

/** Identidad única de un pane montado entre todos los targets (tab.id nunca contiene \u0000). */
const paneKeyDe = (targetKey: string, tabId: string): string => `${targetKey}\u0000${tabId}`

/** Traduce un conjunto por paneKey a ids de pestaña del target activo. */
function idsDelActivo(marcados: Set<string>, tabs: UseEditorTabs['tabs'], key: string | null): Set<string> {
  const s = new Set<string>()
  if (key === null) return s
  for (const tab of tabs) if (marcados.has(paneKeyDe(key, tab.id))) s.add(tab.id)
  return s
}

/** Poda el estado por pane de los panes ya desmontados (los panes no reportan al desmontar). */
function usePodaPorPane(editorTabs: UseEditorTabs): void {
  useEffect(() => {
    const montados = new Set(editorTabs.allPanes.map((p) => paneKeyDe(p.targetKey, p.tab.id)))
    useStoreEditor.setState((s) => ({
      dirtyTabIds: podarConjunto(s.dirtyTabIds, montados),
      borradoTabIds: podarConjunto(s.borradoTabIds, montados),
      reloadTokens: podarMapa(s.reloadTokens, montados),
      saveTokens: podarMapa(s.saveTokens, montados),
      editorMetaByKey: podarMapa(s.editorMetaByKey, montados),
      convertReqByKey: podarMapa(s.convertReqByKey, montados),
      reopenReqByKey: podarMapa(s.reopenReqByKey, montados),
      revelarPorPane: podarMapa(s.revelarPorPane, montados),
      // Aquí importa más: reabrir el mismo archivo recupera la misma clave.
      modoVistaPorPane: podarMapa(s.modoVistaPorPane, montados)
    }))
  }, [editorTabs.allPanes])
}

/** Cierra una pestaña del target activo limpiando su sucio y su modo de vista. */
function useCerrarPestana(editorTabs: UseEditorTabs, activeEditorKey: string | null): (id: string) => void {
  return useCallback(
    (id: string) => {
      // Sin título: el main suelta el destino que recordaba para el siguiente guardado.
      const tab = editorTabs.tabs.find((t) => t.id === id)
      if (tab?.pane.kind === 'untitled') {
        void window.tessera.files
          .forgetUntitled(tab.pane.untitled.id)
          .catch((err) => console.error('[app] forgetUntitled falló:', err))
      }
      editorTabs.closeTab(id)
      if (activeEditorKey === null) return
      const pk = paneKeyDe(activeEditorKey, id)
      useStoreEditor.setState((s) => {
        const cambios: Partial<typeof s> = { dirtyTabIds: conMarca(s.dirtyTabIds, pk, false) }
        if (s.modoVistaPorPane.has(pk)) {
          const next = new Map(s.modoVistaPorPane)
          next.delete(pk)
          cambios.modoVistaPorPane = next
        }
        return cambios
      })
    },
    [editorTabs, activeEditorKey]
  )
}

/** Único punto de apertura de pestañas: sale del maximizado, ajusta el oculto y de la vista de BD. */
function useAbrirPestana(
  editorTabs: UseEditorTabs,
  activeEditorKey: string | null,
  salirDeBd: () => void
): EditorApp['openEditorTab'] {
  return useCallback(
    (pane: CenterPane, opts?: OpcionesApertura) => {
      // En el mismo handler que `openTab`, no en un efecto: llegan en el mismo commit.
      useStoreLayout.setState((s) => ({
        ccExpanded: false,
        ccOculto: siguienteMotivoCcOculto(s.ccOculto, pane, opts?.colapsarAgente === true)
      }))
      salirDeBd()
      editorTabs.openTab(pane, opts?.efimera === true)
      // Por token y no por el pane: dos coincidencias del mismo archivo son la misma pestaña.
      if (opts?.revelar && activeEditorKey !== null) {
        const pk = paneKeyDe(activeEditorKey, deriveTabId(pane))
        const revelar = opts.revelar
        useStoreEditor.setState((s) => {
          const next = new Map(s.revelarPorPane)
          next.set(pk, { ...revelar, token: (s.revelarPorPane.get(pk)?.token ?? 0) + 1 })
          return { revelarPorPane: next }
        })
      }
    },
    [editorTabs, activeEditorKey, salirDeBd]
  )
}

/** Peticiones a un pane por token: guardar, convertir y reabrir con otra codificación. */
function usePeticionesPane(
  editorTabs: UseEditorTabs,
  activeEditorKey: string | null
): Pick<EditorApp, 'requestSaveTab' | 'requestConvert' | 'requestReopenEncoding'> {
  const activeId = editorTabs.activeId
  const requestSaveTab = useCallback(
    (id: string) => {
      if (activeEditorKey === null) return
      const pk = paneKeyDe(activeEditorKey, id)
      useStoreEditor.setState((s) => ({ saveTokens: subirTokens(s.saveTokens, [pk]) }))
    },
    [activeEditorKey]
  )
  const requestConvert = useCallback(
    (payload: { encodingId?: string; eol?: 'CRLF' | 'LF' }) => {
      if (activeEditorKey === null || activeId == null) return
      const pk = paneKeyDe(activeEditorKey, activeId)
      useStoreEditor.setState((s) => {
        const next = new Map(s.convertReqByKey)
        next.set(pk, { token: (s.convertReqByKey.get(pk)?.token ?? 0) + 1, ...payload })
        return { convertReqByKey: next }
      })
    },
    [activeEditorKey, activeId]
  )
  const requestReopenEncoding = useCallback(
    (encodingId: string) => {
      if (activeEditorKey === null || activeId == null) return
      const pk = paneKeyDe(activeEditorKey, activeId)
      useStoreEditor.setState((s) => {
        const next = new Map(s.reopenReqByKey)
        next.set(pk, { token: (s.reopenReqByKey.get(pk)?.token ?? 0) + 1, encodingId })
        return { reopenReqByKey: next }
      })
    },
    [activeEditorKey, activeId]
  )
  return { requestSaveTab, requestConvert, requestReopenEncoding }
}

/** Archivos sin título: crear uno y guardarlo (dentro del proyecto pasa a ser un archivo). */
function useSinTitulo(
  editorTabs: UseEditorTabs,
  activeEditorKey: string | null,
  openEditorTab: EditorApp['openEditorTab']
): Pick<EditorApp, 'newUntitledTab' | 'saveUntitledPane'> {
  // Identidad opaca de los buffers: nunca se reutiliza (el número del nombre sí).
  const untitledSeq = useRef(0)
  const newUntitledTab = useCallback(() => {
    if (activeEditorKey === null) return
    untitledSeq.current += 1
    const untitled: UntitledFile = {
      id: `untitled-${untitledSeq.current}`,
      name: untitledName(editorTabs.nextUntitledNumber())
    }
    openEditorTab({ kind: 'untitled', untitled })
  }, [activeEditorKey, editorTabs, openEditorTab])
  const saveUntitledPane = useCallback(
    async (tabId: string, untitled: UntitledFile, content: string): Promise<boolean> => {
      try {
        const res = await window.tessera.files.saveUntitled(untitled.id, content, untitled.name)
        if (res.canceled) return false
        const name = res.name ?? untitled.name
        if (res.path) editorTabs.replaceTab(tabId, { kind: 'file', file: { path: res.path, name } })
        else editorTabs.replaceTab(tabId, { kind: 'untitled', untitled: { ...untitled, name, saved: true } })
        return true
      } catch (err) {
        console.error('[app] guardar sin título falló:', err)
        return false
      }
    },
    [editorTabs]
  )
  return { newUntitledTab, saveUntitledPane }
}

/** Confirma el cierre solo si pierde trabajo: sin título sucio, o el último titular de un diff sucio. */
function usePedirCierre(
  editorTabs: UseEditorTabs,
  activeEditorKey: string | null,
  dirtyTabIds: Set<string>,
  closeEditorTab: (id: string) => void
): (id: string) => void {
  return useCallback(
    (id: string) => {
      const tab = editorTabs.tabs.find((t) => t.id === id)
      const dirty = activeEditorKey !== null && dirtyTabIds.has(paneKeyDe(activeEditorKey, id))
      const fijar = useStoreEditor.setState
      if (tab?.pane.kind === 'untitled' && dirty) {
        fijar({ pendingClose: { id, name: tab.pane.untitled.name, kind: 'untitled' } })
        return
      }
      if (tab?.pane.kind === 'diff' && dirty && activeEditorKey !== null) {
        const mk = textModelKey(activeEditorKey, tab.pane.target.after.path)
        if (textModels.isDirty(mk) && textModels.refCount(mk) <= 1) {
          const nombre = tab.pane.target.path.split('/').pop() ?? tab.pane.target.path
          fijar({ pendingClose: { id, name: nombre, kind: 'diff' } })
          return
        }
      }
      closeEditorTab(id)
    },
    [editorTabs.tabs, activeEditorKey, dirtyTabIds, closeEditorTab]
  )
}

/** Target, pestañas y acciones del editor de la ventana. */
export function useEditorApp(tabs: UseTabs, vistas: Pick<VistasPorPerfil, 'salirDeBd'>): EditorApp {
  const confirmed = tabs.confirmedTarget
  const activeEditorKey = confirmed ? editorTargetKey(confirmed.profileId, confirmed.project.projectHostPath) : null
  const proyectoAsentado =
    (tabs.activeProject?.projectHostPath ?? null) === (confirmed?.project.projectHostPath ?? null)
  // Proyectos abiertos (hibernados incluidos) sin la dimensión de agente; memo = identidad estable.
  const validEditorKeys = useMemo(() => {
    const seen = new Set<string>()
    for (const t of tabs.allOpenTargets) seen.add(editorTargetKey(t.profileId, t.projectHostPath))
    return [...seen]
  }, [tabs.allOpenTargets])
  const editorTabs = useEditorTabs(activeEditorKey, validEditorKeys)
  const paneKey = useCallback(paneKeyDe, [])
  const { dirtyTabIds, borradoTabIds, editorMetaByKey } = useStoreEditor(
    useShallow((s) => ({ dirtyTabIds: s.dirtyTabIds, borradoTabIds: s.borradoTabIds, editorMetaByKey: s.editorMetaByKey }))
  )
  const activeDirtyIds = useMemo(
    () => idsDelActivo(dirtyTabIds, editorTabs.tabs, activeEditorKey),
    [dirtyTabIds, editorTabs.tabs, activeEditorKey]
  )
  const activeBorradoIds = useMemo(
    () => idsDelActivo(borradoTabIds, editorTabs.tabs, activeEditorKey),
    [borradoTabIds, editorTabs.tabs, activeEditorKey]
  )
  usePodaPorPane(editorTabs)
  const closeEditorTab = useCerrarPestana(editorTabs, activeEditorKey)
  const openEditorTab = useAbrirPestana(editorTabs, activeEditorKey, vistas.salirDeBd)
  // Saltar al fuente desde un diff: abre el archivo de hoy (`path`, el destino en un rename).
  const abrirFuenteDelDiff = useCallback(
    (target: DiffTarget, linea: number): void => {
      const nombre = target.path.split('/').pop() ?? target.path
      openEditorTab({ kind: 'file', file: { path: target.path, name: nombre } }, { revelar: { linea, columna: 1 } })
    },
    [openEditorTab]
  )
  const peticiones = usePeticionesPane(editorTabs, activeEditorKey)
  const activeId = editorTabs.activeId
  const activeEditorMeta = useMemo(() => {
    if (activeEditorKey === null || activeId == null) return null
    return editorMetaByKey.get(paneKeyDe(activeEditorKey, activeId)) ?? null
  }, [editorMetaByKey, activeEditorKey, activeId])
  const sinTitulo = useSinTitulo(editorTabs, activeEditorKey, openEditorTab)
  const requestCloseTab = usePedirCierre(editorTabs, activeEditorKey, dirtyTabIds, closeEditorTab)
  // En el render y no en un efecto: los efectos de los panes de diff corren antes que los de App.
  fijarAmbito(activeEditorKey ?? '')
  const activeTabPane = editorTabs.activeTab?.pane ?? null
  return {
    activeEditorKey,
    editorTabs,
    paneKey,
    openFile: activeTabPane?.kind === 'file' ? activeTabPane.file : null,
    activeDirtyIds,
    activeBorradoIds,
    activeEditorMeta,
    proyectoAsentado,
    openEditorTab,
    closeEditorTab,
    requestCloseTab,
    abrirFuenteDelDiff,
    ...peticiones,
    ...sinTitulo
  }
}
