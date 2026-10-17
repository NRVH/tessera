// =============================================================================
// Pruebas de `busqueda.ts`: la orden que busca el programa de un agente manual en cada shell
// (con el nombre citado, porque lo escribe el usuario) y la lectura de su salida (solo una ruta).
// Uso: node src/main/agents/manuales/test-busqueda.mts
// =============================================================================

import { ordenBuscarPrograma, rutaDeSalida } from './busqueda.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

hr('(1) La orden')
const win = ordenBuscarPrograma(`lin'ce`, 'windows')
check('Windows: Get-Command de una aplicación, citado para PowerShell', win.includes(`Get-Command 'lin''ce' -CommandType Application`), win)
const mac = ordenBuscarPrograma(`lin'ce; rm -rf ~`, 'mac')
check('POSIX: command -v citado, sin dejar escapar la orden', mac === `command -v 'lin'\\''ce; rm -rf ~'`, mac)
check('Linux igual que Mac', ordenBuscarPrograma('lince', 'linux') === `command -v 'lince'`, ordenBuscarPrograma('lince', 'linux'))

hr('(2) La salida')
check('Windows: una ruta con unidad', rutaDeSalida('C:\\Users\\x\\AppData\\Roaming\\npm\\lince.cmd\r\n', 'windows') === 'C:\\Users\\x\\AppData\\Roaming\\npm\\lince.cmd', '')
check('POSIX: una ruta absoluta', rutaDeSalida('\n/usr/local/bin/lince\n', 'mac') === '/usr/local/bin/lince', '')
check('NEGATIVO: un alias o función no es una ruta', rutaDeSalida('alias lince=…', 'linux') === null && rutaDeSalida('lince', 'mac') === null, '')
check('NEGATIVO: vacío', rutaDeSalida('', 'windows') === null, '')

const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
