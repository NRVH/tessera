// =============================================================================
// Qué piezas se mantienen montadas aunque no se vean: las de lo último visto, con tope, para que al
// volver a una esté tal cual se dejó (el árbol de un proyecto, la lista SSH de un perfil). La lista
// va en ORDEN DE ENTRADA y no se reordena: mover el nodo de una pieza oculta haría que el navegador
// descartara su desplazamiento. Lo reciente se lleva aparte (`uso`) y solo decide cuál sale al pasar
// del tope. Puro: lo prueba `test-vivos-recientes.mts`. Decisiones: docs/decisiones/renderer/vivos-y-ocultos.md
// =============================================================================

/** Una pieza montada: su clave, y lo que haga falta para pintarla. */
export interface Vivo {
  clave: string
}

/** Una pieza con cuándo se vio por última vez (un reloj lógico, creciente). */
export interface ConUso<T extends Vivo> {
  pieza: T
  uso: number
}

/** Cuántas piezas de un tipo se mantienen montadas a la vez. */
export const MAX_VIVOS = 6

/**
 * `lista` con `vivo` como lo último visto: si ya estaba, en su sitio (con la pieza al día si
 * `mismo` dice que cambió); si no, al final, y si se pasa de `max` sale la menos reciente. La
 * MISMA lista si `vivo` ya era lo último visto y no cambió.
 */
export function conVisto<T extends Vivo>(
  lista: readonly ConUso<T>[],
  vivo: T,
  max = MAX_VIVOS,
  mismo: (a: T, b: T) => boolean = (a, b) => a.clave === b.clave
): readonly ConUso<T>[] {
  const reloj = lista.reduce((m, v) => Math.max(m, v.uso), 0)
  const i = lista.findIndex((v) => v.pieza.clave === vivo.clave)
  if (i !== -1) {
    const actual = lista[i]
    if (actual.uso === reloj && mismo(actual.pieza, vivo)) return lista
    return lista.map((v, j) => (j === i ? { pieza: vivo, uso: reloj + 1 } : v))
  }
  const conNueva = [...lista, { pieza: vivo, uso: reloj + 1 }]
  if (conNueva.length <= max) return conNueva
  const menosReciente = conNueva.reduce((a, b) => (b.uso < a.uso ? b : a))
  return conNueva.filter((v) => v !== menosReciente)
}

/** `lista` sin las piezas cuya clave ya no está en `existen`; la MISMA si no sobra ninguna. */
export function soloExistentes<T extends Vivo>(lista: readonly ConUso<T>[], existen: ReadonlySet<string>): readonly ConUso<T>[] {
  return lista.every((v) => existen.has(v.pieza.clave)) ? lista : lista.filter((v) => existen.has(v.pieza.clave))
}
