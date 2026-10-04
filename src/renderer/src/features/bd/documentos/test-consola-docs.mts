#!/usr/bin/env node
// =============================================================================
// Prueba de la lógica pura de la consola de documentos (`consolaDocs.ts`):
// (node src/renderer/src/features/bd/documentos/test-consola-docs.mts)
// Fija dónde corta una sentencia del shell y dónde no (`;`, línea en blanco, delimitadores
// abiertos, cadenas, plantillas, comentarios, regex), los offsets, la sentencia bajo el
// cursor, la selección y los textos de los resultados.
// =============================================================================

import {
  baseTrasResultado,
  dividirSentenciasShell,
  resumenEscritura,
  sentenciaShellEnCursor,
  sentenciasShellAEjecutar,
  textoResultadoDocs,
  unirColumnas,
  verboSentencia,
  type SentenciaShell
} from './consolaDocs.ts'

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

const textos = (ss: readonly SentenciaShell[]): string[] => ss.map((s) => s.texto)
const json = (v: unknown): string => JSON.stringify(v)
const igual = (a: unknown, b: unknown): boolean => json(a) === json(b)

function casoTextos(nombre: string, texto: string, esperado: string[]): void {
  const t = textos(dividirSentenciasShell(texto))
  check(nombre, igual(t, esperado), json(t))
}

function main(): void {
  hr('(1) Cortes: `;`, línea en blanco; el salto suelto no')
  casoTextos('dos sentencias con ;', 'db.a.find(); db.b.find()', ['db.a.find()', 'db.b.find()'])
  casoTextos('línea en blanco sin ;', 'db.a.find()\n\ndb.b.countDocuments()', ['db.a.find()', 'db.b.countDocuments()'])
  casoTextos('línea en blanco con espacios', 'show dbs\n   \t\nuse pruebas', ['show dbs', 'use pruebas'])
  casoTextos('cadena de métodos en varias líneas', 'db.a.find({})\n  .sort({ _id: -1 })\n  .limit(5)', [
    'db.a.find({})\n  .sort({ _id: -1 })\n  .limit(5)'
  ])
  casoTextos('; vacíos no crean sentencias', ';;  db.a.find();;\n;', ['db.a.find()'])
  casoTextos('texto vacío o solo blancos', '  \n\n\t ', [])

  hr('(2) Lo abierto no corta')
  casoTextos('filtro con línea en blanco dentro de la llave', 'db.a.find({\n  a: 1,\n\n  b: 2\n})\n\ndb.b.find()', [
    'db.a.find({\n  a: 1,\n\n  b: 2\n})',
    'db.b.find()'
  ])
  casoTextos('; dentro de paréntesis', 'db.a.aggregate([{ $match: { a: 1 } }; ])', ['db.a.aggregate([{ $match: { a: 1 } }; ])'])
  casoTextos('corchete abierto hasta el final', 'db.a.aggregate([\n  { $match: {} },\n\n', ['db.a.aggregate([\n  { $match: {} },'])
  casoTextos('cierre de más no rompe lo siguiente', 'db.a.find())\n\ndb.b.find()', ['db.a.find())', 'db.b.find()'])

  hr('(3) Cadenas y plantillas')
  casoTextos('; y llaves dentro de comillas dobles', 'db.a.find({ n: "x; {y" }); db.b.find()', ['db.a.find({ n: "x; {y" })', 'db.b.find()'])
  casoTextos("comilla simple escapada", "db.a.find({ n: 'it\\'s; ok' }); x", ["db.a.find({ n: 'it\\'s; ok' })", 'x'])
  casoTextos('plantilla con ; y línea en blanco', 'db.a.find({ n: `a;\n\nb` }); x', ['db.a.find({ n: `a;\n\nb` })', 'x'])
  casoTextos('plantilla con ${…} con llaves', 'db.a.find({ n: `a${ {x:1}.x };` }); y', ['db.a.find({ n: `a${ {x:1}.x };` })', 'y'])
  casoTextos('plantilla anidada', 'x(`a${`b;`}c`); y', ['x(`a${`b;`}c`)', 'y'])
  // La cadena sin cerrar acaba en su línea (no se traga el resto de la consola); la llave
  // sigue abierta, así que la línea en blanco no corta: el main dirá el error.
  casoTextos('cadena sin cerrar acaba en su línea', 'x = "abc\n\ndb.b.find()', ['x = "abc', 'db.b.find()'])
  casoTextos('cadena sin cerrar con llave abierta: una sola', 'db.a.find({ n: "abc\n\ndb.b.find()', ['db.a.find({ n: "abc\n\ndb.b.find()'])

  hr('(4) Comentarios')
  const conComentarios = '// usuarios activos\ndb.u.find({ activo: true }) // tras\n\n/* bloque\n\n;con ; */ db.v.find(/* en medio */ {})'
  const cc = dividirSentenciasShell(conComentarios)
  check(
    'los comentarios de delante y detrás no viajan; los de dentro sí',
    igual(textos(cc), ['db.u.find({ activo: true })', 'db.v.find(/* en medio */ {})']),
    json(textos(cc))
  )
  check('desde apunta al primer carácter de código', cc[0].desde === conComentarios.indexOf('db.u'), `desde=${cc[0].desde}`)
  casoTextos('una sentencia solo de comentarios no existe', '// nada\n/* nada */\n', [])
  casoTextos('// dentro de una cadena no es comentario', 'db.a.find({ u: "http://x" }); y', ['db.a.find({ u: "http://x" })', 'y'])

  hr('(5) Regex frente a división')
  casoTextos('regex con ; y /', 'db.a.find({ n: /a;b\\/c/i }); y', ['db.a.find({ n: /a;b\\/c/i })', 'y'])
  casoTextos('regex con [/] en la clase', 'db.a.find({ n: /[/;]x/ }); y', ['db.a.find({ n: /[/;]x/ })', 'y'])
  casoTextos('regex al empezar un argumento', 'db.a.find({ $or: [ { n: /^a/ }, { m: /b$/ } ] }); y', [
    'db.a.find({ $or: [ { n: /^a/ }, { m: /b$/ } ] })',
    'y'
  ])
  casoTextos('división tras un número o un paréntesis', 'x = 10 / 2; y = (a) / b; z', ['x = 10 / 2', 'y = (a) / b', 'z'])
  casoTextos('regex tras return', 'function f() { return /;/ }; y', ['function f() { return /;/ }', 'y'])
  casoTextos('/ sin cerrar en la línea: operador', 'a = b /\n c; y', ['a = b /\n c', 'y'])

  hr('(6) Offsets')
  const t6 = '  db.a.find();\r\n\r\ndb.b.find()  '
  const s6 = dividirSentenciasShell(t6)
  check(
    'con ; : hasta incluye el ;, hastaContenido no',
    s6[0].desde === 2 && s6[0].hastaContenido === 13 && s6[0].hasta === 14 && s6[0].terminador === 'puntoYComa',
    json(s6[0])
  )
  check(
    'sin ; al final: hasta = hastaContenido, sin los blancos de detrás',
    s6[1].texto === 'db.b.find()' && s6[1].hasta === s6[1].hastaContenido && s6[1].terminador === 'finDeTexto',
    json(s6[1])
  )
  const t6b = 'show dbs\r\n\r\nuse x'
  const s6b = dividirSentenciasShell(t6b)
  check('CRLF: la línea en blanco corta', igual(textos(s6b), ['show dbs', 'use x']) && s6b[0].terminador === 'lineaEnBlanco', json(s6b))
  check('los índices van en orden', s6b.every((s, i) => s.indice === i), json(s6b.map((s) => s.indice)))
  check('texto = slice(desde, hastaContenido)', s6.every((s) => t6.slice(s.desde, s.hastaContenido) === s.texto), 'ok')

  hr('(7) Sentencia bajo el cursor')
  const t7 = 'db.a.find();  // fin\ndb.b.find()\n\n   db.c.find()'
  const s7 = dividirSentenciasShell(t7)
  const en = (cursor: number): string | null => sentenciaShellEnCursor(s7, t7, cursor)?.texto ?? null
  check('dentro', en(3) === 'db.a.find()', String(en(3)))
  check('justo tras el ;', en(t7.indexOf(';') + 1) === 'db.a.find()', String(en(t7.indexOf(';') + 1)))
  check('al final de la línea tras el comentario', en(t7.indexOf('\n')) === 'db.a.find()', String(en(t7.indexOf('\n'))))
  check('al final de una sentencia sin ;', en(t7.indexOf('db.b') + 'db.b.find()'.length) === 'db.b.find()', 'ok')
  check('en la línea en blanco: ninguna', en(t7.indexOf('\n\n') + 1) === null, String(en(t7.indexOf('\n\n') + 1)))
  check('en los blancos iniciales de la siguiente', en(t7.indexOf('   db.c')) === 'db.c.find()', String(en(t7.indexOf('   db.c'))))
  check('texto vacío: ninguna', sentenciaShellEnCursor([], '', 0) === null, 'null')

  hr('(8) Selección y todo')
  const t8 = 'db.a.find()\n\ndb.b.find(); db.c.find()'
  const sel = sentenciasShellAEjecutar(t8, { tipo: 'seleccion', desde: t8.indexOf('db.b'), hasta: t8.length })
  check('la selección se parte sola', igual(textos(sel), ['db.b.find()', 'db.c.find()']), json(textos(sel)))
  check('con offsets del texto entero', sel[0].desde === t8.indexOf('db.b') && sel[1].desde === t8.indexOf('db.c'), json(sel.map((s) => s.desde)))
  const todo = sentenciasShellAEjecutar(t8, { tipo: 'todo' })
  check('todo', todo.length === 3, json(textos(todo)))
  const vacia = sentenciasShellAEjecutar(t8, { tipo: 'seleccion', desde: 2, hasta: 2 })
  check('selección vacía = cursor', igual(textos(vacia), ['db.a.find()']), json(textos(vacia)))
  const media = sentenciasShellAEjecutar(t8, { tipo: 'seleccion', desde: t8.indexOf('find', 14), hasta: t8.indexOf(';') })
  check('selección a medias: solo lo seleccionado', igual(textos(media), ['find()']), json(textos(media)))

  hr('(9) Textos')
  const r = (casados: number, modificados: number, insertados: number, borrados: number): string =>
    resumenEscritura({ casados, modificados, insertados, borrados })
  check('insertOne', r(0, 0, 1, 0) === '1 insertado', r(0, 0, 1, 0))
  check('insertMany', r(0, 0, 3, 0) === '3 insertados', r(0, 0, 3, 0))
  check('updateMany', r(3, 2, 0, 0) === '3 coincidentes, 2 modificados', r(3, 2, 0, 0))
  check('coincide sin cambiar: dice 0 modificados', r(1, 0, 0, 0) === '1 coincidente, 0 modificados', r(1, 0, 0, 0))
  check('deleteMany', r(0, 0, 0, 5) === '5 borrados', r(0, 0, 0, 5))
  check('nada', r(0, 0, 0, 0) === 'Ningún documento cambió', r(0, 0, 0, 0))
  check('miles con separador (cantidad)', /^12.345 insertados$/.test(r(0, 0, 12345, 0)), r(0, 0, 12345, 0))

  const pagina = (n: number, lector: string | null, ms: number) => ({
    lector,
    documentos: Array.from({ length: n }, (_, i) => ({ idEjson: String(i), texto: '{}', celdas: {} })),
    columnas: ['_id'],
    ms
  })
  const lDocs = textoResultadoDocs({ tipo: 'documentos', pagina: pagina(20, 'L1', 12), base: 'p', coleccion: 'c' })
  check('documentos con más', lDocs === '20 documentos (hay más) en 12 ms', lDocs)
  const lUno = textoResultadoDocs({ tipo: 'documentos', pagina: pagina(1, null, 1500), base: 'p', coleccion: 'c' })
  check('un documento, en segundos', lUno === '1 documento en 1,50 s', lUno)
  const lCero = textoResultadoDocs({ tipo: 'documentos', pagina: pagina(0, null, 3), base: null, coleccion: null })
  check('ninguno', lCero === 'Ningún documento en 3 ms', lCero)
  check('base', textoResultadoDocs({ tipo: 'base', base: 'ventas' }) === 'Base de la consola: ventas', 'ok')
  check(
    'escritura usa el resumen',
    textoResultadoDocs({ tipo: 'escritura', casados: 0, modificados: 0, insertados: 1, borrados: 0, base: 'p' }) === '1 insertado',
    'ok'
  )

  check('verbo de colección', verboSentencia('db.usuarios.insertOne({})') === 'insertOne', verboSentencia('db.usuarios.insertOne({})'))
  check('verbo con espacios y getCollection', verboSentencia(" db.getCollection('a b') . updateMany({}, {})") === 'updateMany', 'ok')
  check('verbo con corchetes', verboSentencia('db["a-b"].deleteOne({})') === 'deleteOne', 'ok')
  check('verbo de base', verboSentencia('db.dropDatabase()') === 'dropDatabase', 'ok')
  check('sin verbo', verboSentencia('use x') === 'Escritura', 'ok')

  check('base: use la cambia', baseTrasResultado('a', { tipo: 'base', base: 'b' }) === 'b', 'ok')
  check('base: la del resultado', baseTrasResultado('a', { tipo: 'valor', texto: '1', base: 'c' }) === 'c', 'ok')
  check('base: null conserva la de antes', baseTrasResultado('a', { tipo: 'valor', texto: '1', base: null }) === 'a', 'ok')

  const cols = ['_id', 'a']
  check('columnas: sin nuevas, mismo arreglo', unirColumnas(cols, ['a', '_id']) === cols, 'identidad')
  check('columnas: nuevas detrás en su orden', igual(unirColumnas(cols, ['b', 'a', 'c']), ['_id', 'a', 'b', 'c']), json(unirColumnas(cols, ['b', 'a', 'c'])))

  const total = results.length
  const passed = results.filter((x) => x.pass).length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
