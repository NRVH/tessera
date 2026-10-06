// =============================================================================
// La selección de la lista del explorador SFTP, en lógica pura: clic suelto, Ctrl/⌘+clic (alterna),
// Mayús+clic (rango desde el ancla) y el movimiento con las flechas, con o sin Mayús. Las filas se
// identifican por nombre: dentro de una carpeta no hay dos iguales. Sin React ni DOM; se fija bajo
// `node` (`test-sftp.mts`). Sin dependencias.
// =============================================================================

/** Qué está elegido, cuál es el ancla de los rangos y cuál la fila activa (la del teclado). */
export interface SeleccionSftp {
  nombres: ReadonlySet<string>
  ancla: string | null
  activo: string | null
}

export const SELECCION_VACIA: SeleccionSftp = { nombres: new Set(), ancla: null, activo: null }

/** Los modificadores del clic, YA resueltos por plataforma (`esModPrincipal`). */
export interface ModificadoresClic {
  mod: boolean
  mayus: boolean
}

function rango(orden: readonly string[], a: string, b: string): string[] {
  const i = orden.indexOf(a)
  const j = orden.indexOf(b)
  if (i === -1 || j === -1) return [b]
  return orden.slice(Math.min(i, j), Math.max(i, j) + 1)
}

/** La selección tras un clic en `nombre`. `orden` es el de las filas tal como se ven. */
export function seleccionarConClic(sel: SeleccionSftp, orden: readonly string[], nombre: string, m: ModificadoresClic): SeleccionSftp {
  if (m.mayus) {
    const base = sel.ancla !== null && orden.includes(sel.ancla) ? sel.ancla : nombre
    const rangoElegido = rango(orden, base, nombre)
    const nombres = m.mod ? new Set([...sel.nombres, ...rangoElegido]) : new Set(rangoElegido)
    return { nombres, ancla: base, activo: nombre }
  }
  if (m.mod) {
    const nombres = new Set(sel.nombres)
    if (!nombres.delete(nombre)) nombres.add(nombre)
    return { nombres, ancla: nombre, activo: nombre }
  }
  return { nombres: new Set([nombre]), ancla: nombre, activo: nombre }
}

/** Adónde se mueve la fila activa con el teclado. */
export type Movimiento = number | 'inicio' | 'fin'

/** La selección tras mover la fila activa. Con `extender`, el rango crece desde el ancla; si no, queda solo la nueva. */
export function moverActivo(sel: SeleccionSftp, orden: readonly string[], mov: Movimiento, extender: boolean): SeleccionSftp {
  if (orden.length === 0) return SELECCION_VACIA
  const actual = sel.activo === null ? -1 : orden.indexOf(sel.activo)
  let destino: number
  if (mov === 'inicio') destino = 0
  else if (mov === 'fin') destino = orden.length - 1
  else destino = actual === -1 ? (mov > 0 ? 0 : orden.length - 1) : actual + mov
  destino = Math.min(orden.length - 1, Math.max(0, destino))
  const nombre = orden[destino]
  if (extender) return seleccionarConClic(sel, orden, nombre, { mod: false, mayus: true })
  return { nombres: new Set([nombre]), ancla: nombre, activo: nombre }
}

/** Todo elegido (Ctrl/⌘+A); la fila activa se conserva. */
export function seleccionarTodo(sel: SeleccionSftp, orden: readonly string[]): SeleccionSftp {
  if (orden.length === 0) return SELECCION_VACIA
  return { nombres: new Set(orden), ancla: orden[0], activo: sel.activo !== null && orden.includes(sel.activo) ? sel.activo : orden[0] }
}

/** Quita de la selección lo que ya no está en la lista (tras refrescar). Devuelve la MISMA si nada sobra. */
export function podarSeleccion(sel: SeleccionSftp, orden: readonly string[]): SeleccionSftp {
  const vivos = new Set(orden)
  const sobra = [...sel.nombres].some((n) => !vivos.has(n)) || (sel.activo !== null && !vivos.has(sel.activo)) || (sel.ancla !== null && !vivos.has(sel.ancla))
  if (!sobra) return sel
  return {
    nombres: new Set([...sel.nombres].filter((n) => vivos.has(n))),
    ancla: sel.ancla !== null && vivos.has(sel.ancla) ? sel.ancla : null,
    activo: sel.activo !== null && vivos.has(sel.activo) ? sel.activo : null
  }
}

/** La selección con solo esta fila, si no lo estaba ya (clic derecho sobre una fila ajena a la selección). */
export function asegurarFila(sel: SeleccionSftp, nombre: string): SeleccionSftp {
  if (sel.nombres.has(nombre)) return { ...sel, activo: nombre }
  return { nombres: new Set([nombre]), ancla: nombre, activo: nombre }
}
