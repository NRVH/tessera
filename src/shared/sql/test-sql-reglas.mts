#!/usr/bin/env node
// =============================================================================
// Prueba de las REGLAS del dialecto contra su EFECTO (npm run test:sql-reglas).
// (node src/shared/sql/test-sql-reglas.mts)
// Los valores de las banderas los fija `shared/motores/test-motores.mts`; esta prueba fija que cada bandera hace lo que
// dice en el sitio que la lee. Cada comprobación recorre `Object.keys(REGLAS)` y deduce lo esperado de la bandera, no
// del nombre; un dialecto nuevo entra solo, y donde la bandera es una unión el `switch` cierra con `nunca`.
// =============================================================================

import { REGLAS, type DialectoSql, type ReglasDialecto } from './dialectosSql.ts'
import { tokenizar } from './lexicoSql.ts'
import { clasificar, permitidaEnSoloLectura, type Clasificacion } from './clasificarSql.ts'
import { dividirSentencias } from './divisorSql.ts'
import { plegarSinComillas } from './identificadoresSql.ts'
import { plsqlConCommitEscrito } from './produccionSql.ts'
import { nunca } from '../nunca.ts'

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

const DIALECTOS = Object.keys(REGLAS) as DialectoSql[]

function cls(texto: string, d: DialectoSql): Clasificacion {
  return clasificar(tokenizar(texto, d), d, texto)
}
function resumen(c: Clasificacion): string {
  return `${c.clase} «${c.verbo}» filas=${c.devuelveFilas} plsql=${c.plsql}`
}
/** Los valores de los tokens `numero` de `texto`. */
function numeros(texto: string, d: DialectoSql): string[] {
  return tokenizar(texto, d)
    .filter((t) => t.tipo === 'numero')
    .map((t) => t.valor)
}

/**
 * El motivo EXACTO con el que la guardia de solo lectura rechaza un parámetro de sesión
 * que no está en su lista: la forma del SET (`formaSetSesion`) y la lista escrita como
 * la pliega el motor (`cajaSinComillas`). Son los textos de antes del descriptor, al byte.
 */
const MOTIVO_SESION: Readonly<Record<DialectoSql, string>> = {
  oracle: 'La conexión es de solo lectura: solo se permite ALTER SESSION SET CURRENT_SCHEMA o TIME_ZONE.',
  postgres: 'La conexión es de solo lectura: solo se permite SET search_path, timezone, statement_timeout o lock_timeout.',
  // SQLite: no tiene sentencia de sesión por parámetro (ni ALTER SESSION ni SET;
  // su sesión son PRAGMA, que clasifica `pragmas`), así que este motivo no se usa.
  sqlite: '',
  // SQL Server: SET, con las opciones en mayúsculas (como las escribe la
  // documentación; el motor no pliega), y USE, que también pasa.
  sqlserver:
    'La conexión es de solo lectura: solo se permite SET LOCK_TIMEOUT, NOCOUNT, STATISTICS, DEADLOCK_PRIORITY o TRANSACTION (y USE para cambiar de base).'
}

/**
 * Qué se espera de cada cliente de línea: metacomandos `\cmd` en el léxico (`barra`) y
 * comandos de SQL*Plus al inicio de línea en el divisor (`sqlplus`). Un cliente nuevo no
 * compila hasta que se escriba aquí qué hace.
 */
function efectoCliente(cliente: ReglasDialecto['comandosCliente']): { barra: boolean; sqlplus: boolean } {
  switch (cliente) {
    case 'psql':
      return { barra: true, sqlplus: false }
    case 'sqlplus':
      return { barra: false, sqlplus: true }
    // Los `.algo` de sqlite3 no son `\cmd` ni comandos de SQL*Plus (los fija el test del léxico).
    case 'sqlite3':
    case null:
      return { barra: false, sqlplus: false }
    default:
      return nunca(cliente, 'test-sql-reglas (comandosCliente)')
  }
}

function main(): void {
  check('hay al menos los dos dialectos de siempre', DIALECTOS.indexOf('oracle') >= 0 && DIALECTOS.indexOf('postgres') >= 0, j(DIALECTOS))

  // ---------------------------------------------------------------------------
  hr('1. LÉXICO: números con base (numerosConBase) y sufijo f/d (sufijoFlotante)')
  for (const d of DIALECTOS) {
    const r = REGLAS[d]
    const base = numeros('select 0x1F, 0o17, 0b1_01 from t', d)
    // `hex0x` (SQLite) lee SOLO el hexadecimal: `0o17` y `0b1_01` siguen partiéndose.
    const esperado = r.numerosConBase ? ['0x1F', '0o17', '0b1_01'] : r.hex0x ? ['0x1F', '0', '0'] : ['0', '0', '0']
    check(`[${d}] numerosConBase=${r.numerosConBase}: 0x1F / 0o17 / 0b1_01`, j(base) === j(esperado), j(base))
    const suf = numeros('select 1.5f, 2d, 3fx from t', d)
    // `3fx` no lleva sufijo en ningún dialecto: la f va pegada a un identificador.
    const esperadoSuf = r.sufijoFlotante ? ['1.5f', '2d', '3'] : ['1.5', '2', '3']
    check(`[${d}] sufijoFlotante=${r.sufijoFlotante}: 1.5f / 2d / 3fx`, j(suf) === j(esperadoSuf), j(suf))
  }

  // ---------------------------------------------------------------------------
  hr('2. CLASIFICADOR: SELECT INTO, RETURNING, EXPLAIN, ALTER SESSION, SET')
  for (const d of DIALECTOS) {
    const r = REGLAS[d]
    const si = cls('SELECT a INTO nueva FROM t', d)
    const okSi = r.selectIntoCreaTabla
      ? si.clase === 'ddl' &&
        si.verbo === 'SELECT INTO' &&
        si.objetoCreado !== null &&
        si.objetoCreado.nombre === plegarSinComillas('nueva', d) &&
        si.objetoCreado.tipo === 'TABLE'
      : si.clase === 'consulta' && si.verbo === 'SELECT'
    check(`[${d}] selectIntoCreaTabla=${r.selectIntoCreaTabla}: SELECT … INTO nueva`, okSi, resumen(si))

    const ret = cls('DELETE FROM t WHERE a = 1 RETURNING a', d)
    check(
      `[${d}] returningDevuelveFilas=${r.returningDevuelveFilas}: DELETE … RETURNING`,
      ret.clase === 'dml' && ret.devuelveFilas === r.returningDevuelveFilas,
      resumen(ret)
    )

    const planFor = cls('EXPLAIN PLAN FOR SELECT 1 FROM t', d)
    const simple = cls('EXPLAIN SELECT 1 FROM t', d)
    const forma = r.explain
    let okEx: boolean
    switch (forma) {
      case 'planFor':
        // Escribe en PLAN_TABLE y no devuelve el plan: `otra`, sin filas.
        okEx =
          planFor.verbo === 'EXPLAIN PLAN' && planFor.clase === 'otra' && !planFor.devuelveFilas &&
          simple.verbo === 'EXPLAIN' && simple.clase === 'otra'
        break
      case 'conOpciones':
        // Sin ANALYZE devuelve el plan y no ejecuta nada: consulta pura con filas.
        okEx =
          simple.verbo === 'EXPLAIN' && simple.clase === 'consulta' && simple.devuelveFilas && simple.consultaPura &&
          cls('EXPLAIN ANALYZE DELETE FROM t', d).clase === 'dml'
        break
      case 'queryPlan': {
        // SQLite: los dos devuelven filas y ninguno ejecuta, tampoco el de un DELETE.
        const eqp = cls('EXPLAIN QUERY PLAN DELETE FROM t', d)
        okEx =
          simple.verbo === 'EXPLAIN' && simple.clase === 'consulta' && simple.devuelveFilas &&
          eqp.verbo === 'EXPLAIN QUERY PLAN' && eqp.clase === 'consulta' && eqp.devuelveFilas
        break
      }
      case 'showplan':
        // SQL Server: no hay sentencia EXPLAIN (el plan lo pide la sesión con SHOWPLAN_XML);
        // la palabra cae en la genérica. (El SELECT de detrás es otra sentencia de la misma
        // unidad, que se ejecuta con ella: por eso puede devolver filas.)
        okEx = simple.verbo === 'EXPLAIN' && simple.clase === 'otra'
        break
      default:
        okEx = nunca(forma, 'test-sql-reglas (explain)')
    }
    check(`[${d}] explain='${forma}'`, okEx, `${resumen(planFor)} / ${resumen(simple)}`)

    const alt = cls('ALTER SESSION SET current_schema = x', d)
    check(
      `[${d}] alterSession=${r.alterSession}: ALTER SESSION SET es de sesión`,
      (alt.clase === 'sesion') === r.alterSession && (!r.alterSession || j(alt.sesion) === j({ accion: 'set', parametros: ['current_schema'] })),
      resumen(alt) + ' ' + j(alt.sesion)
    )
    const set = cls('SET search_path = x', d)
    check(
      `[${d}] setDeSesion=${r.setDeSesion}: SET x = … es de sesión (si no, genérico «SET»)`,
      r.setDeSesion
        ? set.clase === 'sesion' && j(set.sesion) === j({ accion: 'set', parametros: ['search_path'] })
        : set.clase === 'otra' && set.verbo === 'SET' && set.sesion === null,
      resumen(set) + ' ' + j(set.sesion)
    )
  }

  // ---------------------------------------------------------------------------
  hr('3. CLASIFICADOR: verbos con clasificación propia (verbosDelDialecto)')
  // [texto, verbo, la clasificación PROPIA]: fuera de la lista, el verbo cae en la
  // genérica (`otra`, con el verbo tal cual), que es lo que hacía el `if (!pg) break`.
  const VERBOS: Array<[string, string, Clasificacion['clase'], string]> = [
    ['TABLE t', 'TABLE', 'consulta', 'TABLE'],
    ['SHOW x', 'SHOW', 'consulta', 'SHOW'],
    ['BEGIN', 'BEGIN', 'tx', 'BEGIN'],
    ['START TRANSACTION', 'START', 'tx', 'START TRANSACTION'],
    ['END', 'END', 'tx', 'END'],
    ['ABORT', 'ABORT', 'tx', 'ABORT'],
    ["PREPARE TRANSACTION 'x'", 'PREPARE', 'tx', 'PREPARE TRANSACTION'],
    ['RESET x', 'RESET', 'sesion', 'RESET'],
    ['DISCARD ALL', 'DISCARD', 'sesion', 'DISCARD'],
    ['DO $$ x $$', 'DO', 'rutina', 'DO']
  ]
  for (const d of DIALECTOS) {
    const r = REGLAS[d]
    for (const [texto, w, clase, verbo] of VERBOS) {
      // Donde BEGIN abre un bloque PL/SQL, lo decide el bloque antes que el verbo. Y en T-SQL
      // (BEGIN en `hastaSeparadorLote`) BEGIN y END son un bloque: `test-sql-sqlserver`.
      if (w === 'BEGIN' && r.bloquesPlsql) continue
      const c = cls(texto, d)
      if ((w === 'BEGIN' || w === 'END') && r.hastaSeparadorLote.indexOf('BEGIN') >= 0) {
        check(`[${d}] ${w} es un bloque (neutro, sin filas): ${texto}`, c.clase === 'consulta' && c.verbo === w && !c.devuelveFilas && !c.escribe, resumen(c))
        continue
      }
      const propio = r.verbosDelDialecto.indexOf(w) >= 0
      check(
        `[${d}] ${w} ${propio ? 'propio' : 'genérico'}: ${texto}`,
        propio ? c.clase === clase && c.verbo === verbo : c.clase === 'otra' && c.verbo === w,
        resumen(c)
      )
    }
    // El PREPARE que no es de una transacción es genérico en todos.
    const prep = cls('PREPARE q AS SELECT 1', d)
    check(`[${d}] PREPARE sin TRANSACTION: genérico`, prep.clase === 'otra' && prep.verbo === 'PREPARE', resumen(prep))
  }

  // ---------------------------------------------------------------------------
  hr('4. CLASIFICADOR: ANALYZE, CALL, EXEC/EXECUTE, FETCH')
  for (const d of DIALECTOS) {
    const r = REGLAS[d]
    const an = cls('ANALYZE t', d)
    check(`[${d}] analyzeEsDdl=${r.analyzeEsDdl}: ANALYZE t`, an.clase === (r.analyzeEsDdl ? 'ddl' : 'otra') && an.verbo === 'ANALYZE', resumen(an))
    const call = cls('CALL p()', d)
    check(`[${d}] callDevuelveFilas=${r.callDevuelveFilas}: CALL p()`, call.clase === 'rutina' && call.devuelveFilas === r.callDevuelveFilas, resumen(call))
    const fetch = cls('FETCH NEXT FROM c', d)
    check(`[${d}] fetchDevuelveFilas=${r.fetchDevuelveFilas}: FETCH NEXT FROM c`, fetch.devuelveFilas === r.fetchDevuelveFilas && fetch.verbo === 'FETCH', resumen(fetch))

    const execute = cls('EXECUTE p', d)
    const exec = cls('EXEC p', d)
    const ejecutar = r.ejecutar
    let okEj: boolean
    switch (ejecutar) {
      case 'rutinaPlsql':
        // La llamada de SQL*Plus a un procedimiento: rutina que se envía como bloque.
        okEj = [execute, exec].every((c) => c.clase === 'rutina' && c.verbo === 'EXEC' && c.plsql && !c.devuelveFilas)
        break
      case 'sentenciaPreparada':
        // Ejecuta una sentencia preparada; solo EXECUTE devuelve filas.
        okEj =
          execute.clase === 'otra' && execute.verbo === 'EXECUTE' && execute.devuelveFilas && !execute.plsql &&
          exec.verbo === 'EXEC' && !exec.devuelveFilas
        break
      case 'noExiste':
        // No es una sentencia del dialecto: la genérica, sin filas.
        okEj = [execute, exec].every((c) => c.clase === 'otra' && !c.devuelveFilas && !c.plsql) &&
          execute.verbo === 'EXECUTE' && exec.verbo === 'EXEC'
        break
      case 'procedimientoTsql':
        // SQL Server: procedimiento o SQL dinámico; rutina siempre (nunca en solo lectura).
        okEj = [execute, exec].every((c) => c.clase === 'rutina' && c.verbo === 'EXEC' && !c.plsql)
        break
      default:
        okEj = nunca(ejecutar, 'test-sql-reglas (ejecutar)')
    }
    check(`[${d}] ejecutar='${ejecutar}': EXECUTE p / EXEC p`, okEj, `${resumen(execute)} / ${resumen(exec)}`)
  }

  // ---------------------------------------------------------------------------
  hr('5. GUARDIA DE SOLO LECTURA: la forma del SET permitido (formaSetSesion + cajaSinComillas)')
  for (const d of DIALECTOS) {
    const r = REGLAS[d]
    // Un parámetro de sesión que NO está en la lista blanca, escrito en la forma de sesión
    // del dialecto.
    const texto = r.alterSession ? 'ALTER SESSION SET nls_sort = binary' : r.setDeSesion ? 'SET work_mem = 1' : null
    if (texto === null) {
      check(`[${d}] sin sentencia de sesión: nada que rechazar por parámetro`, true, 'ni alterSession ni setDeSesion')
      continue
    }
    const c = cls(texto, d)
    const p = permitidaEnSoloLectura(c, d)
    const motivo = p.ok ? '(permitida)' : p.motivo
    check(`[${d}] ${texto}: rechazada con «solo se permite ${r.formaSetSesion}…»`, !p.ok && motivo.indexOf('solo se permite ' + r.formaSetSesion) >= 0, motivo)
    check(`[${d}] el motivo es EXACTAMENTE el de siempre`, motivo === MOTIVO_SESION[d], motivo)
  }

  // ---------------------------------------------------------------------------
  hr('6. PRODUCCIÓN: un COMMIT escrito en un bloque (bloquesPlsql)')
  for (const d of DIALECTOS) {
    const r = REGLAS[d]
    const s = dividirSentencias('BEGIN\n  UPDATE t SET a = 1 WHERE id = 1;\n  COMMIT;\nEND;', d)[0]
    check(
      `[${d}] bloquesPlsql=${r.bloquesPlsql}: BEGIN … COMMIT; END; ${r.bloquesPlsql ? 'lleva' : 'no lleva'} un COMMIT escrito`,
      plsqlConCommitEscrito(s, d) === r.bloquesPlsql,
      `${s.clase} -> ${plsqlConCommitEscrito(s, d)}`
    )
    // La bandera es la que decide, no la clase: aun rotulado como `plsql`, un dialecto sin
    // bloques PL/SQL no confirma nada de rebote.
    const rotulado = plsqlConCommitEscrito({ clase: 'plsql', texto: 'BEGIN COMMIT; END;' }, d)
    check(`[${d}] con clase 'plsql' forzada: ${r.bloquesPlsql}`, rotulado === r.bloquesPlsql, String(rotulado))
  }

  // ---------------------------------------------------------------------------
  hr('7. CLIENTE DE LÍNEA: metacomando \\cmd (léxico) y comandos de SQL*Plus (divisor)')
  for (const d of DIALECTOS) {
    const cliente = REGLAS[d].comandosCliente
    const ef = efectoCliente(cliente)
    const meta = tokenizar('\\dt\nselect 1', d)[0]
    check(
      `[${d}] comandosCliente=${cliente}: \\dt al inicio de línea ${ef.barra ? 'ES' : 'NO es'} un metacomando`,
      (meta.tipo === 'lineaCliente') === ef.barra && (!ef.barra || meta.valor === '\\dt'),
      `${meta.tipo}:${meta.valor}`
    )
    const ss = dividirSentencias('PROMPT hola\nselect 1 from t', d)
    const okP = ef.sqlplus
      ? ss.length === 2 && ss[0].clase === 'cliente' && ss[1].texto === 'select 1 from t'
      : ss.every((s) => s.clase !== 'cliente')
    check(
      `[${d}] comandosCliente=${cliente}: PROMPT al inicio de línea ${ef.sqlplus ? 'ES' : 'NO es'} un comando del cliente`,
      okP,
      j(ss.map((s) => [s.clase, s.texto]))
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

main()
