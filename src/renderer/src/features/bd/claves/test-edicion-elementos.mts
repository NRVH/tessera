#!/usr/bin/env node
// =============================================================================
// Prueba de la edición de list, set, zset y stream y de la creación de claves, sin servidor
// (npm run test:edicion-elementos; lógica pura de `edicionElementos.ts`, a través de `edicionClaves.ts`).
// Cubre el comando de cada acción, sus validaciones, el texto del resultado y la clave binaria.
// =============================================================================

import type { DbKvBytes, DbKvRespuesta } from '../../../../../shared/db-claves-ipc.ts'
import { comandoDeAccion, entradasIniciales, resultadoDeAccion, textosAccion, type AccionClave } from './edicionClaves.ts'
import { TIPOS_CREABLES, comandoCrear, cuadrosDeCreacion, puntuacionValida } from './edicionElementos.ts'

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

const txt = (t: string): DbKvBytes => ({ texto: t, base64: Buffer.from(t).toString('base64') })
const bin = (...b: number[]): DbKvBytes => ({ base64: Buffer.from(b).toString('base64') })
const e = (uno: string, dos = ''): { uno: string; dos: string } => ({ uno, dos })
const K = txt('k')
const cmd = (a: AccionClave, uno = '', dos = ''): string => {
  const c = comandoDeAccion(K, a, e(uno, dos), false)
  return c.ok ? c.texto : `ERROR: ${c.motivo}`
}
const ent = (valor: string): DbKvRespuesta => ({ tipo: 'entero', valor })

hr('Añadir un elemento')
check('list: RPUSH al final', cmd({ tipo: 'anadir', de: 'list' }, 'a b') === 'RPUSH k "a b"', cmd({ tipo: 'anadir', de: 'list' }, 'a b'))
check('list: un valor vacío se admite', cmd({ tipo: 'anadir', de: 'list' }, '') === 'RPUSH k ""', cmd({ tipo: 'anadir', de: 'list' }, ''))
check('set: SADD', cmd({ tipo: 'anadir', de: 'set' }, 'x') === 'SADD k x', cmd({ tipo: 'anadir', de: 'set' }, 'x'))
check('set: sin miembro, no hay comando', cmd({ tipo: 'anadir', de: 'set' }, '').startsWith('ERROR'), cmd({ tipo: 'anadir', de: 'set' }, ''))
check('zset: ZADD puntuación miembro', cmd({ tipo: 'anadir', de: 'zset' }, 'ana', '2.5') === 'ZADD k 2.5 ana', cmd({ tipo: 'anadir', de: 'zset' }, 'ana', '2.5'))
check('zset: una puntuación que no es número, no hay comando', cmd({ tipo: 'anadir', de: 'zset' }, 'ana', 'dos').startsWith('ERROR'), cmd({ tipo: 'anadir', de: 'zset' }, 'ana', 'dos'))
check('zset: inf y -inf valen', cmd({ tipo: 'anadir', de: 'zset' }, 'a', '-inf') === 'ZADD k -inf a', cmd({ tipo: 'anadir', de: 'zset' }, 'a', '-inf'))
check('stream: XADD con id automático', cmd({ tipo: 'anadir', de: 'stream' }, 'campo', 'va lor') === 'XADD k * campo "va lor"', cmd({ tipo: 'anadir', de: 'stream' }, 'campo', 'va lor'))
check('stream: sin campo, no hay comando', cmd({ tipo: 'anadir', de: 'stream' }, '', 'v').startsWith('ERROR'), cmd({ tipo: 'anadir', de: 'stream' }, '', 'v'))

hr('Editar y quitar')
check('list: LSET por índice', cmd({ tipo: 'elemento', indice: 3, actual: 'a' }, 'nuevo') === 'LSET k 3 nuevo', cmd({ tipo: 'elemento', indice: 3, actual: 'a' }, 'nuevo'))
check('zset: la puntuación va con XX (no crea el miembro)', cmd({ tipo: 'puntuacion', miembro: txt('ana'), actual: '1' }, '7') === 'ZADD k XX 7 ana', cmd({ tipo: 'puntuacion', miembro: txt('ana'), actual: '1' }, '7'))
check('zset: puntuación inválida', cmd({ tipo: 'puntuacion', miembro: txt('ana'), actual: '1' }, 'x').startsWith('ERROR'), '')
check('list: LREM 1 del valor', cmd({ tipo: 'quitar', de: 'list', elemento: txt('a') }) === 'LREM k 1 a', cmd({ tipo: 'quitar', de: 'list', elemento: txt('a') }))
check('set: SREM', cmd({ tipo: 'quitar', de: 'set', elemento: txt('a') }) === 'SREM k a', cmd({ tipo: 'quitar', de: 'set', elemento: txt('a') }))
check('zset: ZREM', cmd({ tipo: 'quitar', de: 'zset', elemento: txt('a') }) === 'ZREM k a', cmd({ tipo: 'quitar', de: 'zset', elemento: txt('a') }))
check('stream: XDEL por id', cmd({ tipo: 'quitarEntrada', id: '1-0' }) === 'XDEL k 1-0', cmd({ tipo: 'quitarEntrada', id: '1-0' }))
check('un elemento binario va en sus bytes exactos', cmd({ tipo: 'quitar', de: 'set', elemento: bin(0x00, 0x41) }) === 'SREM k "\\x00A"', cmd({ tipo: 'quitar', de: 'set', elemento: bin(0x00, 0x41) }))

hr('Crear una clave')
const crear = (nombre: string, tipo: (typeof TIPOS_CREABLES)[number], uno = '', dos = ''): string => {
  const c = comandoCrear(nombre, tipo, e(uno, dos))
  return c.ok ? c.texto : `ERROR: ${c.motivo}`
}
check('string: SET … NX (nunca pisa)', crear('a b', 'string', 'v') === 'SET "a b" v NX', crear('a b', 'string', 'v'))
check('hash: HSET campo valor', crear('h', 'hash', 'f', 'v') === 'HSET h f v', crear('h', 'hash', 'f', 'v'))
check('hash sin campo: no hay comando', crear('h', 'hash', '', 'v').startsWith('ERROR'), '')
check('list, set, zset y stream crean con su primer elemento', [crear('l', 'list', 'x'), crear('s', 'set', 'x'), crear('z', 'zset', 'x', '1'), crear('x', 'stream', 'c', 'v')].join('|') === 'RPUSH l x|SADD s x|ZADD z 1 x|XADD x * c v', [crear('l', 'list', 'x'), crear('s', 'set', 'x'), crear('z', 'zset', 'x', '1'), crear('x', 'stream', 'c', 'v')].join('|'))
check('sin nombre: no hay comando', crear('', 'string', 'v').startsWith('ERROR'), crear('', 'string', 'v'))
check('cada tipo creable tiene cuadros (etiqueta; el segundo, en hash, zset y stream)', TIPOS_CREABLES.every((t) => cuadrosDeCreacion(t).etiqueta !== '') && TIPOS_CREABLES.filter((t) => cuadrosDeCreacion(t).etiquetaDos !== null).join() === 'hash,zset,stream', TIPOS_CREABLES.join())

hr('Textos y resultados')
check('puntuacionValida: 1, -2.5, .5, 1e3, +inf sí; "", "a", "1,5" no', ['1', '-2.5', '.5', '1e3', '+inf'].every((s) => puntuacionValida(s) !== null) && ['', 'a', '1,5', '1.5.2'].every((s) => puntuacionValida(s) === null), 'ok')
check('el diálogo de borrar es de peligro y nombra el miembro', textosAccion({ tipo: 'quitar', de: 'set', elemento: txt('a') }, 'ana').peligro && textosAccion({ tipo: 'quitar', de: 'set', elemento: txt('a') }, 'ana').titulo.includes('ana'), j(textosAccion({ tipo: 'quitar', de: 'set', elemento: txt('a') }, 'ana')))
check('editar un elemento arranca con su valor; añadir, vacío', entradasIniciales({ tipo: 'elemento', indice: 0, actual: 'v' }).uno === 'v' && entradasIniciales({ tipo: 'anadir', de: 'list' }).uno === '', 'ok')
check('SADD que da 0: ya era miembro', !resultadoDeAccion({ tipo: 'anadir', de: 'set' }, 'SADD k a', ent('0')).ok, j(resultadoDeAccion({ tipo: 'anadir', de: 'set' }, 'SADD k a', ent('0'))))
check('ZADD que da 0 no es un fallo (puntuación actualizada)', resultadoDeAccion({ tipo: 'anadir', de: 'zset' }, 'ZADD k 1 a', ent('0')).ok, 'ok')
check('SREM/ZREM/LREM/XDEL que dan 0: ya no estaba', !resultadoDeAccion({ tipo: 'quitar', de: 'set', elemento: txt('a') }, '', ent('0')).ok && !resultadoDeAccion({ tipo: 'quitarEntrada', id: '1-0' }, '', ent('0')).ok, 'fallo')
check('SET NX que da nil al crear: ya existe', !resultadoDeAccion({ tipo: 'crear' }, '', { tipo: 'nulo' }).ok && resultadoDeAccion({ tipo: 'crear' }, '', { tipo: 'simple', texto: 'OK' }).ok, 'ok')
check('un error de Redis (WRONGTYPE) se dice tal cual', j(resultadoDeAccion({ tipo: 'anadir', de: 'list' }, '', { tipo: 'error', texto: 'WRONGTYPE x' })) === j({ ok: false, mensaje: 'WRONGTYPE x' }), 'tal cual')

const ok = results.filter((r) => r.pass).length
console.log(`\nVEREDICTO: ${ok}/${results.length} PASS`)
process.exit(ok === results.length ? 0 : 1)
