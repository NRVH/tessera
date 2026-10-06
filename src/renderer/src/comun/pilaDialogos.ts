// =============================================================================
// pilaDialogos: la pila de los diálogos abiertos. Cada modal entra al montarse y sale al
// desmontarse, y solo el de la cima atiende Esc, para que un Esc no cierre un diálogo y el
// que tiene debajo. Puro (sin React ni DOM) para probarlo bajo `node`; lo usa `useDialogo`.
// Decisiones: docs/decisiones/renderer/dialogos-foco-y-teclado.md
// =============================================================================

/** Los diálogos abiertos, de abajo a arriba: el último es el que está encima. */
const pila: string[] = []

/** La cima que vio el primer manejador de cada evento; los demás manejadores del mismo evento la heredan. */
const cimaPorEvento = new WeakMap<object, string | undefined>()

function cimaActual(): string | undefined {
  return pila[pila.length - 1]
}

/** Un diálogo recién montado queda encima. Si ya estaba apilado no se duplica: sube a la cima. */
export function apilar(id: string): void {
  desapilar(id)
  pila.push(id)
}

/** Quita el diálogo de donde esté: los desmontajes no llegan siempre de arriba abajo. Un id que no está se ignora. */
export function desapilar(id: string): void {
  const i = pila.indexOf(id)
  if (i !== -1) pila.splice(i, 1)
}

/**
 * ¿Está `id` encima de todos? Con `evento`, la cima se fija en el primer manejador que lo mira
 * y los demás la heredan: quien cierra la cima desmonta su diálogo entre dos manejadores del
 * mismo evento (React vacía su cola en una microtarea), y sin esto el de debajo, si escucha
 * detrás en `window`, se vería como cima y se cerraría con ese mismo Esc.
 */
export function esCima(id: string, evento?: object): boolean {
  if (evento === undefined) return cimaActual() === id
  if (!cimaPorEvento.has(evento)) cimaPorEvento.set(evento, cimaActual())
  return cimaPorEvento.get(evento) === id
}
