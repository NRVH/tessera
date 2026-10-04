// =============================================================================
// Teclado de la rejilla de datos: qué hace cada acorde al navegar, al editar una tabla y
// dentro del editor de una celda. Puro, con la plataforma como PARÁMETRO: por defecto
// `window.tessera.plataforma` (en el renderer no hay `process`), y bajo `node` se pasa.
// Lo usan `DbRejilla` y `EditorCelda`; la tabla de acordes y sus mitades negativas, en el ADR.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-teclado.md
// =============================================================================

import type { Plataforma } from '../../../../../shared/plataforma.ts'
import { esModPrincipal } from '../../../util/atajos.ts'
import type { Movimiento } from './seleccionRejilla.ts'

/** Lo mínimo de un evento de teclado: lo cumplen el del DOM y el sintético de React. */
export interface TeclaRejilla {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

/** Lo que hace una tecla al navegar la rejilla. */
export type AccionRejilla =
  | { tipo: 'mover'; mov: Movimiento; extender: boolean }
  | { tipo: 'todo' }
  | { tipo: 'copiar' }
  | { tipo: 'colapsar' }
  | { tipo: 'verValor' }

const FLECHAS: Record<string, { simple: Movimiento; borde: Movimiento }> = {
  ArrowUp: { simple: 'arriba', borde: 'bordeArriba' },
  ArrowDown: { simple: 'abajo', borde: 'bordeAbajo' },
  ArrowLeft: { simple: 'izquierda', borde: 'bordeIzquierda' },
  ArrowRight: { simple: 'derecha', borde: 'bordeDerecha' }
}

/** Las teclas de movimiento con nombre; `conMod: null` = con el modificador no son nuestras. */
const NOMBRADAS: Record<string, { simple: Movimiento; conMod: Movimiento | null }> = {
  Home: { simple: 'inicioFila', conMod: 'primeraCelda' },
  End: { simple: 'finFila', conMod: 'ultimaCelda' },
  PageUp: { simple: 'paginaArriba', conMod: null },
  PageDown: { simple: 'paginaAbajo', conMod: null }
}

function propia<T>(tabla: Record<string, T>, key: string): T | null {
  return Object.prototype.hasOwnProperty.call(tabla, key) ? tabla[key] : null
}

/** El movimiento de una flecha o tecla con nombre; undefined si la tecla no es de movimiento. */
function accionMovimiento(e: TeclaRejilla, mod: boolean): AccionRejilla | null | undefined {
  const flecha = propia(FLECHAS, e.key)
  if (flecha) return { tipo: 'mover', mov: mod ? flecha.borde : flecha.simple, extender: e.shiftKey }
  const nombrada = propia(NOMBRADAS, e.key)
  if (!nombrada) return undefined
  const mov = mod ? nombrada.conMod : nombrada.simple
  return mov ? { tipo: 'mover', mov, extender: e.shiftKey } : null
}

/** Mod+A y Mod+C: por la LETRA impresa (`key`), como los aceleradores de menú. */
function accionLetra(key: string): AccionRejilla | null {
  // Con Bloq Mayús llega 'A' sin Mayús: vale igual.
  const letra = key.length === 1 ? key.toLowerCase() : ''
  if (letra === 'a') return { tipo: 'todo' }
  if (letra === 'c') return { tipo: 'copiar' }
  return null
}

/**
 * La acción de la rejilla para esta tecla, o `null` si no es suya (y entonces el
 * llamador NO debe hacer `preventDefault`: la tecla sigue su camino).
 */
export function accionTecla(
  e: TeclaRejilla,
  plataforma: Plataforma = window.tessera.plataforma
): AccionRejilla | null {
  if (e.altKey) return null
  const sinMod = !e.ctrlKey && !e.metaKey
  const mod = esModPrincipal(e, plataforma)
  // El modificador AJENO (⌃ en Mac, ⊞ en Windows) o los dos a la vez: no es nuestro.
  if (!sinMod && !mod) return null
  const movimiento = accionMovimiento(e, mod)
  if (movimiento !== undefined) return movimiento
  if (e.key === 'Escape') return sinMod && !e.shiftKey ? { tipo: 'colapsar' } : null
  // Solo Mayús+Intro, y sin modificador principal.
  if (e.key === 'Enter') return sinMod && e.shiftKey ? { tipo: 'verValor' } : null
  return mod && !e.shiftKey ? accionLetra(e.key) : null
}

// --- La edición --------------------------------------------------------------------------

/** Un evento de teclado con lo que hace falta para la edición (tecla física y AltGr). */
export interface TeclaEdicion extends TeclaRejilla {
  /** Tecla FÍSICA (`KeyN`): NULL y Revertir van por ella (en Mac ⌥ compone la `key`). */
  readonly code?: string
  /** AltGr explícito, para los eventos sintéticos de los tests. */
  readonly altGraph?: boolean
  /** El del DOM y el de React: de él se lee AltGr. Método, para no perder el `this`. */
  getModifierState?(tecla: string): boolean
}

/** Lo que hace una tecla en una pestaña de tabla editable. */
export type AccionEdicion =
  | { tipo: 'editar' }
  | { tipo: 'editarVacia' }
  | { tipo: 'escribir'; texto: string }
  | { tipo: 'nulo' }
  | { tipo: 'revertir' }
  | { tipo: 'borrarFilas' }
  | { tipo: 'enviar' }

function hayAltGr(e: TeclaEdicion): boolean {
  return e.altGraph === true || e.getModifierState?.('AltGraph') === true
}

/** ¿Es UN carácter (un punto de código), no el nombre de una tecla ('Enter', 'Dead')? */
function esUnCaracter(key: string): boolean {
  if (key.length === 1) return key.charCodeAt(0) >= 32 && key.charCodeAt(0) !== 127
  if (key.length !== 2) return false
  const alto = key.charCodeAt(0)
  const bajo = key.charCodeAt(1)
  return alto >= 0xd800 && alto <= 0xdbff && bajo >= 0xdc00 && bajo <= 0xdfff
}

/** Ctrl+Alt+<code> en Windows y Linux (sin AltGr), ⌥⌘<code> en Mac; sin Mayús. */
function esModAlt(e: TeclaEdicion, code: string, plataforma: Plataforma): boolean {
  if (e.code !== code || e.shiftKey || !e.altKey) return false
  if (plataforma === 'mac') return e.metaKey && !e.ctrlKey
  return e.ctrlKey && !e.metaKey && !hayAltGr(e)
}

/**
 * ¿La tecla escribe un carácter que puede EMPEZAR la edición? Sin Mod; en Windows
 * Ctrl+Alt solo si es AltGr de verdad; en Mac ⌥ sí (compone).
 */
export function caracterQueEscribe(
  e: TeclaEdicion,
  plataforma: Plataforma = window.tessera.plataforma
): string | null {
  if (!esUnCaracter(e.key)) return null
  if (plataforma === 'mac') return e.metaKey || e.ctrlKey ? null : e.key
  if (e.metaKey) return null
  if (e.ctrlKey || e.altKey) {
    // Ctrl+Alt solo si es AltGr (que el SO entrega como Ctrl+Alt); Ctrl o Alt sueltos, nunca.
    return e.ctrlKey && e.altKey && hayAltGr(e) ? e.key : null
  }
  return e.key
}

/** ⌫: a secas edita con la celda vacía; ⌘⌫ SOLO en Mac borra filas (Ctrl+⌫ no borra nada). */
function accionRetroceso(e: TeclaEdicion, plataforma: Plataforma): AccionEdicion | null {
  if (e.shiftKey || e.altKey) return null
  if (!e.ctrlKey && !e.metaKey) return { tipo: 'editarVacia' }
  return plataforma === 'mac' && esModPrincipal(e, plataforma) ? { tipo: 'borrarFilas' } : null
}

/** Intro: a secas edita; con el modificador principal (sin Alt ni Mayús) envía. */
function accionIntroEdicion(e: TeclaEdicion, sinMod: boolean, plataforma: Plataforma): AccionEdicion | null {
  if (sinMod && !e.shiftKey) return { tipo: 'editar' }
  return !e.altKey && !e.shiftKey && esModPrincipal(e, plataforma) ? { tipo: 'enviar' } : null
}

/** F2, Intro, Supr y ⌫; undefined si la tecla es otra. */
function accionEdicionNombrada(e: TeclaEdicion, plataforma: Plataforma): AccionEdicion | null | undefined {
  const sinMod = !e.ctrlKey && !e.metaKey && !e.altKey
  switch (e.key) {
    case 'F2':
      return sinMod && !e.shiftKey ? { tipo: 'editar' } : null
    case 'Enter':
      return accionIntroEdicion(e, sinMod, plataforma)
    case 'Delete':
      return sinMod && !e.shiftKey ? { tipo: 'borrarFilas' } : null
    case 'Backspace':
      return accionRetroceso(e, plataforma)
  }
  return undefined
}

/**
 * La acción de EDICIÓN de la rejilla para esta tecla, o null (entonces la rejilla le
 * pregunta a `accionTecla`). Solo se consulta en una pestaña de tabla editable.
 */
export function accionEdicion(
  e: TeclaEdicion,
  plataforma: Plataforma = window.tessera.plataforma
): AccionEdicion | null {
  if (esModAlt(e, 'KeyN', plataforma)) return { tipo: 'nulo' }
  if (esModAlt(e, 'KeyZ', plataforma)) return { tipo: 'revertir' }
  const nombrada = accionEdicionNombrada(e, plataforma)
  if (nombrada !== undefined) return nombrada
  const texto = caracterQueEscribe(e, plataforma)
  return texto !== null ? { tipo: 'escribir', texto } : null
}

/** Lo que hace una tecla dentro del editor de una celda. */
export type AccionEditorCelda =
  | { tipo: 'confirmar'; mov: 'abajo' | 'arriba' | 'derecha' | 'izquierda' | 'quieto' }
  | { tipo: 'cancelar' }
  | { tipo: 'salto' }
  | { tipo: 'enviar' }
  | { tipo: 'nulo' }

/** Intro dentro del editor: Alt+Intro salto, Mod+Intro enviar, a secas confirmar. */
function accionIntroEditor(e: TeclaEdicion, mod: boolean, sinMod: boolean): AccionEditorCelda | null {
  if (e.altKey) return sinMod && !e.shiftKey ? { tipo: 'salto' } : null
  if (mod && !e.shiftKey) return { tipo: 'enviar' }
  if (!sinMod) return null
  return { tipo: 'confirmar', mov: e.shiftKey ? 'arriba' : 'abajo' }
}

/**
 * Lo que hace una tecla DENTRO del editor de una celda, o null: entonces es del campo de
 * texto (escribir, flechas, Mod+C/V/X/A/Z, Inicio/Fin). Quien llama descarta antes la
 * composición de un IME (`isComposing`): su Intro confirma la composición, no la celda.
 */
export function accionEditorCelda(
  e: TeclaEdicion,
  plataforma: Plataforma = window.tessera.plataforma
): AccionEditorCelda | null {
  if (esModAlt(e, 'KeyN', plataforma)) return { tipo: 'nulo' }
  const mod = esModPrincipal(e, plataforma)
  const sinMod = !e.ctrlKey && !e.metaKey
  switch (e.key) {
    case 'Enter':
      return accionIntroEditor(e, mod, sinMod)
    case 'Tab':
      if (!sinMod || e.altKey) return null
      return { tipo: 'confirmar', mov: e.shiftKey ? 'izquierda' : 'derecha' }
    case 'Escape':
      return sinMod && !e.altKey && !e.shiftKey ? { tipo: 'cancelar' } : null
  }
  return null
}
