#!/usr/bin/env node
// =============================================================================
// Prueba: un DIALECTO DESCONOCIDO da un error con nombre en cada entrada del léxico (npm run test:sql-dialecto-desconocido).
// (node src/shared/sql/test-sql-dialecto-desconocido.mts)
// Fija (1) `deDialecto`/`reglasDe` con los nombres heredados de `Object.prototype`, (2) cada entrada llamada por el
// camino que no mira el dialecto, (3) que la tabla de (2) está completa leyendo los `export function` de `sql/*.ts`
// que reciben un `DialectoSql`, y (4) que con los dialectos del registro ninguna lanza.
// `leerToken` recibe la FILA ya validada por su llamador, por eso no está en la tabla.
// =============================================================================

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGLAS, deDialecto, marcadorPosicional, reglasDe, type DialectoSql } from './dialectosSql.ts'
import { esParteIdent, tokenizar } from './lexicoSql.ts'
import { clasificar, esAlcanceDeLote, esInicioBloquePlsql, formatoFijadoPorTessera, permitidaEnSoloLectura } from './clasificarSql.ts'
import { crearVista } from './clasificarSqlBase.ts'
import { dividirSentencias, sentenciasAEjecutar } from './divisorSql.ts'
import { citar, citarSiHaceFalta, claveDeNombre, mismoNombre, nombreCalificado, normalizarIdent, plegarSinComillas } from './identificadoresSql.ts'
import { RESERVADAS, esReservada } from './palabrasSql.ts'
import { claveDeBind, parametrosSql } from './parametrosSql.ts'
import { offsetDeError } from './posicionErrorSql.ts'
import { plsqlConCommitEscrito } from './produccionSql.ts'
import { taparSecretosSql } from './secretosSql.ts'
import { avisoSoloLectura, avisosConSoloLectura, avisosDeSentencia } from './avisosSql.ts'
import { comparacionOriginal } from './originalesSql.ts'
import { CacheSintaxis, errorDeSintaxis, erroresDeSintaxis, sentenciasAValidar } from './sintaxisSql.ts'

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

/** El mensaje con el que lanza `f`, o null si no lanza. Un TypeError sale con su clase. */
function lanza(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof TypeError ? `TypeError: ${e.message}` : e instanceof Error ? e.message : String(e)
  }
}

const esperado = (d: unknown): string => `Dialecto desconocido: "${String(d)}".`

/** Los dialectos inventados: uno de mañana y los heredados de `Object.prototype`. */
// ('mysql' hace de dialecto desconocido: antes lo hacía 'sqlite'.)
const DESCONOCIDOS = ['mysql', 'constructor', 'toString', '__proto__', ''] as const
const DIALECTOS = Object.keys(REGLAS) as DialectoSql[]

// Datos de partida, construido con un dialecto que existe.
const SENT = dividirSentencias('SELECT 1 FROM DUAL', 'oracle')[0]
const CLS_CONSULTA = clasificar(tokenizar('SELECT 1 FROM DUAL', 'oracle'), 'oracle')

/**
 * Cada entrada exportada de `shared/sql` que recibe un dialecto, llamada por el camino que
 * MENOS lo mira. La clave es el nombre de la función: (3) la cruza con el fuente.
 */
const ENTRADAS: Readonly<Record<string, (d: DialectoSql) => unknown>> = {
  marcadorPosicional: (d) => marcadorPosicional(d, 1),
  esParteIdent: (d) => esParteIdent(65 /* A: no mira las reglas */, d),
  tokenizar: (d) => tokenizar('', d),
  esInicioBloquePlsql: (d) => esInicioBloquePlsql([], d),
  // (SQL Server.)
  esAlcanceDeLote: (d) => esAlcanceDeLote([], d),
  citar: (d) => citar('a', d),
  clasificar: (d) => clasificar([], d),
  crearVista: (d) => crearVista([], d),
  permitidaEnSoloLectura: (d) => permitidaEnSoloLectura(CLS_CONSULTA, d),
  formatoFijadoPorTessera: (d) => formatoFijadoPorTessera(CLS_CONSULTA, d),
  dividirSentencias: (d) => dividirSentencias('', d),
  sentenciasAEjecutar: (d) => sentenciasAEjecutar('', d, { tipo: 'todo' }),
  plegarSinComillas: (d) => plegarSinComillas('a', d),
  normalizarIdent: (d) => normalizarIdent('"a"', d),
  claveDeNombre: (d) => claveDeNombre('a', d),
  mismoNombre: (d) => mismoNombre('a', 'a', d),
  citarSiHaceFalta: (d) => citarSiHaceFalta('A', d),
  nombreCalificado: (d) => nombreCalificado(null, 'a', d, { siempre: true }),
  esReservada: (d) => esReservada('SELECT', d),
  claveDeBind: (d) => claveDeBind(':a', d),
  parametrosSql: (d) => parametrosSql('', d),
  offsetDeError: (d) => offsetDeError(SENT, { offsetCp: null }, d),
  plsqlConCommitEscrito: (d) => plsqlConCommitEscrito({ clase: 'consulta', texto: '' }, d),
  taparSecretosSql: (d) => taparSecretosSql('', d),
  avisosDeSentencia: (d) => avisosDeSentencia('', [], d, CLS_CONSULTA),
  avisoSoloLectura: (d) => avisoSoloLectura(SENT, d),
  avisosConSoloLectura: (d) => avisosConSoloLectura([], d, false),
  comparacionOriginal: (d) => comparacionOriginal(d, 'TEXT'),
  // La gramática local.
  sentenciasAValidar: (d) => sentenciasAValidar([], d),
  errorDeSintaxis: (d) => errorDeSintaxis('', SENT, { ok: true }, d),
  erroresDeSintaxis: (d) => erroresDeSintaxis('', [], new CacheSintaxis(), d)
}

/**
 * Las funciones exportadas de un fuente que reciben un `DialectoSql` (en cualquier
 * parámetro, con la firma partida en varias líneas o no). Lee los paréntesis contándolos,
 * así que una firma con un tipo `Pick<…> & { … }` no la corta.
 */
function entradasConDialecto(fuente: string): string[] {
  const salida: string[] = []
  const re = /export function (\w+)\s*(?:<[^>]*>)?\s*\(/g
  for (let m = re.exec(fuente); m; m = re.exec(fuente)) {
    let i = re.lastIndex
    let prof = 1
    while (prof > 0 && i < fuente.length) {
      if (fuente[i] === '(') prof++
      else if (fuente[i] === ')') prof--
      i++
    }
    if (/\bDialectoSql\b/.test(fuente.slice(re.lastIndex, i - 1))) salida.push(m[1])
  }
  return salida
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('(1) deDialecto / reglasDe')
  for (const d of DIALECTOS) {
    check(`${d}: reglasDe da la MISMA fila de REGLAS`, reglasDe(d) === REGLAS[d], '')
    check(`${d}: deDialecto(RESERVADAS) da el mismo conjunto`, deDialecto(RESERVADAS, d) === RESERVADAS[d], '')
  }
  for (const x of DESCONOCIDOS) {
    const m = lanza(() => reglasDe(x as never))
    check(`reglasDe(${JSON.stringify(x)}) lanza con nombre`, m === esperado(x), String(m))
    const r = lanza(() => deDialecto(RESERVADAS, x as never))
    check(`deDialecto(RESERVADAS, ${JSON.stringify(x)}) lanza con nombre`, r === esperado(x), String(r))
  }
  // Lo que no es una cadena, aunque su conversión a texto SÍ sea un dialecto.
  const disfrazado = { toString: (): string => 'oracle' }
  const md = lanza(() => reglasDe(disfrazado as never))
  check('un objeto cuyo toString da "oracle" no pasa', md === esperado(disfrazado), String(md))
  for (const x of [42, null, undefined]) {
    const mx = lanza(() => reglasDe(x as never))
    check(`reglasDe(${String(x)}) lanza con nombre`, mx === esperado(x), String(mx))
  }

  // ---------------------------------------------------------------------------
  hr('(2) Cada entrada del léxico lanza con nombre, también por el camino que no mira el dialecto')
  for (const [nombre, f] of Object.entries(ENTRADAS)) {
    for (const x of DESCONOCIDOS) {
      const m = lanza(() => f(x as never))
      check(`${nombre}(${JSON.stringify(x)})`, m === esperado(x), String(m))
    }
  }

  // ---------------------------------------------------------------------------
  hr('(3) La tabla de (2) está completa')
  // Autoprueba del lector.
  const inventado = [
    'export function a(x: string, d: DialectoSql): void {}',
    'export function b(\n  texto: string,\n  dialecto: DialectoSql,\n  n = 0\n): void {}',
    'export function c(s: Pick<X, "y"> & { t: string }, d: DialectoSql): boolean {}',
    'export function g<T>(tabla: Readonly<Record<DialectoSql, T>>, d: DialectoSql): T {}',
    'export function sin(x: string): DialectoSql {}',
    'function interna(d: DialectoSql): void {}',
    'export function otra(d: DialectoSqlX): void {}'
  ].join('\n')
  const leidas = entradasConDialecto(inventado)
  check('el lector ve firmas en una línea, partidas, con tipos anidados y genéricas', leidas.join(',') === 'a,b,c,g', leidas.join(','))

  const dir = dirname(fileURLToPath(import.meta.url))
  const fuentes = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.startsWith('test-'))
  const todas: string[] = []
  for (const f of fuentes) for (const e of entradasConDialecto(readFileSync(join(dir, f), 'utf8'))) todas.push(`${f}:${e}`)
  // `deDialecto` y `reglasDe` SON la validación: los prueba (1).
  const QUE_SON_LA_VALIDACION = new Set(['deDialecto', 'reglasDe'])
  const sinCubrir = todas.filter((x) => {
    const n = x.split(':')[1]
    return !QUE_SON_LA_VALIDACION.has(n) && !Object.prototype.hasOwnProperty.call(ENTRADAS, n)
  })
  check(`${todas.length} entradas con dialecto en ${fuentes.length} fuentes: todas en la tabla`, todas.length > 20 && sinCubrir.length === 0, sinCubrir.join(', ') || 'ninguna fuera')
  const sobran = Object.keys(ENTRADAS).filter((n) => !todas.some((x) => x.endsWith(':' + n)))
  check('y la tabla no tiene entradas que ya no existan', sobran.length === 0, sobran.join(', ') || 'ninguna')

  // ---------------------------------------------------------------------------
  hr('(4) Negativas: con los dialectos del registro no lanza nadie')
  for (const d of DIALECTOS) {
    const fallos = Object.entries(ENTRADAS)
      .map(([n, f]) => [n, lanza(() => f(d))] as const)
      .filter(([, m]) => m !== null)
    check(`${d}: ninguna entrada lanza`, fallos.length === 0, fallos.map(([n, m]) => `${n}: ${m}`).join(' | ') || `${Object.keys(ENTRADAS).length} entradas`)
  }

  // ---------------------------------------------------------------------------
  const pass = results.filter((r) => r.pass).length
  const allPass = pass === results.length
  console.log('\n' + '='.repeat(78))
  console.log(`VEREDICTO: ${pass}/${results.length} PASS`)
  process.exit(allPass ? 0 : 1)
}

main()
