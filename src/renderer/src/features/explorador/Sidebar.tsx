// =============================================================================
// Panel del explorador de archivos: elige entre el estado vacío y el `FileTree` de la
// contenedora de la pestaña activa (no del repo activo: cambiar de repo es asunto de git).
// Recuerda las carpetas abiertas de cada proyecto entre remontajes del árbol, que se
// remonta por `key={projectHostPath}`. El renderer solo ve rutas relativas POSIX.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { useCallback, useRef } from 'react'
import { EstadoVacio, IconoCarpetaVacia } from '../../comun/EstadoVacio'
import type { OpenFile } from '../editor'
import type { OpenProject } from '../pestanas'
import type { WorktreeDecorations } from '../git'
import { FileTree } from './FileTree'
import type { BasesDeArchivoSidebar } from './tiposArbol'

export type { BasesDeArchivoSidebar } from './tiposArbol'

interface SidebarProps {
  /** Alto de fila en px; lo decide el tamaño de letra de la interfaz (theme/densidad). */
  altoFila: number
  /** Contenedora activa confirmada, o null si no hay ninguna abierta. */
  activeProject: OpenProject | null
  /** Archivo abierto ahora mismo (para resaltar la fila activa). */
  openFile: OpenFile | null
  /** Decoraciones git del working-tree, o null si no se conocen. Solo lectura. */
  decorations: WorktreeDecorations | null
  /** Abre un archivo en el editor. */
  onOpenFile: (file: OpenFile) => void
  /** Abre el panel de historial de git de un archivo (menú contextual). */
  onOpenFileHistory: (path: string) => void
  /** Descarta los cambios del working-tree de un archivo (menú contextual). */
  onDiscardChanges: (path: string) => void
  /** Ruta a desplegar y traer a la vista; con token para poder pedir la misma dos veces. */
  revelarRuta?: { path: string; token: number }
  /**
   * Variables CSS de densidad de esta superficie. Se escriben en la raíz del panel y no en
   * `:root`, y salen del mismo número que `altoFila` o el scroll de las listas se descuadra.
   */
  varsDensidad?: React.CSSProperties
  /** «Montar como base de datos» sobre un archivo del proyecto. Ausente = no se ofrece. */
  basesDeArchivo?: BasesDeArchivoSidebar
}

/** Panel lateral con el árbol de archivos del proyecto activo. */
export function Sidebar({
  altoFila,
  varsDensidad,
  activeProject,
  openFile,
  decorations,
  onOpenFile,
  onOpenFileHistory,
  onDiscardChanges,
  revelarRuta,
  basesDeArchivo
}: SidebarProps): React.JSX.Element {
  // Carpetas abiertas por proyecto. Vive aquí porque el Sidebar no se remonta: cambiar de
  // proyecto o de perfil y volver restaura el árbol. Es de sesión (un ref, sin disco).
  const expandedByProject = useRef<Map<string, Set<string>>>(new Map())
  const rememberExpanded = useCallback((projectHostPath: string, expanded: Set<string>) => {
    expandedByProject.current.set(projectHostPath, expanded)
  }, [])

  return (
    <aside className="sidebar" aria-label="Explorador" style={varsDensidad}>
      {activeProject === null ? (
        <>
          <div className="sidebar-header">
            <span className="sidebar-title">Explorador</span>
          </div>
          <div className="sidebar-body">
            <EstadoVacio
              icono={<IconoCarpetaVacia />}
              titulo="Sin proyecto abierto"
              pista="Abre un proyecto para explorar sus archivos."
            />
          </div>
        </>
      ) : (
        // La clave es solo la contenedora: cambiar de repo no debe remontar el árbol.
        <FileTree
          key={activeProject.projectHostPath}
          projectHostPath={activeProject.projectHostPath}
          projectName={activeProject.name}
          altoFila={altoFila}
          initialExpanded={expandedByProject.current.get(activeProject.projectHostPath)}
          onExpandedChange={rememberExpanded}
          openFile={openFile}
          decorations={decorations}
          onOpenFile={onOpenFile}
          onOpenFileHistory={onOpenFileHistory}
          onDiscardChanges={onDiscardChanges}
          revelarRuta={revelarRuta}
          basesDeArchivo={basesDeArchivo}
        />
      )}
    </aside>
  )
}
