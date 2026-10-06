// =============================================================================
// Los códigos de salida propios de `tssh`, el error que los lleva y cómo se avisa: siempre por la salida de
// errores y con «tssh:» delante, para no mezclarse con la salida de la orden remota. Los mismos códigos los
// decide el main (`CODIGOS_TSSH` de `src/main/ssh/controlador/puenteTssh.ts`). Sin dependencias.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

/**
 * Códigos propios: solo salen ANTES de que corra la orden remota (o al agotar el tope). Si la orden corre,
 * el código es el suyo, y 255 si ssh no pudo conectar o entrar.
 */
const CODIGOS = Object.freeze({ uso: 2, puente: 3, alias: 4, huella: 5, noUsable: 6, tope: 124 })

/** Un fallo de `tssh` con su código de salida. */
class ErrorTssh extends Error {
  constructor(codigo, mensaje) {
    super(mensaje)
    this.codigo = codigo
  }
}

/** Un fallo de uso (código 2), con la pista de la ayuda. */
function errorDeUso(mensaje) {
  return new ErrorTssh(CODIGOS.uso, `${mensaje} La ayuda: tssh help.`)
}

/** Escribe una línea de `tssh` en la salida de errores. */
function aviso(texto) {
  process.stderr.write(`tssh: ${texto}\n`)
}

module.exports = { CODIGOS, ErrorTssh, errorDeUso, aviso }
