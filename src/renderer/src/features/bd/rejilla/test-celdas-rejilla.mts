#!/usr/bin/env node
// =============================================================================
// Prueba de `celdasRejilla.ts` y del TSV de `copiarComo.ts` (npm run test:db-rejilla-celdas):
// qué se pinta (`<null>`, números, saltos, corte a 300, binario), `formatoEntero`, la
// validación de páginas, los recortes, el presupuesto (nunca la visible) y el TSV byte a
// byte (comillas, NULL vacío).
// =============================================================================

import {
  textoCelda,
  formatoEntero,
  parsearPagina,
  aplicarRecortes,
  longitudOriginal,
  anexarPagina,
  presupuesto,
  rejillasALiberar,
  soloPrimeraPagina,
  SIN_RECORTES,
  TOPE_CELDAS_MEMORIA,
  LARGO_VISIBLE_CELDA,
  TEXTO_NULO,
  type DatosRejilla
} from './celdasRejilla.ts'
import { copiarComo, campoTsv } from './copiarComo.ts'
import type { DbPagina } from '../../../../../shared/db-explorador-ipc.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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

const j = (x: unknown): string => JSON.stringify(x)
const NBSP = String.fromCharCode(160)

function pagina(filas: unknown[], desde: number, hayMas: boolean, recortes?: DbPagina['recortes']): DbPagina {
  return { filasJson: JSON.stringify(filas), desde, hayMas, recortes }
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) textoCelda')
  // -------------------------------------------------------------------------
  const nulo = textoCelda(null, 'texto')
  check('(1a) NULL -> <null>, clase nulo', nulo.texto === TEXTO_NULO && nulo.texto === '<null>' && nulo.clase === 'nulo' && !nulo.truncado, j(nulo))
  check('(1b) NULL en una columna numérica sigue siendo nulo', textoCelda(null, 'numero').clase === 'nulo', 'nulo')
  const vacio = textoCelda('', 'texto')
  check('(1c) cadena vacía NO es <null>', vacio.texto === '' && vacio.clase === 'texto', j(vacio))
  const grande = '12345678901234567890123456789012345678'
  const num = textoCelda(grande, 'numero')
  check('(1d) NUMBER(38) se pinta EXACTO, clase num, sin formatear', num.texto === grande && num.clase === 'num', j(num))
  check('(1e) decimal con punto intacto', textoCelda('-0.000001', 'numero').texto === '-0.000001', 'ok')
  check('(1f) booleano de PG -> true/false, clase bool', textoCelda(true, 'booleano').texto === 'true' && textoCelda(false, 'texto').clase === 'bool', 'ok')
  check('(1g) fecha y fechaHora -> clase fecha, texto tal cual', textoCelda('2026-09-25 10:00:00', 'fechaHora').clase === 'fecha' && textoCelda('2026-09-25', 'fecha').texto === '2026-09-25', 'ok')
  const multilinea = textoCelda('uno\r\ndos\ntres\rcuatro', 'texto')
  check('(1h) CRLF, LF y CR se ven como ⏎ en una sola línea', multilinea.texto === 'uno ⏎ dos ⏎ tres ⏎ cuatro' && !multilinea.truncado, j(multilinea))
  const largo = textoCelda('x'.repeat(1000), 'texto')
  check('(1i) más de 300: se corta a 300 + …, truncado', largo.texto.length === LARGO_VISIBLE_CELDA + 1 && largo.texto.endsWith('…') && largo.truncado && !largo.incompleto, `${largo.texto.length} chars`)
  const justo = textoCelda('x'.repeat(300), 'texto')
  check('(1j) exactamente 300: entero, sin …', justo.texto.length === 300 && !justo.truncado, `${justo.texto.length}`)
  const expandido = textoCelda('\n'.repeat(150), 'texto')
  check('(1k) 150 saltos (450 al pintarlos): también se corta', expandido.truncado && expandido.texto.length === 301, `${expandido.texto.length}`)
  const emoji = textoCelda('x'.repeat(299) + '😀' + 'y', 'texto')
  const ultimo = emoji.texto.charCodeAt(emoji.texto.length - 2)
  check('(1l) el corte no deja medio emoji (sustituto suelto)', !(ultimo >= 0xd800 && ultimo <= 0xdbff) && emoji.texto.endsWith('…'), `len=${emoji.texto.length}`)
  const bin = textoCelda('0x' + 'ab'.repeat(16), 'binario')
  check('(1m) binario 0x… -> <binario 16 bytes>, clase bin', bin.texto === '<binario 16 bytes>' && bin.clase === 'bin' && !bin.incompleto, j(bin))
  check('(1n) un solo byte en singular', textoCelda('0xff', 'binario').texto === '<binario 1 byte>', textoCelda('0xff', 'binario').texto)
  check('(1o) binario vacío (0x) -> 0 bytes', textoCelda('0x', 'binario').texto === '<binario 0 bytes>', textoCelda('0x', 'binario').texto)
  const binRecortado = textoCelda('0x' + 'ab'.repeat(8), 'binario', { longitudOriginal: 123_456 })
  check(
    '(1p) binario recortado: N es la longitud ORIGINAL, incompleto y truncado',
    binRecortado.texto === `<binario 123${NBSP}456 bytes>` && binRecortado.incompleto && binRecortado.truncado,
    j(binRecortado)
  )
  const blob = textoCelda('0xcafe', 'lob', { tipoMotor: 'BLOB' })
  check('(1q) un lob que es BLOB (hex) se pinta como binario', blob.texto === '<binario 2 bytes>' && blob.clase === 'bin', j(blob))
  const clob = textoCelda('0xcafe es texto', 'lob', { tipoMotor: 'CLOB' })
  check('(1r) un CLOB que empieza por 0x sigue siendo texto (clase lob)', clob.texto === '0xcafe es texto' && clob.clase === 'lob', j(clob))
  const clobRecortado = textoCelda('abc', 'lob', { longitudOriginal: 70_000 })
  check('(1s) CLOB recortado por el main: incompleto y truncado aunque se vea corto', clobRecortado.incompleto && clobRecortado.truncado, j(clobRecortado))
  const noHex = textoCelda('???', 'binario')
  check('(1t) binario que no es hex: se pinta el texto, clase bin', noHex.texto === '???' && noHex.clase === 'bin', j(noHex))
  check('(1u) json/otro -> clase texto', textoCelda('{"a":1}', 'json').clase === 'texto' && textoCelda('x', 'otro').clase === 'texto', 'ok')

  // -------------------------------------------------------------------------
  hr('(2) formatoEntero')
  // -------------------------------------------------------------------------
  check('(2a) cuatro cifras sin separar (RAE)', formatoEntero(1234) === '1234', formatoEntero(1234))
  check('(2b) cinco cifras: 12 345 con espacio duro', formatoEntero(12_345) === `12${NBSP}345`, j(formatoEntero(12_345)))
  check('(2c) millones', formatoEntero(2_000_000) === `2${NBSP}000${NBSP}000`, j(formatoEntero(2_000_000)))
  check('(2d) negativos y cero', formatoEntero(-12_345) === `-12${NBSP}345` && formatoEntero(0) === '0', 'ok')

  // -------------------------------------------------------------------------
  hr('(3) parsearPagina')
  // -------------------------------------------------------------------------
  const ok = parsearPagina(JSON.stringify([['1', null, true], ['2', 'b', false]]), 3)
  check('(3a) página válida', ok.ok && ok.filas.length === 2 && ok.filas[0][1] === null, j(ok))
  const roto = parsearPagina('[[1,', 3)
  check('(3b) JSON roto: error, no excepción', !roto.ok && /JSON/.test(roto.error), j(roto))
  const noLista = parsearPagina('{"a":1}')
  check('(3c) no es una lista: error', !noLista.ok, j(noLista))
  const filaNoLista = parsearPagina('[["a"], "b"]')
  check('(3d) una fila que no es lista: error con su número', !filaNoLista.ok && filaNoLista.error.includes('fila 2'), j(filaNoLista))
  const corta = parsearPagina(JSON.stringify([['1', '2'], ['3']]), 2)
  check('(3e) fila con menos celdas que columnas: error', !corta.ok && corta.error.includes('fila 2'), j(corta))
  const numero = parsearPagina(JSON.stringify([['1', 2]]), 2)
  check('(3f) un NÚMERO se rechaza (perdió precisión por el camino)', !numero.ok && numero.error.includes('number'), j(numero))
  const objeto = parsearPagina(JSON.stringify([[{ a: 1 }]]))
  check('(3g) un objeto en una celda: error', !objeto.ok, j(objeto))
  check('(3h) sin numColumnas no se exige largo', parsearPagina(JSON.stringify([['a'], ['b', 'c']])).ok, 'ok')
  check('(3i) página vacía es válida', parsearPagina('[]', 5).ok, 'ok')

  // -------------------------------------------------------------------------
  hr('(4) recortes y anexarPagina')
  // -------------------------------------------------------------------------
  const r1 = aplicarRecortes(SIN_RECORTES, [[0, 1, 70_000]], 500, { filas: 2, columnas: 3 })
  check('(4a) recorte relativo a la página -> fila ABSOLUTA', longitudOriginal(r1, 500, 1) === 70_000 && longitudOriginal(r1, 0, 1) === undefined, j([...r1.keys()]))
  check('(4b) sin recortes devuelve el MISMO mapa', aplicarRecortes(r1, undefined, 0, { filas: 2, columnas: 3 }) === r1 && aplicarRecortes(r1, [], 0, { filas: 2, columnas: 3 }) === r1, 'misma ref')
  const r2 = aplicarRecortes(r1, [[5, 0, 1], [0, 9, 1], [-1, 0, 1]], 502, { filas: 2, columnas: 3 })
  check('(4c) recortes fuera de la página se ignoran (y no crean mapa nuevo)', r2 === r1, 'misma ref')
  const r3 = aplicarRecortes(r1, [[0, 2, 99]], 500, { filas: 2, columnas: 3 })
  check('(4d) inmutable: el mapa previo no cambia', longitudOriginal(r1, 500, 2) === undefined && longitudOriginal(r3, 500, 2) === 99 && longitudOriginal(r3, 500, 1) === 70_000, 'ok')

  const a1 = anexarPagina(null, pagina([['1', 'a'], ['2', 'b']], 0, true, [[1, 1, 5000]]), 2)
  check('(4e) primera página', a1.ok && a1.datos.filas.length === 2 && a1.datos.hayMas && longitudOriginal(a1.datos.recortes, 1, 1) === 5000, j(a1))
  const d1 = (a1 as { ok: true; datos: DatosRejilla }).datos
  const a2 = anexarPagina(d1, pagina([['3', 'c']], 2, false, [[0, 0, 7]]), 2)
  check(
    '(4f) segunda página: se concatena, recortes en absoluto, hayMas del último',
    a2.ok && a2.datos.filas.length === 3 && !a2.datos.hayMas && longitudOriginal(a2.datos.recortes, 2, 0) === 7 && longitudOriginal(a2.datos.recortes, 1, 1) === 5000,
    j(a2.ok ? a2.datos.filas : a2)
  )
  check('(4g) inmutable: la primera página no cambió', d1.filas.length === 2, `${d1.filas.length}`)
  const saltada = anexarPagina(d1, pagina([['9', 'z']], 5, false), 2)
  check('(4h) página que no empieza donde acaba lo cargado: error', !saltada.ok && saltada.error.includes('fila 6'), j(saltada))
  const repetida = anexarPagina(d1, pagina([['2', 'b']], 1, false), 2)
  check('(4i) página repetida (solapa): error', !repetida.ok, j(repetida))
  const reinicio = anexarPagina(d1, pagina([['x', 'y']], 0, false), 2)
  check('(4j) desde 0 con datos previos = se volvió a ejecutar: reemplaza', reinicio.ok && reinicio.datos.filas.length === 1 && reinicio.datos.recortes === SIN_RECORTES, j(reinicio.ok ? reinicio.datos.filas : reinicio))
  const malas = anexarPagina(d1, pagina([['3']], 2, false), 2)
  check('(4k) una página mal formada no toca lo cargado', !malas.ok && d1.filas.length === 2, j(malas))

  // -------------------------------------------------------------------------
  hr('(5) presupuesto de memoria')
  // -------------------------------------------------------------------------
  check('(5a) TOPE_CELDAS_MEMORIA = 2 000 000', TOPE_CELDAS_MEMORIA === 2_000_000, String(TOPE_CELDAS_MEMORIA))
  const p1 = presupuesto(1_500_000)
  check('(5b) por debajo: no excedido, restantes', !p1.excedido && p1.restantes === 500_000, j(p1))
  check('(5c) justo en el tope: excedido (ya no carga más sola)', presupuesto(2_000_000).excedido, j(presupuesto(2_000_000)))
  check('(5d) negativo/absurdo se trata como 0', presupuesto(-5).usadas === 0, j(presupuesto(-5)))
  const rejillas = [
    { id: 'visible', celdas: 1_200_000, celdasPrimeraPagina: 50_000, visible: true, usadaEn: 100 },
    { id: 'vieja', celdas: 600_000, celdasPrimeraPagina: 50_000, visible: false, usadaEn: 1 },
    { id: 'reciente', celdas: 500_000, celdasPrimeraPagina: 50_000, visible: false, usadaEn: 50 },
    { id: 'pequena', celdas: 50_000, celdasPrimeraPagina: 50_000, visible: false, usadaEn: 0 }
  ]
  // total 2 350 000; soltar 'vieja' quita 550 000 -> 1 800 000 <= 2 M
  check('(5e) suelta la oculta MENOS usada y para en cuanto alcanza', j(rejillasALiberar(rejillas)) === j(['vieja']), j(rejillasALiberar(rejillas)))
  check('(5f) bajo el tope: nada', rejillasALiberar(rejillas.slice(0, 2)).length === 0, j(rejillasALiberar(rejillas.slice(0, 2))))
  const soloVisible = [{ id: 'v', celdas: 3_000_000, celdasPrimeraPagina: 50_000, visible: true, usadaEn: 1 }]
  check('(5g) nunca suelta la visible, aunque se pase ella sola', rejillasALiberar(soloVisible).length === 0 && presupuesto(3_000_000).excedido, 'ok')
  check('(5h) la que sólo tiene su primera página no cuenta como candidata', !rejillasALiberar(rejillas, 100).includes('pequena'), j(rejillasALiberar(rejillas, 100)))
  // soloPrimeraPagina: lo que queda de una rejilla liberada.
  const cinco: DatosRejilla = {
    filas: [['a'], ['b'], ['c'], ['d'], ['e']],
    recortes: aplicarRecortes(SIN_RECORTES, [[1, 0, 900], [3, 0, 800]], 0, { filas: 5, columnas: 1 }),
    hayMas: false
  }
  const suelta = soloPrimeraPagina(cinco, 2)
  check(
    '(5i) soloPrimeraPagina: conserva las n primeras, hayMas a true (lo soltado sigue en el servidor)',
    suelta.filas.length === 2 && suelta.filas[1][0] === 'b' && suelta.hayMas,
    j(suelta.filas)
  )
  check(
    '(5j) …y solo los recortes de ESAS filas',
    longitudOriginal(suelta.recortes, 1, 0) === 900 && longitudOriginal(suelta.recortes, 3, 0) === undefined,
    j([...suelta.recortes.keys()])
  )
  check('(5k) sin nada que soltar devuelve la MISMA referencia', soloPrimeraPagina(cinco, 5) === cinco && soloPrimeraPagina(cinco, 9) === cinco, 'misma')
  const sinRecortesFuera = soloPrimeraPagina(cinco, 4)
  check('(5l) si ningún recorte cae fuera, el mapa se reutiliza', sinRecortesFuera.recortes === cinco.recortes, 'mismo mapa')
  const recortesSoloFuera: DatosRejilla = { ...cinco, recortes: aplicarRecortes(SIN_RECORTES, [[4, 0, 5]], 0, { filas: 5, columnas: 1 }) }
  check('(5m) si todos caen fuera, vuelve a SIN_RECORTES', soloPrimeraPagina(recortesSoloFuera, 2).recortes === SIN_RECORTES, 'SIN_RECORTES')

  // -------------------------------------------------------------------------
  hr('(6) copiarComo (TSV)')
  // -------------------------------------------------------------------------
  const columnas = [{ nombre: 'ID' }, { nombre: 'NOMBRE' }, { nombre: 'NOTA' }, { nombre: 'ACTIVO' }]
  const filas = [
    ['1', 'Ana', null, true],
    ['2', 'con\ttab', 'dos\nlíneas', false],
    ['3', 'dice "hola"', '', null]
  ]
  const todoRango = { f0: 0, f1: 2, c0: 0, c1: 3 }
  const tsv = copiarComo('tsv', { columnas, filas, rango: todoRango })
  const esperado = ['1\tAna\t\ttrue', '2\t"con\ttab"\t"dos\nlíneas"\tfalse', '3\t"dice ""hola"""\t\t'].join('\n')
  check('(6a) TSV: NULL vacío, tab/salto/comillas entre comillas, sin salto final', tsv.texto === esperado, j(tsv.texto))
  check('(6b) cuenta filas y columnas', tsv.filas === 3 && tsv.columnas === 4, j(tsv))
  const cab = copiarComo('tsvCabecera', { columnas, filas, rango: { f0: 1, f1: 1, c0: 1, c1: 2 } })
  check('(6c) TSV con cabecera sobre un subrango', cab.texto === 'NOMBRE\tNOTA\n"con\ttab"\t"dos\nlíneas"', j(cab.texto))
  const fuera = copiarComo('tsv', { columnas, filas, rango: { f0: 2, f1: 900, c0: 3, c1: 50 } })
  check('(6d) rango más allá de lo cargado se acota', fuera.texto === '' && fuera.filas === 1 && fuera.columnas === 1, j(fuera))
  const soloCab = copiarComo('tsvCabecera', { columnas, filas: [], rango: { f0: 0, f1: 0, c0: 0, c1: 1 } })
  check('(6e) sin filas cargadas y con cabecera: sólo la cabecera', soloCab.texto === 'ID\tNOMBRE' && soloCab.filas === 0, j(soloCab))
  const recortes = aplicarRecortes(SIN_RECORTES, [[1, 2, 99_999]], 0, { filas: 3, columnas: 4 })
  const conRecorte = copiarComo('tsv', { columnas, filas, rango: todoRango, recortes })
  check('(6f) cuenta las celdas incompletas (LOB recortado)', conRecorte.incompletas === 1, j(conRecorte.incompletas))
  check('(6g) campoTsv: sin nada especial, tal cual; CR también entrecomilla', campoTsv('abc') === 'abc' && campoTsv('a\rb') === '"a\rb"', 'ok')
  check('(6h) cabecera con carácter especial también se entrecomilla', copiarComo('tsvCabecera', { columnas: [{ nombre: 'A"B' }], filas: [['x']], rango: { f0: 0, f1: 0, c0: 0, c1: 0 } }).texto === '"A""B"\nx', 'ok')
  check('(6i) el binario se copia en su hex (lo reutilizable)', copiarComo('tsv', { columnas: [{ nombre: 'B' }], filas: [['0xcafe']], rango: { f0: 0, f1: 0, c0: 0, c1: 0 } }).texto === '0xcafe', 'ok')

  // ---------------------------------------------------------------------------
  // Reporte final
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
