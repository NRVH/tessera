// =============================================================================
// `tctx`: el CLI de las reglas del perfil que Tessera pone en el PATH de sus terminales y agentes nativos,
// hermano de `tdb` y `tssh`. Proceso corto con el ejecutable de Tessera bajo ELECTRON_RUN_AS_NODE: lee las
// reglas vigentes, deja una propuesta (nunca las cambia), lee el traspaso de su sesión o busca en lo que se habló
// en el proyecto, por el puente local. Este archivo despacha y sale; el resto vive en `tctx*.cjs`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md, docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================
'use strict'

const os = require('node:os')
const { analizar } = require('./tctxArgumentos.cjs')
const { leerTexto, plataformaDelProceso } = require('./tctxEntrada.cjs')
const { TOPE_BUSCAR_MS, exigirPuente, mostrar, peticionDe, textoAyuda } = require('./tctxOrdenes.cjs')
const { pedir } = require('./tctxPuente.cjs')
const { ErrorTctx, aviso, salir } = require('./tctxSalida.cjs')
const { textosTctx } = require('./textosTctx.cjs')

/** Despacha el subcomando y resuelve con el código de salida. */
async function main(argv) {
  const a = analizar(argv)
  if (a.sub === 'help') {
    process.stdout.write(textoAyuda())
    return 0
  }
  const texto = a.sub === 'proponer' ? await leerTexto(a.fuente, { plataforma: plataformaDelProceso(), cwd: process.cwd(), casa: os.homedir() }) : ''
  const { op, campos } = peticionDe(a, texto)
  return mostrar(a, exigirPuente(await pedir(op, campos, process.env, a.sub === 'buscar' ? TOPE_BUSCAR_MS : undefined)))
}

main(process.argv.slice(2)).then(salir, (e) => {
  if (e instanceof ErrorTctx) {
    aviso(e.message)
    salir(e.codigo)
    return
  }
  aviso(textosTctx().falloInesperado(e instanceof Error ? e.message : String(e)))
  salir(1)
})
