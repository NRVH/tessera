// =============================================================================
// El teclado del lateral de BD: la lista (foco en el contenedor) y la barra de búsqueda.
// Qué gesto es cada tecla lo decide `arbolTeclado.ts` (puro); aquí, una TABLA ejecuta cada
// gesto con el contexto del render (`CtxArbol`). Mayús+F10 y la tecla Menú no se cancelan:
// se recuerdan para que el `contextmenu` que llega después abra el menú de la fila.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import type { KeyboardEvent } from 'react'
import { indicePadre } from './arbolBd'
import { accionTeclaArbol, borradoDeFila, esContenedorArbol, nombreDeFila } from './filasArbolBd'
import { destinoNavegacion, gestoDeTecla, type GestoTecla } from './arbolTeclado'
import { copiar } from './DbArbolAcciones'
import { abrirBusqueda, activarFila, cerrarBusqueda, filasPorPagina } from './DbArbolNavegacion'
import type { CtxArbol } from './DbArbolTipos'

/** Navegación común de la lista y de la barra de búsqueda. true = la tecla se usó. */
function navegar(a: CtxArbol, e: KeyboardEvent): boolean {
  const i = destinoNavegacion(e, a.d.filas, a.d.idxSel, () => filasPorPagina(a))
  if (i === null) return false
  if (i >= 0) a.e.moverA(i)
  return true
}

function abrir(a: CtxArbol, e: KeyboardEvent): void {
  e.preventDefault()
  if (!e.repeat && a.d.filaSel) activarFila(a, a.d.filaSel)
}

/** → despliega o baja, ← pliega o sube al padre (buscado en `filasBd`, mismos índices). */
function lateral(a: CtxArbol, e: KeyboardEvent): void {
  e.preventDefault()
  const { filaSel } = a.d
  if (!filaSel) return
  // Sobre una ajena, 'nada'.
  const accion = accionTeclaArbol(filaSel, e.key === 'ArrowRight' ? 'dcha' : 'izq')
  if (accion === 'expandir') a.p.onAlternarExpandido(filaSel.key, true)
  else if (accion === 'plegar') a.p.onAlternarExpandido(filaSel.key, false)
  else if (accion === 'aPadre') a.e.moverA(indicePadre(a.d.filasBd, a.d.idxSel))
}

function borrar(a: CtxArbol, e: KeyboardEvent): void {
  e.preventDefault()
  if (e.repeat || !a.d.filaSel) return
  // Conexión, consola o AJENA; el resto de filas no se borra con la tecla.
  const borrado = borradoDeFila(a.d.filaSel)
  if (borrado) a.e.setConfirmacion(borrado)
}

function espacio(a: CtxArbol, e: KeyboardEvent): void {
  e.preventDefault()
  const { filaSel } = a.d
  if (filaSel && esContenedorArbol(filaSel)) {
    a.p.onAlternarExpandido(filaSel.key, !('expandida' in filaSel && filaSel.expandida))
  }
}

const GESTOS: Record<GestoTecla, (a: CtxArbol, e: KeyboardEvent) => void> = {
  menuTeclado: (a) => {
    a.e.menuPorTeclado.current = performance.now()
  },
  abrir,
  navegar: (a, e) => {
    navegar(a, e)
    e.preventDefault()
  },
  lateral,
  escape: (a, e) => {
    if (a.e.busqueda === null) return
    e.preventDefault()
    cerrarBusqueda(a)
  },
  retroceso: (a, e) => {
    e.preventDefault()
    a.e.setBusqueda((b) => (b ?? '').slice(0, -1))
    a.e.busquedaRef.current?.focus()
  },
  borrar,
  renombrar: (a, e) => {
    const { filaSel } = a.d
    if (filaSel?.kind !== 'consola') return
    e.preventDefault()
    a.e.setRenombrando({ consola: filaSel.consola, error: null })
  },
  copiar: (a, e) => {
    if (!a.d.filaSel) return
    e.preventDefault()
    copiar(a, nombreDeFila(a.d.filaSel))
  },
  espacio,
  buscar: (a, e) => {
    e.preventDefault()
    abrirBusqueda(a, e.key)
  }
}

/** Teclas de la lista del árbol. */
export function alTeclear(a: CtxArbol, e: KeyboardEvent<HTMLDivElement>): void {
  if (e.nativeEvent.isComposing) return
  const gesto = gestoDeTecla(e, { plataforma: a.plataforma, hayFilas: a.d.filas.length > 0, busquedaAbierta: a.e.busqueda !== null })
  if (gesto !== null) GESTOS[gesto](a, e)
}

/** Teclas de la barra de búsqueda: Esc la cierra, Enter/F4 abren, y se navega sin salir de ella. */
export function alTeclearBusqueda(a: CtxArbol, e: KeyboardEvent<HTMLInputElement>): void {
  if (e.nativeEvent.isComposing) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    cerrarBusqueda(a)
    return
  }
  if (e.key === 'Enter' || e.key === 'F4') {
    e.preventDefault()
    if (!e.repeat && a.d.filaSel) activarFila(a, a.d.filaSel)
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp') {
    if (navegar(a, e)) e.preventDefault()
  }
}
