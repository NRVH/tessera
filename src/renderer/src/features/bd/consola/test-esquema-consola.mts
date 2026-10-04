#!/usr/bin/env node
// =============================================================================
// Prueba del selector de esquema de la consola (npm run test:db-consola-esquema):
// `esquemaEfectivo` (sesión > elegido > conexión), las opciones y su filtro, el índice
// inicial y el título del botón, y el texto cuando la lista es de bases.
// =============================================================================

import type { DbEsquema, DbEstadoSesion } from '../../../../../shared/db-explorador-ipc.ts'
import {
  esquemaEfectivo,
  indiceInicialEsquema,
  opcionesEsquemaConsola,
  textoEsquemaConexion,
  tituloBotonEsquema
} from './esquemaConsola.ts'

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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const esq = (nombre: string, sistema = false, pseudo = false): DbEsquema => ({
  nombre,
  sistema,
  visible: true,
  porDefecto: nombre === 'public',
  ...(pseudo ? { pseudo: true } : {})
})
// Tal como llega del main: mezclados; PUBLIC (pseudo de Oracle) incluido.
const LISTA: DbEsquema[] = [esq('information_schema', true), esq('public'), esq('pg_catalog', true), esq('ventas'), esq('PUBLIC', false, true)]

const sesion = (esquema: string | null, fase: DbEstadoSesion['fase'] = 'lista'): Pick<DbEstadoSesion, 'esquema' | 'fase'> => ({
  esquema,
  fase
})

function main(): void {
  hr('(1) esquemaEfectivo')
  check('la sesión manda (un ALTER a mano gana a lo elegido)', esquemaEfectivo(sesion('ventas'), 'public', 'public') === 'ventas', 'ventas')
  check('sin sesión: lo elegido', esquemaEfectivo(null, 'ventas', 'public') === 'ventas', 'ventas')
  check('sin sesión ni elección: el de la conexión', esquemaEfectivo(null, null, 'public') === 'public', 'public')
  check(
    'NO: una sesión cerrada o sin esquema no cuenta',
    esquemaEfectivo(sesion('viejo', 'cerrada'), 'ventas', 'public') === 'ventas' && esquemaEfectivo(sesion(null), null, 'public') === 'public',
    'ventas / public'
  )
  check('nada conocido: null', esquemaEfectivo(null, null, null) === null, 'null')

  hr('(2) opciones')
  const ops = opcionesEsquemaConsola(LISTA, 'public', null, 'public', '')
  check(
    'conexión primero; normales en su orden; sistema al final; PUBLIC fuera',
    j(ops.map((o) => o.esquema)) === j([null, 'public', 'ventas', 'information_schema', 'pg_catalog']),
    j(ops.map((o) => o.esquema))
  )
  check('la de la conexión dice cuál es', ops[0].texto === 'Esquema de la conexión (public)' && textoEsquemaConexion(null) === 'Esquema de la conexión', ops[0].texto)
  check('los del sistema van marcados como tales', ops.filter((o) => o.sistema).map((o) => o.esquema).join(',') === 'information_schema,pg_catalog', 'ok')
  check(
    'sin elegir y en el de la conexión: la vigente es «Esquema de la conexión», no la fila public',
    ops[0].actual && !ops[1].actual && ops.filter((o) => o.actual).length === 1,
    j(ops.map((o) => o.actual))
  )
  const elegida = opcionesEsquemaConsola(LISTA, 'public', 'ventas', 'ventas', '')
  check('elegido ventas: la vigente es ventas', elegida.filter((o) => o.actual).map((o) => o.esquema).join() === 'ventas', 'ventas')
  const aMano = opcionesEsquemaConsola(LISTA, 'public', null, 'ventas', '')
  check(
    'sin elegir pero la sesión en ventas (ALTER a mano): la vigente es ventas',
    aMano.filter((o) => o.actual).map((o) => o.esquema).join() === 'ventas',
    j(aMano.map((o) => [o.esquema, o.actual]))
  )
  const filtrada = opcionesEsquemaConsola(LISTA, 'public', null, 'public', 'VEN')
  check('filtro sin mayúsculas: solo ventas (la de la conexión no coincide)', j(filtrada.map((o) => o.esquema)) === j(['ventas']), j(filtrada.map((o) => o.esquema)))
  const pub = opcionesEsquemaConsola(LISTA, 'public', null, 'public', 'pub')
  check(
    'filtro que coincide con el de la conexión: la opción de la conexión sigue, PUBLIC no',
    j(pub.map((o) => o.esquema)) === j([null, 'public']),
    j(pub.map((o) => o.esquema))
  )
  check(
    'NO: sin lista (aún cargando): solo la de la conexión',
    j(opcionesEsquemaConsola(null, 'public', null, null, '').map((o) => o.esquema)) === j([null]),
    'ok'
  )
  check('NO: filtro sin coincidencias: vacío', opcionesEsquemaConsola(LISTA, 'public', null, 'public', 'zzz').length === 0, '[]')

  hr('(3) cursor inicial y título')
  check('el cursor abre en la vigente', indiceInicialEsquema(elegida) === 2, String(indiceInicialEsquema(elegida)))
  check('sin vigente a la vista (filtrada): la primera', indiceInicialEsquema(filtrada) === 0 && indiceInicialEsquema([]) === 0, '0')
  check('título del botón', tituloBotonEsquema('ventas', false) === 'Esquema: ventas. Pulsa para cambiar', tituloBotonEsquema('ventas', false))
  check(
    'mientras ejecuta: por qué está deshabilitado',
    tituloBotonEsquema('ventas', true) === 'Espera a que termine la ejecución para cambiar el esquema',
    tituloBotonEsquema('ventas', true)
  )
  check('sin esquema conocido', tituloBotonEsquema(null, false) === 'Esquema de la consola. Pulsa para cambiar', tituloBotonEsquema(null, false))

  hr('(4) SQL Server: la lista es de BASES y la primera opción lo dice')
  const bases = opcionesEsquemaConsola(LISTA, 'public', null, 'public', '', (p) => `Base de la conexión (${p ?? ''})`)
  check('la primera opción con el texto de las bases', bases[0]?.texto === 'Base de la conexión (public)' && bases[0].esquema === null, j(bases[0]))
  check('el resto, igual que con esquemas', j(bases.slice(1).map((o) => o.esquema)) === j(ops.slice(1).map((o) => o.esquema)), 'igual')
  check('sin el texto: el de siempre', ops[0]?.texto === 'Esquema de la conexión (public)', j(ops[0]))

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
