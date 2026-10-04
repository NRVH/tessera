#!/usr/bin/env node
// =============================================================================
// Prueba de la VALIDACIÓN GRAMATICAL LOCAL, lado puro (npm run test:sql-sintaxis).
// (node src/shared/sql/test-sql-sintaxis.mts)
// Qué sentencias se piden, cómo se traduce el mensaje, dónde se subraya (con emoji y CRLF) y la caché por texto, sin
// cargar el parser: los veredictos van escritos a mano y se contrastan con el parser real en `main/db/test-sintaxis-local.mts`.
// =============================================================================

import { dividirSentencias, type Sentencia } from './divisorSql.ts'
import { REGLAS, type DialectoSql } from './dialectosSql.ts'
import {
  CacheSintaxis,
  errorDeSintaxis,
  erroresDeSintaxis,
  fuenteSintaxis,
  loteDeSintaxis,
  MAX_SENTENCIAS_SINTAXIS,
  mensajeSintaxis,
  pendientesDeSintaxis,
  sentenciasAValidar,
  TOPE_TEXTO_SINTAXIS,
  TOPE_TEXTOS_SINTAXIS,
  TOPE_TOTAL_SINTAXIS,
  type VeredictoSintaxis
} from './sintaxisSql.ts'
import { MOTORES } from '../motores/index.ts'

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

const PG: DialectoSql = 'postgres'

function textos(ss: readonly Sentencia[]): string[] {
  return ss.map((s) => s.texto)
}

/** El texto subrayado por el veredicto `v` de la sentencia `i` de `texto`. */
function subrayado(texto: string, i: number, v: VeredictoSintaxis): string | null {
  const ss = dividirSentencias(texto, PG)
  const e = errorDeSintaxis(texto, ss[i], v, PG)
  return e ? texto.slice(e.desde, e.hasta) : null
}

function main(): void {
  hr('1. Qué dialectos tienen gramática local (la TABLA, no un «¿es PG?»)')
  const conGramatica = (Object.keys(REGLAS) as DialectoSql[]).filter((d) => REGLAS[d].gramaticaLocal !== null)
  check('solo PG tiene gramática local', conGramatica.join(',') === 'postgres', conGramatica.join(','))
  for (const d of Object.keys(REGLAS) as DialectoSql[]) {
    if (REGLAS[d].gramaticaLocal !== null) continue
    const n = sentenciasAValidar(dividirSentencias('SELEC 1;\nSELECT 2', d), d).length
    check(`${d}: no pide nada`, n === 0, `${n} sentencias`)
  }
  check(
    'la fuente del marcador sale del registro',
    fuenteSintaxis('postgres') === `gramática de ${MOTORES.postgres.etiqueta}, sin ejecutar`,
    fuenteSintaxis('postgres')
  )

  hr('2. Qué sentencias se piden')
  {
    const t = 'SELECT 1;\n\\dt\nSELEC 2;\n  ;\nSELECT 3'
    const a = textos(sentenciasAValidar(dividirSentencias(t, PG), PG))
    check('sin el comando del cliente ni la vacía', JSON.stringify(a) === JSON.stringify(['SELECT 1', 'SELEC 2', 'SELECT 3']), JSON.stringify(a))
  }
  {
    const casos: Array<[string, string]> = [
      ["SELECT 'sin cerrar", 'cadena sin cerrar'],
      ['SELECT 1 /* sin cerrar', 'comentario sin cerrar'],
      ['SELECT (1', 'paréntesis de menos'],
      ['SELECT 1)', 'paréntesis de más'],
      ['SELECT 1\nSELECT 2', '¿falta ;?']
    ]
    for (const [t, que] of casos) {
      const ss = dividirSentencias(t, PG)
      const a = sentenciasAValidar(ss, PG)
      const avisos = ss.flatMap((s) => s.avisos.map((x) => x.tipo))
      check(`${que}: lo explica el aviso léxico, no se pide`, a.length === 0 && avisos.length > 0, `avisos ${avisos.join(',')}; pedidas ${a.length}`)
    }
  }
  {
    const grande = 'SELECT ' + '1,'.repeat(TOPE_TEXTO_SINTAXIS / 2) + '1'
    const a = sentenciasAValidar(dividirSentencias(grande, PG), PG)
    check('una sentencia de más del tope no se pide', a.length === 0, `${grande.length} caracteres`)
  }
  {
    const t = 'DO $$ BEGIN RAISE NOTICE $q$;$q$; END $$;\nCREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;\nSELECT $1::int'
    const a = sentenciasAValidar(dividirSentencias(t, PG), PG)
    check('DO $$…$$, BEGIN ATOMIC y $1: una sentencia cada uno, todas se piden', a.length === 3, JSON.stringify(textos(a)))
  }

  hr('3. Mensajes')
  const m: Array<[string, string]> = [
    ['syntax error at or near "SELEC"', 'Error de sintaxis cerca de «SELEC».'],
    ['syntax error at end of input', 'La sentencia está incompleta: se acaba antes de lo que pide la gramática.'],
    ['memory exhausted at or near "("', 'Anidamiento demasiado profundo cerca de «(».'],
    ['invalid Unicode escape value', 'Error de sintaxis: invalid Unicode escape value'],
    ['syntax error at or near """', 'Error de sintaxis cerca de «"».']
  ]
  for (const [crudo, esperado] of m) check(`«${crudo}»`, mensajeSintaxis(crudo) === esperado, mensajeSintaxis(crudo))

  hr('4. Dónde se subraya')
  const err = (mensaje: string, offsetCp: number): VeredictoSintaxis => ({ ok: false, mensaje, offsetCp })
  check('el token de la posición', subrayado('SELEC 1', 0, err('syntax error at or near "SELEC"', 0)) === 'SELEC', String(subrayado('SELEC 1', 0, err('x', 0))))
  {
    const t = 'SELECT * FROM t WHERE'
    const s = subrayado(t, 0, err('syntax error at end of input', 21))
    check('al final: el último token', s === 'WHERE', String(s))
  }
  {
    // Medido: con 'áéí😀' delante, libpg_query da 31 (puntos de código) para el segundo «=».
    const t = "SELECT 'áéí😀' FROM t WHERE a = = 1"
    const s0 = errorDeSintaxis(t, dividirSentencias(t, PG)[0], err('syntax error at or near "="', 31), PG)
    const esperado = t.lastIndexOf('= 1')
    check('con emoji delante: puntos de código a UTF-16', !!s0 && s0.desde === esperado && t.slice(s0.desde, s0.hasta) === '=', `${s0 && s0.desde} (esperado ${esperado})`)
  }
  {
    // La segunda sentencia: el offset es relativo a SU texto; el subrayado, en el modelo.
    const t = 'SELECT 1;\r\n\r\nSELECT a FROM t WHERE b = = 2;'
    const s = subrayado(t, 1, err('syntax error at or near "="', 25))
    const ss = dividirSentencias(t, PG)
    const e = errorDeSintaxis(t, ss[1], err('x', 25), PG)
    check('segunda sentencia tras CRLF: en su sitio del modelo', s === '=' && !!e && e.desde === t.lastIndexOf('= 2'), `«${s}» en ${e && e.desde}`)
  }
  {
    // Una posición que cae en un blanco se va al token siguiente.
    const t = 'SELECT 1 FROM   WHERE x'
    const s = subrayado(t, 0, err('syntax error at or near "WHERE"', 14))
    check('posición en un blanco: el token siguiente', s === 'WHERE', String(s))
  }
  check('un ok no subraya', subrayado('SELECT 1', 0, { ok: true }) === null, 'null')
  check('un null no subraya', subrayado('SELECT 1', 0, null) === null, 'null')

  hr('5. Caché y pendientes')
  {
    const c = new CacheSintaxis(3)
    c.guardar('a', { ok: true })
    c.guardar('b', { ok: true })
    c.guardar('c', { ok: true })
    c.de('a') // refresca «a»
    c.guardar('d', { ok: true }) // echa a «b», el menos usado
    check('LRU: echa el menos usado', c.de('b') === undefined && c.de('a') !== undefined && c.tamano === 3, `tamaño ${c.tamano}`)
    c.guardar('e', null)
    check('un null no se guarda (se vuelve a pedir)', c.de('e') === undefined, 'undefined')
  }
  {
    const t = 'SELECT 1;\nSELEC 2;\nSELECT 1;\nSELECT 3'
    const a = sentenciasAValidar(dividirSentencias(t, PG), PG)
    const c = new CacheSintaxis()
    const p1 = pendientesDeSintaxis(a, c)
    check('pendientes sin repetir', JSON.stringify(p1) === JSON.stringify(['SELECT 1', 'SELEC 2', 'SELECT 3']), JSON.stringify(p1))
    c.guardar('SELECT 1', { ok: true })
    c.guardar('SELEC 2', err('syntax error at or near "SELEC"', 0))
    const p2 = pendientesDeSintaxis(a, c)
    check('lo sabido no se vuelve a pedir', JSON.stringify(p2) === JSON.stringify(['SELECT 3']), JSON.stringify(p2))
    const es = erroresDeSintaxis(t, a, c, PG)
    check('errores: solo los sabidos, en su sitio', es.length === 1 && t.slice(es[0].desde, es[0].hasta) === 'SELEC', JSON.stringify(es))
  }

  hr('6. Lotes que caben en una petición')
  {
    const muchos = new Array(TOPE_TEXTOS_SINTAXIS + 500).fill(0).map((_, i) => `SELECT ${i}`)
    const l1 = loteDeSintaxis(muchos)
    check('por número: el tope de textos', l1.length === TOPE_TEXTOS_SINTAXIS && l1[0] === 'SELECT 0', `${l1.length}`)
    const grandes = new Array(40).fill('x'.repeat(TOPE_TEXTO_SINTAXIS))
    const l2 = loteDeSintaxis(grandes)
    const suma = l2.reduce((a, t) => a + t.length, 0)
    check('por tamaño: no pasa del total', l2.length > 0 && suma <= TOPE_TOTAL_SINTAXIS && l2.length < 40, `${l2.length} textos, ${suma}`)
    check('lo que cabe va entero', loteDeSintaxis(['a', 'b']).length === 2, '2')
  }

  hr('7. Lotes sucesivos TERMINAN (la caché echaba al lote anterior)')
  for (const n of [2500, 5000, 12_000]) {
    const t = new Array(n).fill(0).map((_, i) => `INSERT INTO t VALUES (${i});`).join('\n')
    const a = sentenciasAValidar(dividirSentencias(t, PG), PG)
    const c = new CacheSintaxis()
    let pausas = 0
    // Lo que hace el validador: pedir un lote, guardarlo y volver a programarse si quedan.
    for (; pausas < 50; pausas++) {
      const lote = loteDeSintaxis(pendientesDeSintaxis(a, c))
      if (lote.length === 0) break
      for (const x of lote) c.guardar(x, { ok: true })
    }
    const esperado = Math.ceil(Math.min(n, MAX_SENTENCIAS_SINTAXIS) / TOPE_TEXTOS_SINTAXIS)
    check(
      `${n} sentencias distintas: acaba en ${esperado} pausas, sin volver a pedir`,
      pausas === esperado && a.length === Math.min(n, MAX_SENTENCIAS_SINTAXIS),
      `${pausas} pausas, ${a.length} validadas, caché ${c.tamano}`
    )
  }
  {
    const c = new CacheSintaxis(100, 1000)
    for (let i = 0; i < 10; i++) c.guardar(String(i).repeat(300), { ok: true })
    check('tope de caracteres: echa las versiones viejas', c.tamano === 3 && c.de('9'.repeat(300)) !== undefined, `tamaño ${c.tamano}`)
  }

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
