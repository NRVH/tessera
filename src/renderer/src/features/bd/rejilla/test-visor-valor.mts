#!/usr/bin/env node
// =============================================================================
// Prueba de `visorValor.ts` (npm run test:db-rejilla-visor): el modo de cada celda, el JSON
// formateado SIN tocar números grandes, decimales ni escapes, el volcado hex con tope, los
// textos y el tipo visible, y la clave de una fila para pedir el valor completo.
// =============================================================================

import {
  modoVisor,
  pareceJson,
  formatearJson,
  resangrarJson,
  hexAgrupado,
  describirLongitud,
  longitudDe,
  metadatosVisor,
  tipoVisible,
  avisoParcial,
  lenguajeVisor,
  textoDeCelda,
  esColumnaBinaria,
  claveDeFila,
  RAZON_SIN_CLAVE_PRIMARIA,
  TOPE_HEX_VISOR,
  TOPE_JSON_COLOREADO
} from './visorValor.ts'
import type { DbCelda } from '../../../../../shared/db-explorador-ipc.ts'

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

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) modoVisor')
  // -------------------------------------------------------------------------
  check('(1a) NULL -> nulo', modoVisor(null, 'texto') === 'nulo' && modoVisor(undefined, 'json') === 'nulo', 'nulo')
  check('(1b) texto normal -> texto', modoVisor('hola', 'texto') === 'texto', 'texto')
  check('(1c) booleano -> texto', modoVisor(true, 'booleano') === 'texto' && textoDeCelda(false) === 'false', 'texto')
  check('(1d) columna json válida -> json', modoVisor('{"a":1}', 'json') === 'json', 'json')
  check('(1e) columna json con un escalar válido -> json', modoVisor('42', 'json') === 'json', 'json')
  check('(1f) CLOB con un objeto JSON -> json', modoVisor('  {"a": [1, 2]}\n', 'lob') === 'json', 'json')
  check('(1g) VARCHAR con una lista JSON -> json', modoVisor('[1,2,3]', 'texto') === 'json', 'json')
  check('(1h) NEGATIVO: un escalar en una columna de texto NO es JSON ("42", "true")', modoVisor('42', 'texto') === 'texto' && modoVisor('true', 'texto') === 'texto', 'texto')
  check('(1i) NEGATIVO: llaves que no cierran JSON -> texto', modoVisor('{ no es json }', 'texto') === 'texto', 'texto')
  check('(1j) columna json RECORTADA (inválida) -> texto hasta tener el valor entero', modoVisor('{"a": "xxxx', 'json') === 'texto', 'texto')
  check('(1k) NEGATIVO: columna json vacía no es JSON', modoVisor('   ', 'json') === 'texto' && !pareceJson('', 'json'), 'texto')
  check('(1l) bytea -> binario', modoVisor('0xcafe', 'binario', 'bytea') === 'binario', 'binario')
  check('(1m) BLOB etiquetado como lob -> binario', modoVisor('0x00ff', 'lob', 'BLOB') === 'binario' && esColumnaBinaria('lob', 'BLOB'), 'binario')
  check('(1n) NEGATIVO: un CLOB (lob de texto) con «0x…» es texto', modoVisor('0xcafe', 'lob', 'CLOB') === 'texto', 'texto')
  check('(1o) NEGATIVO: un VARCHAR2 que empieza por 0x es texto', modoVisor('0x1234', 'texto', 'VARCHAR2') === 'texto', 'texto')
  check('(1p) binario que no es hex (no debería llegar) -> texto', modoVisor('<corrupto>', 'binario', 'RAW') === 'texto', 'texto')

  // -------------------------------------------------------------------------
  hr('(2) formatearJson')
  // -------------------------------------------------------------------------
  const normal = '{"a":[1,2,{"b":null}],"c":"x","d":true,"e":{},"f":[]}'
  const esperado = JSON.stringify(JSON.parse(normal), null, 2)
  check('(2a) lo normal sale igual que JSON.stringify(…, null, 2)', formatearJson(normal) === esperado, j(formatearJson(normal)))
  const grande = '{"id":12345678901234567890,"precio":1.10,"exp":1E+400,"neg":-0.0}'
  const fg = formatearJson(grande) ?? ''
  check('(2b) el número grande NO se redondea (12345678901234567890)', fg.includes('"id": 12345678901234567890'), fg)
  check('(2c) ni se reescribe el decimal ni el exponente (1.10, 1E+400, -0.0)', fg.includes('1.10') && fg.includes('1E+400') && fg.includes('-0.0'), fg)
  check('(2d) NO es lo que haría la receta de siempre (la que miente)', !JSON.stringify(JSON.parse(grande)).includes('12345678901234567890'), 'stringify redondea')
  const escapes = '{"t":"a\\"b\\\\c\\u00e1\\n","k":"{no es llave}"}'
  const fe = formatearJson(escapes) ?? ''
  check('(2e) los escapes se copian tal cual (\\u00e1 sigue siendo \\u00e1)', fe.includes('"a\\"b\\\\c\\u00e1\\n"') && fe.includes('"{no es llave}"'), fe)
  check('(2f) las llaves dentro de una cadena no sangran', fe.split('\n').length === 4, j(fe.split('\n')))
  check('(2g) vacíos en una línea, también con espacios dentro', formatearJson('{ "a" : [ ] , "b" : { } }') === '{\n  "a": [],\n  "b": {}\n}', j(formatearJson('{ "a" : [ ] , "b" : { } }')))
  check('(2h) espacios y saltos de origen se descartan', formatearJson('[\n\t1 ,\r\n 2 ]') === '[\n  1,\n  2\n]', j(formatearJson('[\n\t1 ,\r\n 2 ]')))
  check('(2i) primitivas: igual', formatearJson(' 42 ') === '42' && formatearJson('"x"') === '"x"' && formatearJson('null') === 'null', 'ok')
  check('(2j) NEGATIVO: lo que no es JSON devuelve null', formatearJson('{"a":') === null && formatearJson('') === null, 'null')
  check('(2k) sangría configurable (4)', resangrarJson('{"a":1}', 4) === '{\n    "a": 1\n}', j(resangrarJson('{"a":1}', 4)))
  const anidado = '[[[[1]]]]'
  check('(2l) anidado profundo', formatearJson(anidado) === JSON.stringify(JSON.parse(anidado), null, 2), j(formatearJson(anidado)))

  // -------------------------------------------------------------------------
  hr('(3) hexAgrupado')
  // -------------------------------------------------------------------------
  // 'Hola, mundo!\n' + 0x00 0xff 0x7f
  const bytes = [...'Hola, mundo!\n'].map((c) => c.charCodeAt(0)).concat([0x00, 0xff, 0x7f, 0x41])
  const hex = '0x' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  const h = hexAgrupado(hex)
  const lineas = h?.texto.split('\n') ?? []
  check('(3a) cuenta los bytes', h?.bytes === 17 && h.mostrados === 17, j({ bytes: h?.bytes, mostrados: h?.mostrados }))
  check(
    '(3b) primera línea como hexdump -C (minúsculas, dos grupos de 8, ASCII)',
    lineas[0] === '00000000  48 6f 6c 61 2c 20 6d 75  6e 64 6f 21 0a 00 ff 7f  |Hola, mundo!....|',
    j(lineas[0])
  )
  check(
    '(3c) la última línea, corta, conserva las columnas (el ASCII queda alineado)',
    // Tras «41»: su espacio, 15 huecos de 3, el espacio entre grupos y el de antes de «|».
    lineas[1] === '00000010  41' + ' '.repeat(1 + 3 * 15 + 1 + 1) + '|A|' && lineas[1].indexOf('|') === lineas[0].indexOf('|'),
    j(lineas[1])
  )
  const topado = hexAgrupado('0x' + 'ab'.repeat(100), 32)
  check('(3d) con tope: vuelca solo los primeros N', topado?.bytes === 100 && topado.mostrados === 32 && topado.texto.split('\n').length === 2, j({ b: topado?.bytes, m: topado?.mostrados }))
  check('(3e) el tope por defecto es 1 MiB', TOPE_HEX_VISOR === 1024 * 1024, String(TOPE_HEX_VISOR))
  const vacio = hexAgrupado('0x')
  check('(3f) binario vacío: 0 bytes y texto vacío', vacio?.bytes === 0 && vacio.texto === '', j(vacio))
  check('(3g) NEGATIVO: hex impar o con letras raras -> null', hexAgrupado('0xabc') === null && hexAgrupado('0xzz') === null, 'null')
  check('(3h) sin prefijo también vale', hexAgrupado('41')?.texto.endsWith('|A|') === true, 'ok')

  // -------------------------------------------------------------------------
  hr('(4) textos')
  // -------------------------------------------------------------------------
  check('(4a) singular', describirLongitud(1, false) === '1 carácter' && describirLongitud(1, true) === '1 byte', 'ok')
  check('(4b) plural con miles a la RAE', describirLongitud(12345, false) === `12${NBSP}345 caracteres` && describirLongitud(2048, true) === '2048 bytes', describirLongitud(12345, false))
  check('(4c) cero y absurdos', describirLongitud(0, false) === '0 caracteres' && describirLongitud(Number.NaN, true) === '0 bytes', 'ok')
  check('(4d) longitudDe: caracteres del texto y bytes del hex', longitudDe('hola', 'texto') === 4 && longitudDe('0xcafe', 'binario') === 2 && longitudDe(null, 'nulo') === 0, 'ok')
  check('(4e) metadatos: tipo · longitud', metadatosVisor('VARCHAR2', 'texto', 12) === 'VARCHAR2 · 12 caracteres', metadatosVisor('VARCHAR2', 'texto', 12))
  check('(4f) metadatos: NULL y binario', metadatosVisor('BLOB', 'nulo', 0) === 'BLOB · NULL' && metadatosVisor('bytea', 'binario', 1) === 'bytea · 1 byte', 'ok')
  check('(4g) metadatos sin tipo del motor', metadatosVisor('  ', 'texto', 2) === '2 caracteres', metadatosVisor('  ', 'texto', 2))
  // En una pestaña de tabla de Oracle el main trae el tipo DECLARADO
  // del catálogo, que es el que se enseña; el del trabajador ('VARCHAR2', sin el tamaño que
  // el driver no sabe dar con su unidad) queda para lo demás, y para decidir.
  const declarada = tipoVisible({ tipoMotor: 'VARCHAR2', tipoDeclarado: 'VARCHAR2(40 CHAR)' })
  const sinDeclarado = tipoVisible({ tipoMotor: 'NVARCHAR2(20)' })
  const declaradoVacio = tipoVisible({ tipoMotor: 'VARCHAR2', tipoDeclarado: '  ' })
  check(
    '(4m) tipoVisible: el declarado si lo hay (VARCHAR2(40 CHAR)), y si no (o viene vacío) el del trabajador',
    declarada === 'VARCHAR2(40 CHAR)' && sinDeclarado === 'NVARCHAR2(20)' && declaradoVacio === 'VARCHAR2',
    JSON.stringify([declarada, sinDeclarado, declaradoVacio])
  )
  check(
    '(4n) y es lo que lleva la cabecera del visor',
    metadatosVisor(declarada, 'texto', 12) === 'VARCHAR2(40 CHAR) · 12 caracteres',
    metadatosVisor(declarada, 'texto', 12)
  )
  check('(4h) aviso parcial', avisoParcial(65536, 180000, false) === `Se muestran 65${NBSP}536 de 180${NBSP}000 caracteres`, avisoParcial(65536, 180000, false))
  check('(4i) aviso parcial de binario', avisoParcial(10, 20, true) === 'Se muestran 10 de 20 bytes', avisoParcial(10, 20, true))
  check('(4j) JSON pequeño se colorea', lenguajeVisor('json', 100) === 'json', 'json')
  check('(4k) JSON de más de 2 MiB va como texto plano', lenguajeVisor('json', TOPE_JSON_COLOREADO + 1) === 'plaintext' && lenguajeVisor('json', TOPE_JSON_COLOREADO) === 'json', 'plaintext')
  check('(4l) texto y binario, texto plano', lenguajeVisor('texto', 5) === 'plaintext' && lenguajeVisor('binario', 5) === 'plaintext', 'plaintext')

  // -------------------------------------------------------------------------
  hr('(5) claveDeFila (volver a encontrar la fila por su PK)')
  // -------------------------------------------------------------------------
  const nombres = ['NOMBRE', 'ID_B', 'ID_A', 'NOTA']
  const fila: DbCelda[] = ['Ana', '7', '3', 'x'.repeat(10)]
  const nunca = (): boolean => false
  check('(5a) en el orden de la PK, no en el de las columnas', j(claveDeFila(nombres, ['ID_A', 'ID_B'], fila, nunca)) === j({ ok: true, valores: ['3', '7'] }), j(claveDeFila(nombres, ['ID_A', 'ID_B'], fila, nunca)))
  const sinPk = claveDeFila(nombres, [], fila, nunca)
  check('(5b) sin PK: la razón que enseña el visor', !sinPk.ok && sinPk.error === RAZON_SIN_CLAVE_PRIMARIA && RAZON_SIN_CLAVE_PRIMARIA.startsWith('La tabla no tiene clave primaria'), j(sinPk))
  check('(5c) NEGATIVO: por nombre EXACTO (en PG "ID" e id son dos columnas)', !claveDeFila(['id'], ['ID'], ['1'], nunca).ok, 'no casa')
  check('(5d) una celda de la PK recortada no sirve para buscar', !claveDeFila(nombres, ['ID_A'], fila, (c) => c === 2).ok, 'error')
  check('(5e) sin fila (ya no está cargada): error', !claveDeFila(nombres, ['ID_A'], undefined, nunca).ok, 'error')
  check('(5f) una PK con NULL (no debería) se manda tal cual', j(claveDeFila(['A'], ['A'], [null], nunca)) === j({ ok: true, valores: [null] }), 'ok')

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
