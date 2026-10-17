// =============================================================================
// Pruebas de `rutaCopiaSistema.ts`: qué copia que llega del sistema se abre. Un archivo local sí;
// en Windows, una ruta de red o de dispositivo no, en cualquiera de sus formas; en POSIX `//x` es
// una ruta local más; y algo que no es un archivo regular, en ninguna plataforma.
// Uso: node src/main/configuracion/test-ruta-copia-sistema.mts
// =============================================================================

import { copiaDelSistemaAceptable, esRutaRemotaWindows } from './rutaCopiaSistema.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

hr('(1) Windows')
const locales = ['C:\\Users\\ana\\copia.tessera', 'D:/copias/copia.tessera', '\\\\?\\C:\\Users\\ana\\copia.tessera']
for (const r of locales) check(`local se abre: ${r}`, copiaDelSistemaAceptable(r, true, 'windows'), String(esRutaRemotaWindows(r)))
const remotas = [
  '\\\\servidor\\recurso\\copia.tessera',
  '//servidor/recurso/copia.tessera',
  '\\\\?\\UNC\\servidor\\recurso\\copia.tessera',
  '\\\\.\\pipe\\algo',
  '\\\\?\\GLOBALROOT\\Device\\algo',
  '\\??\\C:\\copia.tessera'
]
for (const r of remotas) check(`red o dispositivo se rechaza: ${r}`, !copiaDelSistemaAceptable(r, true, 'windows'), String(esRutaRemotaWindows(r)))

hr('(2) POSIX')
for (const p of ['mac', 'linux'] as const) {
  check(`${p}: local se abre`, copiaDelSistemaAceptable('/home/ana/copia.tessera', true, p), '')
  check(`${p}: //x no es UNC`, copiaDelSistemaAceptable('//srv/copia.tessera', true, p), '')
}

hr('(3) No es un archivo regular (FIFO, dispositivo, carpeta)')
for (const p of ['windows', 'mac', 'linux'] as const) {
  check(`${p}: se rechaza`, !copiaDelSistemaAceptable(p === 'windows' ? 'C:\\copia.tessera' : '/tmp/copia.tessera', false, p), '')
}

const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
