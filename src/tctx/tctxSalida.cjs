// =============================================================================
// Los códigos de salida de `tctx`, el error que los lleva y cómo se avisa: siempre por la salida de
// errores y con «tctx:» delante. Los mismos códigos los fija el main (`CODIGOS_TCTX` de
// `src/main/reglas/operacionesReglas.ts`). Solo depende de `textosTctx`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
'use strict'

const { textosTctx } = require('./textosTctx.cjs')

/** 2 uso, 3 puente (como `tdb` y `tssh`) y 4 propuesta rechazada. */
const CODIGOS = Object.freeze({ uso: 2, puente: 3, rechazo: 4 })

/** Un fallo de `tctx` con su código de salida. */
class ErrorTctx extends Error {
  constructor(codigo, mensaje) {
    super(mensaje)
    this.codigo = codigo
  }
}

/** Un fallo de uso (código 2), con la pista de la ayuda. */
function errorDeUso(mensaje) {
  return new ErrorTctx(CODIGOS.uso, textosTctx().conPistaDeAyuda(mensaje))
}

/** Escribe una línea de `tctx` en la salida de errores. */
function aviso(texto) {
  process.stderr.write(`tctx: ${texto}\n`)
}

/** Sale cuando ya se escribió todo: con la salida canalizada, salir a secas puede cortar lo que quede. */
function salir(codigo) {
  process.exitCode = codigo
  process.stdout.write('', () => process.stderr.write('', () => process.exit(codigo)))
}

module.exports = { CODIGOS, ErrorTctx, errorDeUso, aviso, salir }
