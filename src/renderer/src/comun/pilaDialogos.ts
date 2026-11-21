// =============================================================================
// pilaDialogos: la pila de los diálogos abiertos, indexada por documento (`WeakMap`). Cada modal
// entra en la pila de su documento al montarse y sale al desmontarse, y solo el de la cima de esa
// ventana atiende Esc, para que un Esc no cierre un diálogo y el de debajo ni un diálogo abierto en
// una ventana bloquee a la otra. Puro (sin React ni DOM) para probarlo bajo `node`; lo usa `useDialogo`.
// Decisiones: docs/decisiones/renderer/dialogos-foco-y-teclado.md
// =============================================================================

/** Los diálogos abiertos de cada documento, de abajo a arriba: el último es el que está encima. */
const pilas = new WeakMap<object, string[]>()

/** La cima que vio el primer manejador de cada evento; los demás manejadores del mismo evento la heredan. */
const cimaPorEvento = new WeakMap<object, string | undefined>()

function pilaDe(clave: object): string[] {
  let pila = pilas.get(clave)
  if (!pila) {
    pila = []
    pilas.set(clave, pila)
  }
  return pila
}

function cimaActual(clave: object): string | undefined {
  const pila = pilas.get(clave)
  return pila && pila.length > 0 ? pila[pila.length - 1] : undefined
}

/** Un diálogo recién montado queda encima en su documento. Si ya estaba apilado no se duplica: sube a la cima. */
export function apilar(id: string, clave: object): void {
  desapilar(id, clave)
  pilaDe(clave).push(id)
}

/** ¿Hay algún diálogo abierto en ese documento? Quien se abre encima de otro lo mira antes de apilarse. */
export function hayDialogos(clave: object): boolean {
  const pila = pilas.get(clave)
  return pila !== undefined && pila.length > 0
}

/** Quita el diálogo de donde esté: los desmontajes no llegan siempre de arriba abajo. Un id que no está se ignora. */
export function desapilar(id: string, clave: object): void {
  const pila = pilas.get(clave)
  if (!pila) return
  const i = pila.indexOf(id)
  if (i !== -1) pila.splice(i, 1)
}

/**
 * ¿Está `id` encima de todos en su documento? Con `evento`, la cima se fija en el primer manejador que lo
 * mira y los demás la heredan: quien cierra la cima desmonta su diálogo entre dos manejadores del
 * mismo evento (React vacía su cola en una microtarea), y sin esto el de debajo, si escucha
 * detrás en `window`, se vería como cima y se cerraría con ese mismo Esc.
 */
export function esCima(id: string, evento: object | undefined, clave: object): boolean {
  if (evento === undefined) return cimaActual(clave) === id
  if (!cimaPorEvento.has(evento)) cimaPorEvento.set(evento, cimaActual(clave))
  return cimaPorEvento.get(evento) === id
}
