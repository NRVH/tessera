// =============================================================================
// Ayudas de DOM del arrastre del árbol: distinguir un arrastre de archivos del sistema,
// leer las rutas soltadas y rasterizar el «fantasma» del arrastre múltiple nativo.
// Sin estado de React: las usan las filas y el cuerpo del árbol.
// =============================================================================
import { medidasFantasma, type ElementoFantasma } from './seleccionArbol'

/**
 * true si el arrastre trae archivos del sistema y no un nodo del propio árbol.
 * En `dragover` el navegador solo deja leer los tipos del `dataTransfer`.
 */
export function hasExternalFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files')
}

/**
 * Rutas absolutas del host de los archivos soltados desde el sistema. Debe llamarse de
 * forma síncrona en el `drop`: el `dataTransfer` se invalida después.
 */
export function droppedHostPaths(e: React.DragEvent): string[] {
  return Array.from(e.dataTransfer.files)
    .map((f) => window.tessera.getPathForFile(f))
    .filter((p) => p !== '')
}

/** Recorta con puntos suspensivos para que un nombre largo no desborde el fantasma. */
function recortar(ctx: CanvasRenderingContext2D, texto: string, ancho: number): string {
  if (ctx.measureText(texto).width <= ancho) return texto
  let corto = texto
  while (corto.length > 1 && ctx.measureText(`${corto}…`).width > ancho) {
    corto = corto.slice(0, -1)
  }
  return `${corto}…`
}

/**
 * El fantasma rasterizado a PNG para el arrastre nativo, que quiere una imagen y no un
 * nodo del DOM. Se dibuja a mano: el navegador no rasteriza HTML sin una librería.
 * `superficie` es el panel y no `document` porque las variables de densidad se publican
 * inline en él; `null` cae a la raíz.
 */
export function pintarFantasma(
  lineas: readonly ElementoFantasma[],
  resto: number,
  altoFila: number,
  superficie: Element | null
): string {
  const { ancho, alto, altoResto } = medidasFantasma(lineas.length, resto, altoFila)
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(ancho * dpr)
  canvas.height = Math.round(alto * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.scale(dpr, dpr)

  const css = getComputedStyle(superficie ?? document.documentElement)
  const color = (nombre: string, fallback: string): string => {
    const v = css.getPropertyValue(nombre).trim()
    return v === '' ? fallback : v
  }
  const fuente = parseFloat(css.getPropertyValue('--ui-font')) || 12

  ctx.fillStyle = color('--bg-elevated', '#20242b')
  ctx.strokeStyle = color('--border', '#3a4048')
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(0.5, 0.5, ancho - 1, alto - 1, 6)
  ctx.fill()
  ctx.stroke()

  ctx.textBaseline = 'middle'
  ctx.font = `${fuente}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.fillStyle = color('--fg', '#d7dae0')
  lineas.forEach((it, i) => {
    const y = 3 + i * altoFila + altoFila / 2
    // El icono se resume en un cuadrado de color: rasterizar los SVG uno a uno no compensa.
    ctx.fillStyle = color(it.isDir ? '--accent' : '--fg-faint', '#7f8794')
    ctx.fillRect(10, y - 4, 8, 8)
    ctx.fillStyle = color('--fg', '#d7dae0')
    ctx.fillText(recortar(ctx, it.nombre, ancho - 34), 24, y)
  })
  if (resto > 0) {
    ctx.fillStyle = color('--fg-faint', '#7f8794')
    ctx.font = `italic ${Math.max(9, fuente - 1)}px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.fillText(`y ${resto} más`, 24, 3 + lineas.length * altoFila + altoResto / 2)
  }
  return canvas.toDataURL('image/png')
}
