// =============================================================================
// `tssh`: el CLI de las conexiones SSH del perfil que Tessera pone en el PATH de sus terminales y agentes
// nativos, hermano de `tdb`. Proceso corto con el ejecutable de Tessera bajo ELECTRON_RUN_AS_NODE: pide al
// puente local la lista o la línea de ssh/scp de un alias y la lanza; nunca ve un secreto ni pasa opciones a
// ssh. Este archivo despacha y sale; el resto vive en `tssh*.cjs`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const { analizar } = require('./tsshArgumentos.cjs')
const { ayuda } = require('./tsshAyuda.cjs')
const { cmdDoctor } = require('./tsshDoctor.cjs')
const { cmdCp, cmdLs, cmdRun } = require('./tsshOrdenes.cjs')
const { CODIGOS, ErrorTssh, aviso } = require('./tsshSalida.cjs')

/** Despacha el subcomando y resuelve con el código de salida. */
async function main(argv) {
  const a = analizar(argv)
  if (a.sub === 'help') {
    ayuda()
    return 0
  }
  if (a.sub === 'ls') return cmdLs(a)
  if (a.sub === 'run') return cmdRun(a)
  if (a.sub === 'cp') return cmdCp(a)
  if (a.sub === 'doctor') return cmdDoctor(a)
  return CODIGOS.uso
}

/** Sale cuando ya se escribió todo: con la salida canalizada, salir a secas puede cortar lo que quede. */
function salir(codigo) {
  process.exitCode = codigo
  process.stdout.write('', () => process.stderr.write('', () => process.exit(codigo)))
}

main(process.argv.slice(2)).then(salir, (e) => {
  if (e instanceof ErrorTssh) {
    aviso(e.message)
    salir(e.codigo)
    return
  }
  aviso(`fallo inesperado: ${e instanceof Error ? e.message : String(e)}`)
  salir(1)
})
