// =============================================================================
// Prueba de cómo se cuenta la actividad de los agentes por SSH (npm run test:actividad-ssh): el resultado
// de cada petición en palabras del usuario (también por qué no se lanzó), la duración con su coma
// decimal y el filtro por conexión, sin caja ni tildes.
// =============================================================================

import type { SshActividad } from '../../../../shared/ssh-ipc.ts'
import { filtrarActividad, resultadoActividad, textoDuracion, textoUso } from './actividadSsh.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const e = (x: Partial<SshActividad>): SshActividad => ({ fecha: '2026-10-08T10:00:00.000Z', uso: 'run', alias: 'a', estado: 'terminada', codigo: 0, ms: 100, tope: false, ...x })

hr('1 - El resultado')
check('(1a) código 0: correcta', j(resultadoActividad(e({}))) === j({ texto: 'Correcta', tono: 'ok' }), j(resultadoActividad(e({}))))
check('(1b) otro código: lo dice', resultadoActividad(e({ codigo: 3 })).texto === 'Terminó con el código 3' && resultadoActividad(e({ codigo: 3 })).tono === 'error', resultadoActividad(e({ codigo: 3 })).texto)
check('(1c) con motivo de ssh, el motivo', resultadoActividad(e({ codigo: 255, motivo: 'ssh-autenticacion' })).texto === 'El servidor rechazó las credenciales', resultadoActividad(e({ codigo: 255, motivo: 'ssh-autenticacion' })).texto)
check('(1d) cortada por su tope', resultadoActividad(e({ codigo: null, tope: true })).texto === 'Cortada por su tiempo máximo', resultadoActividad(e({ tope: true })).texto)
const r4 = resultadoActividad(e({ estado: 'rechazada', codigo: 4, ms: null }))
const r5 = resultadoActividad(e({ estado: 'rechazada', codigo: 5, ms: null }))
check('(1e) rechazada: no se lanzó, y por qué (no disponible, huella sin confirmar)', r4.tono === 'aviso' && r4.texto.includes('no disponible para los agentes') && r5.texto.includes('Huella del servidor sin confirmar'), `${r4.texto} | ${r5.texto}`)
check('(1f) qué pidió', textoUso('run') === 'Orden remota' && textoUso('cp') === 'Copia de archivos' && textoUso('doctor') === 'Prueba de conexión', textoUso('doctor'))

hr('2 - La duración')
check('(2a) menos de 10 s con un decimal y coma', textoDuracion(400) === '0,4 s' && textoDuracion(1234) === '1,2 s', `${textoDuracion(400)} ${textoDuracion(1234)}`)
check('(2b) segundos y minutos', textoDuracion(12_400) === '12 s' && textoDuracion(185_000) === '3 min 5 s', `${textoDuracion(12_400)} ${textoDuracion(185_000)}`)
check('(2c) sin duración, vacío', textoDuracion(null) === '', 'vacío')

hr('3 - El filtro por conexión')
const lista = [e({ alias: 'Producción' }), e({ alias: 'pruebas' }), e({ alias: 'Otro' })]
check('(3a) sin caja ni tildes', j(filtrarActividad(lista, 'produccion').map((x) => x.alias)) === j(['Producción']), j(filtrarActividad(lista, 'produccion').map((x) => x.alias)))
check('(3b) vacío o solo espacios: todas', filtrarActividad(lista, '  ').length === 3, '3')
const web = [e({ alias: 'web' }), e({ alias: 'web-prod' })]
check('(3d) exacto (abierta desde una conexión): «web» no enseña «web-prod»', j(filtrarActividad(web, 'web', true).map((x) => x.alias)) === j(['web']) && filtrarActividad(web, 'web').length === 2, j(filtrarActividad(web, 'web', true).map((x) => x.alias)))
const sinFin = resultadoActividad(e({ estado: 'sinFinal', codigo: null, ms: null }))
check('(1g) sin final: en curso o interrumpida', sinFin.tono === 'aviso' && sinFin.texto.startsWith('Sin final registrado'), sinFin.texto)
check('(3c) contiene, no empieza por', j(filtrarActividad(lista, 'ue').map((x) => x.alias)) === j(['pruebas']), j(filtrarActividad(lista, 'ue').map((x) => x.alias)))

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
