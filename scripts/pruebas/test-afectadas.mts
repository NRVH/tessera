// =============================================================================
// La versión propia del lock no obliga a correr todas las pruebas; cualquier otro dato o fallo sí.
// La comparación conserva las dependencias y separa los scripts de la versión del manifiesto.
// Los casos son puros: no modifican archivos ni referencias de git.
// =============================================================================
import { cambioRealDelLock, cambioFueraDeScriptsYVersion } from './afectadas.mjs'

const resultados: boolean[] = []
function hr(titulo: string): void {
  console.log('\n' + titulo)
}
function check(nombre: string, pasa: boolean): void {
  resultados.push(pasa)
  console.log(`${pasa ? 'PASS' : 'FAIL'} ${nombre}`)
}

hr('Comparación del lock')
const original = { version: '1.0.0', packages: { '': { version: '1.0.0', dependencies: { modulo: '2' } }, 'node_modules/modulo': { version: '2.0.0' } } }
const texto = JSON.stringify(original)
const siguiente = structuredClone(original)
siguiente.version = '1.1.0'
siguiente.packages[''].version = '1.1.0'
check('solo las dos versiones no exige todas', !cambioRealDelLock(texto, JSON.stringify(siguiente)))
check('el formato JSON no exige todas', !cambioRealDelLock(texto, JSON.stringify(original, null, 2)))
siguiente.packages['node_modules/modulo'].version = '3.0.0'
check('una dependencia cambiada exige todas', cambioRealDelLock(texto, JSON.stringify(siguiente)))
check('el lock anterior ilegible exige todas', cambioRealDelLock('{', texto))
check('el lock actual ilegible exige todas', cambioRealDelLock(texto, '{'))
check('el lock ausente exige todas', cambioRealDelLock(undefined, texto))
check('un JSON sin objeto exige todas', cambioRealDelLock('null', texto))
check('la comparación no modifica las entradas', JSON.stringify(original) === texto)
hr('Comparación del manifiesto')
const paquete = { version: '1.0.0', scripts: { 'test:uno': 'node uno.mts' }, dependencies: { modulo: '2' } }
check('la versión del manifiesto no arrastra lectores', !cambioFueraDeScriptsYVersion(paquete, { ...paquete, version: '1.1.0' }))
check('los scripts se dejan a su selección individual', !cambioFueraDeScriptsYVersion(paquete, { ...paquete, scripts: { 'test:uno': 'node dos.mts' } }))
check('las dependencias del manifiesto siguen contando', cambioFueraDeScriptsYVersion(paquete, { ...paquete, dependencies: { modulo: '3' } }))
check('otros datos del manifiesto siguen contando', cambioFueraDeScriptsYVersion(paquete, { ...paquete, name: 'otro' }))
hr(`VEREDICTO: ${resultados.filter(Boolean).length}/${resultados.length} PASS`)
process.exit(resultados.every(Boolean) ? 0 : 1)
