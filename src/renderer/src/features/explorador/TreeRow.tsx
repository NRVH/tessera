// =============================================================================
// Fila del árbol ya aplanada: cadena de carpetas compactada expandible, o archivo
// clicable. Presentacional: la expansión y los hijos los resuelve `FileTree` para poder
// virtualizar; la fila solo conserva el estado local del arrastre.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { statusClass } from '../git'
import { FileTypeIcon } from '../../comun/fileIcons'
import { ChevronArbol, IconoCarpeta } from '../../comun/iconosArbol'
import { esModPrincipal } from '../../util/atajos'
import { useArrastreFila } from './arrastreFila'
import { parentDir } from './posixPath'
import type { ModificadoresClic } from './seleccionArbol'
import type { TreeRowProps } from './tiposArbol'

/** Todo lo que la fila deriva de sus props para pintarse y decidir. */
function datosFila(p: TreeRowProps) {
  const { row, activePath, decorations, selectedDir, cutPaths } = p
  const { entry, segments, leaf, depth, isDir, esContenedor, esVirtual } = row
  const esExpandibleFila = isDir || esContenedor
  return {
    esExpandibleFila,
    // Prefijo atenuado («com/ejemplo/») y nombre de la hoja en color pleno.
    prefix: segments.slice(0, -1).map((s) => s.name).join('/'),
    fullLabel: segments.map((s) => s.name).join('/'),
    isActive: !isDir && activePath === entry.path,
    // +14px en lo que no lleva chevron, para alinear.
    paddingLeft: 8 + depth * 12 + (esExpandibleFila ? 0 : 14),
    // Letra de git por archivo con ruta real (un .jar la tiene; lo de dentro, no) y marca
    // tenue si algún segmento de la cadena contiene cambios.
    fileLetter: !isDir && !esVirtual ? (decorations?.byPath.get(entry.path) ?? null) : null,
    dirDirty: isDir && segments.some((s) => decorations?.dirtyDirs.has(s.path) ?? false),
    // Dónde cae un soltar sobre la fila: dentro de la carpeta o junto al archivo. Se calcula
    // una vez para que `dragover` y `drop` no discrepen.
    destinoInterno: isDir ? leaf.path : parentDir(entry.path),
    isSelectedDir: isDir && selectedDir === leaf.path,
    isCut: cutPaths.has(leaf.path)
  }
}
type DatosFila = ReturnType<typeof datosFila>

function claseFila(p: TreeRowProps, d: DatosFila, dropOver: boolean): string {
  return `tree-row${d.isActive ? ' active' : ''}${d.dirDirty ? ' dir-dirty' : ''}${
    d.isSelectedDir ? ' selected-dir' : ''
  }${p.seleccionada ? ' seleccionada' : ''}${p.lider ? ' lider' : ''}${
    dropOver ? ' drop-over' : ''
  }${d.isCut ? ' cut' : ''}${p.row.esVirtual ? ' in-archive' : ''}`
}

/**
 * Activa la fila: abre el archivo o alterna la carpeta. Dentro de un contenedor no se toca
 * `selectedDir`, porque ahí no se puede crear nada; se mira `esContenedor` y no
 * `esExpandibleFila`, que dejaría fuera las carpetas reales.
 */
function activarFila(p: TreeRowProps, d: DatosFila): void {
  const { entry, leaf, isDir, esContenedor, esVirtual } = p.row
  if (!d.esExpandibleFila) {
    if (!esVirtual) p.onSelectDir(parentDir(entry.path))
    p.onOpenFile({ path: entry.path, name: entry.name })
    return
  }
  if (isDir && !esVirtual && !esContenedor) p.onSelectDir(leaf.path)
  p.onToggleExpand(leaf.path)
}

/** Modificadores de un evento de ratón; en macOS Ctrl+clic es el clic derecho, así que allí añade ⌘. */
const modsDe = (e: React.MouseEvent): ModificadoresClic => ({ mod: esModPrincipal(e), shift: e.shiftKey })

/**
 * Manejadores de clic y teclado. El `mousedown` no lleva `preventDefault` ni
 * `stopPropagation`: cancelaría el arrastre nativo y no cerraría el menú contextual al
 * clicar fuera. El `click` solo dispara si no hubo arrastre.
 */
function eventosClic(p: TreeRowProps, d: DatosFila) {
  const clave = p.row.leaf.path
  return {
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 0) return
      p.onClicFila(clave, modsDe(e), 'abajo')
    },
    onClick: (e: React.MouseEvent) => {
      if (p.onClicFila(clave, modsDe(e), 'arriba')) activarFila(p, d)
    },
    // El panel escucha el clic derecho para su menú de raíz: si burbujeara se abrirían los dos.
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      p.onNodeContextMenu(e.clientX, e.clientY, clave, p.row.isDir)
    },
    // Con teclado no hay arrastre: hacen falta las dos fases para colapsar el grupo a esta fila.
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      const sinMods = { mod: false, shift: false }
      p.onClicFila(clave, sinMods, 'abajo')
      if (p.onClicFila(clave, sinMods, 'arriba')) activarFila(p, d)
    }
  }
}

/** Fila del árbol. */
export function TreeRow(p: TreeRowProps): React.JSX.Element {
  const d = datosFila(p)
  const { dropOver, eventos } = useArrastreFila(p, d.destinoInterno)
  const { entry, leaf, isDir, isExpanded, esVirtual } = p.row
  return (
    <div
      className={claseFila(p, d, dropOver)}
      style={{ paddingLeft: d.paddingLeft }}
      role="button"
      tabIndex={0}
      // Lo de dentro de un .jar no se arrastra: el adjunto entregaría el jar entero.
      draggable={!esVirtual}
      {...eventosClic(p, d)}
      {...eventos}
      title={d.fullLabel}
    >
      {/* Chevron en toda fila desplegable; el icono sigue a la naturaleza del nodo. */}
      {d.esExpandibleFila && <ChevronArbol abierto={isExpanded} />}
      {isDir ? <IconoCarpeta abierto={isExpanded} /> : <FileTypeIcon name={entry.name} />}
      <span className={`tree-label${d.fileLetter ? ` ${statusClass(d.fileLetter)}` : ''}`}>
        {d.prefix && <span className="tree-compact-prefix">{d.prefix}/</span>}
        {leaf.name}
      </span>
      {d.fileLetter && (
        <span className={`git-decoration-letter ${statusClass(d.fileLetter)}`} aria-hidden="true">
          {d.fileLetter}
        </span>
      )}
    </div>
  )
}
