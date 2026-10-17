// =============================================================================
// La ayuda de `tssh`: el vocabulario, el lado remoto de una copia, los códigos de salida y lo que cambia
// según el shell. Es la que remiten el aviso de arranque del agente y el `CLAUDE.md` del agente de la
// terminal. El texto vive en `textosTssh.cjs`; lo usa `tssh.cjs`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const { CODIGOS } = require('./tsshSalida.cjs')
const { textosTssh } = require('./textosTssh.cjs')

/** El texto de la ayuda, con los códigos de salida de verdad. */
function textoAyuda() {
  return textosTssh().ayuda(CODIGOS)
}

/** Escribe la ayuda. */
function ayuda() {
  process.stdout.write(textoAyuda())
}

module.exports = { ayuda, textoAyuda }
