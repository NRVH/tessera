// =============================================================================
// «Buscar en archivos» (Mod+Shift+F) conectado a la ventana. Lleva `key` por perfil:
// el modal lee su estado inicial al montarse y devuelve lo escrito al desmontarse,
// así que cambiar de perfil con él abierto lo remonta con lo del perfil al que llegas.
// =============================================================================
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { BuscarEnArchivosModal } from './BuscarEnArchivosModal'
import { useStoreBusqueda } from './store'
import type { UseTabs } from '../pestanas'
import type { EditorApp } from '../editor'

interface Props {
  tabs: UseTabs
  perfilUI: string
  editor: Pick<EditorApp, 'activeEditorKey' | 'openEditorTab'>
}

/** Modal de búsqueda en archivos, montado solo mientras está abierto. */
export function ModalBusqueda({ tabs, perfilUI, editor }: Props): React.JSX.Element | null {
  const b = useStoreBusqueda(
    useShallow((s) => ({
      abierto: s.buscarAbierto,
      focusToken: s.buscarFocusToken,
      memoria: s.buscarMemoria,
      query: s.buscarQueryPorPerfil[perfilUI] ?? ''
    }))
  )
  // Identidad estable: es dependencia del efecto que pide el árbol de carpetas.
  const proyectosBuscables = useMemo(
    () => tabs.openProjects.map((p) => ({ nombre: p.name, raiz: p.projectHostPath })),
    [tabs.openProjects]
  )
  if (!b.abierto) return null
  const activeProject = tabs.confirmedTarget?.project ?? null
  return (
    <ErrorBoundary label="la búsqueda en archivos" variant="pane">
      <BuscarEnArchivosModal
        key={perfilUI}
        projectName={activeProject?.name ?? ''}
        proyectos={proyectosBuscables}
        raizActiva={activeProject?.projectHostPath ?? null}
        onActivarProyecto={(raiz) => {
          if (tabs.activeProfile !== null) tabs.setActiveProject(tabs.activeProfile.id, raiz)
        }}
        projectKey={editor.activeEditorKey ?? ''}
        estadoInicial={{ ...b.memoria, query: b.query }}
        onRecordar={(m) => {
          // `perfilUI` del cierre y no una ref: esta instancia es la del perfil con el que se montó.
          useStoreBusqueda.setState((s) => ({
            buscarMemoria: m,
            buscarQueryPorPerfil:
              s.buscarQueryPorPerfil[perfilUI] === m.query ? s.buscarQueryPorPerfil : { ...s.buscarQueryPorPerfil, [perfilUI]: m.query }
          }))
        }}
        // Una coincidencia sin línea (el pool de un .class) se abre sin fingir destino;
        // `columnaArchivo` y no `columna`: la segunda viene sin sangría y recortada.
        onAbrir={(c) =>
          editor.openEditorTab(
            { kind: 'file', file: { path: c.path, name: c.nombre } },
            c.linea > 0 ? { revelar: { linea: c.linea, columna: Math.max(1, c.columnaArchivo) } } : undefined
          )
        }
        onClose={() => useStoreBusqueda.setState({ buscarAbierto: false })}
        focusToken={b.focusToken}
      />
    </ErrorBoundary>
  )
}
