#!/usr/bin/env node
// =============================================================================
// Prueba del visor de claves y de cómo se pintan sus bytes, sin servidor
// (npm run test:visor-claves; lógica pura de `visorClaves.ts` y `bytesClaves.ts`).
// Cubre los bytes (escapes, tamaño, hex), la cabecera (tipo, TTL, resumen), los modos
// texto/JSON/hex, los trozos de «Cargar más», la tabla por tipo con su detalle y el comando
// de lectura para la consola.
// =============================================================================

import type { DbKvBytes, DbKvContenido, DbKvValor } from '../../../../../shared/db-claves-ipc.ts'
import {
  BYTES_POR_LINEA_HEX,
  citarRedisCli,
  escaparBinario,
  hexCorto,
  pintarBytes,
  tamanoBytes,
  unaLinea,
  volcadoHex
} from './bytesClaves.ts'
import {
  COLUMNAS_STREAM_MAX,
  acumularValor,
  avisoTruncado,
  bytesLegibles,
  comandoConsola,
  detalleDeFila,
  etiquetaTipo,
  formatearJson,
  modoInicial,
  modosDe,
  resumenElementos,
  siguienteDe,
  tablaDeContenido,
  textoEnModo,
  tokensJson,
  ttlLegible,
  ttlRestante
} from './visorClaves.ts'

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

/** Bytes de un texto UTF-8 (como los manda el trabajador: texto y base64). */
function txt(t: string): DbKvBytes {
  return { texto: t, base64: Buffer.from(t, 'utf8').toString('base64') }
}
/** Bytes crudos que no son UTF-8 (sin texto). */
function bin(...bytes: number[]): DbKvBytes {
  return { base64: Buffer.from(bytes).toString('base64') }
}
function valor(contenido: DbKvContenido, extra: Partial<DbKvValor> = {}): DbKvValor {
  return { contenido, ttlMs: null, ms: 1, ...extra }
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('(1) Los bytes: pintar, citar, una línea, hex')
  check('UTF-8: el texto tal cual (café, no caf\\xc3\\xa9)', pintarBytes(txt('café')) === 'café', pintarBytes(txt('café')))
  check('no UTF-8: escapes de redis-cli (\\xff, \\\\, \\")', pintarBytes(bin(0xff, 0x5c, 0x22, 0x41, 0x0a)) === '\\xff\\\\\\"A\\x0a', pintarBytes(bin(0xff, 0x5c, 0x22, 0x41, 0x0a)))
  check('escaparBinario: ASCII imprimible tal cual', escaparBinario('abc XYZ~') === 'abc XYZ~', escaparBinario('abc XYZ~'))
  check('base64 ilegible: el propio base64 (no lanza)', pintarBytes({ base64: '@@@' }) === '@@@', pintarBytes({ base64: '@@@' }))
  check(
    'tamanoBytes sin decodificar: 0, 1, 2 y 3 bytes (con y sin relleno)',
    tamanoBytes(bin()) === 0 && tamanoBytes(bin(1)) === 1 && tamanoBytes(bin(1, 2)) === 2 && tamanoBytes(bin(1, 2, 3)) === 3 && tamanoBytes(txt('café')) === 5,
    j([tamanoBytes(bin(1)), tamanoBytes(bin(1, 2)), tamanoBytes(txt('café'))])
  )
  check('citar: a pelo si se puede', citarRedisCli(txt('usuario:1')) === 'usuario:1', citarRedisCli(txt('usuario:1')))
  check(
    'citar: comillas y escapes con espacios, comillas, saltos o vacío (el UTF-8 legible)',
    citarRedisCli(txt('a b')) === '"a b"' &&
      citarRedisCli(txt('di "hola"')) === '"di \\"hola\\""' &&
      citarRedisCli(txt('x\ny')) === '"x\\ny"' &&
      citarRedisCli(txt('')) === '""' &&
      citarRedisCli(txt("o'k")) === '"o\'k"' &&
      citarRedisCli(txt('ñandú feliz')) === '"ñandú feliz"',
    j([citarRedisCli(txt('a b')), citarRedisCli(txt('di "hola"')), citarRedisCli(txt('x\ny')), citarRedisCli(txt('ñandú feliz'))])
  )
  check('citar: bytes que no son UTF-8, entre comillas con \\xHH', citarRedisCli(bin(0xff, 0x00)) === '"\\xff\\x00"', citarRedisCli(bin(0xff, 0x00)))
  check('una línea: saltos como ↵ y tabuladores como →', unaLinea('a\r\nb\nc\td') === 'a↵b↵c→d', unaLinea('a\r\nb\nc\td'))
  check('una línea: recorte con «…»', unaLinea('abcdef', 3) === 'abc…' && unaLinea('abc', 3) === 'abc', unaLinea('abcdef', 3))
  check('hex corto con tope', hexCorto(bin(0x48, 0x69)) === '48 69' && hexCorto(bin(1, 2, 3), 2) === '01 02 …', hexCorto(bin(1, 2, 3), 2))
  const volcado = volcadoHex(txt('Hola, mundo binario!'))
  check(
    'volcado hex: desplazamiento, 16 bytes con hueco a la mitad y su ASCII',
    volcado.lineas.length === 2 &&
      volcado.lineas[0] === '00000000  48 6f 6c 61 2c 20 6d 75  6e 64 6f 20 62 69 6e 61  |Hola, mundo bina|' &&
      volcado.lineas[1].startsWith('00000010  72 69 6f 21') &&
      volcado.lineas[1].endsWith('|rio!|') &&
      !volcado.recortado,
    j(volcado)
  )
  const grande = volcadoHex(bin(...new Array(100).fill(0)), 32)
  check('volcado hex: tope en bytes y lo dice', grande.lineas.length === 32 / BYTES_POR_LINEA_HEX && grande.recortado, j(grande))
  check('volcado hex: lo no imprimible es un punto', volcadoHex(bin(0x00, 0x41)).lineas[0].endsWith('|.A|'), volcadoHex(bin(0x00, 0x41)).lineas[0])

  // ---------------------------------------------------------------------------
  hr('(2) La cabecera: tipo, TTL, memoria, elementos, cortado')
  check('tipo: el de Redis en mayúsculas; «otro» con el del servidor', etiquetaTipo('zset') === 'ZSET' && etiquetaTipo('json') === 'JSON' && etiquetaTipo('otro', 'TSDB-TYPE') === 'TSDB-TYPE' && etiquetaTipo('otro') === 'OTRO', 'ok')
  check(
    'TTL legible',
    ttlLegible(null) === 'Sin caducidad' &&
      ttlLegible(0) === 'Caducada' &&
      ttlLegible(850) === '850 ms' &&
      ttlLegible(12_000) === '12 s' &&
      ttlLegible(243_000) === '4 min 3 s' &&
      ttlLegible(3 * 3600_000 + 5 * 60_000) === '3 h 5 min' &&
      ttlLegible(3600_000) === '1 h' &&
      ttlLegible(2 * 86400_000 + 3 * 3600_000) === '2 d 3 h',
    j([ttlLegible(850), ttlLegible(243_000), ttlLegible(3 * 3600_000 + 5 * 60_000), ttlLegible(2 * 86400_000 + 3 * 3600_000)])
  )
  check(
    'cuenta atrás: lo que queda desde la lectura, sin bajar de 0; null sigue siendo null',
    ttlRestante(10_000, 1000, 4000) === 7000 && ttlRestante(10_000, 1000, 99_000) === 0 && ttlRestante(null, 0, 5) === null && ttlRestante(5000, 1000, 500) === 5000,
    j([ttlRestante(10_000, 1000, 4000), ttlRestante(10_000, 1000, 99_000)])
  )
  check(
    'bytes legibles con coma',
    bytesLegibles(512) === '512 B' && bytesLegibles(1536) === '1,5 KB' && bytesLegibles(2.25 * 1024 * 1024) === '2,3 MB' && bytesLegibles(20 * 1024) === '20 KB' && bytesLegibles(-1) === '—',
    j([bytesLegibles(1536), bytesLegibles(2.25 * 1024 * 1024), bytesLegibles(20 * 1024)])
  )
  const hashParcial: DbKvContenido = { tipo: 'hash', pares: [{ campo: txt('a'), valor: txt('1') }], total: 3, siguiente: '17' }
  check(
    'resumen: «n de total» mientras hay más; «total» al acabar; singular; nada en un string',
    resumenElementos(hashParcial) === '1 de 3 campos' &&
      resumenElementos({ ...hashParcial, siguiente: null, total: 1 }) === '1 campo' &&
      resumenElementos({ tipo: 'list', elementos: [], total: 1200, siguiente: null }) === `${(1200).toLocaleString('es-ES')} elementos` &&
      resumenElementos({ tipo: 'string', valor: txt('x'), bytes: 1, truncado: false }) === null,
    j([resumenElementos(hashParcial), resumenElementos({ ...hashParcial, siguiente: null, total: 1 })])
  )
  check(
    'aviso de un string cortado: cuánto se ve de cuánto',
    avisoTruncado({ tipo: 'string', valor: bin(...new Array(2048).fill(65)), bytes: 10 * 1024 * 1024, truncado: true }) ===
      'Se ve el principio: 2,0 KB de 10 MB. Para leerlo entero, usa GETRANGE en la consola.' &&
      avisoTruncado({ tipo: 'string', valor: txt('x'), bytes: 1, truncado: false }) === null &&
      avisoTruncado({ tipo: 'json', texto: '{}', truncado: true }) !== null,
    String(avisoTruncado({ tipo: 'string', valor: bin(...new Array(2048).fill(65)), bytes: 10 * 1024 * 1024, truncado: true }))
  )

  // ---------------------------------------------------------------------------
  hr('(3) Modos: texto, JSON y hex')
  const json = txt('{"a":1,"b":[true,null]}')
  check('JSON sangrado a 2; un texto que no es JSON, null', formatearJson(json.texto ?? '') === '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}' && formatearJson('hola') === null && formatearJson('123') === null && formatearJson('{roto') === null, 'ok')
  check('modos: JSON solo si parsea; hex siempre', j(modosDe(json)) === j(['texto', 'json', 'hex']) && j(modosDe(txt('hola'))) === j(['texto', 'hex']) && j(modosDe(bin(0xff))) === j(['texto', 'hex']), j(modosDe(json)))
  check('modo inicial: hex si no es UTF-8, JSON si parsea, texto si no', modoInicial(bin(0xff)) === 'hex' && modoInicial(json) === 'json' && modoInicial(txt('hola')) === 'texto', 'ok')
  check(
    'lo que enseña cada modo',
    textoEnModo(json, 'texto').texto === json.texto &&
      textoEnModo(json, 'json').texto.startsWith('{\n  "a": 1') &&
      textoEnModo(txt('hola'), 'json').texto === 'hola' &&
      textoEnModo(bin(0xff), 'texto').texto === '\\xff' &&
      textoEnModo(txt('A'), 'hex').texto.startsWith('00000000  41 '),
    j(textoEnModo(txt('A'), 'hex'))
  )

  // El sangrado NO reinterpreta los números: un entero de más de 2^53
  // sale exacto (con JSON.parse + stringify saldría 12345678901234567000), y los vacíos, en una línea.
  const enteroGrande = formatearJson('{"id":12345678901234567890,"v":{},"w":[ ]}')
  check(
    'JSON sangrado: el entero grande sale EXACTO y los vacíos en una línea',
    enteroGrande === '{\n  "id": 12345678901234567890,\n  "v": {},\n  "w": []\n}',
    j(enteroGrande)
  )

  const sangrado = formatearJson('{"a b":"x\\"y","n":-1.5e3,"l":[true,null]}') ?? ''
  const tokens = tokensJson(sangrado)
  check(
    'tokens del JSON sangrado: clave, cadena (con comillas escapadas), número, literales; juntos, el original',
    tokens.map((t) => t.texto).join('') === sangrado &&
      tokens.some((t) => t.clase === 'clave' && t.texto === '"a b"') &&
      tokens.some((t) => t.clase === 'cadena' && t.texto === '"x\\"y"') &&
      tokens.some((t) => t.clase === 'numero' && t.texto === '-1.5e3') &&
      tokens.filter((t) => t.clase === 'literal').length === 2,
    j(tokens.filter((t) => t.clase !== 'espacio'))
  )

  // ---------------------------------------------------------------------------
  hr('(4) Trozos: acumular sin repetir')
  const h1 = valor({ tipo: 'hash', pares: [{ campo: txt('a'), valor: txt('1') }, { campo: txt('b'), valor: txt('2') }], total: 3, siguiente: '9' }, { ms: 2, ttlMs: 5000 })
  const h2 = valor({ tipo: 'hash', pares: [{ campo: txt('b'), valor: txt('2') }, { campo: txt('c'), valor: txt('3') }], total: 3, siguiente: null }, { ms: 3, ttlMs: 4000, memoria: 99 })
  const hs = acumularValor(h1, h2)
  check(
    'hash: suma sin repetir campos, el `siguiente`, el TTL y la memoria del nuevo, los ms sumados',
    hs.contenido.tipo === 'hash' && j(hs.contenido.pares.map((p) => p.campo.texto)) === j(['a', 'b', 'c']) && hs.contenido.siguiente === null && hs.ttlMs === 4000 && hs.memoria === 99 && hs.ms === 5,
    j(hs)
  )
  const l = acumularValor(valor({ tipo: 'list', elementos: [txt('x')], total: 3, siguiente: '1' }), valor({ tipo: 'list', elementos: [txt('x'), txt('y')], total: 3, siguiente: null }))
  check('list: por índice, sin quitar repetidos (una lista los tiene)', l.contenido.tipo === 'list' && l.contenido.elementos.length === 3, j(l))
  const z = acumularValor(
    valor({ tipo: 'zset', miembros: [{ miembro: txt('m'), puntuacion: '1' }], total: 2, siguiente: '4' }),
    valor({ tipo: 'zset', miembros: [{ miembro: txt('m'), puntuacion: '1' }, { miembro: txt('n'), puntuacion: '2.5' }], total: 2, siguiente: null })
  )
  check('zset: sin repetir miembros', z.contenido.tipo === 'zset' && z.contenido.miembros.length === 2, j(z))
  const st = acumularValor(
    valor({ tipo: 'stream', entradas: [{ id: '1-0', campos: [] }], total: 2, siguiente: '1-0' }),
    valor({ tipo: 'stream', entradas: [{ id: '1-0', campos: [] }, { id: '2-0', campos: [] }], total: 2, siguiente: null })
  )
  check('stream: sin repetir ids', st.contenido.tipo === 'stream' && st.contenido.entradas.length === 2, j(st))
  const cambio = acumularValor(h1, valor({ tipo: 'string', valor: txt('ya no es un hash'), bytes: 16, truncado: false }))
  check('si la clave cambió de tipo entre trozos, vale lo nuevo', cambio.contenido.tipo === 'string', j(cambio))
  check('siguienteDe: el cursor de los tipos con trozos; null en los demás', siguienteDe(h1.contenido) === '9' && siguienteDe({ tipo: 'json', texto: '{}', truncado: false }) === null && siguienteDe({ tipo: 'noExiste' }) === null, 'ok')

  // ---------------------------------------------------------------------------
  hr('(5) La tabla por tipo y el detalle de la fila')
  const th = tablaDeContenido(hs.contenido)
  check(
    'hash: Campo y Valor, una fila por campo, identidad por los bytes del campo',
    th !== null && j(th.columnas.map((c) => c.titulo)) === j(['Campo', 'Valor']) && th.filas.length === 3 && th.filas[0].clave === txt('a').base64 && th.filas[2].celdas[1].texto === '3',
    j(th)
  )
  const tl = tablaDeContenido({ tipo: 'list', elementos: [txt('uno\ndos'), bin(0xff)], total: 2, siguiente: null })
  check(
    'list: Índice numérico y Elemento en una línea; lo binario marcado',
    tl !== null && tl.columnas[0].numerica === true && tl.filas[0].celdas[1].texto === 'uno↵dos' && tl.filas[1].celdas[1].binario === true && tl.filas[1].celdas[1].texto === '\\xff',
    j(tl)
  )
  const tz = tablaDeContenido(z.contenido)
  check('zset: Miembro y Puntuación (numérica, el texto del servidor)', tz !== null && tz.columnas[1].numerica === true && tz.filas[1].celdas[1].texto === '2.5', j(tz))
  const ts = tablaDeContenido({ tipo: 'set', miembros: [txt('rojo')], total: 1, siguiente: null })
  check('set: una columna', ts !== null && ts.columnas.length === 1 && ts.filas[0].celdas[0].texto === 'rojo', j(ts))
  const tst = tablaDeContenido({
    tipo: 'stream',
    entradas: [
      { id: '1-0', campos: [{ campo: txt('temp'), valor: txt('21') }] },
      { id: '2-0', campos: [{ campo: txt('hum'), valor: txt('40') }, { campo: txt('temp'), valor: txt('22') }] }
    ],
    total: 2,
    siguiente: null
  })
  check(
    'stream: ID y una columna por campo (orden de aparición); el que falta, ausente',
    tst !== null &&
      j(tst.columnas.map((c) => c.titulo)) === j(['ID', 'temp', 'hum']) &&
      tst.filas[0].celdas[2].ausente === true &&
      tst.filas[1].celdas[1].texto === '22' &&
      tst.filas[1].clave === '2-0',
    j(tst)
  )
  const muchos = tablaDeContenido({
    tipo: 'stream',
    entradas: [{ id: '1-0', campos: Array.from({ length: 30 }, (_, i) => ({ campo: txt(`c${i}`), valor: txt('v') })) }],
    total: 1,
    siguiente: null
  })
  check('stream con muchos campos: columnas con tope (el resto, en el detalle)', muchos !== null && muchos.columnas.length === 1 + COLUMNAS_STREAM_MAX, String(muchos?.columnas.length))
  check('string, json, otro y noExiste no son tabla', tablaDeContenido({ tipo: 'noExiste' }) === null && tablaDeContenido({ tipo: 'otro', tipoServidor: 'X' }) === null, 'null')
  const anchoLargo = tablaDeContenido({ tipo: 'set', miembros: [txt('x'.repeat(500))], total: 1, siguiente: null })
  check('el ancho de columna tiene tope', anchoLargo !== null && anchoLargo.columnas[0].ancho <= 50, String(anchoLargo?.columnas[0].ancho))
  const det = detalleDeFila(hs.contenido, 1)
  check('detalle de un hash: Campo y Valor con sus bytes', j(det.map((p) => p.titulo)) === j(['Campo', 'Valor']) && 'bytes' in det[1] && det[1].bytes.texto === '2', j(det))
  const detZ = detalleDeFila(z.contenido, 1)
  check('detalle de un zset: el miembro en bytes y la puntuación en texto', detZ.length === 2 && 'texto' in detZ[1] && detZ[1].texto === '2.5', j(detZ))
  const detSt = detalleDeFila({ tipo: 'stream', entradas: [{ id: '9-1', campos: [{ campo: txt('k'), valor: txt('v') }] }], total: 1, siguiente: null }, 0)
  check('detalle de una entrada de stream: su ID y TODOS sus campos', j(detSt.map((p) => p.titulo)) === j(['ID', 'k']), j(detSt))
  check('detalle fuera de rango: nada', detalleDeFila(hs.contenido, 99).length === 0, '[]')

  // ---------------------------------------------------------------------------
  hr('(6) El comando de lectura para la consola')
  check(
    'por tipo, acotado y con la clave citada',
    comandoConsola('string', txt('a b')) === 'GET "a b"' &&
      comandoConsola('hash', txt('usuario:1')) === 'HSCAN usuario:1 0 COUNT 100' &&
      comandoConsola('list', txt('cola')) === 'LRANGE cola 0 99' &&
      comandoConsola('set', txt('s')) === 'SSCAN s 0 COUNT 100' &&
      comandoConsola('zset', txt('z')) === 'ZRANGE z 0 99 WITHSCORES' &&
      comandoConsola('stream', txt('ev')) === 'XRANGE ev - + COUNT 100' &&
      comandoConsola('json', txt('doc')) === 'JSON.GET doc $' &&
      comandoConsola('otro', bin(0xff)) === 'TYPE "\\xff"',
    j([comandoConsola('string', txt('a b')), comandoConsola('otro', bin(0xff))])
  )

  // ---------------------------------------------------------------------------
  const pasadas = results.filter((r) => r.pass).length
  const allPass = pasadas === results.length
  hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
  process.exit(allPass ? 0 : 1)
}

main()
