// =============================================================================
// Formateo de tamaños en bytes para la interfaz, compartido por los visores y el diff de
// imágenes para que un mismo archivo no pese distinto según por dónde se abra.
// Puro (sin JSX ni DOM en la cadena de imports) para que un test `.mts` lo importe.
// =============================================================================

const UNIDADES = ['KB', 'MB', 'GB', 'TB'] as const

/**
 * Tamaño legible con la escala binaria (1 KB = 1024 B), que es la que usan el
 * explorador de Windows y los propios topes del main (`50 * 1024 * 1024`).
 *
 * Por debajo de 1 KB se dan los bytes EXACTOS y sin decimales: en un icono o un
 * archivo de configuración "0,4 KB" esconde justo el dato que interesa.
 */
export function formatoBytes(n: number): string {
  if (n < 1024) return `${n} B`
  let val = n / 1024
  let i = 0
  while (val >= 1024 && i < UNIDADES.length - 1) {
    val /= 1024
    i++
  }
  // Los KB van SIN decimal (`i === 0`) a propósito: es el escalón donde "1,5 KB" no aporta
  // nada frente a "2 KB".
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${UNIDADES[i]}`
}

/**
 * La DIFERENCIA de peso entre dos revisiones, con su signo. Devuelve '' cuando no
 * hay cambio, porque un "±0 B" es ruido: si la imagen pesa lo mismo, lo que el ojo
 * tiene que buscar está en el píxel, no en la cifra.
 */
export function deltaBytes(antes: number, despues: number): string {
  const d = despues - antes
  if (d === 0) return ''
  return `${d > 0 ? '+' : '−'}${formatoBytes(Math.abs(d))}`
}
