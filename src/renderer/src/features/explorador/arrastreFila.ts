// =============================================================================
// Arrastre de una fila del árbol: el estado del resaltado del destino, la URL del
// archivo para soltarlo fuera y los manejadores de `dragstart`, `dragover` y `drop`.
// Un solo gesto sirve para las tres direcciones (dentro del árbol, hacia el sistema y
// desde él); qué se acepta lo decide `efectoDeDragOver`.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { useRef, useState, type MutableRefObject } from 'react'
import { droppedHostPaths, hasExternalFiles, pintarFantasma } from './arrastreArbol'
import { efectoDeDragOver } from './seleccionArbol'
import type { TreeRowProps } from './tiposArbol'

type Arrastre = React.DragEvent<HTMLDivElement>

/**
 * Pide la URL `file://` del archivo al apretar el ratón, no al empezar a arrastrar:
 * `dragstart` es síncrono y no puede esperar a un IPC, y entre ambos media el umbral de
 * arrastre. Si no llega, el arrastre interno funciona igual. Lo de dentro de un .jar no
 * se pide: no hay URL posible y cruzaría el IPC en cada pulsación.
 */
function precargarUrl(p: TreeRowProps, ref: MutableRefObject<string>): void {
  const { isDir, esVirtual, entry } = p.row
  if (isDir || esVirtual) return
  ref.current = ''
  void window.tessera.files
    .fileUrl(entry.path)
    .then((url) => {
      ref.current = url
    })
    .catch(() => {
      ref.current = ''
    })
}

/**
 * Empieza el arrastre. Varios archivos salen por el arrastre NATIVO, la única forma de
 * entregar más de uno al sistema: sustituye al HTML5 de este gesto, pero mover dentro del
 * árbol no se pierde porque el nativo llega como un drop que `arrastrados` reconoce como
 * propio. Uno va por `DownloadURL`, que convive con el arrastre HTML5.
 */
function iniciarArrastreFila(e: Arrastre, p: TreeRowProps, fileUrl: string): void {
  e.stopPropagation()
  const { entry, leaf, isDir } = p.row
  const rutas = p.onDragStartNode(leaf.path)
  if (rutas.length === 0) {
    e.preventDefault()
    return
  }
  if (rutas.length > 1) {
    e.preventDefault()
    // La superficie sale del evento: el fantasma usa la densidad de ESTE panel.
    const fantasma = pintarFantasma(
      p.fantasma.lineas,
      p.fantasma.resto,
      p.altoFila,
      e.currentTarget.closest('.sidebar')
    )
    p.onArrastreFuera(rutas, fantasma)
    return
  }
  e.dataTransfer.effectAllowed = 'copyMove'
  e.dataTransfer.setData('text/plain', rutas.join('\n'))
  if (!isDir && fileUrl) {
    e.dataTransfer.setData('DownloadURL', `application/octet-stream:${entry.name}:${fileUrl}`)
  }
}

/**
 * Sobrevuelo de la fila. `stopPropagation` siempre, también al rechazar: si el evento
 * burbujeara, el panel habilitaría el drop a la raíz y el cursor prometería un movimiento
 * que el `drop` de la fila descarta. Solo se resalta una carpeta: sobre un archivo el
 * destino es su carpeta y encender su fila prometería otro sitio.
 */
function sobrevolarFila(
  e: Arrastre,
  p: TreeRowProps,
  destino: string,
  dropOver: boolean,
  setDropOver: (v: boolean) => void
): void {
  e.stopPropagation()
  const efecto = efectoDeDragOver({
    esVirtual: p.row.esVirtual,
    arrastrados: p.arrastrados,
    destino,
    externo: hasExternalFiles(e)
  })
  if (efecto === null) return
  e.preventDefault()
  e.dataTransfer.dropEffect = efecto
  if (p.row.isDir && !dropOver) setDropOver(true)
}

/** Soltar sobre la fila: mueve lo propio o importa lo del sistema al destino de la fila. */
function soltarEnFila(
  e: Arrastre,
  p: TreeRowProps,
  destino: string,
  setDropOver: (v: boolean) => void
): void {
  e.preventDefault()
  e.stopPropagation()
  setDropOver(false)
  // Segunda guarda, no redundante: `dragover` puede no haber corrido sobre esta fila.
  if (p.row.esVirtual) return
  if (p.arrastrados.length > 0) {
    p.onMoveNode(p.arrastrados, destino)
    return
  }
  if (hasExternalFiles(e)) p.onImportNode(droppedHostPaths(e), destino)
}

/** Estado y manejadores de arrastre de la fila; `destino` es dónde cae un soltar sobre ella. */
export function useArrastreFila(p: TreeRowProps, destino: string) {
  // true mientras se arrastra algo válido sobre esta carpeta (resalta el destino).
  const [dropOver, setDropOver] = useState(false)
  const fileUrlRef = useRef<string>('')
  const eventos = {
    onPointerDown: () => precargarUrl(p, fileUrlRef),
    onDragStart: (e: Arrastre) => iniciarArrastreFila(e, p, fileUrlRef.current),
    onDragEnd: () => p.onDragEndNode(),
    onDragOver: (e: Arrastre) => sobrevolarFila(e, p, destino, dropOver, setDropOver),
    // `dragleave` también dispara al pasar a un hijo de la fila: sin la guarda parpadea.
    onDragLeave: (e: Arrastre) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDropOver(false)
    },
    onDrop: (e: Arrastre) => soltarEnFila(e, p, destino, setDropOver)
  }
  return { dropOver, eventos }
}
