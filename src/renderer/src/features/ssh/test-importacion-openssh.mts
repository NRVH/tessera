#!/usr/bin/env node
// =============================================================================
// Prueba de lo puro de «Importar desde OpenSSH…» (npm run test:importacion-openssh): el formulario relleno
// con un solo `Host` y su nota, las filas de la revisión (cuáles nacen elegidas), sus problemas (nombre vacío,
// repetido o ya usado, sin usuario, puerto que no es número), el alta de cada fila y los textos.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================

import type { SshCandidataOpenSsh, SshLecturaOpenSsh } from '../../../../shared/ssh-ipc.ts'
import {
  entradaDeFila,
  filasIniciales,
  importacionEnFormulario,
  motivoSinCandidatas,
  pideSecreto,
  problemaDeFila,
  resumenImportacion,
  textoNoSeImporta,
  tituloImportadas
} from './importacionOpenSsh.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const clave = { token: 'ficha', nombre: 'id_web', tipo: 'RSA', cifrada: false }
const cand = (c: Partial<SshCandidataOpenSsh>): SshCandidataOpenSsh => ({ alias: 'web', host: '192.0.2.30', puerto: 22, usuario: 'deploy', clave: null, claveNoUsable: false, existe: false, ...c })
const lectura = (candidatas: SshCandidataOpenSsh[], extra: Partial<SshLecturaOpenSsh> = {}): SshLecturaOpenSsh => ({ archivo: 'config', candidatas, conPatrones: 0, include: 0, ...extra })

hr('(1) Un solo Host: el formulario relleno y su nota')
{
  const i = importacionEnFormulario(lectura([cand({ clave, puerto: 2222 })]))
  check(
    'con clave: método «Archivo de clave» con su ficha, puerto como texto',
    j(i.prefijo) === j({ alias: 'web', host: '192.0.2.30', puerto: '2222', usuario: 'deploy', metodo: 'clave', clave: { nombre: 'id_web', tipo: 'RSA', cifrada: false, token: 'ficha' } }),
    j(i.prefijo)
  )
  check('la nota dice de dónde salió y qué hacer', i.nota === 'Datos de «web» leídos de «config». Revisa, elige el grupo y guarda.', i.nota)
  const raro = importacionEnFormulario(lectura([cand({ existe: true, usuario: '', claveNoUsable: true })]))
  check('sin clave usable: «Claves del sistema»', raro.prefijo.metodo === 'sistema' && raro.prefijo.clave === null, j(raro.prefijo))
  check('y la nota avisa de lo que falta revisar', raro.nota.includes('ya hay una conexión con ese nombre') && raro.nota.includes('no trae el usuario') && raro.nota.includes('no se pudo usar'), raro.nota)
}

hr('(2) Varios Host: las filas y sus problemas')
{
  const l = lectura([cand({}), cand({ alias: 'existe', existe: true }), cand({ alias: 'sin', usuario: '' }), cand({ alias: 'raro', puerto: null })])
  const filas = filasIniciales(l)
  check('nacen elegidas solo las que se pueden importar tal cual', j(filas.map((f) => f.elegida)) === j([true, false, false, false]), j(filas.map((f) => [f.alias, f.elegida])))
  const existentes = ['Existe']
  check('una buena no tiene problema', problemaDeFila(filas[0], filas, existentes) === null, '')
  check('ya usada (sin distinguir mayúsculas)', problemaDeFila({ ...filas[1], elegida: true }, filas, existentes) === 'Ya hay una conexión con ese nombre.', '')
  check('sin usuario', problemaDeFila({ ...filas[2], elegida: true }, filas, existentes) === 'Falta el usuario.', '')
  check('el puerto no es número (no se puede arreglar aquí)', problemaDeFila(filas[3], filas, existentes) === 'El puerto del archivo no es un número.', '')
  check('nombre vacío', problemaDeFila({ ...filas[0], alias: '  ' }, filas, existentes) === 'Ponle un nombre.', '')
  const dos = [filas[0], { ...filas[2], elegida: true, alias: 'WEB', usuario: 'u' }]
  check('dos elegidas con el mismo nombre', problemaDeFila(dos[1], dos, existentes) === 'Hay otra con el mismo nombre.', '')
  check('resumen: una elegida y lista', j(resumenImportacion(filas, existentes)) === j({ elegidas: 1, listo: true }), j(resumenImportacion(filas, existentes)))
  check('resumen: con un problema en una elegida, no está lista', !resumenImportacion(dos, existentes).listo, '')
  check('resumen: ninguna elegida, no está lista', !resumenImportacion(filas.map((f) => ({ ...f, elegida: false })), existentes).listo, '')
}

hr('(3) El alta de una fila y los textos')
{
  const [f] = filasIniciales(lectura([cand({ clave })]))
  check(
    'con clave: método «clave» con su ficha, el grupo elegido y el nombre editado sin espacios de más',
    j(entradaDeFila({ ...f, alias: ' Web PROD ' }, 'pa', 'g1')) === j({ profileId: 'pa', alias: 'Web PROD', grupoId: 'g1', host: '192.0.2.30', puerto: 22, usuario: 'deploy', disponibleAgentes: true, metodo: 'clave', clave: { tipo: 'elegida', token: 'ficha' } }),
    j(entradaDeFila({ ...f, alias: ' Web PROD ' }, 'pa', 'g1'))
  )
  const [sinClave] = filasIniciales(lectura([cand({})]))
  check('sin clave en el archivo: nace con claves del sistema, como entra con OpenSSH', sinClave.metodo === 'sistema' && entradaDeFila(sinClave, 'pa', null).metodo === 'sistema', j(entradaDeFila(sinClave, 'pa', null)))
  const s = { ...sinClave, metodo: 'contrasena' as const }
  check('con contraseña y vacía, no viaja (la pedirá la terminal)', entradaDeFila(s, 'pa', null).metodo === 'contrasena' && !('secreto' in entradaDeFila(s, 'pa', null)), j(entradaDeFila(s, 'pa', null)))
  check('con la contraseña escrita, viaja con el alta', entradaDeFila({ ...s, secreto: 'pw ñ' }, 'pa', null).secreto === 'pw ñ', '')
  check('con claves del sistema, nunca un secreto aunque se hubiera escrito', j(entradaDeFila({ ...s, metodo: 'sistema', secreto: 'quedó' }, 'pa', null)).includes('"metodo":"sistema"') && !('secreto' in entradaDeFila({ ...s, metodo: 'sistema', secreto: 'quedó' }, 'pa', null)), '')
  const cifrada = { ...clave, cifrada: true }
  check('archivo con frase: la frase viaja con la clave', j(entradaDeFila({ ...f, clave: cifrada, secreto: 'frase' }, 'pa', null)).includes('"secreto":"frase"'), '')
  check('pideSecreto: contraseña sí; clave solo si tiene frase; sistema no', pideSecreto(s) && !pideSecreto(f) && pideSecreto({ ...f, clave: cifrada }) && !pideSecreto({ ...s, metodo: 'sistema' }), '')
  check('archivo de clave sin elegir: no se importa', problemaDeFila({ ...s, metodo: 'clave', clave: null }, [s], []) === 'Elige el archivo de clave.', '')
  check('lo que no se importa', textoNoSeImporta(lectura([], { conPatrones: 2, include: 1 })) === 'No se importa: 2 bloques con comodines o Match y 1 Include (no se siguen).', String(textoNoSeImporta(lectura([], { conPatrones: 2, include: 1 }))))
  check('sin nada que no se importe: null', textoNoSeImporta(lectura([])) === null, '')
  check('sin Host concretos: el motivo', motivoSinCandidatas(lectura([], { conPatrones: 1 })) === '«config» no tiene ningún Host concreto que importar. No se importa: 1 bloque con comodines o Match.', motivoSinCandidatas(lectura([], { conPatrones: 1 })))
  check('el aviso final', tituloImportadas(1, null) === 'Se importó 1 conexión SSH en «Sin grupo»' && tituloImportadas(3, 'Casa') === 'Se importaron 3 conexiones SSH en «Casa»', tituloImportadas(3, 'Casa'))
}

hr('RESULTADO (PASS/FAIL)')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
