#!/usr/bin/env node
// =============================================================================
// Prueba de `exportarMongodb.cjs` (npm run test:exportar-mongodb): una página de documentos como filas de JSON y de
// CSV, con los tipos BSON que no tienen forma obvia en un archivo (ObjectId, fechas, Long, Decimal128, subdocumentos).
// No necesita servidor: corre sobre documentos construidos con el driver.
// =============================================================================

import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const { paginaExportada, celdaCsv, FORMATOS } = require_('./exportarMongodb.cjs') as {
  paginaExportada: (docs: unknown[], formato: string, columnas: string[]) => { filas: Array<Array<string | null>>; omitidos: number }
  celdaCsv: (v: unknown) => string | null
  FORMATOS: string[]
}
const { ObjectId, Long, Decimal128, Int32, Double, Binary, Timestamp, EJSON } = (require_('mongodb') as { BSON: Record<string, any> }).BSON

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: Array<{ name: string; pass: boolean }> = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence.slice(0, 300)}`)
}
const j = (v: unknown): string => JSON.stringify(v) ?? 'undefined'

const id = new ObjectId('65a1b2c3d4e5f60718293a4b')
const fecha = new Date('2026-09-28T23:59:59.000Z')

hr('(1) Formatos')
check('los dos formatos son json y csv', j(FORMATOS) === j(['json', 'csv']), j(FORMATOS))

hr('(2) JSON: un documento por fila, en EJSON relajado')
{
  const doc = { _id: id, nombre: 'Ana "la" primera', edad: new Int32(30), saldo: new Double(12.5), grande: Long.fromString('9007199254740993'), creado: fecha, dir: { ciudad: 'Lima' }, etiquetas: ['a', 'b'], nada: null }
  const { filas, omitidos } = paginaExportada([doc], 'json', [])
  check('una fila con una celda', filas.length === 1 && filas[0].length === 1 && omitidos === 0, j(filas))
  const texto = filas[0][0] as string
  const vuelta = JSON.parse(texto)
  check('es JSON válido en una sola línea', !texto.includes('\n') && vuelta.nombre === 'Ana "la" primera', texto)
  check('el ObjectId y la fecha llevan su envoltorio ($oid, $date)', vuelta._id?.$oid === '65a1b2c3d4e5f60718293a4b' && typeof vuelta.creado?.$date === 'string', texto)
  check('los números van como números; subdocumentos y listas, enteros', vuelta.edad === 30 && vuelta.saldo === 12.5 && vuelta.dir.ciudad === 'Lima' && j(vuelta.etiquetas) === '["a","b"]' && vuelta.nada === null, texto)
  check('el documento vuelve a ser el mismo con EJSON', EJSON.parse(texto).nombre === doc.nombre && EJSON.parse(texto)._id.equals(id), '')
}

hr('(3) CSV: una fila por documento, con las columnas dadas')
{
  const docs = [
    { _id: id, nombre: 'Ana', edad: new Int32(30), creado: fecha, dir: { ciudad: 'Lima' } },
    { _id: new ObjectId('65a1b2c3d4e5f60718293a4c'), nombre: 'Luis, "el" grande', extra: 'fuera' }
  ]
  const { filas, omitidos } = paginaExportada(docs, 'csv', ['_id', 'nombre', 'edad', 'creado', 'dir'])
  check('las celdas siguen el orden de las columnas', j(filas[0]) === j(['65a1b2c3d4e5f60718293a4b', 'Ana', '30', '2026-09-28T23:59:59.000Z', '{"ciudad":"Lima"}']), j(filas[0]))
  check('un campo ausente es una celda vacía y el texto con comas se deja tal cual (el escritor lo entrecomilla)', j(filas[1]) === j(['65a1b2c3d4e5f60718293a4c', 'Luis, "el" grande', null, null, null]), j(filas[1]))
  check('un documento con un campo fuera de las columnas se cuenta como omitido', omitidos === 1, String(omitidos))
  const sinOmitidos = paginaExportada([docs[0]], 'csv', ['_id', 'nombre', 'edad', 'creado', 'dir'])
  check('… y uno que cabe entero, no', sinOmitidos.omitidos === 0, String(sinOmitidos.omitidos))
}

hr('(4) Cada tipo, como celda')
{
  const casos: Array<[string, unknown, string | null]> = [
    ['null', null, null],
    ['undefined', undefined, null],
    ['texto', 'hola', 'hola'],
    ['true', true, 'true'],
    ['número', 3.5, '3.5'],
    ['Int32', new Int32(7), '7'],
    ['Double entero', new Double(3), '3'],
    ['Long', Long.fromString('9007199254740993'), '9007199254740993'],
    ['Decimal128', Decimal128.fromString('0.1'), '0.1'],
    ['ObjectId', id, '65a1b2c3d4e5f60718293a4b'],
    ['fecha', fecha, '2026-09-28T23:59:59.000Z'],
    ['fecha inválida', new Date('x'), null],
    ['lista', [1, 'a'], '[1,"a"]'],
    ['subdocumento', { a: { b: 1 } }, '{"a":{"b":1}}'],
    ['Timestamp', new Timestamp({ t: 5, i: 2 }), 'Timestamp(5, 2)'],
    ['UUID', new Binary(Buffer.from('0123456789abcdef0123456789abcdef', 'hex'), 4), 'UUID("01234567-89ab-cdef-0123-456789abcdef")']
  ]
  for (const [nombre, valor, esperado] of casos) check(nombre, celdaCsv(valor) === esperado, j(celdaCsv(valor)))
}

const pasan = results.filter((r) => r.pass).length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${pasan === results.length ? ' — TODO PASS' : ' — HAY FAIL'}`)
process.exit(pasan === results.length ? 0 : 1)
