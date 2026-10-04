// =============================================================================
// Error del protocolo del trabajador de sesión: un `Error` que lleva su `ErrorTrabajador`
// (`clase`, `mensaje` y `codigo` opcional) en `e.trabajador`, que es lo que `sesion.cjs` responde
// al main. Sin dependencias; lo usan `sesion.cjs` y los adaptadores de sesión.
// Decisiones: docs/decisiones/bd/sesiones-protocolo-del-trabajador.md
// =============================================================================
'use strict'

function errorDe(clase, mensaje, codigo) {
  const e = new Error(mensaje)
  e.trabajador = { clase, mensaje }
  if (codigo) e.trabajador.codigo = codigo
  return e
}

module.exports = { errorDe }
