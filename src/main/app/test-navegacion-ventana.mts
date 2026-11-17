#!/usr/bin/env node
// =============================================================================
// Prueba de `navegacionPermitida` (npm run test:navegacion-ventana): con la app cargada desde disco, recargar su
// página sí y cualquier otro archivo local no, aunque sus orígenes sean los dos `null`; con el servidor de desarrollo,
// el mismo origen sí y otro no. Rutas de las tres plataformas.
// =============================================================================

import { navegacionPermitida } from './navegacionVentana.ts'

let passed = 0
let fallido = 0
function check(id: string, ok: boolean, detalle: string): void {
  if (ok) passed++
  else fallido++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detalle}`)
}

const aplicaciones = {
  windows: 'file:///C:/Users/ana/AppData/Local/Programs/Tessera/resources/app.asar/out/renderer/index.html',
  mac: 'file:///Applications/Tessera.app/Contents/Resources/app.asar/out/renderer/index.html',
  linux: 'file:///tmp/.mount_TesseraXYZ/resources/app.asar/out/renderer/index.html'
}
for (const [plataforma, app] of Object.entries(aplicaciones)) {
  check(`${plataforma}-a`, navegacionPermitida(app, app), 'recargar la propia página')
  check(`${plataforma}-b`, navegacionPermitida(app, `${app}#ajustes`) && navegacionPermitida(app, `${app}?x=1`), 'cambiar el fragmento o la consulta')
  const repo = plataforma === 'windows' ? 'file:///C:/proyectos/demo/malicioso.html' : 'file:///home/ana/proyectos/demo/malicioso.html'
  check(`${plataforma}-c`, !navegacionPermitida(app, repo), 'NEGATIVO: un HTML de un repo, aunque los dos orígenes sean «null»')
  check(`${plataforma}-d`, !navegacionPermitida(app, app.replace('index.html', 'otra.html')), 'NEGATIVO: otro archivo de la misma carpeta')
  check(`${plataforma}-e`, !navegacionPermitida(app, 'https://example.invalid/'), 'NEGATIVO: una web')
}
check('unc', !navegacionPermitida(aplicaciones.windows, 'file://servidor/compartida/index.html'), 'NEGATIVO: un archivo de un recurso de red con la misma ruta relativa')
const desarrollo = 'http://localhost:5173/'
check('dev-a', navegacionPermitida(desarrollo, 'http://localhost:5173/?t=1'), 'desarrollo: el mismo origen (HMR)')
check('dev-b', !navegacionPermitida(desarrollo, 'http://localhost:5174/'), 'NEGATIVO: desarrollo, otro puerto')
check('dev-c', !navegacionPermitida(desarrollo, 'file:///C:/proyectos/demo/malicioso.html'), 'NEGATIVO: desarrollo, un archivo local')
check('rara', !navegacionPermitida('about:blank', 'about:blank') && !navegacionPermitida(desarrollo, 'no es una url'), 'NEGATIVO: lo que no tiene origen o no se entiende')

console.log(`\nVEREDICTO: ${passed}/${passed + fallido} PASS${fallido ? ' — HAY FAIL' : ' — TODO PASS'}`)
process.exit(fallido ? 1 : 0)
