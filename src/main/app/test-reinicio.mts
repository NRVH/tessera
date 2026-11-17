// =============================================================================
// Pruebas de `reinicio.ts`: reiniciar no arrastra la bandera del instalador ni las rutas de «Abrir
// con Tessera», conserva las opciones y, en un AppImage, relanza el AppImage y no su montaje.
// Uso: node src/main/app/test-reinicio.mts
// =============================================================================

import { opcionesReinicio } from './reinicio.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}
const j = (v: unknown): string => JSON.stringify(v)

hr('(1) Empaquetada')
const tras = opcionesReinicio(['C:\\Apps\\Tessera.exe', '--updated', '--force-run'], true)
check('NEGATIVO: sin la bandera del instalador, con las demás opciones', j(tras.args) === j(['--force-run']) && tras.execPath === undefined, j(tras))
const abrirCon = opcionesReinicio(['C:\\Apps\\Tessera.exe', 'D:\\proyectos\\alfa', '--user-data-dir=X'], true)
check('NEGATIVO: sin la carpeta de «Abrir con Tessera»', j(abrirCon.args) === j(['--user-data-dir=X']), j(abrirCon))

hr('(2) En desarrollo')
const desarrollo = opcionesReinicio(['electron', '.', '--updated', '--inspect'], false)
check('conserva la carpeta de la app y quita la bandera', j(desarrollo.args) === j(['.', '--inspect']), j(desarrollo))

hr('(3) AppImage')
const opcionesImagenApp = opcionesReinicio(['/tmp/.mount_TesseXyz/tessera'], true, '/home/u/Apps/Tessera.AppImage')
check('relanza el AppImage, no el binario del montaje', opcionesImagenApp.execPath === '/home/u/Apps/Tessera.AppImage' && opcionesImagenApp.args.length === 0, j(opcionesImagenApp))

const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
