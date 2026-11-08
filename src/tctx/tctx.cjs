// =============================================================================
// `tctx`: el CLI del contexto de los agentes que Tessera pone en el PATH de sus terminales y agentes nativos,
// hermano de `tdb` y `tssh`. Proceso corto con el ejecutable de Tessera bajo ELECTRON_RUN_AS_NODE: lee las
// reglas, los documentos y la configuración vigentes, deja propuestas (nunca las aplica), lee el traspaso de su
// sesión, busca en lo que se habló en el proyecto y delega tareas en las cuentas de Docker, por el puente local.
// Este archivo despacha y sale; el resto vive en `tctx*.cjs`.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md, docs/decisiones/agentes/buscar-en-el-historial.md,
// docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
'use strict'

const os = require('node:os')
const { analizar } = require('./tctxArgumentos.cjs')
const { leerTexto, plataformaDelProceso } = require('./tctxEntrada.cjs')
const { topeDe, exigirPuente, mostrar, peticionDe, textoAyuda, ejecutarDelegacion } = require('./tctxOrdenes.cjs')
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
  const texto = a.fuente ? await leerTexto(a.fuente, { plataforma: plataformaDelProceso(), cwd: process.cwd(), casa: os.homedir(), delegacion: a.sub === 'delegar' || a.sub === 'tarea' }) : ''
  const { op, campos } = peticionDe(a, texto)
  const r = await pedir(op, campos, process.env, topeDe(a))
  if (a.sub === 'delegar' || a.sub === 'tarea') return ejecutarDelegacion(a, r, pedir)
  return mostrar(a, exigirPuente(r))
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
