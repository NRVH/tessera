// =============================================================================
// Teclado, portapapeles y puntero de la rejilla de datos: traducen el evento a las
// funciones puras de `tecladoRejilla.ts` y `seleccionRejilla.ts` y a las acciones de
// `rejillaAcciones.ts`. Solo el foco en la propia rejilla es suyo: las teclas de la
// píldora, el menú o el editor viven dentro de la raíz pero no son de la rejilla.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { hayCambios } from './cambiosRejilla'
import { abrirEditor, abrirVisor, borrarSeleccion, copiar, mostrarCelda, ponerNulo, revertirSeleccion } from './rejillaAcciones'
import { clic, filaCompleta, mover, rango, todo, type Seleccion } from './seleccionRejilla'
import { accionEdicion, accionTecla, type AccionEdicion } from './tecladoRejilla'
import { anchoTotal, columnaEn, filasPorPagina } from './ventanaRejilla'
import type { Rejilla, Zona } from './rejillaTipos'

type Tecla = React.KeyboardEvent<HTMLDivElement>

function sinCelda(r: Rejilla): boolean {
  return !r.sel || r.numFilas === 0 || r.numCols === 0
}

function modoEditor(a: AccionEdicion): 'editar' | 'vaciar' | { texto: string } {
  if (a.tipo === 'editar') return 'editar'
  if (a.tipo === 'escribir') return { texto: a.texto }
  return 'vaciar'
}

/** Ejecuta una acción de edición; false si la tecla no es de la rejilla y sigue su camino. */
function ejecutarEdicion(r: Rejilla, a: AccionEdicion, e: Tecla): boolean {
  const rg = rango(r.sel)
  switch (a.tipo) {
    case 'enviar':
      if (!hayCambios(r.cambios)) return false
      e.preventDefault()
      r.edicion?.onEnviar()
      return true
    case 'editar':
    case 'editarVacia':
    case 'escribir':
      if (!r.sel || sinCelda(r)) return false
      e.preventDefault()
      abrirEditor(r, r.sel.foco, modoEditor(a), !e.repeat)
      return true
    case 'nulo':
      if (!rg) return false
      e.preventDefault()
      ponerNulo(r, rg)
      return true
    case 'revertir':
      if (!rg) return false
      e.preventDefault()
      revertirSeleccion(r)
      return true
    case 'borrarFilas':
      if (!rg) return false
      e.preventDefault()
      borrarSeleccion(r)
      return true
  }
}

/** Mover, seleccionar todo, copiar, colapsar el rango o ver el valor. */
function ejecutarTecla(r: Rejilla, e: Tecla): void {
  const a = accionTecla(e, window.tessera.plataforma)
  if (!a) return
  const { sel, setSel } = r
  const el = r.scrollRef.current
  const dimsR = {
    filas: r.numFilas,
    columnas: r.numCols,
    filasPorPagina: el ? filasPorPagina(el.clientHeight, r.props.altoFila, r.altoCab) : 1
  }
  switch (a.tipo) {
    case 'mover': {
      e.preventDefault()
      const n = mover(sel, a.mov, dimsR, a.extender)
      setSel(n)
      if (n) mostrarCelda(r, n.foco)
      return
    }
    case 'todo':
      e.preventDefault()
      setSel(todo(dimsR))
      return
    case 'copiar':
      if (!sel) return
      e.preventDefault()
      copiar(r, 'tsv')
      return
    case 'colapsar':
      // Esc sin rango que colapsar tampoco es nuestro (lo puede querer un ancestro).
      if (!sel || (sel.ancla.f === sel.foco.f && sel.ancla.c === sel.foco.c)) return
      e.preventDefault()
      setSel({ ancla: sel.foco, foco: sel.foco })
      return
    case 'verValor':
      if (!sel || sinCelda(r)) return
      e.preventDefault()
      abrirVisor(r, sel.foco)
      return
  }
}

export function alTeclear(r: Rejilla, e: Tecla): void {
  if (e.target !== e.currentTarget) return
  if (r.edicion && !e.nativeEvent.isComposing) {
    const ae = accionEdicion(e, window.tessera.plataforma)
    if (ae && ejecutarEdicion(r, ae, e)) return
  }
  ejecutarTecla(r, e)
}

/** Red para el menú Edición de macOS, que puede resolver ⌘C sin que llegue el keydown. */
export function alCopiar(r: Rejilla, e: React.ClipboardEvent<HTMLDivElement>): void {
  if (e.target !== e.currentTarget || !r.sel) return
  e.preventDefault()
  copiar(r, 'tsv')
}

/** El punto relativo a la caja de desplazamiento; null si cae en la cabecera, las barras o fuera. */
function puntoEnCaja(
  el: HTMLDivElement,
  clientX: number,
  clientY: number,
  altoCab: number,
  acotar: boolean
): { vx: number; vy: number } | null {
  const rc = el.getBoundingClientRect()
  const vx = clientX - rc.left
  const vy = clientY - rc.top
  if (acotar) {
    return { vx: Math.max(0, Math.min(el.clientWidth - 1, vx)), vy: Math.max(altoCab, Math.min(el.clientHeight - 1, vy)) }
  }
  if (vx < 0 || vy < altoCab || vx >= el.clientWidth || vy >= el.clientHeight) return null
  return { vx, vy }
}

/**
 * Qué hay bajo un punto de la pantalla. Con `acotar` (arrastre) un punto fuera de las
 * filas se lleva a la fila/columna más cercana en vez de devolver 'fuera'.
 */
export function zonaEn(r: Rejilla, clientX: number, clientY: number, acotar: boolean): Zona {
  const el = r.scrollRef.current
  const { numFilas, numCols, altoCab, anchoFijo, pref } = r
  if (!el || numFilas === 0 || numCols === 0) return { zona: 'fuera' }
  const punto = puntoEnCaja(el, clientX, clientY, altoCab, acotar)
  if (!punto) return { zona: 'fuera' }
  const { vx, vy } = punto
  let f = Math.floor((vy - altoCab + el.scrollTop) / r.props.altoFila)
  if (acotar) f = Math.max(0, Math.min(numFilas - 1, f))
  else if (f < 0 || f >= numFilas) return { zona: 'fuera' }
  if (vx < anchoFijo) return acotar ? { zona: 'celda', f, c: columnaEn(pref, el.scrollLeft) } : { zona: 'num', f }
  const x = vx - anchoFijo + el.scrollLeft
  if (!acotar && x >= anchoTotal(pref)) return { zona: 'fuera' }
  return { zona: 'celda', f, c: columnaEn(pref, x) }
}

/** Clic (o Mayús+clic) en una celda o un número de fila, y arrastre para extender. */
export function alPulsar(r: Rejilla, e: React.PointerEvent<HTMLDivElement>): void {
  if (e.button !== 0) return
  const z = zonaEn(r, e.clientX, e.clientY, false)
  if (z.zona === 'fuera') return
  // Sin el preventDefault el navegador empezaría a seleccionar TEXTO de las celdas.
  e.preventDefault()
  // Llevarse el foco a la raíz CONFIRMA un editor abierto (su `blur`).
  r.raizRef.current?.focus({ preventScroll: true })
  const dimsR = { filas: r.numFilas, columnas: r.numCols }
  const modoFilas = z.zona === 'num'
  const base: Seleccion = modoFilas
    ? filaCompleta(r.sel, z.f, dimsR, e.shiftKey)
    : clic(r.sel, { f: z.f, c: z.c }, { shift: e.shiftKey })
  r.setSel(base)
  if (!base) return
  const ancla = base.ancla
  const ultimaC = r.numCols - 1
  const setSel = r.setSel
  const alMover = (ev: PointerEvent): void => {
    const h = zonaEn(r, ev.clientX, ev.clientY, true)
    if (h.zona !== 'celda') return
    const foco = modoFilas ? { f: h.f, c: ultimaC } : { f: h.f, c: h.c }
    setSel((s) => (s && s.ancla === ancla && s.foco.f === foco.f && s.foco.c === foco.c ? s : { ancla, foco }))
  }
  const alSoltar = (): void => {
    window.removeEventListener('pointermove', alMover)
    window.removeEventListener('pointerup', alSoltar)
    window.removeEventListener('pointercancel', alSoltar)
  }
  window.addEventListener('pointermove', alMover)
  window.addEventListener('pointerup', alSoltar)
  window.addEventListener('pointercancel', alSoltar)
}

/** Doble clic en una celda: editarla (o decir por qué no se puede). */
export function alDobleClic(r: Rejilla, e: React.MouseEvent<HTMLDivElement>): void {
  if (!r.edicion || e.button !== 0) return
  const z = zonaEn(r, e.clientX, e.clientY, false)
  if (z.zona !== 'celda') return
  abrirEditor(r, { f: z.f, c: z.c }, 'editar', true)
}
