#!/usr/bin/env node
// =============================================================================
// Prueba de la lógica pura de la consola de claves (`consolaClaves.ts`):
// (node src/renderer/src/features/bd/claves/test-consola-claves.mts)
// Fija qué texto viaja al main y con qué `desplazamiento` (un comando por línea; selección,
// cursor y todo), cómo se pinta la respuesta (escalares, bytes, listas, cruda, topes), los
// errores, la base tras el resultado y el registro (comando que se completa, notas, topes).
// =============================================================================

import {
  MAX_ENTRADAS_REGISTRO,
  MAX_LARGO_LINEA,
  MAX_LINEAS_REGISTRO,
  MAX_LINEAS_RESPUESTA,
  agregarComando,
  agregarNota,
  baseDeFiltro,
  baseTrasResultado,
  citarBytes,
  comandosAEjecutar,
  comandosDeTexto,
  confirmacionPeligroso,
  ecoComando,
  formatearRespuesta,
  limpiarRegistro,
  lineaDeError,
  lineaNoEnviado,
  registroVacio,
  salidaCruda,
  terminarComando,
  textoMs,
  verboComando,
  type ComandoConsola
} from './consolaClaves.ts'
import type { DbKvRespuesta } from '../../../../../shared/db-claves-ipc.ts'

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
function json(x: unknown): string {
  return JSON.stringify(x)
}
function textos(cs: readonly ComandoConsola[]): string[] {
  return cs.map((c) => c.texto)
}
function igual(a: unknown, b: unknown): boolean {
  return json(a) === json(b)
}
function lineas(r: DbKvRespuesta, cruda = false): string[] {
  return formatearRespuesta(r, cruda).map((l) => l.texto)
}
function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
}
function bytes(s: string): DbKvRespuesta {
  return { tipo: 'bytes', valor: { texto: s, base64: b64(s) } }
}

function main(): void {
  hr('(1) Un comando por línea')
  const t1 = '  SET a 1  \n\n# comentario\n   # otro\nGET a\r\nDEL "a b" # no es comentario\rPING'
  const cs = comandosDeTexto(t1)
  check('comandos', igual(textos(cs), ['SET a 1', 'GET a', 'DEL "a b" # no es comentario', 'PING']), json(textos(cs)))
  check('índices 0..n-1', igual(cs.map((c) => c.indice), [0, 1, 2, 3]), json(cs.map((c) => c.indice)))
  check('líneas (0-based)', igual(cs.map((c) => c.linea), [0, 4, 5, 6]), json(cs.map((c) => c.linea)))
  check('desde/hasta = el texto exacto', cs.every((c) => t1.slice(c.desde, c.hasta) === c.texto), json(cs.map((c) => [c.desde, c.hasta])))
  check('desde sin blancos delante', cs[0].desde === 2, String(cs[0].desde))
  check('offset tras CRLF', cs[2].desde === t1.indexOf('DEL'), String(cs[2].desde))
  check('offset tras CR suelto', cs[3].desde === t1.indexOf('PING'), String(cs[3].desde))
  check('texto vacío: nada', comandosDeTexto('').length === 0, 'ok')
  check('solo comentarios y blancos: nada', comandosDeTexto('# a\n\n   \n#b').length === 0, 'ok')

  hr('(2) Selección')
  const t2 = 'SET a 1\nGET a\n# c\nDEL a\nPING'
  const off = (s: string): number => t2.indexOf(s)
  check('selección dentro de una línea: la línea entera', igual(textos(comandosAEjecutar(t2, { tipo: 'seleccion', desde: off('ET a 1'), hasta: off('ET a 1') + 2 })), ['SET a 1']), 'ok')
  check(
    'selección de varias líneas, comentario fuera',
    igual(textos(comandosAEjecutar(t2, { tipo: 'seleccion', desde: off('a 1'), hasta: off('EL a') })), ['SET a 1', 'GET a', 'DEL a']),
    json(textos(comandosAEjecutar(t2, { tipo: 'seleccion', desde: off('a 1'), hasta: off('EL a') })))
  )
  check(
    'acaba al principio de una línea: no la cuenta',
    igual(textos(comandosAEjecutar(t2, { tipo: 'seleccion', desde: 0, hasta: off('GET') })), ['SET a 1']),
    json(textos(comandosAEjecutar(t2, { tipo: 'seleccion', desde: 0, hasta: off('GET') })))
  )
  check(
    'empieza al principio de una línea: la cuenta',
    igual(textos(comandosAEjecutar(t2, { tipo: 'seleccion', desde: off('GET'), hasta: off('GET') + 1 })), ['GET a']),
    'ok'
  )
  check('selección vacía = cursor', igual(textos(comandosAEjecutar(t2, { tipo: 'seleccion', desde: off('DEL'), hasta: off('DEL') })), ['DEL a']), 'ok')
  check('todo', igual(textos(comandosAEjecutar(t2, { tipo: 'todo' })), ['SET a 1', 'GET a', 'DEL a', 'PING']), 'ok')
  const sel = comandosAEjecutar(t2, { tipo: 'seleccion', desde: 0, hasta: t2.length })
  check('los índices de una selección empiezan en 0', igual(sel.map((c) => c.indice), [0, 1, 2, 3]), json(sel.map((c) => c.indice)))

  hr('(3) Cursor')
  const t3 = 'SET a 1\n\nGET a\n# nota\n\n\nPING\n'
  const o3 = (s: string): number => t3.indexOf(s)
  check('en su línea', igual(textos(comandosAEjecutar(t3, { tipo: 'cursor', cursor: o3('ET a') })), ['SET a 1']), 'ok')
  check('al final de su línea', igual(textos(comandosAEjecutar(t3, { tipo: 'cursor', cursor: o3('SET a 1') + 7 })), ['SET a 1']), 'ok')
  check('línea en blanco justo debajo: el de arriba', igual(textos(comandosAEjecutar(t3, { tipo: 'cursor', cursor: o3('SET a 1') + 8 })), ['SET a 1']), 'ok')
  check('en un comentario: nada', comandosAEjecutar(t3, { tipo: 'cursor', cursor: o3('nota') }).length === 0, 'ok')
  check('en blanco bajo un comentario: nada', comandosAEjecutar(t3, { tipo: 'cursor', cursor: o3('# nota') + 7 }).length === 0, 'ok')
  check('en blanco a dos líneas del comando: nada', comandosAEjecutar(t3, { tipo: 'cursor', cursor: o3('PING') - 1 }).length === 0, 'ok')
  check('al final del texto (línea vacía tras PING): PING', igual(textos(comandosAEjecutar(t3, { tipo: 'cursor', cursor: t3.length })), ['PING']), 'ok')
  check('cursor fuera de rango: acotado', igual(textos(comandosAEjecutar('GET a', { tipo: 'cursor', cursor: 99 })), ['GET a']), 'ok')
  const c3 = comandosAEjecutar(t3, { tipo: 'cursor', cursor: o3('GET') })
  check('el del cursor lleva su desplazamiento', c3[0].desde === o3('GET') && c3[0].indice === 0, json(c3[0]))

  hr('(4) Verbo y salida cruda')
  check('verbo simple en mayúsculas', verboComando('flushdb') === 'FLUSHDB', verboComando('flushdb'))
  check('verbo con subcomando', verboComando('config set maxmemory 1') === 'CONFIG SET', verboComando('config set maxmemory 1'))
  check('verbo entre comillas', verboComando('"get" a') === 'GET', verboComando('"get" a'))
  check('contenedor sin subcomando', verboComando('CONFIG') === 'CONFIG', 'ok')
  check('verbo vacío', verboComando('   ') === '', 'ok')
  check('INFO es cruda', salidaCruda('info memory'), 'ok')
  check('CLIENT LIST es cruda', salidaCruda('client list'), 'ok')
  check('GET no es cruda', !salidaCruda('GET a'), 'ok')
  check('eco', ecoComando(3, 'GET a') === 'db3> GET a', ecoComando(3, 'GET a'))
  check('eco recortado', ecoComando(0, 'x'.repeat(5000)).length === 2000 && ecoComando(0, 'x'.repeat(5000)).endsWith('…'), 'ok')

  hr('(5) Respuestas como redis-cli')
  check('simple sin comillas', igual(lineas({ tipo: 'simple', texto: 'OK' }), ['OK']), 'ok')
  check('entero', igual(lineas({ tipo: 'entero', valor: '42' }), ['(integer) 42']), 'ok')
  check('nulo', igual(lineas({ tipo: 'nulo' }), ['(nil)']), 'ok')
  check('error', igual(lineas({ tipo: 'error', texto: 'ERR x' }), ['(error) ERR x']), 'ok')
  check('error en su tono', formatearRespuesta({ tipo: 'error', texto: 'ERR x' })[0].tono === 'error', 'ok')
  check('bytes entre comillas', igual(lineas(bytes('hola')), ['"hola"']), 'ok')
  check('escapes', citarBytes({ texto: 'a"b\\c\nd\re\tf\u0007\u0008\u0001', base64: '' }) === '"a\\"b\\\\c\\nd\\re\\tf\\a\\b\\x01"', citarBytes({ texto: 'a"b\\c\nd\re\tf\u0007\u0008\u0001', base64: '' }))
  check('UTF-8 legible', citarBytes({ texto: 'café ✓', base64: '' }) === '"café ✓"', citarBytes({ texto: 'café ✓', base64: '' }))
  const binario = Buffer.from([0x61, 0xff, 0x00, 0x22, 0x0a]).toString('base64')
  check('binario con \\xHH', citarBytes({ base64: binario }) === '"a\\xff\\x00\\"\\n"', citarBytes({ base64: binario }))
  check('base64 roto: tal cual', citarBytes({ base64: '%%%' }) === '"%%%"', citarBytes({ base64: '%%%' }))
  check('lista vacía', igual(lineas({ tipo: 'lista', elementos: [] }), ['(empty array)']), 'ok')
  check('lista', igual(lineas({ tipo: 'lista', elementos: [bytes('a'), { tipo: 'entero', valor: '2' }, { tipo: 'nulo' }] }), ['1) "a"', '2) (integer) 2', '3) (nil)']), 'ok')
  const diez: DbKvRespuesta = { tipo: 'lista', elementos: Array.from({ length: 10 }, (_, i) => bytes(String(i))) }
  const l10 = lineas(diez)
  check('índices alineados a la derecha', l10[0] === ' 1) "0"' && l10[9] === '10) "9"', json([l10[0], l10[9]]))
  const anidada: DbKvRespuesta = {
    tipo: 'lista',
    elementos: [bytes('a'), { tipo: 'lista', elementos: [bytes('b'), { tipo: 'lista', elementos: [bytes('c'), bytes('d')] }] }, { tipo: 'lista', elementos: [] }]
  }
  const la = lineas(anidada)
  check(
    'anidada con la sangría de redis-cli',
    igual(la, ['1) "a"', '2) 1) "b"', '   2) 1) "c"', '      2) "d"', '3) (empty array)']),
    json(la)
  )
  const exec = formatearRespuesta({ tipo: 'lista', elementos: [{ tipo: 'simple', texto: 'OK' }, { tipo: 'error', texto: 'WRONGTYPE x' }] })
  check('error anidado (EXEC) en su tono', exec[1].texto === '2) (error) WRONGTYPE x' && exec[1].tono === 'error' && exec[0].tono === 'normal', json(exec))
  check('cruda: líneas sin comillas', igual(lineas(bytes('# Server\r\nredis_version:7\r\n'), true), ['# Server', 'redis_version:7']), json(lineas(bytes('# Server\r\nredis_version:7\r\n'), true)))
  check('cruda con binario: como siempre', igual(lineas({ tipo: 'bytes', valor: { base64: binario } }, true), ['"a\\xff\\x00\\"\\n"']), 'ok')
  const mucha: DbKvRespuesta = { tipo: 'lista', elementos: Array.from({ length: MAX_LINEAS_RESPUESTA + 7 }, () => bytes('x')) }
  const lm = formatearRespuesta(mucha)
  check('tope de líneas + la que dice cuántas', lm.length === MAX_LINEAS_RESPUESTA + 1 && lm[lm.length - 1].texto === '… 7 líneas más sin mostrar' && lm[lm.length - 1].tono === 'tenue', lm[lm.length - 1].texto)
  const una = formatearRespuesta({ tipo: 'lista', elementos: Array.from({ length: MAX_LINEAS_RESPUESTA + 1 }, () => bytes('x')) })
  check('singular: 1 línea más', una[una.length - 1].texto === '… 1 línea más sin mostrar', una[una.length - 1].texto)
  const larga = formatearRespuesta(bytes('y'.repeat(MAX_LARGO_LINEA + 50)))
  check('línea larga recortada', larga[0].texto.length === MAX_LARGO_LINEA + 2 && larga[0].texto.endsWith(' …'), String(larga[0].texto.length))

  hr('(6) Errores')
  const e1 = lineaDeError({ motivo: 'servidor', mensaje: 'WRONGTYPE Operation against a key holding the wrong kind of value' })
  check('servidor: (error) …', e1.texto === '(error) WRONGTYPE Operation against a key holding the wrong kind of value' && e1.tono === 'error', e1.texto)
  check('servidor con código que el mensaje no trae', lineaDeError({ motivo: 'servidor', codigo: 'NOPERM', mensaje: 'this user has no permissions' }).texto === '(error) NOPERM this user has no permissions', lineaDeError({ motivo: 'servidor', codigo: 'NOPERM', mensaje: 'this user has no permissions' }).texto)
  check('servidor con código repetido: no se duplica', lineaDeError({ motivo: 'servidor', codigo: 'NOPERM', mensaje: 'NOPERM no' }).texto === '(error) NOPERM no', 'ok')
  check('sintaxis: (error) …', lineaDeError({ motivo: 'servidor', codigo: 'TESSERA-SINTAXIS', mensaje: 'Comillas sin cerrar' }).texto === '(error) Comillas sin cerrar', 'ok')
  const na = lineaDeError({ motivo: 'servidor', codigo: 'TESSERA-NO-ADMITIDO', mensaje: 'SUBSCRIBE no se admite en la consola' })
  check('no admitido: No se envió, sin el código interno', na.texto === 'No se envió: SUBSCRIBE no se admite en la consola', na.texto)
  const sl = lineaDeError({ motivo: 'soloLectura', codigo: 'TESSERA-SOLO-LECTURA', mensaje: 'La conexión es de solo lectura' })
  check('solo lectura: No se envió', sl.texto === 'No se envió: La conexión es de solo lectura' && sl.tono === 'error', sl.texto)
  check('no repite «No se envió»', lineaDeError({ motivo: 'soloLectura', mensaje: 'No se envió: x' }).texto === 'No se envió: x', 'ok')
  check('otro motivo: textoError', lineaDeError({ motivo: 'timeout', codigo: 'ETIMEDOUT', mensaje: 'tardó' }).texto === '[ETIMEDOUT] tardó', lineaDeError({ motivo: 'timeout', codigo: 'ETIMEDOUT', mensaje: 'tardó' }).texto)
  const ne = lineaNoEnviado({ mensaje: 'FLUSHDB borra todas las claves' })
  check('no enviado por el usuario: tenue', ne.texto === 'No se envió: FLUSHDB borra todas las claves' && ne.tono === 'tenue', ne.texto)
  const cp = confirmacionPeligroso({ verbo: 'FLUSHDB', alias: 'cache', base: 2, mensaje: 'Borra todas las claves de la base.', produccion: false })
  check('peligroso: título y botón con el verbo', cp.titulo === '¿Ejecutar FLUSHDB?' && cp.confirmar === 'Ejecutar FLUSHDB', json(cp))
  check('peligroso: mensaje con motivo, alias y base', cp.mensaje.startsWith('Borra todas') && cp.mensaje.includes('«cache»') && cp.mensaje.includes('db2'), cp.mensaje)
  const cpp = confirmacionPeligroso({ verbo: 'FLUSHALL', alias: 'x', base: 0, mensaje: '', produccion: true })
  check('peligroso en producción: lo dice', cpp.mensaje.includes('PRODUCCIÓN') && !cpp.mensaje.startsWith('\n'), cpp.mensaje)

  hr('(7) Base')
  check('base del resultado', baseTrasResultado(0, { base: 3 }) === 3, 'ok')
  check('base inválida: la de antes', baseTrasResultado(2, { base: -1 }) === 2 && baseTrasResultado(2, { base: 1.5 }) === 2, 'ok')
  check('filtro: número', baseDeFiltro('3') === 3, 'ok')
  check('filtro: db3', baseDeFiltro(' DB12 ') === 12, 'ok')
  check('filtro: otra cosa', baseDeFiltro('abc') === null && baseDeFiltro('') === null, 'ok')

  hr('(8) Registro')
  let r = registroVacio()
  const a = agregarComando(r, { base: 0, texto: 'GET a' }, 0)
  r = a.registro
  const c0 = r.entradas[0]
  check('comando corriendo con su eco', c0.tipo === 'comando' && c0.estado === 'corriendo' && c0.eco === 'db0> GET a' && c0.ms === null, json(c0))
  r = terminarComando(r, a.id, { estado: 'ok', ms: 3, lineas: [{ texto: '"1"', tono: 'normal' }] })
  const c1 = r.entradas[0]
  check('se completa en su sitio', c1.tipo === 'comando' && c1.estado === 'ok' && c1.ms === 3 && c1.lineas.length === 1 && c1.id === a.id, json(c1))
  check('terminar un id que no está: igual', terminarComando(r, 999, { estado: 'ok', ms: 1, lineas: [] }) === r, 'identidad')
  r = agregarNota(r, { tono: 'aviso', texto: 'x', accion: { tipo: 'forzar', etiqueta: 'Forzar' } }, 0)
  const n1 = r.entradas[1]
  check('nota con acción', n1.tipo === 'nota' && n1.accion?.tipo === 'forzar' && n1.id === a.id + 1, json(n1))
  const limpio = limpiarRegistro(r)
  check('limpiar: vacío, los ids siguen', limpio.entradas.length === 0 && limpio.siguienteId === r.siguienteId, json(limpio))
  let tope = registroVacio()
  for (let i = 0; i < MAX_ENTRADAS_REGISTRO + 10; i++) tope = agregarNota(tope, { tono: 'normal', texto: String(i) }, 0)
  const pri = tope.entradas[0]
  check('tope de entradas: se van las viejas', tope.entradas.length === MAX_ENTRADAS_REGISTRO && pri.tipo === 'nota' && pri.texto === '10', json(pri))
  let lin = registroVacio()
  const grandes = Array.from({ length: 499 }, () => ({ texto: 'x', tono: 'normal' as const }))
  for (let i = 0; i < 12; i++) {
    const x = agregarComando(lin, { base: 0, texto: `SMEMBERS s${i}` }, 0)
    lin = terminarComando(x.registro, x.id, { estado: 'ok', ms: 1, lineas: grandes })
  }
  const totalLineas = lin.entradas.reduce((s, e) => s + (e.tipo === 'nota' ? 1 : 1 + e.lineas.length), 0)
  check('tope de líneas', totalLineas <= MAX_LINEAS_REGISTRO && lin.entradas.length === 10, `${totalLineas} líneas, ${lin.entradas.length} entradas`)
  let solo = registroVacio()
  const enorme = Array.from({ length: MAX_LINEAS_REGISTRO + 10 }, () => ({ texto: 'x', tono: 'normal' as const }))
  const s1 = agregarComando(solo, { base: 0, texto: 'A' }, 0)
  solo = terminarComando(s1.registro, s1.id, { estado: 'ok', ms: 1, lineas: enorme })
  check('siempre queda la última', solo.entradas.length === 1, String(solo.entradas.length))
  check('ms', textoMs(3) === '3 ms' && textoMs(0) === '<1 ms' && textoMs(null) === '' && textoMs(1200) === '1 s 200 ms', json([textoMs(3), textoMs(0), textoMs(1200)]))

  const total = results.length
  const passed = results.filter((x) => x.pass).length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
