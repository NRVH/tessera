// =============================================================================
// Fila del árbol ya aplanada: cadena de carpetas compactada expandible, o archivo
// activable con ratón o teclado. La expansión y los hijos los resuelve `ArbolArchivos` para poder
// virtualizar; la fila solo conserva el estado local del arrastre.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { claseEstado } from '../git'
import { IconoTipoArchivo } from '../../comun/iconosArchivo'
import { ChevronArbol, IconoCarpeta } from '../../comun/iconosArbol'
import { esModPrincipal } from '../../util/atajos'
import { useArrastreFila } from './arrastreFila'
import { dirPadre } from './rutaPosix'
import { clicActivaFila, type ModificadoresClic } from './seleccionArbol'
import type { PropsFilaArbolArchivos } from './tiposArbol'

/** Todo lo que la fila deriva de sus props para pintarse y decidir. */
function datosFila(p: PropsFilaArbolArchivos) {
  const { fila, rutaActiva, decoraciones, dirSeleccionado, rutasCortadas } = p
  const { entrada, segmentos, hoja, profundidad, esDir, esContenedor, esVirtual } = fila
  const esExpandibleFila = esDir || esContenedor
  return {
    esExpandibleFila,
    // Prefijo atenuado («com/ejemplo/») y nombre de la hoja en color pleno.
    prefijo: segmentos.slice(0, -1).map((s) => s.nombre).join('/'),
    etiquetaCompleta: segmentos.map((s) => s.nombre).join('/'),
    esActivo: !esDir && rutaActiva === entrada.ruta,
    // +14px en lo que no lleva chevron, para alinear.
    rellenoIzquierdo: 8 + profundidad * 12 + (esExpandibleFila ? 0 : 14),
    // Letra de git por archivo con ruta real (un .jar la tiene; lo de dentro, no) y marca
    // tenue si algún segmento de la cadena contiene cambios.
    letraArchivo: !esDir && !esVirtual ? (decoraciones?.porRuta.get(entrada.ruta) ?? null) : null,
    dirSucio: esDir && segmentos.some((s) => decoraciones?.carpetasSucias.has(s.ruta) ?? false),
    // Dónde cae un soltar sobre la fila: dentro de la carpeta o junto al archivo. Se calcula
    // una vez para que `dragover` y `drop` no discrepen.
    destinoInterno: esDir ? hoja.ruta : dirPadre(entrada.ruta),
    esDirSeleccionado: esDir && dirSeleccionado === hoja.ruta,
    esCortado: rutasCortadas.has(hoja.ruta)
  }
}
type DatosFila = ReturnType<typeof datosFila>

function claseFila(p: PropsFilaArbolArchivos, d: DatosFila, esDestinoSoltar: boolean): string {
  return `tree-row${d.esActivo ? ' active' : ''}${d.dirSucio ? ' dir-dirty' : ''}${
    d.esDirSeleccionado ? ' selected-dir' : ''
  }${p.seleccionada ? ' seleccionada' : ''}${p.lider ? ' lider' : ''}${
    esDestinoSoltar ? ' drop-over' : ''
  }${d.esCortado ? ' cut' : ''}${p.fila.esVirtual ? ' in-archive' : ''}`
}

/**
 * Activa la fila: abre el archivo o alterna la carpeta. Dentro de un contenedor no se toca
 * `dirSeleccionado`, porque ahí no se puede crear nada; se mira `esContenedor` y no
 * `esExpandibleFila`, que dejaría fuera las carpetas reales.
 */
function activarFila(p: PropsFilaArbolArchivos, d: DatosFila): void {
  const { entrada, hoja, esDir, esContenedor, esVirtual } = p.fila
  if (!d.esExpandibleFila) {
    if (!esVirtual) p.onSeleccionarDir(dirPadre(entrada.ruta))
    p.onAbrirArchivo({ ruta: entrada.ruta, nombre: entrada.nombre })
    return
  }
  if (esDir && !esVirtual && !esContenedor) p.onSeleccionarDir(hoja.ruta)
  p.onAlternarExpandido(hoja.ruta)
}

/** Modificadores de un evento de ratón; en macOS Ctrl+clic es el clic derecho, así que allí añade ⌘. */
const modsDe = (e: React.MouseEvent): ModificadoresClic => ({ mod: esModPrincipal(e), shift: e.shiftKey })

/**
 * Manejadores de clic y teclado. El `mousedown` no lleva `preventDefault` ni
 * `stopPropagation`: cancelaría el arrastre nativo y no cerraría el menú contextual al
 * clicar fuera. El `click` solo dispara si no hubo arrastre.
 */
function eventosClic(p: PropsFilaArbolArchivos, d: DatosFila) {
  const clave = p.fila.hoja.ruta
  return {
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 0) return
      p.onClicFila(clave, modsDe(e), 'abajo')
    },
    onClick: (e: React.MouseEvent) => {
      const mods = modsDe(e)
      if (!p.onClicFila(clave, mods, 'arriba')) return
      if (clicActivaFila(p.fila, 'simple', mods)) {
        activarFila(p, d)
        return
      }
      // Los documentos de oficina no se abren con un clic, pero sí fijan su carpeta para «Nuevo archivo».
      if (!d.esExpandibleFila && !p.fila.esVirtual) p.onSeleccionarDir(dirPadre(p.fila.entrada.ruta))
    },
    onDoubleClick: (e: React.MouseEvent) => {
      if (clicActivaFila(p.fila, 'doble', modsDe(e))) activarFila(p, d)
    },
    // El panel escucha el clic derecho para su menú de raíz: si burbujeara se abrirían los dos.
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      p.onMenuContextualNodo(e.clientX, e.clientY, clave, p.fila.esDir)
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
export function FilaArbolArchivos(p: PropsFilaArbolArchivos): React.JSX.Element {
  const d = datosFila(p)
  const { esDestinoSoltar, eventos } = useArrastreFila(p, d.destinoInterno)
  const { entrada, hoja, esDir, estaExpandida, esVirtual } = p.fila
  return (
    <div
      className={claseFila(p, d, esDestinoSoltar)}
      style={{ paddingLeft: d.rellenoIzquierdo }}
      role="button"
      tabIndex={0}
      // Lo de dentro de un .jar no se arrastra: el adjunto entregaría el jar entero.
      draggable={!esVirtual}
      {...eventosClic(p, d)}
      {...eventos}
      title={d.etiquetaCompleta}
    >
      {/* Chevron en toda fila desplegable; el icono sigue a la naturaleza del nodo. */}
      {d.esExpandibleFila && <ChevronArbol abierto={estaExpandida} />}
      {esDir ? <IconoCarpeta abierto={estaExpandida} /> : <IconoTipoArchivo nombre={entrada.nombre} />}
      <span className={`tree-label${d.letraArchivo ? ` ${claseEstado(d.letraArchivo)}` : ''}`}>
        {d.prefijo && <span className="tree-compact-prefix">{d.prefijo}/</span>}
        {hoja.nombre}
      </span>
      {d.letraArchivo && (
        <span className={`git-decoration-letter ${claseEstado(d.letraArchivo)}`} aria-hidden="true">
          {d.letraArchivo}
        </span>
      )}
    </div>
  )
}
