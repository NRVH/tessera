// =============================================================================
// Panel del explorador de archivos: elige entre el estado vacío y los `FileTree` de las
// contenedoras (no de los repos: cambiar de repo es asunto de git). Mantiene montados los árboles
// de los últimos proyectos vistos (`comun/useVivosRecientes`) y enseña solo el del que se ve: al
// volver a uno, está tal cual se dejó. Recuerda las carpetas abiertas de los que salen de la lista.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { memo, useCallback, useRef } from 'react'
import { useCapaVisible } from '../../comun/capaVisible'
import { EstadoVacio, IconoCarpetaVacia } from '../../comun/EstadoVacio'
import { CapaViva, useVivosRecientes } from '../../comun/useVivosRecientes'
import type { Vivo } from '../../comun/vivosRecientes'
import type { OpenFile } from '../editor'
import type { OpenProject } from '../pestanas'
import type { WorktreeDecorations } from '../git'
import { txExplorador } from './textos.ts'
import { FileTree } from './FileTree'
import type { BasesDeArchivoSidebar } from './tiposArbol'

export type { BasesDeArchivoSidebar } from './tiposArbol'

interface SidebarProps {
  /** Alto de fila en px; lo decide el tamaño de letra de la interfaz (theme/densidad). */
  altoFila: number
  /** Perfil del proyecto que se ve: con la contenedora, la clave de su árbol. */
  perfilId: string | null
  /** Contenedora que se ve, o null si no hay ninguna abierta. */
  activeProject: OpenProject | null
  /** Claves (`perfil|contenedora`) de los proyectos abiertos: el árbol de uno cerrado se desmonta. */
  abiertos: ReadonlySet<string>
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

/** El árbol de un proyecto montado: su clave (`perfil|contenedora`) y su proyecto. */
interface ArbolVivo extends Vivo {
  projectHostPath: string
  name: string
}

/** Un proyecto renombrado repinta su árbol, aunque ya fuera el último visto. */
const mismoArbol = (a: ArbolVivo, b: ArbolVivo): boolean => a.clave === b.clave && a.name === b.name

/**
 * Un árbol oculto no se repinta por lo que le llega de fuera (callbacks nuevos en cada render del
 * lateral, el archivo abierto…): nadie lo ve ni puede tocarlo. Al volver a verse recibe las props
 * vigentes. Su propio estado (cargas, cambios) sí lo repinta.
 */
const FileTreeVivo = memo(
  FileTree,
  (antes, ahora) =>
    !antes.activo &&
    !ahora.activo &&
    antes.altoFila === ahora.altoFila &&
    antes.revelarRuta?.token === ahora.revelarRuta?.token
)

/** Panel lateral con el árbol de archivos del proyecto que se ve. */
export function Sidebar(props: SidebarProps): React.JSX.Element {
  const { altoFila, varsDensidad, perfilId, activeProject, abiertos } = props
  // Carpetas abiertas de los árboles que salen de la lista viva: si se vuelve a ellos, se restauran.
  // Es de sesión (un ref, sin disco).
  const expandedByProject = useRef<Map<string, Set<string>>>(new Map())
  const rememberExpanded = useCallback((projectHostPath: string, expanded: Set<string>) => {
    expandedByProject.current.set(projectHostPath, expanded)
  }, [])
  const activo: ArbolVivo | null =
    activeProject && perfilId !== null
      ? { clave: `${perfilId}|${activeProject.projectHostPath}`, projectHostPath: activeProject.projectHostPath, name: activeProject.name }
      : null
  const vivos = useVivosRecientes(activo, abiertos, mismoArbol)
  // Con el lateral de archivos oculto (se mira otra vista), el árbol del proyecto tampoco se ve: no
  // escucha cambios ni atiende menús, y se recarga al volver a verse.
  const lateralSeVe = useCapaVisible()

  const t = txExplorador()
  return (
    <aside className="sidebar" aria-label={t.titulo} style={varsDensidad}>
      {activo === null && (
        <>
          <div className="sidebar-header">
            <span className="sidebar-title">{t.titulo}</span>
          </div>
          <div className="sidebar-body">
            <EstadoVacio icono={<IconoCarpetaVacia />} titulo={t.sinProyecto} pista={t.sinProyectoPista} />
          </div>
        </>
      )}
      {vivos.map((a) => {
        const visto = a.clave === activo?.clave
        return (
          <CapaViva key={a.clave} visible={visto}>
            <FileTreeVivo
              projectHostPath={a.projectHostPath}
              projectName={a.name}
              activo={visto && lateralSeVe}
              altoFila={altoFila}
              initialExpanded={expandedByProject.current.get(a.projectHostPath)}
              onExpandedChange={rememberExpanded}
              openFile={visto ? props.openFile : null}
              decorations={visto ? props.decorations : null}
              onOpenFile={props.onOpenFile}
              onOpenFileHistory={props.onOpenFileHistory}
              onDiscardChanges={props.onDiscardChanges}
              revelarRuta={props.revelarRuta}
              basesDeArchivo={visto ? props.basesDeArchivo : undefined}
            />
          </CapaViva>
        )
      })}
    </aside>
  )
}
