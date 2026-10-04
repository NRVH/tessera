// =============================================================================
// Qué significa una tecla en el lateral de BD, en PURO: el gesto que toca (por reglas en
// orden, la primera que casa gana) y el destino de las teclas de navegación. Lo ejecuta
// `DbArbolTeclado.ts`. Mayús+F10 y la tecla Menú no se cancelan: generan el `contextmenu`.
// Se prueba con `node` (test-arbol-teclado.mts): imports con extensión, sin JSX ni DOM.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { esAbrirNodo, esAtajoBorrado, esModPrincipal, type TeclaAcorde } from '../../util/atajos.ts'
import { saltoNavegable, siguienteNavegable, type FilaArbol } from './filasArbolBd.ts'
import type { Plataforma } from '../../../../shared/plataforma'

/** Lo que hace falta de un evento de teclado (lo cumple el de React). */
export type TeclaArbol = TeclaAcorde

export interface ContextoTecla {
  plataforma: Plataforma
  /** Hay alguna fila (sin filas, las teclas de navegación no se usan). */
  hayFilas: boolean
  busquedaAbierta: boolean
}

/** El gesto de una tecla sobre la lista, en el orden en que se decide. */
export type GestoTecla =
  | 'menuTeclado'
  | 'abrir'
  | 'navegar'
  | 'lateral'
  | 'escape'
  | 'retroceso'
  | 'borrar'
  | 'renombrar'
  | 'copiar'
  | 'espacio'
  | 'buscar'

function sinMods(t: TeclaArbol): boolean {
  return !t.altKey && !t.ctrlKey && !t.metaKey
}

type Regla = readonly [GestoTecla, (t: TeclaArbol, c: ContextoTecla) => boolean]

// En orden: abrir va ANTES que las flechas (en Mac ⌘↓ también abre). AltGr llega como
// Ctrl+Alt y queda fuera de la búsqueda: buscar un «@» en un árbol de tablas no es real.
const REGLAS: readonly Regla[] = [
  ['menuTeclado', (t) => t.key === 'ContextMenu' || (t.key === 'F10' && t.shiftKey)],
  ['abrir', (t, c) => esAbrirNodo(t, c.plataforma)],
  ['navegar', (t, c) => c.hayFilas && esTeclaNavegacion(t)],
  ['lateral', (t) => (t.key === 'ArrowRight' || t.key === 'ArrowLeft') && sinMods(t)],
  ['escape', (t) => t.key === 'Escape'],
  // Con la búsqueda abierta, el retroceso la edita (no borra la fila seleccionada).
  ['retroceso', (t, c) => c.busquedaAbierta && t.key === 'Backspace' && sinMods(t)],
  ['borrar', (t, c) => esAtajoBorrado(t, c.plataforma)],
  ['renombrar', (t) => t.key === 'F2' && !t.shiftKey && sinMods(t)],
  ['copiar', (t, c) => esModPrincipal(t, c.plataforma) && !t.shiftKey && !t.altKey && t.key.toLowerCase() === 'c'],
  ['espacio', (t, c) => t.key === ' ' && !c.busquedaAbierta],
  ['buscar', (t) => t.key.length === 1 && sinMods(t)]
]

/** El gesto de la tecla, o null si no tiene ninguno. */
export function gestoDeTecla(t: TeclaArbol, c: ContextoTecla): GestoTecla | null {
  for (const [gesto, casa] of REGLAS) if (casa(t, c)) return gesto
  return null
}

type Salto = (filas: readonly FilaArbol[], actual: number, porPagina: () => number) => number

/** Desde dónde se cuenta al moverse en `dir` sin selección: antes de la primera o tras la última. */
function origen(filas: readonly FilaArbol[], actual: number, dir: 1 | -1): number {
  if (actual >= 0) return actual
  return dir === 1 ? -1 : filas.length
}

const flecha =
  (dir: 1 | -1): Salto =>
  (filas, actual) =>
    siguienteNavegable(filas, origen(filas, actual, dir), dir)

const pagina =
  (dir: 1 | -1): Salto =>
  (filas, actual, porPagina) =>
    saltoNavegable(filas, origen(filas, actual, dir), dir, porPagina())

const NAVEGACION: ReadonlyMap<string, Salto> = new Map<string, Salto>([
  ['ArrowDown', flecha(1)],
  ['ArrowUp', flecha(-1)],
  ['Home', (filas) => siguienteNavegable(filas, -1, 1)],
  ['End', (filas) => siguienteNavegable(filas, filas.length, -1)],
  ['PageDown', pagina(1)],
  ['PageUp', pagina(-1)]
])

/** ¿Es una tecla de navegación de la lista? Las flechas verticales, solo sin modificadores. */
export function esTeclaNavegacion(t: TeclaArbol): boolean {
  if (!NAVEGACION.has(t.key)) return false
  return !((t.key === 'ArrowDown' || t.key === 'ArrowUp') && !sinMods(t))
}

/**
 * La fila a la que lleva una tecla de navegación: su índice, -1 si no hay a dónde ir, o null
 * si la tecla no navega (o no hay filas). `porPagina` solo se pide para RePág/AvPág.
 */
export function destinoNavegacion(
  t: TeclaArbol,
  filas: readonly FilaArbol[],
  actual: number,
  porPagina: () => number
): number | null {
  if (filas.length === 0 || !esTeclaNavegacion(t)) return null
  const salto = NAVEGACION.get(t.key)
  return salto ? salto(filas, actual, porPagina) : null
}
