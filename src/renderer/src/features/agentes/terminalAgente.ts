// =============================================================================
// Operaciones del xterm del agente que solo leen refs y setters estables: ajustar al
// hueco, sincronizar el tamaño del pty, escribir, copiar, pegar, compactar y el
// clic derecho.
// Como no capturan valores de un render, valen igual desde un efecto viejo que desde
// un evento de ahora.
// =============================================================================

import type { MouseEvent } from 'react'
import {
  ajustarConRebote,
  ajustarXterm,
  copiarSeleccion,
  debeAbrirMenuContextual,
  alPegarTerminal,
  laAppUsaElRaton
} from '../terminales'
import type { EstadoUi } from './useEstadoPaneAgente'
import type { RefsPaneAgente } from './useRefsPaneAgente'
import { contarEvento } from '../../util/contadorRenders'

/** Setters de la interfaz que tocan estas operaciones. */
export type UiTerminal = Pick<EstadoUi, 'setPreviasImagen'>

/**
 * Envía al pty el tamaño del xterm. Ignora tamaños no positivos (un reflow transitorio
 * mide 0 y el agente redibujaría raro) y los reenvíos del mismo tamaño: cada RESIZE deja
 * ciega 600 ms la detección de actividad del main. Una sesión nueva se envía siempre.
 */
export function sincronizarTamanoPty(r: RefsPaneAgente): void {
  const term = r.term.current
  const id = r.sesion.id()
  if (term && id && term.cols > 0 && term.rows > 0) {
    const u = r.ultimoTam.current
    if (u && u.id === id && u.cols === term.cols && u.rows === term.rows) return
    r.ultimoTam.current = { id, cols: term.cols, rows: term.rows }
    contarEvento('pty:resize')
    window.tessera.terminalAgente.redimensionar({ sessionId: id, cols: term.cols, rows: term.rows })
  }
}

/**
 * Ajusta el xterm y devuelve el tamaño con el que debe nacer el pty de una sesión que se
 * abre; undefined si aún no se pudo medir (el main usa el suyo y el ajuste lo corrige).
 */
export function tamanoParaAbrir(r: RefsPaneAgente): { cols: number; rows: number } | undefined {
  const term = r.term.current
  if (!term) return undefined
  ajustarXterm(r)
  return term.cols > 0 && term.rows > 0 ? { cols: term.cols, rows: term.rows } : undefined
}

/** Apunta como ya enviado el tamaño con el que nació la sesión `id`, para no repetirlo. */
export function apuntarTamanoDeNacimiento(r: RefsPaneAgente, id: string, tamano: { cols: number; rows: number } | undefined): void {
  if (tamano) r.ultimoTam.current = { id, ...tamano }
}

/** Ajusta y sincroniza el pty en el acto. */
export function ajustarYSincronizarAhora(r: RefsPaneAgente): void {
  if (ajustarXterm(r)) sincronizarTamanoPty(r)
}

/** Ajusta en el acto y sincroniza el pty con antirrebote. */
export function ajustarYSincronizarConRebote(r: RefsPaneAgente): void {
  ajustarConRebote(r, () => sincronizarTamanoPty(r))
}

/** Inyecta stdin al pty de ESTA sesión (o no hace nada). Sumidero del pegado. */
export function escribirAPty(r: RefsPaneAgente, datos: string): void {
  // Preparado para actualizar: `disableStdin` corta el teclado y el texto pegado, pero
  // las imágenes, los archivos arrastrados y compactar escriben por aquí.
  if (r.actualizando.current) return
  const id = r.sesion.id()
  if (id) window.tessera.terminalAgente.escribir({ sessionId: id, data: datos })
}

/** Copia la selección del xterm al portapapeles. */
export function copiarSeleccionDelAgente(r: RefsPaneAgente): void {
  copiarSeleccion(r)
}

/**
 * Compacta la conversación tecleando `/compact` en el pty (los dos agentes lo exponen)
 * y enfoca la terminal para mirar lo que hace.
 */
export function compactarConversacion(r: RefsPaneAgente): void {
  if (!r.sesion.id()) return
  escribirAPty(r, '/compact\r')
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
  r: RefsPaneAgente,
  ui: UiTerminal & Pick<EstadoUi, 'setCtxMenu'>,
  sesionId: string | null
): void {
  e.preventDefault()
  const term = r.term.current
  if (e.button !== 2) {
    ui.setCtxMenu({ x: e.clientX, y: e.clientY, haySeleccion: term?.hasSelection() ?? false })
    return
  }
  if (!e.shiftKey && sesionId !== null) {
    if (!laAppUsaElRaton(term?.modes.mouseTrackingMode)) {
      pegarDesdePortapapeles(r, ui)
      term?.focus()
    }
    return
  }
  if (!debeAbrirMenuContextual(term?.modes.mouseTrackingMode, e.shiftKey)) return
  ui.setCtxMenu({ x: e.clientX, y: e.clientY, haySeleccion: term?.hasSelection() ?? false })
}

/** Añade una miniatura de imagen pegada a la vista previa (se autodescarta sola). */
function anadirPreviaImagen(r: RefsPaneAgente, ui: UiTerminal, url: string): void {
  const id = ++r.previaId.current
  ui.setPreviasImagen((prev) => [...prev, { id, url }])
}

/**
 * Pegado por el canal compartido: archivos e imagen van al CONTENEDOR de esta sesión
 * (el CLI solo lee rutas suyas) y el texto a `term.paste()`. Sin `ClipboardEvent`
 * sondea imagen por IPC y, si no hay, texto.
 */
export function pegarDesdePortapapeles(r: RefsPaneAgente, ui: UiTerminal, e?: ClipboardEvent): void {
  const term = r.term.current
  const id = r.sesion.id()
  if (!term || !id) return
  void alPegarTerminal(term, (datos) => escribirAPty(r, datos), e, {
    guardarImagen: () => window.tessera.terminalAgente.guardarImagen(id),
    prepararRuta: (p) => window.tessera.terminalAgente.prepararArchivo(id, p),
    onPreviaImagen: (url) => anadirPreviaImagen(r, ui, url)
  })
}
