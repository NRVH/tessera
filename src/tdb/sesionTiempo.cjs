// =============================================================================
// Reloj de los trabajadores de sesión: `ahora` en milisegundos monótonos y `ms(desde)` como
// duración entera no negativa. Sin dependencias; lo usan los `sesion<Motor>.cjs` y sus piezas
// (`conjuntos`, `cursor`, `filas`).
// =============================================================================
'use strict'

function ahora() {
  return performance.now()
}

/** Milisegundos enteros transcurridos desde `desde` (un valor de `ahora()`). */
function ms(desde) {
  return Math.max(0, Math.round(ahora() - desde))
}

module.exports = { ahora, ms }
