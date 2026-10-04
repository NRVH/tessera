// =============================================================================
// Operaciones del xterm del agente que solo leen refs y setters estables: ajustar al
// hueco, sincronizar el tamaño del pty, escribir, copiar, pegar, buscar, compactar y el
// clic derecho.
// Como no capturan valores de un render, valen igual desde un efecto viejo que desde
// un evento de ahora.
// =============================================================================

import type { MouseEvent } from 'react'
import type { SearchOptions } from '../../comun/SearchBox'
import {
  ajustarConRebote,
  ajustarXterm,
  buscarEnXterm,
  cerrarBuscadorXterm,
  copiarSeleccion,
  debeAbrirMenuContextual,
  handleTerminalPaste,
  laAppUsaElRaton
} from '../terminales'
import type { EstadoUi } from './useEstadoAgentPane'
import type { RefsAgentPane } from './useRefsAgentPane'
import { contarEvento } from '../../util/contadorRenders'

/** Setters de la interfaz que tocan estas operaciones. */
export type UiTerminal = Pick<EstadoUi, 'setSearchOpen' | 'setSearchResults' | 'setImagePreviews'>

/**
 * Envía al pty el tamaño del xterm. Ignora tamaños no positivos (un reflow transitorio
 * mide 0 y el agente redibujaría raro) y los reenvíos del mismo tamaño: cada RESIZE deja
 * ciega 600 ms la detección de actividad del main. Una sesión nueva se envía siempre.
 */
export function syncPtySize(r: RefsAgentPane): void {
  const term = r.term.current
  const id = r.sesion.id()
  if (term && id && term.cols > 0 && term.rows > 0) {
    const u = r.ultimoTam.current
    if (u && u.id === id && u.cols === term.cols && u.rows === term.rows) return
    r.ultimoTam.current = { id, cols: term.cols, rows: term.rows }
    contarEvento('pty:resize')
    window.tessera.agentTerminal.resize({ sessionId: id, cols: term.cols, rows: term.rows })
  }
}

/** Ajusta y sincroniza el pty en el acto. */
export function fitAndSyncNow(r: RefsAgentPane): void {
  if (ajustarXterm(r)) syncPtySize(r)
}

/** Ajusta en el acto y sincroniza el pty con antirrebote. */
export function fitAndSyncDebounced(r: RefsAgentPane): void {
  ajustarConRebote(r, () => syncPtySize(r))
}

/** Inyecta stdin al pty de ESTA sesión (o no hace nada). Sumidero del pegado. */
export function writeToPty(r: RefsAgentPane, data: string): void {
  // Preparado para actualizar: `disableStdin` corta el teclado y el texto pegado, pero
  // las imágenes, los archivos arrastrados y compactar escriben por aquí.
  if (r.actualizando.current) return
  const id = r.sesion.id()
  if (id) window.tessera.agentTerminal.write({ sessionId: id, data })
}

/** Copia la selección del xterm al portapapeles. */
export function copySelection(r: RefsAgentPane): void {
  copiarSeleccion(r)
}

/** Busca en el scrollback y la pantalla. Query vacía = limpia resaltados. */
export function runSearch(r: RefsAgentPane, ui: UiTerminal, query: string, opts: SearchOptions, direction: 'next' | 'prev'): void {
  buscarEnXterm(r, ui.setSearchResults, query, opts, direction)
}

/** Cierra el buscador: limpia resaltados y devuelve el foco a la terminal. */
export function closeSearch(r: RefsAgentPane, ui: UiTerminal): void {
  cerrarBuscadorXterm(r, ui.setSearchResults, ui.setSearchOpen)
}

/**
 * Compacta la conversación tecleando `/compact` en el pty (los dos agentes lo exponen)
 * y enfoca la terminal para mirar lo que hace.
 */
export function compactConversation(r: RefsAgentPane): void {
  if (!r.sesion.id()) return
  writeToPty(r, '/compact\r')
  r.term.current?.focus()
}

/**
 * Clic derecho sobre la terminal. Desde el teclado (tecla de menú, Mayús+F10: `button`
 * distinto de 2) abre siempre nuestro menú. Con el ratón y una sesión viva PEGA, pero
 * solo si el CLI no sigue el ratón (si lo sigue, pega él y el texto entraría dos veces).
 * Mayús+clic derecho, o sin sesión, abre el menú para poder copiar. Ver el ADR.
 */
export function alClicDerecho(
  e: MouseEvent,
  r: RefsAgentPane,
  ui: UiTerminal & Pick<EstadoUi, 'setCtxMenu'>,
  sessionId: string | null
): void {
  e.preventDefault()
  const term = r.term.current
  if (e.button !== 2) {
    ui.setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection: term?.hasSelection() ?? false })
    return
  }
  if (!e.shiftKey && sessionId !== null) {
    if (!laAppUsaElRaton(term?.modes.mouseTrackingMode)) {
      pasteFromClipboard(r, ui)
      term?.focus()
    }
    return
  }
  if (!debeAbrirMenuContextual(term?.modes.mouseTrackingMode, e.shiftKey)) return
  ui.setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection: term?.hasSelection() ?? false })
}

/** Añade una miniatura de imagen pegada a la vista previa (se autodescarta sola). */
function addImagePreview(r: RefsAgentPane, ui: UiTerminal, url: string): void {
  const id = ++r.previewId.current
  ui.setImagePreviews((prev) => [...prev, { id, url }])
}

/**
 * Pegado por el canal compartido: archivos e imagen van al CONTENEDOR de esta sesión
 * (el CLI solo lee rutas suyas) y el texto a `term.paste()`. Sin `ClipboardEvent`
 * sondea imagen por IPC y, si no hay, texto.
 */
export function pasteFromClipboard(r: RefsAgentPane, ui: UiTerminal, e?: ClipboardEvent): void {
  const term = r.term.current
  const id = r.sesion.id()
  if (!term || !id) return
  void handleTerminalPaste(term, (data) => writeToPty(r, data), e, {
    saveImage: () => window.tessera.agentTerminal.saveImage(id),
    stagePath: (p) => window.tessera.agentTerminal.stageFile(id, p),
    onImagePreview: (url) => addImagePreview(r, ui, url)
  })
}
