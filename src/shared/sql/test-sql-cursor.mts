#!/usr/bin/env node
// =============================================================================
// Prueba de la SENTENCIA BAJO EL CURSOR y de los modos de ejecución (npm run test:sql-cursor).
// (node src/shared/sql/test-sql-cursor.mts)
// Las cinco ramas de `sentenciaEnCursor` y sus bordes en los dos motores, con LF y CRLF, y `sentenciasAEjecutar`
// en sus tres modos (la selección vacía se comporta como el cursor).
// =============================================================================

import { dividirSentencias, sentenciaEnCursor, sentenciasAEjecutar, type Sentencia } from './divisorSql.ts'
import { REGLAS, type DialectoSql } from './dialectosSql.ts'

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

// Todos los dialectos con reglas: uno nuevo entra solo en la prueba.
const DIALECTOS = Object.keys(REGLAS) as DialectoSql[]
const FINES: ReadonlyArray<[string, string]> = [
  ['LF', '\n'],
  ['CRLF', '\r\n']
]

function texto(s: Sentencia | null): string {
  return s ? s.texto : '(ninguna)'
}

function main(): void {
  for (const d of DIALECTOS) {
    for (const [nombreFin, nl] of FINES) {
      const etiqueta = `[${d} ${nombreFin}]`
      hr(`${etiqueta} reglas de la sentencia bajo el cursor`)
      // Cada línea, con su contenido:
      //   0: select 1 from t1; select 2 from t2;   <- dos en la misma línea
      //   1: (vacía)
      //   2:    select 3 from t3;   -- nota
      //   3: -- comentario suelto
      //   4: select 4
      //   5:   from t4
      //   6: (vacía, fin)
      const t = [
        'select 1 from t1; select 2 from t2;',
        '',
        '   select 3 from t3;   -- nota',
        '-- comentario suelto',
        'select 4',
        '  from t4',
        ''
      ].join(nl)
      const ss = dividirSentencias(t, d)
      const en = (cursor: number): string => texto(sentenciaEnCursor(ss, t, cursor))
      const p1 = t.indexOf('select 1')
      const fin1 = t.indexOf(';') + 1
      check(`${etiqueta} 4 sentencias`, ss.length === 4, JSON.stringify(ss.map((s) => s.texto)))
      check(`${etiqueta} (2) dentro de la primera`, en(p1 + 3) === 'select 1 from t1', en(p1 + 3))
      check(`${etiqueta} (2) justo en su primer carácter`, en(p1) === 'select 1 from t1', en(p1))
      check(`${etiqueta} (1) justo tras el ; (a;|b) -> la ANTERIOR`, en(fin1) === 'select 1 from t1', en(fin1))
      check(`${etiqueta} (2) justo antes de la segunda de la misma línea -> la segunda`, en(fin1 + 1) === 'select 2 from t2', en(fin1 + 1))
      const finL0 = t.indexOf(nl)
      check(`${etiqueta} (1) al final de la línea 0, tras el ; de la segunda`, en(finL0) === 'select 2 from t2', en(finL0))
      const inicioL1 = finL0 + nl.length
      check(`${etiqueta} (5) en la línea vacía -> ninguna`, en(inicioL1) === '(ninguna)', en(inicioL1))
      const inicioL2 = t.indexOf('   select 3')
      check(`${etiqueta} (4) en los blancos iniciales de la línea -> la siguiente`, en(inicioL2) === 'select 3 from t3' && en(inicioL2 + 2) === 'select 3 from t3', en(inicioL2))
      const nota = t.indexOf('-- nota') + 4
      check(`${etiqueta} (3) dentro del comentario al final de su línea -> la anterior`, en(nota) === 'select 3 from t3', en(nota))
      const suelto = t.indexOf('comentario suelto')
      check(`${etiqueta} (5) en un comentario suelto de otra línea -> ninguna`, en(suelto) === '(ninguna)', en(suelto))
      const multi = t.indexOf('from t4') + 2
      check(`${etiqueta} (2) en la segunda línea de una sentencia multilínea`, en(multi) === `select 4${nl}  from t4`, JSON.stringify(en(multi)))
      const finUltima = t.indexOf('from t4') + 'from t4'.length
      check(`${etiqueta} (1) al final de la última sin ; -> esa`, en(finUltima) === `select 4${nl}  from t4`, JSON.stringify(en(finUltima)))
      check(`${etiqueta} (5) en la línea vacía final -> ninguna`, en(t.length) === '(ninguna)', en(t.length))
      check(`${etiqueta} (5) texto vacío -> ninguna`, sentenciaEnCursor(dividirSentencias('', d), '', 0) === null, '')
    }
  }

  // ---------------------------------------------------------------------------
  for (const d of DIALECTOS) {
    hr(`[${d}] sentenciasAEjecutar: cursor / selección / todo`)
    const t = 'select 1 from t1;\nselect 2 from t2;\nselect 3 from t3'
    const todo = sentenciasAEjecutar(t, d, { tipo: 'todo' })
    check(`[${d}] todo -> las 3`, todo.length === 3, JSON.stringify(todo.map((s) => s.texto)))
    const cur = sentenciasAEjecutar(t, d, { tipo: 'cursor', cursor: t.indexOf('2 from') })
    check(`[${d}] cursor -> solo la de debajo`, cur.length === 1 && cur[0].texto === 'select 2 from t2', JSON.stringify(cur.map((s) => s.texto)))
    const nada = sentenciasAEjecutar('select 1;\n\n\nselect 2', d, { tipo: 'cursor', cursor: 11 })
    check(`[${d}] cursor en una línea vacía -> nada (la UI da la pista)`, nada.length === 0, JSON.stringify(nada.map((s) => s.texto)))
    const desde = t.indexOf('select 2')
    const sel = sentenciasAEjecutar(t, d, { tipo: 'seleccion', desde, hasta: t.length })
    check(
      `[${d}] selección -> sus sentencias, con offsets del modelo`,
      sel.length === 2 && sel[0].desde === desde && t.slice(sel[1].desde, sel[1].hastaContenido) === 'select 3 from t3',
      JSON.stringify(sel.map((s) => [s.desde, s.texto]))
    )
    const parcial = sentenciasAEjecutar(t, d, { tipo: 'seleccion', desde: t.indexOf('from t1'), hasta: t.indexOf('from t2') })
    check(`[${d}] selección parcial: lo seleccionado, tal cual, partido`, parcial.length === 2 && parcial[0].texto === 'from t1' && parcial[1].texto === 'select 2', JSON.stringify(parcial.map((s) => s.texto)))
    const vacia = sentenciasAEjecutar(t, d, { tipo: 'seleccion', desde: t.indexOf('3 from'), hasta: t.indexOf('3 from') })
    check(`[${d}] selección vacía = cursor`, vacia.length === 1 && vacia[0].texto === 'select 3 from t3', JSON.stringify(vacia.map((s) => s.texto)))
  }

  // ---------------------------------------------------------------------------
  hr('[oracle] bloques PL/SQL y comandos de cliente bajo el cursor')
  {
    const t = 'SET SERVEROUTPUT ON\nBEGIN\n  NULL;\nEND;\n/\nselect 1 from dual'
    const ss = dividirSentencias(t, 'oracle')
    const dentro = sentenciaEnCursor(ss, t, t.indexOf('NULL'))
    check('cursor dentro del bloque -> el bloque entero (con END;)', !!dentro && dentro.plsql && dentro.texto.slice(-4) === 'END;', texto(dentro))
    const enBarra = sentenciaEnCursor(ss, t, t.indexOf('/') + 1)
    check('cursor justo tras la / -> el bloque', !!enBarra && enBarra.plsql, texto(enBarra))
    const set = sentenciaEnCursor(ss, t, 3)
    check('cursor en SET SERVEROUTPUT -> la línea de cliente (la UI la marca ⊘)', !!set && set.clase === 'cliente', texto(set))
  }

  // ---------------------------------------------------------------------------
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
