#!/usr/bin/env node
// =============================================================================
// Prueba de los parámetros de un lote de la consola (npm run test:db-consola-parametros):
// con el divisor y el detector REALES, fija el REPARTO: un campo por clave, cada sentencia
// con sus binds, lo que no es parámetro, el prerrelleno, y textos y pie del diálogo.
// =============================================================================

import { dividirSentencias } from '../../../../../shared/sql/divisorSql.ts'
import { REGLAS, type DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import {
  bindsPorSentencia,
  clavesSinValor,
  etiquetaDeClave,
  parametrosDeLote,
  pieDialogoParametros,
  recordarValores,
  resumenBinds,
  sentenciasConParametros,
  textoDialogoParametros,
  valoresABinds,
  valoresIniciales
} from './parametrosConsola.ts'

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

function main(): void {
  hr('(1) Un campo por clave del lote')

  const oraTexto = 'select * from t where id = :id;\nupdate t set x = :valor where id = :ID;\nselect 1 from dual;'
  const oraSs = dividirSentencias(oraTexto, 'oracle')
  const ora = parametrosDeLote(oraTexto, oraSs, 'oracle')
  check(
    '(1a) Oracle: `:id` y `:ID` son UN campo (clave en mayúsculas), en orden de aparición',
    j(ora.campos.map((c) => c.clave)) === '["ID","VALOR"]',
    j(ora.campos)
  )
  check('(1b) la etiqueta es como se escribió la PRIMERA vez', ora.campos[0].etiqueta === ':id', ora.campos[0].etiqueta)
  check('(1c) cuenta en cuántas sentencias aparece', ora.campos[0].sentencias === 2 && ora.campos[1].sentencias === 1, j(ora.campos))

  const pgTexto = 'select $2, $1;\nselect * from t where id = $1'
  const pgSs = dividirSentencias(pgTexto, 'postgres')
  const pg = parametrosDeLote(pgTexto, pgSs, 'postgres')
  check('(1d) PG: `$1` en dos sentencias es un campo, y se ordenan por número', j(pg.campos.map((c) => c.clave)) === '["1","2"]', j(pg.campos))
  check('(1e) PG: etiqueta `$1`', pg.campos[0].etiqueta === '$1', pg.campos[0].etiqueta)

  hr('(2) Cada sentencia lleva SOLO sus binds')

  check('(2a) claves por sentencia', j(ora.porSentencia) === '[["ID"],["VALOR","ID"],[]]', j(ora.porSentencia))
  const bOra = bindsPorSentencia(ora, { ID: '5', VALOR: 'x' })
  check('(2b) la primera solo lleva ID', j(bOra[0]) === '{"ID":"5"}', j(bOra[0]))
  check('(2c) la segunda lleva VALOR e ID', j(bOra[1]) === '{"VALOR":"x","ID":"5"}', j(bOra[1]))
  check('(2d) la tercera, sin parámetros, NO lleva el campo', bOra[2] === undefined, String(bOra[2]))
  check('(2e) sentencias con parámetros', sentenciasConParametros(ora) === 2, String(sentenciasConParametros(ora)))
  const bPg = bindsPorSentencia(pg, { '1': 'a', '2': null })
  check('(2f) PG: la segunda sentencia solo lleva `1`', j(bPg[1]) === '{"1":"a"}', j(bPg[1]))

  hr('(3) Lo que NO es parámetro')

  const cli = 'SET SERVEROUTPUT ON\nselect :x from dual;'
  const pCli = parametrosDeLote(cli, dividirSentencias(cli, 'oracle'), 'oracle')
  check('(3a) el comando del cliente no pide nada; la consulta sí', j(pCli.porSentencia) === '[[],["X"]]', j(pCli.porSentencia))
  const plsql = "begin\n  v := 'a :b';\n  -- :c\n  x := :d;\nend;\n/"
  const pPlsql = parametrosDeLote(plsql, dividirSentencias(plsql, 'oracle'), 'oracle')
  check('(3b) `:=`, una cadena y un comentario no son parámetros; `:d` sí', j(pPlsql.campos.map((c) => c.clave)) === '["D"]', j(pPlsql.campos))
  const trig = 'create or replace trigger tr before insert on t for each row\nbegin\n  :new.id := 1;\nend;\n/'
  const pTrig = parametrosDeLote(trig, dividirSentencias(trig, 'oracle'), 'oracle')
  check('(3c) el `:new` de un disparador no se pide', pTrig.campos.length === 0, j(pTrig))
  const dolar = 'select $$ $1 $$, $1'
  const pDolar = parametrosDeLote(dolar, dividirSentencias(dolar, 'postgres'), 'postgres')
  check('(3d) PG: un `$1` dentro de `$$…$$` es texto; el de fuera, parámetro', j(pDolar.campos.map((c) => c.clave)) === '["1"]', j(pDolar.campos))
  const sin = 'select 1 from dual'
  check('(3e) sin parámetros: ningún campo', parametrosDeLote(sin, dividirSentencias(sin, 'oracle'), 'oracle').campos.length === 0, 'vacío')

  hr('(4) Prerrelleno')

  const recordados = new Map<string, string | null>([
    ['ID', '7'],
    ['VALOR', null]
  ])
  const v0 = valoresIniciales(ora.campos, recordados)
  check('(4a) lo recordado entra en los campos', v0.ID.texto === '7' && !v0.ID.nulo, j(v0.ID))
  check('(4b) un NULL recordado es la casilla marcada, con el texto vacío', v0.VALOR.nulo && v0.VALOR.texto === '', j(v0.VALOR))
  const v1 = valoresIniciales(ora.campos, recordados, { ID: '99' })
  check('(4c) lo que trae el lote MANDA sobre lo recordado', v1.ID.texto === '99' && v1.VALOR.nulo, j(v1))
  const v2 = valoresIniciales(ora.campos, new Map())
  check('(4d) sin nada: vacío y sin NULL', v2.ID.texto === '' && !v2.ID.nulo, j(v2))

  hr('(5) Del diálogo al contrato')

  const b = valoresABinds(ora.campos, { ID: { texto: '5', nulo: false }, VALOR: { texto: 'ignorado', nulo: true } })
  check('(5a) la casilla NULL manda null aunque haya texto', j(b) === '{"ID":"5","VALOR":null}', j(b))
  const bVacio = valoresABinds(ora.campos, { ID: { texto: '', nulo: false } })
  check('(5b) un campo vacío es la cadena vacía (no NULL: lo decide el servidor)', bVacio.ID === '' && bVacio.VALOR === '', j(bVacio))
  const r2 = recordarValores(recordados, { ID: '1' })
  check('(5c) recordar pisa lo usado y conserva lo demás, sin tocar el original', r2.get('ID') === '1' && r2.get('VALOR') === null && recordados.get('ID') === '7', j([...r2]))
  check('(5d) clavesSinValor', j(clavesSinValor(ora, { ID: '1' })) === '["VALOR"]' && clavesSinValor(ora, { ID: '1', VALOR: null }).length === 0, 'ok')
  check('(5e) clavesSinValor sin binds: todas', j(clavesSinValor(ora, undefined)) === '["ID","VALOR"]', 'ok')

  hr('(6) Textos')

  check('(6a) etiqueta Oracle simple', etiquetaDeClave('ID', 'oracle') === ':ID', etiquetaDeClave('ID', 'oracle'))
  check('(6b) etiqueta Oracle citada', etiquetaDeClave('Id', 'oracle') === ':"Id"', etiquetaDeClave('Id', 'oracle'))
  check('(6c) etiqueta Oracle numérica', etiquetaDeClave('1', 'oracle') === ':1', etiquetaDeClave('1', 'oracle'))
  check('(6d) etiqueta PG', etiquetaDeClave('2', 'postgres') === '$2', etiquetaDeClave('2', 'postgres'))
  const res = resumenBinds({ NOMBRE: null, ID: '5', NOTA: '' }, 'oracle')
  check('(6e) resumen de una pestaña: NULL y cadena vacía se distinguen', res === ":NOMBRE = NULL · :ID = 5 · :NOTA = ''", res)
  const resPg = resumenBinds({ '2': 'b', '1': 'a' }, 'postgres')
  check('(6f) resumen PG por número', resPg === '$1 = a · $2 = b', resPg)
  const largo = resumenBinds({ X: 'x'.repeat(100) }, 'oracle')
  check('(6g) un valor largo se recorta', largo.length < 60 && largo.endsWith('…'), largo)
  check('(6h) sin binds, resumen vacío', resumenBinds(undefined, 'oracle') === '', 'vacío')
  const t1 = textoDialogoParametros(1, 'ejecutar')
  const t3 = textoDialogoParametros(3, 'ejecutar')
  const tp = textoDialogoParametros(1, 'explicar')
  check('(6i) frase: una sentencia', t1.startsWith('Valores para ejecutar la sentencia.'), t1)
  check('(6j) frase: varias', t3.startsWith('Valores para ejecutar 3 sentencias del lote.'), t3)
  check('(6k) frase: plan', tp.startsWith('Valores para explicar el plan de la sentencia.'), tp)
  // El pie del diálogo lo decide `pieDialogoParametros`, fuera del componente; los textos, al byte.
  check('(6l) pie Oracle, el de antes', pieDialogoParametros('oracle') === 'Sin comillas, :id y :ID son el mismo', pieDialogoParametros('oracle'))
  check('(6m) pie PG, el de antes', pieDialogoParametros('postgres') === 'Por número: $1, $2…', pieDialogoParametros('postgres'))
  // Y cada dialecto tiene el suyo: ninguno cae en el de otro sin decirlo.
  const sinPie = (Object.keys(REGLAS) as DialectoSql[]).filter((d) => pieDialogoParametros(d) === '')
  check('(6n) todo dialecto tiene pie', sinPie.length === 0, JSON.stringify(sinPie))

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
