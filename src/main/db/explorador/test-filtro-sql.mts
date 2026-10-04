#!/usr/bin/env node
// =============================================================================
// Prueba del compilador puro del filtro guiado a SQL (filtroSql.ts), sin electron ni disco: los
// cuatro dialectos van como parámetro. Fija la forma del SQL y de los parámetros: marcadores,
// una condición por línea con sus rangos, LIKE con ESCAPE, números y fechas por dialecto,
// booleanos, unión, filtros inválidos con su índice y el orden de la cabecera.
// Decisiones: docs/decisiones/bd/rejilla-filtro-guiado-sql.md
// =============================================================================

import {
  compilarFiltro,
  compilarOrden,
  escaparLike,
  esErrorFiltro,
  partirNumero,
  type ErrorFiltroSql,
  type FiltroCompilado
} from './filtroSql.ts'
import type { DbCondicionFiltro, DbFiltroGuiado } from '../../../shared/filtroGuiado.ts'
import type { DialectoSql } from '../../../shared/sql/dialectosSql.ts'

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

const J = (v: unknown): string => JSON.stringify(v)

const DIALECTOS: DialectoSql[] = ['oracle', 'postgres', 'sqlserver', 'sqlite']

function filtro(condiciones: DbCondicionFiltro[], union: DbFiltroGuiado['union'] = 'todas'): DbFiltroGuiado {
  return { union, condiciones }
}

function ok(d: DialectoSql, f: DbFiltroGuiado): FiltroCompilado {
  const r = compilarFiltro(d, f)
  if (r === null) throw new Error('se esperaba un filtro y llegó null')
  if (esErrorFiltro(r)) throw new Error('se esperaba un filtro y llegó error: ' + r.mensaje)
  return r
}

function mal(d: DialectoSql, f: unknown): ErrorFiltroSql | null {
  const r = compilarFiltro(d, f)
  return r !== null && esErrorFiltro(r) ? r : null
}

/** Una condición sola: su SQL y sus valores (los nombrados de Oracle, como lista en orden). */
function una(d: DialectoSql, c: DbCondicionFiltro): { sql: string; v: unknown[] } {
  const r = ok(d, filtro([c]))
  return { sql: r.sql, v: r.nombrados ? Object.values(r.nombrados) : r.valores }
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('(1) Marcadores por dialecto')
  {
    const f = filtro([
      { columna: 'A', categoria: 'texto', operador: 'igual', valor: 'x' },
      { columna: 'B', categoria: 'texto', operador: 'igual', valor: 'y' }
    ])
    const o = ok('oracle', f)
    check('Oracle: `:f1`, `:f2` por nombre, sin posicionales', o.sql === '"A" = :f1\nAND "B" = :f2' && J(o.nombrados) === '{"f1":{"entrada":"char","valor":"x"},"f2":{"entrada":"char","valor":"y"}}' && o.valores.length === 0, J(o))
    const p = ok('postgres', f)
    check('PG: `$1`, `$2`', p.sql === '"A" = $1\nAND "B" = $2' && J(p.valores) === '["x","y"]' && p.nombrados === null, J(p))
    const s = ok('sqlserver', f)
    check('SQL Server: `@p1`, `@p2`', s.sql === '"A" = @p1\nAND "B" = @p2' && J(s.valores) === '["x","y"]', J(s))
    const q = ok('sqlite', f)
    check('SQLite: `?1`, `?2`', q.sql === '"A" = ?1\nAND "B" = ?2' && J(q.valores) === '["x","y"]', J(q))
  }

  // ---------------------------------------------------------------------------
  hr('(2) Una condición por línea y sus rangos')
  {
    const f = filtro([
      { columna: 'A', categoria: 'texto', operador: 'vacio' },
      { columna: 'B', categoria: 'numero', operador: 'distinto', valor: '3' },
      { columna: 'C', categoria: 'fecha', operador: 'igual', valor: '2026-09-28' }
    ])
    for (const d of DIALECTOS) {
      const r = ok(d, f)
      const lineas = r.sql.split('\n')
      const cortes = r.rangos.map(([a, b]) => r.sql.slice(a, b))
      check(`${d}: cada rango es su línea entera`, J(cortes) === J(lineas) && lineas.length === 3, J(cortes))
    }
    const r = ok('postgres', f)
    check('la unión va DELANTE desde la segunda', r.sql.split('\n')[1].startsWith('AND (') && r.sql.split('\n')[2].startsWith('AND ('), r.sql)
    check('cada condición compuesta, entre paréntesis', /^AND \("B" IS NULL OR "B" <> CAST\(\$1 AS bigint\)\)$/.test(r.sql.split('\n')[1]), r.sql)
    const raro = ok('oracle', filtro([{ columna: 'Mi "col"', categoria: 'texto', operador: 'igual', valor: 'x' }]))
    check('la columna va citada duplicando `"`', raro.sql === '"Mi ""col""" = :f1', raro.sql)
  }

  // ---------------------------------------------------------------------------
  hr('(3) contiene / empieza por: sin mayúsculas, comodines literales')
  {
    const c = (op: 'contiene' | 'empiezaPor', valor: string): DbCondicionFiltro => ({ columna: 'N', categoria: 'texto', operador: op, valor })
    const o = una('oracle', c('contiene', '50%_a!'))
    check("Oracle: LOWER(c) LIKE LOWER(:f1) ESCAPE '!' y `%`, `_`, `!` escapados", o.sql === `LOWER("N") LIKE LOWER(:f1) ESCAPE '!'` && J(o.v) === J(['%50!%!_a!!%']), J(o))
    const p = una('postgres', c('contiene', 'Ab'))
    check("PG: CAST(c AS text) ILIKE $1 ESCAPE '!'", p.sql === `CAST("N" AS text) ILIKE $1 ESCAPE '!'` && J(p.v) === '["%Ab%"]', J(p))
    const s = una('sqlserver', c('empiezaPor', '[a]_'))
    check("SQL Server: LOWER(CAST(c AS NVARCHAR(MAX))) y `[` también escapado", s.sql === `LOWER(CAST("N" AS NVARCHAR(MAX))) LIKE LOWER(@p1) ESCAPE '!'` && J(s.v) === J(['![a]!_%']), J(s))
    const q = una('sqlite', c('empiezaPor', 'x'))
    check("SQLite: LOWER(c) LIKE LOWER(?1) ESCAPE '!', `x%`", q.sql === `LOWER("N") LIKE LOWER(?1) ESCAPE '!'` && J(q.v) === '["x%"]', J(q))
    check('NEGATIVO: `[` NO se escapa fuera de SQL Server (ORA-01424 en Oracle)', escaparLike('oracle', '[x]') === '[x]' && escaparLike('postgres', '[') === '[' && escaparLike('sqlite', '[') === '[', escaparLike('oracle', '[x]'))
    const iny = una('postgres', c('contiene', "x'); DROP TABLE t; --"))
    check('un valor con comillas y `; DROP` es solo un valor (no toca el texto)', iny.sql === `CAST("N" AS text) ILIKE $1 ESCAPE '!'` && J(iny.v) === J(["%x'); DROP TABLE t; --%"]), J(iny))
  }

  // ---------------------------------------------------------------------------
  hr('(4) ≠ con NULL; vacío / no vacío')
  {
    const dist = una('oracle', { columna: 'E', categoria: 'texto', operador: 'distinto', valor: 'P' })
    check('≠ incluye NULL', dist.sql === '("E" IS NULL OR "E" <> :f1)', dist.sql)
    const v = (d: DialectoSql, op: 'vacio' | 'noVacio', categoria: DbCondicionFiltro['categoria'] = 'texto'): string => una(d, { columna: 'E', categoria, operador: op }).sql
    check("Oracle: vacío = IS NULL ('' ES NULL)", v('oracle', 'vacio') === '"E" IS NULL' && v('oracle', 'noVacio') === '"E" IS NOT NULL', v('oracle', 'vacio'))
    check("PG: vacío con '' y el CAST a text (un uuid = '' es un error)", v('postgres', 'vacio') === `("E" IS NULL OR CAST("E" AS text) = '')` && v('postgres', 'noVacio') === `("E" IS NOT NULL AND CAST("E" AS text) <> '')`, v('postgres', 'vacio'))
    check("SQL Server: vacío con '' y el CAST a NVARCHAR(MAX)", v('sqlserver', 'vacio') === `("E" IS NULL OR CAST("E" AS NVARCHAR(MAX)) = '')`, v('sqlserver', 'vacio'))
    check("SQLite: vacío con '' sin CAST", v('sqlite', 'vacio') === `("E" IS NULL OR "E" = '')`, v('sqlite', 'vacio'))
    check("número, fecha, booleano y otro: solo NULL (sin '')", v('postgres', 'vacio', 'numero') === '"E" IS NULL' && v('sqlserver', 'noVacio', 'fecha') === '"E" IS NOT NULL' && v('sqlite', 'vacio', 'otro') === '"E" IS NULL' && v('postgres', 'vacio', 'booleano') === '"E" IS NULL', v('postgres', 'vacio', 'numero'))
    const sinValor = ok('postgres', filtro([{ columna: 'E', categoria: 'texto', operador: 'vacio' }]))
    check('vacío no lleva parámetros', sinValor.valores.length === 0, J(sinValor))
  }

  // ---------------------------------------------------------------------------
  hr('(5) Números exactos')
  {
    check('canónico: +007.50 -> 7.5, -0 -> 0, .5 -> 0.5, 5. -> 5', J(['+007.50', '-0', '.5', '5.'].map((x) => partirNumero(x)?.texto)) === '["7.5","0","0.5","5"]', J(['+007.50', '-0', '.5', '5.'].map((x) => partirNumero(x)?.texto)))
    check('int8: 9223372036854775807 sí, 9223372036854775808 no', partirNumero('9223372036854775807')?.int8 === true && partirNumero('9223372036854775808')?.int8 === false && partirNumero('-9223372036854775808')?.int8 === true, 'límites')
    const n = (d: DialectoSql, valor: string): { sql: string; v: unknown[] } => una(d, { columna: 'S', categoria: 'numero', operador: 'igual', valor })
    const o = n('oracle', '12.5')
    check("Oracle: TO_NUMBER(:f1, '99D9', NLS '.,')", o.sql === `"S" = TO_NUMBER(:f1, '99D9', 'NLS_NUMERIC_CHARACTERS=''.,''')` && J(o.v) === '["12.5"]', J(o))
    const big = '123456789012345678901234567890'
    const ob = n('oracle', big)
    check('Oracle: entero de 30 cifras con modelo de 30 nueves, como TEXTO', ob.sql.includes(`'${'9'.repeat(30)}'`) && J(ob.v) === J([big]), J(ob))
    const neg = n('oracle', '-0.25')
    check("Oracle: -0.25 -> modelo '9D99' (el signo lo admite el modelo)", neg.sql.includes(`'9D99'`) && J(neg.v) === '["-0.25"]', J(neg))
    check('PG: entero de int8 -> bigint', n('postgres', '42').sql === '"S" = CAST($1 AS bigint)', n('postgres', '42').sql)
    check('PG: decimal y entero enorme -> numeric', n('postgres', '12.5').sql === '"S" = CAST($1 AS numeric)' && n('postgres', big).sql === '"S" = CAST($1 AS numeric)', n('postgres', big).sql)
    check('SQL Server: BIGINT y DECIMAL(38, s)', n('sqlserver', '42').sql === '"S" = CAST(@p1 AS BIGINT)' && n('sqlserver', '12.50').sql === '"S" = CAST(@p1 AS DECIMAL(38, 1))' && n('sqlserver', big).sql === '"S" = CAST(@p1 AS DECIMAL(38, 0))', n('sqlserver', '12.50').sql)
    const tope = mal('sqlserver', filtro([{ columna: 'S', categoria: 'numero', operador: 'igual', valor: '1'.repeat(39) }]))
    check('SQL Server: más de 38 cifras -> error EN la condición, antes de enviar', tope !== null && tope.indice === 0 && /38 cifras/.test(tope.mensaje), J(tope))
    const q = n('sqlite', '42')
    const qd = n('sqlite', '12.5')
    const qb = n('sqlite', big)
    check('SQLite: con su clase (entero / real; el que no cabe en int8, real)', J(q.v) === '[{"sqlite":"entero","valor":"42"}]' && J(qd.v) === '[{"sqlite":"real","valor":"12.5"}]' && J(qb.v) === J([{ sqlite: 'real', valor: big }]), J([q.v, qd.v, qb.v]))
    const entre = una('postgres', { columna: 'S', categoria: 'numero', operador: 'entre', valor: '1', valor2: '2.5' })
    check('entre -> BETWEEN con los dos extremos', entre.sql === '"S" BETWEEN CAST($1 AS bigint) AND CAST($2 AS numeric)' && J(entre.v) === '["1","2.5"]', J(entre))
    const mayor = una('sqlserver', { columna: 'S', categoria: 'numero', operador: 'mayor', valor: '5' })
    const menor = una('sqlserver', { columna: 'S', categoria: 'numero', operador: 'menor', valor: '5' })
    check('> y <', mayor.sql === '"S" > CAST(@p1 AS BIGINT)' && menor.sql === '"S" < CAST(@p1 AS BIGINT)', mayor.sql)
  }

  // ---------------------------------------------------------------------------
  hr('(6) Fechas: el día entero sin hora, exacto con hora')
  {
    const f = (d: DialectoSql, op: DbCondicionFiltro['operador'], valor: string, valor2?: string): { sql: string; v: unknown[] } =>
      una(d, { columna: 'F', categoria: 'fecha', operador: op, valor, ...(valor2 !== undefined ? { valor2 } : {}) })
    const td = (m: string): string => `TO_DATE(${m}, 'YYYY-MM-DD HH24:MI:SS')`
    const o = f('oracle', 'igual', '2026-09-28')
    check('Oracle =día: [d, d+1) con TO_DATE', o.sql === `("F" >= ${td(':f1')} AND "F" < ${td(':f2')})` && J(o.v) === '["2026-09-28 00:00:00","2026-09-29 00:00:00"]', J(o))
    const oh = f('oracle', 'igual', '2026-09-28T14:30')
    check('Oracle =con hora: exacto, segundos a :00', oh.sql === `"F" = ${td(':f1')}` && J(oh.v) === '["2026-09-28 14:30:00"]', J(oh))
    const p = f('postgres', 'distinto', '2026-12-31')
    check('PG ≠día: NULL o fuera del día; fin de año -> 2027-01-01', p.sql === '("F" IS NULL OR "F" < $1 OR "F" >= $2)' && J(p.v) === '["2026-12-31","2027-01-01"]', J(p))
    const s = f('sqlserver', 'mayor', '2024-02-28')
    check('SQL Server >día: desde el día siguiente, ISO con T (bisiesto: 29-feb)', s.sql === '"F" >= @p1' && J(s.v) === '["2024-02-29T00:00:00"]', J(s))
    const sh = f('sqlserver', 'mayor', '2024-02-28 10:00:05')
    check('SQL Server >con hora: > exacto', sh.sql === '"F" > @p1' && J(sh.v) === '["2024-02-28T10:00:05"]', J(sh))
    const q = f('sqlite', 'menor', '2026-09-28')
    check('SQLite <día: antes del día, `YYYY-MM-DD` a secas', q.sql === '"F" < ?1' && J(q.v) === '["2026-09-28"]', J(q))
    const qe = f('sqlite', 'entre', '2026-09-01', '2026-09-03')
    check('SQLite entre días: [a, b+1)', qe.sql === '("F" >= ?1 AND "F" < ?2)' && J(qe.v) === '["2026-09-01","2026-09-04"]', J(qe))
    const pe = f('postgres', 'entre', '2026-09-01 08:00', '2026-09-03 18:00')
    check('PG entre con horas: [a, b] exacto', pe.sql === '("F" >= $1 AND "F" <= $2)' && J(pe.v) === '["2026-09-01 08:00:00","2026-09-03 18:00:00"]', J(pe))
    const mixto = f('oracle', 'entre', '2026-09-01 08:00', '2026-09-03')
    check('entre mixto: desde la hora exacta hasta el final del día b', J(mixto.v) === '["2026-09-01 08:00:00","2026-09-04 00:00:00"]' && mixto.sql.includes('"F" < '), J(mixto))
    // el 9999-12-31 (centinela de «sin fecha de baja») no tiene día
    // siguiente en ningún motor; nunca se manda un año 10000.
    const c9 = (op: DbCondicionFiltro['operador'], v2?: string): { sql: string; v: unknown[] } => f('oracle', op, op === 'entre' ? '2026-01-01' : '9999-12-31', v2)
    const i9 = c9('igual')
    const d9 = c9('distinto')
    const m9 = c9('mayor')
    const e9 = c9('entre', '9999-12-31')
    check(
      '9999-12-31: = es «desde ese día», ≠ «NULL o antes», > ninguna fila, entre sin tope; nunca 10000',
      i9.sql === `"F" >= ${td(':f1')}` &&
        d9.sql === `("F" IS NULL OR "F" < ${td(':f1')})` &&
        m9.sql === '1 = 0' &&
        e9.sql === `"F" >= ${td(':f1')}` &&
        ![i9, d9, m9, e9].some((x) => J(x.v).includes('10000')),
      J({ i9, d9, m9, e9 })
    )
  }

  hr('(6b) Texto de «=» y «≠» en Oracle: bind CHAR')
  {
    const oi = una('oracle', { columna: 'C', categoria: 'texto', operador: 'igual', valor: 'ABC' })
    const pi = una('postgres', { columna: 'C', categoria: 'texto', operador: 'distinto', valor: 'ABC' })
    const oc = una('oracle', { columna: 'C', categoria: 'texto', operador: 'contiene', valor: 'ABC' })
    check(
      'Oracle = y ≠ de texto van como { entrada: "char" } (compara como un literal); PG y «contiene», texto a secas',
      oi.sql === '"C" = :f1' && J(oi.v) === '[{"entrada":"char","valor":"ABC"}]' && J(pi.v) === '["ABC"]' && typeof oc.v[0] === 'string',
      J({ oi, pi, oc })
    )
  }

  // ---------------------------------------------------------------------------
  hr('(7) Booleanos')
  {
    const b = (d: DialectoSql, valor: string, op: 'igual' | 'distinto' = 'igual'): { sql: string; v: unknown[] } => una(d, { columna: 'B', categoria: 'booleano', operador: op, valor })
    check("PG: 'true'/'false' sin tipo", J(b('postgres', 'sí').v) === '["true"]' && J(b('postgres', '0').v) === '["false"]', J(b('postgres', 'sí')))
    check('Oracle y SQL Server: 1/0 como número', J(b('oracle', 'true').v) === '[1]' && J(b('sqlserver', 'false').v) === '[0]', J(b('oracle', 'true')))
    check('SQLite: entero con su clase', J(b('sqlite', 'true').v) === '[{"sqlite":"entero","valor":"1"}]', J(b('sqlite', 'true')))
    check('≠ booleano incluye NULL', b('sqlserver', 'true', 'distinto').sql === '("B" IS NULL OR "B" <> @p1)', b('sqlserver', 'true', 'distinto').sql)
  }

  // ---------------------------------------------------------------------------
  hr('(8) Unión O y filtro vacío')
  {
    const o = ok('sqlite', filtro([{ columna: 'A', categoria: 'texto', operador: 'igual', valor: '1' }, { columna: 'A', categoria: 'texto', operador: 'vacio' }], 'cualquiera'))
    check('cualquiera -> OR delante de la segunda', o.sql === `"A" = ?1\nOR ("A" IS NULL OR "A" = '')`, o.sql)
    check('sin condiciones -> null (no hay WHERE)', compilarFiltro('oracle', filtro([])) === null, 'null')
  }

  // ---------------------------------------------------------------------------
  hr('(9) Inválidos: con el índice de su condición')
  {
    const e1 = mal('postgres', filtro([{ columna: 'A', categoria: 'texto', operador: 'igual', valor: 'x' }, { columna: 'B', categoria: 'numero', operador: 'igual', valor: '1,5' }]))
    check('un número con coma -> condición 1', e1 !== null && e1.indice === 1 && /número/.test(e1.mensaje), J(e1))
    const e2 = mal('oracle', filtro([{ columna: 'F', categoria: 'fecha', operador: 'igual', valor: '2026-02-30' }]))
    check('una fecha que no existe -> condición 0', e2 !== null && e2.indice === 0, J(e2))
    const e3 = mal('sqlite', { union: 'y', condiciones: [] })
    check('una unión inventada -> -1 (del filtro entero)', e3 !== null && e3.indice === -1, J(e3))
    const e4 = mal('sqlserver', filtro([{ columna: 'A', categoria: 'otro', operador: 'igual', valor: 'x' }]))
    check('un operador que no es de su categoría -> error, no SQL', e4 !== null && e4.indice === 0, J(e4))
    const e5 = mal('postgres', filtro([{ columna: 'A', categoria: 'texto', operador: 'vacio', valor: 'x' }]))
    check('un valor de más en «vacío» -> error', e5 !== null && e5.indice === 0, J(e5))
    const e6 = mal('postgres', 'DROP TABLE t')
    check('lo que no es un objeto -> -1', e6 !== null && e6.indice === -1, J(e6))
  }

  // ---------------------------------------------------------------------------
  hr('(10) Orden de la cabecera')
  {
    check('citado, ASC/DESC en su prioridad', compilarOrden([{ columna: 'b', dir: 'desc' }, { columna: 'A"x', dir: 'asc' }]) === '"b" DESC, "A""x" ASC', J(compilarOrden([{ columna: 'b', dir: 'desc' }, { columna: 'A"x', dir: 'asc' }])))
    check('vacío -> null', compilarOrden([]) === null, 'null')
    const m1 = compilarOrden([{ columna: 'a', dir: 'asc' }, { columna: 'a', dir: 'desc' }])
    const m2 = compilarOrden([{ columna: 'a', dir: 'up' }])
    const m3 = compilarOrden('a desc')
    check('NEGATIVO: repetida, dirección inventada o texto -> mensaje', typeof m1 === 'object' && m1 !== null && typeof m2 === 'object' && m2 !== null && typeof m3 === 'object' && m3 !== null, J([m1, m2, m3]))
  }

  // ---------------------------------------------------------------------------
  const total = results.length
  const passed = results.filter((r) => r.pass).length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
