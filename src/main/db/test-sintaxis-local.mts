#!/usr/bin/env node
// =============================================================================
// Prueba de la gramática local del main contra el WASM real (`npm run test:sintaxis-local`).
// Recorre el camino de la consola (dividir, elegir, validar, situar): carga perezosa y única,
// veredictos del parser (con emoji delante, `$1`, DO $$…$$), topes, petición mal formada,
// anidamiento de 10 000 niveles, excepción ajena que rompe la gramática y cesión del hilo.
// Decisiones: docs/decisiones/bd/motores-sintaxis-local.md
// =============================================================================

import { SintaxisLocal } from './sintaxisLocal.ts'
import { dividirSentencias } from '../../shared/sql/divisorSql.ts'
import {
  errorDeSintaxis,
  sentenciasAValidar,
  TOPE_TEXTO_SINTAXIS,
  TOPE_TEXTOS_SINTAXIS,
  TOPE_TOTAL_SINTAXIS,
  type VeredictoSintaxis
} from '../../shared/sql/sintaxisSql.ts'

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

async function veredictos(s: SintaxisLocal, textos: string[]): Promise<VeredictoSintaxis[] | string> {
  const r = await s.validar({ gramatica: 'postgres', textos })
  return r.ok ? r.valor : `ok:false ${r.error.motivo}: ${r.error.mensaje}`
}

/** Lo subrayado en `texto` (camino entero de la consola), una entrada por sentencia con error. */
async function subrayados(s: SintaxisLocal, texto: string): Promise<string[]> {
  const ss = sentenciasAValidar(dividirSentencias(texto, 'postgres'), 'postgres')
  const vs = await veredictos(
    s,
    ss.map((x) => x.texto)
  )
  if (typeof vs === 'string') return [vs]
  const out: string[] = []
  ss.forEach((x, i) => {
    const e = errorDeSintaxis(texto, x, vs[i], 'postgres')
    if (e) out.push(`${texto.slice(e.desde, e.hasta)}@${e.desde}`)
  })
  return out
}

async function main(): Promise<void> {
  hr('1. Carga perezosa y única')
  {
    let cargas = 0
    const real = new SintaxisLocal()
    const espia = new SintaxisLocal({
      cargarParser: async () => {
        cargas++
        const m = (await import('libpg-query')) as unknown as {
          loadModule(): Promise<void>
          parseSync(q: string): unknown
        }
        await m.loadModule()
        return m
      }
    })
    check('construir no carga', cargas === 0, `${cargas} cargas`)
    const [a, b] = await Promise.all([veredictos(espia, ['SELECT 1']), veredictos(espia, ['SELECT 2'])])
    check('dos peticiones a la vez: una carga', cargas === 1 && Array.isArray(a) && Array.isArray(b), `${cargas} cargas`)
    const t0 = performance.now()
    const r = await veredictos(real, ['SELECT 1'])
    check('la carga real responde', Array.isArray(r) && r[0]?.ok === true, `${(performance.now() - t0).toFixed(0)} ms, ${JSON.stringify(r)}`)
  }
  {
    // Sin reintento: la librería real no se puede recargar (ver la cabecera de sintaxisLocal).
    let intentos = 0
    const logs: string[] = []
    const s = new SintaxisLocal({
      log: (l) => logs.push(l),
      cargarParser: async () => {
        intentos++
        throw new Error('no compila')
      }
    })
    const r1 = await s.validar({ gramatica: 'postgres', textos: ['SELECT 1'] })
    const r2 = await s.validar({ gramatica: 'postgres', textos: ['SELECT 1'] })
    const r3 = await s.validar({ gramatica: 'postgres', textos: ['SELECT 1'] })
    check(
      'un fallo de carga: ok:false, UN intento y UNA línea de log',
      !r1.ok && !r2.ok && !r3.ok && intentos === 1 && logs.length === 1,
      `${intentos} intentos, ${logs.length} líneas de log`
    )
  }

  const s = new SintaxisLocal()

  hr('2. Veredictos del parser real')
  {
    const vs = await veredictos(s, ['SELECT 1', 'SELEC 1', 'SELECT * FROM t WHERE', "SELECT 'áéí😀' FROM t WHERE a = = 1"])
    const ok = Array.isArray(vs)
    check('válida', ok && vs[0]?.ok === true, JSON.stringify(ok && vs[0]))
    check('error con posición', ok && vs[1]?.ok === false && vs[1].offsetCp === 0 && vs[1].mensaje === 'syntax error at or near "SELEC"', JSON.stringify(ok && vs[1]))
    check('fin de la entrada', ok && vs[2]?.ok === false && vs[2].mensaje === 'syntax error at end of input' && vs[2].offsetCp === 21, JSON.stringify(ok && vs[2]))
    check('con emoji: PUNTOS DE CÓDIGO (31, no 32)', ok && vs[3]?.ok === false && vs[3].offsetCp === 31, JSON.stringify(ok && vs[3]))
  }
  {
    const validas = [
      'SELECT $1::int',
      'DO $$ BEGIN RAISE NOTICE $q$;$q$; END $$',
      'CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END',
      'COPY t FROM STDIN',
      'SELECT 1 -- comentario',
      'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 3) SELECT * FROM r',
      "SELECT jsonb_path_query('{}'::jsonb, '$.a') FROM t FOR UPDATE SKIP LOCKED",
      'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET v = s.v WHEN NOT MATCHED THEN INSERT (id, v) VALUES (s.id, s.v)',
      "SELECT E'\\x41', U&'d\\0061t\\+000061'",
      'EXPLAIN (ANALYZE, BUFFERS) SELECT 1'
    ]
    const vs = await veredictos(s, validas)
    const malas = Array.isArray(vs) ? validas.filter((_, i) => vs[i]?.ok !== true) : [String(vs)]
    check('lo válido no se marca (10 casos)', malas.length === 0, malas.length === 0 ? 'ninguna marcada' : JSON.stringify(malas))
  }

  hr('3. Camino entero de la consola: divisor → gramática → subrayado')
  {
    const t = 'SELECT 1;\n\\dt\nSELEC 2;\nSELECT a FROM t WHERE;\nSELECT 😀 FROM t WHERE a = = 1;\nSELECT 3'
    const got = await subrayados(s, t)
    const esperado = [`SELEC@${t.indexOf('SELEC 2')}`, `WHERE@${t.indexOf('WHERE;')}`, `=@${t.lastIndexOf('= 1')}`]
    check('un error por sentencia, en su sitio; `\\dt` no se valida', JSON.stringify(got) === JSON.stringify(esperado), JSON.stringify(got))
  }

  hr('4. Topes y peticiones mal formadas (nunca lanza)')
  {
    const r1 = await s.validar({ gramatica: 'oracle', textos: ['SELECT 1'] })
    const r2 = await s.validar({ gramatica: 'postgres', textos: 'SELECT 1' })
    const r3 = await s.validar(null)
    const r4 = await s.validar({ gramatica: 'postgres', textos: [1] })
    check('gramática desconocida, textos no lista, null, no-string: ok:false', !r1.ok && !r2.ok && !r3.ok && !r4.ok, [r1, r2, r3, r4].map((r) => (r.ok ? 'ok' : r.error.motivo)).join(','))
    const r5 = await s.validar({ gramatica: 'postgres', textos: new Array(TOPE_TEXTOS_SINTAXIS + 1).fill('SELECT 1') })
    check('demasiados textos: limite', !r5.ok && r5.error.motivo === 'limite', r5.ok ? 'ok' : r5.error.motivo)
    const trozo = 'x'.repeat(TOPE_TEXTO_SINTAXIS)
    const r6 = await s.validar({ gramatica: 'postgres', textos: new Array(Math.ceil(TOPE_TOTAL_SINTAXIS / TOPE_TEXTO_SINTAXIS) + 1).fill(trozo) })
    check('demasiado texto en total: limite', !r6.ok && r6.error.motivo === 'limite', r6.ok ? 'ok' : r6.error.motivo)
    const vs = await veredictos(s, ['SELECT ' + '1,'.repeat(TOPE_TEXTO_SINTAXIS / 2) + '1', '', 'SELECT 1'])
    check('una sentencia de más del tope: null; vacía: ok', Array.isArray(vs) && vs[0] === null && vs[1]?.ok === true && vs[2]?.ok === true, JSON.stringify(vs).slice(0, 80))
  }

  hr('5. Límites del parser real')
  {
    const q = 'SELECT ' + '('.repeat(10000) + '1' + ')'.repeat(10000)
    const vs = await veredictos(s, [q, 'SELECT 1'])
    check(
      'anidamiento de 10 000: su error, y el módulo sigue vivo',
      Array.isArray(vs) && vs[0]?.ok === false && /memory exhausted/.test(vs[0].mensaje) && vs[1]?.ok === true,
      JSON.stringify(Array.isArray(vs) ? vs.map((v) => (v === null ? null : v.ok ? 'ok' : v.mensaje)) : vs)
    )
  }
  {
    const roto = new SintaxisLocal({
      cargarParser: async () => ({
        loadModule: async () => undefined,
        parseSync: () => {
          throw new Error('Aborted(RuntimeError: unreachable)')
        }
      })
    })
    const r1 = await roto.validar({ gramatica: 'postgres', textos: ['SELECT 1', 'SELECT 2'] })
    const r2 = await roto.validar({ gramatica: 'postgres', textos: ['SELECT 1'] })
    check(
      'una excepción ajena al parser: null, y la gramática queda rota',
      r1.ok && r1.valor[0] === null && r1.valor[1] === null && !r2.ok,
      `${JSON.stringify(r1.ok ? r1.valor : r1.error)} / ${r2.ok ? 'ok' : r2.error.mensaje}`
    )
  }

  {
    // Un `Error` corriente de la librería es de ESE texto: los demás siguen validándose.
    const s2 = new SintaxisLocal({
      cargarParser: async () => ({
        loadModule: async () => undefined,
        parseSync: (q: string) => {
          if (q === 'RARA') throw new Error('No parse tree generated')
          return {}
        }
      })
    })
    const r1 = await s2.validar({ gramatica: 'postgres', textos: ['RARA', 'SELECT 1'] })
    const r2 = await s2.validar({ gramatica: 'postgres', textos: ['SELECT 2'] })
    check(
      'un Error de un texto: null para él, y la gramática sigue viva',
      r1.ok && r1.valor[0] === null && r1.valor[1]?.ok === true && r2.ok && r2.valor[0]?.ok === true,
      `${JSON.stringify(r1.ok ? r1.valor : r1.error)} / ${r2.ok ? 'ok' : r2.error.mensaje}`
    )
  }

  hr('6. Cede el hilo en un lote grande')
  {
    const una = "SELECT a.id, count(*) FROM clientes a JOIN pedidos b ON b.cliente = a.id WHERE a.alta > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC LIMIT 50"
    const lote = new Array(TOPE_TEXTOS_SINTAXIS).fill(0).map((_, i) => `${una} OFFSET ${i}`)
    let corrio = false
    setImmediate(() => {
      corrio = true
    })
    let corrioAntes = false
    const t0 = performance.now()
    const p = s.validar({ gramatica: 'postgres', textos: lote }).then((r) => {
      corrioAntes = corrio
      return r
    })
    const r = await p
    const ms = performance.now() - t0
    check(
      `${TOPE_TEXTOS_SINTAXIS} sentencias: todas válidas y un setImmediate corre en medio`,
      r.ok && r.valor.every((v) => v?.ok === true) && corrioAntes,
      `${ms.toFixed(0)} ms; setImmediate antes del fin: ${corrioAntes}`
    )
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

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
