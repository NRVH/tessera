// =============================================================================
// El hueco de los botones de la ventana, que está en un lado distinto en cada sistema:
// a la derecha en Windows (Window Controls Overlay) y a la izquierda en macOS (semáforo).
// El ancho lo consume el CSS desde `env()`; este módulo marca el `<html>` con la plataforma
// y, en Mac, con `data-semaforo="oculto"` mientras el semáforo no está (pantalla completa).
// Depende de `window.tessera.plataforma` y del overlay de Chromium; el tipo `Plataforma` es de tipo.
// Decisiones: docs/decisiones/renderer/hueco-de-botones-de-ventana.md
// =============================================================================

import type { Plataforma } from '../../../shared/plataforma'

/**
 * Marca la raíz del documento con la plataforma. Se llama UNA vez, en la carga del
 * módulo de arranque, por el mismo motivo que `aplicarTema`: si esto ocurriera dentro de
 * un efecto, el primer fotograma se pintaría con el hueco en el lado equivocado.
 */
export function marcarPlataforma(): void {
  document.documentElement.dataset.plataforma = window.tessera.plataforma
}

/**
 * Lo ÚNICO que se lee del Window Controls Overlay desde producción: si está visible.
 * El tipo es local y no una declaración global a propósito (ver `e2e/tipos-wco.d.ts`):
 * no trae `getTitlebarAreaRect`, para que la medida del hueco no pueda leerse desde el
 * renderer sin que alguien lo decida a la vista.
 */
interface CapaVentana extends EventTarget {
  readonly visible: boolean
}

function capaDelNavegador(navegador: Navigator): CapaVentana | undefined {
  return (navegador as Navigator & { windowControlsOverlay?: CapaVentana }).windowControlsOverlay
}

/**
 * macOS: marca `<html data-semaforo="oculto">` mientras el semáforo NO está, que es en
 * pantalla completa. Con esa marca el CSS quita el hueco y el botón del mosaico vuelve
 * al eje del riel, igual que en Windows. Lee el estado al llamarse y luego sigue cada
 * `geometrychange`.
 *
 * Se llama UNA vez desde el arranque, junto a `marcarPlataforma`. En Windows no hace
 * nada. Los tres parámetros existen para el test: en la app van siempre por defecto, y el
 * de la plataforma sale de `window.tessera`: en el renderer no existe `process`.
 */
export function seguirSemaforo(
  plataforma: Plataforma = window.tessera.plataforma,
  capa?: CapaVentana,
  raiz: { dataset: DOMStringMap } = document.documentElement,
  navegador: Navigator = navigator
): void {
  if (plataforma !== 'mac') return
  const controles = capa ?? capaDelNavegador(navegador)
  if (!controles) return
  const aplicar = (): void => {
    if (controles.visible) delete raiz.dataset.semaforo
    else raiz.dataset.semaforo = 'oculto'
  }
  aplicar()
  controles.addEventListener('geometrychange', aplicar)
}
