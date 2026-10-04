// =============================================================================
// Árbol de archivos de UN proyecto: cabecera, cuerpo virtualizado, menú contextual y
// diálogos. `FileTree` solo compone; el estado y los efectos viven en `useArbol`, y las
// operaciones, el menú y el teclado en sus módulos. Se remonta con `key={projectHostPath}`
// al cambiar de proyecto, así que su estado arranca limpio para el proyecto nuevo.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { VirtualList } from '../../comun/VirtualList'
import { DialogosArbol } from './DialogosArbol'
import { MenuContextualArbol, abrirMenuDeFila } from './menuArbol'
import { CabeceraArbol, PlaceholderRow } from './piezasArbol'
import { TreeRow } from './TreeRow'
import { importarNodos, moverNodos } from './operacionesArbol'
import {
  alClicarFila,
  alClicDerechoVacio,
  alPulsarVacio,
  alSobrevolarVacio,
  alSoltarEnVacio,
  prepararArrastre
} from './interaccionArbol'
import { manejarTeclaArbol } from './tecladoArbol'
import { useArbol } from './useArbol'
import type { FlatRow } from './treeFlatten'
import type { Arbol, PropsFileTree } from './tiposArbol'

/** Una fila del árbol aplanado: nodo o placeholder. */
function renderFila(a: Arbol, r: FlatRow): React.JSX.Element {
  if (r.kind === 'placeholder') return <PlaceholderRow row={r} />
  const { openFile, decorations, altoFila, onOpenFile } = a.props
  return (
    <TreeRow
      row={r}
      activePath={openFile?.path ?? null}
      decorations={decorations}
      selectedDir={a.selectedDir}
      // Un boolean por fila y no el Set: una fila no se repinta si la selección no la incluye.
      seleccionada={a.seleccion.claves.has(r.key)}
      // El líder solo se dibuja cuando hay grupo: con una fila, el contorno sería ruido.
      lider={a.seleccion.claves.size > 1 && a.seleccion.lider === r.key}
      cutPaths={a.cutPaths}
      arrastrados={a.arrastrados}
      fantasma={a.fantasma}
      altoFila={altoFila}
      onOpenFile={onOpenFile}
      onSelectDir={a.setSelectedDir}
      onClicFila={(clave, mods, fase) => alClicarFila(a, clave, mods, fase)}
      onToggleExpand={a.toggleExpand}
      onDragStartNode={(clave) => prepararArrastre(a, clave)}
      onArrastreFuera={a.arrastrarFuera}
      onDragEndNode={() => a.setArrastrados([])}
      onMoveNode={(srcs, destDir) => void moverNodos(a, srcs, destDir)}
      onImportNode={(hostPaths, destDir) => void importarNodos(a, hostPaths, destDir)}
      onNodeContextMenu={(x, y, clave, isDir) => abrirMenuDeFila(a, x, y, clave, isDir)}
    />
  )
}

/** Cuerpo del panel: también es zona de drop y de menú de la raíz. */
function CuerpoArbol({ arbol }: { arbol: Arbol }): React.JSX.Element {
  const { error, rootEntries, rows, revealIndex } = arbol
  return (
    <div
      className="sidebar-body sidebar-body-tree"
      ref={arbol.treeRef}
      // -1: enfocable con el ratón sin entrar en el orden de tabulación; hace falta para
      // que Ctrl+V funcione tras clicar el vacío, donde no hay fila que tome el foco.
      tabIndex={-1}
      onKeyDown={(e) => void manejarTeclaArbol(arbol, e)}
      onMouseDown={(e) => alPulsarVacio(arbol, e)}
      onContextMenu={(e) => alClicDerechoVacio(arbol, e)}
      onDragOver={(e) => alSobrevolarVacio(arbol, e)}
      onDrop={(e) => alSoltarEnVacio(arbol, e)}
    >
      {error && <div className="tree-error">No se pudo leer el proyecto:{'\n'}{error}</div>}
      {!error && rootEntries === null && <div className="tree-row muted">cargando…</div>}
      {!error && rootEntries !== null && (
        // Virtualizada: solo se montan las filas visibles del árbol aplanado.
        <VirtualList<FlatRow>
          className="tree-virtual"
          ariaLabel="Árbol de archivos"
          items={rows}
          itemHeight={arbol.props.altoFila}
          getKey={(r) => r.key}
          scrollToIndex={revealIndex}
          renderItem={(r) => renderFila(arbol, r)}
        />
      )}
    </div>
  )
}

/** Árbol de archivos de un proyecto. */
export function FileTree(props: PropsFileTree): React.JSX.Element {
  const arbol = useArbol(props)
  return (
    <>
      <CabeceraArbol arbol={arbol} />
      {arbol.opError && <div className="tree-op-error">{arbol.opError}</div>}
      <CuerpoArbol arbol={arbol} />
      <MenuContextualArbol arbol={arbol} />
      <DialogosArbol arbol={arbol} />
    </>
  )
}
