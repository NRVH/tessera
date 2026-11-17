// =============================================================================
// Prueba de la presencia (npm run test:presencia): lo que deja de verse sigue montado mientras sale y vuelve a estar
// visible si se pide antes de que termine; lo que nunca estuvo no se monta para salir. Y la lista con salida: los
// que se van se quedan en su sitio, saliendo, entre los que siguen.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { conSalientes, siguientePresencia, type Presencia } from './presencia.ts'

let pasan = 0
let total = 0
function check(nombre: string, ok: boolean): void {
  total++
  if (ok) pasan++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre}`)
}

const oculto: Presencia = { montado: false, saliendo: false }
const visible = siguientePresencia(oculto, true)
check('al mostrarse se monta, sin salida', visible.montado && !visible.saliendo)
const saliendo = siguientePresencia(visible, false)
check('al ocultarse sigue montado mientras sale', saliendo.montado && saliendo.saliendo)
check('si vuelve a mostrarse durante la salida, la salida se cancela', JSON.stringify(siguientePresencia(saliendo, true)) === JSON.stringify(visible))
check('NEGATIVO: lo que no estaba montado no se monta para salir', JSON.stringify(siguientePresencia(oculto, false)) === JSON.stringify(oculto))

const clave = (s: string): string => s
const previa = ['a', 'b', 'c'].map((elemento) => ({ elemento, saliendo: false }))
const sinB = conSalientes(previa, ['a', 'c'], clave)
check('el que se va se queda en su sitio, saliendo', JSON.stringify(sinB) === JSON.stringify([{ elemento: 'a', saliendo: false }, { elemento: 'b', saliendo: true }, { elemento: 'c', saliendo: false }]))
const conNuevo = conSalientes(sinB, ['a', 'c', 'd'], clave)
check('uno nuevo entra al final sin quitar al que sale', conNuevo.map((x) => `${x.elemento}${x.saliendo ? '-' : ''}`).join(',') === 'a,b-,c,d')
check('uno que vuelve deja de salir', conSalientes(sinB, ['a', 'b', 'c'], clave).every((x) => !x.saliendo))

console.log(`\nVEREDICTO: ${pasan}/${total} PASS`)
process.exit(pasan === total ? 0 : 1)
