#!/usr/bin/env node
// =============================================================================
// Prueba de la exportación de una clave a JSON, sin servidor (npm run test:exportar-clave; lógica
// pura de `exportarClave.ts`): leer la clave entera por trozos, lo que no se exporta y el documento de
// cada tipo (texto y bytes, hash como objeto o pares, puntuaciones, streams, JSON sin redondear).
// =============================================================================

import type { DbKvBytes, DbKvContenido, DbKvValor } from '../../../../../shared/db-claves-ipc.ts'
import type { DbRespuesta } from '../../../../../shared/db-explorador-ipc.ts'
import { documentoJsonDeClave, leerClaveEntera, motivoNoExportable } from './exportarClave.ts'

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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence.slice(0, 300)}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const txt = (t: string): DbKvBytes => ({ texto: t, base64: Buffer.from(t).toString('base64') })
const bin = (...b: number[]): DbKvBytes => ({ base64: Buffer.from(b).toString('base64') })
const valor = (contenido: DbKvContenido, ttlMs: number | null = null): DbKvValor => ({ contenido, ttlMs, ms: 1 })
const doc = (nombre: DbKvBytes, v: DbKvValor): unknown => JSON.parse(documentoJsonDeClave(nombre, v))

async function main(): Promise<void> {
  hr('Leer la clave entera')
  const pidio: Array<string | undefined> = []
  const trozos: DbKvValor[] = [
    valor({ tipo: 'list', elementos: [txt('a'), txt('b')], total: 3, siguiente: '2' }),
    valor({ tipo: 'list', elementos: [txt('c')], total: 3, siguiente: null })
  ]
  const r1 = await leerClaveEntera(async (desde) => (pidio.push(desde), { ok: true, valor: trozos[pidio.length - 1] }), () => false)
  check('junta los trozos hasta que no queda ninguno', r1.ok && r1.valor.contenido.tipo === 'list' && r1.valor.contenido.elementos.length === 3 && j(pidio) === j([undefined, '2']), j(r1))
  const r2 = await leerClaveEntera(async () => ({ ok: true, valor: valor({ tipo: 'string', valor: txt('x'), bytes: 900_000, truncado: true }) }), () => false)
  check('un string cortado por el tope del visor NO se exporta a medias', !r2.ok && /Se ve el principio/.test(r2.mensaje), j(r2))
  const r3 = await leerClaveEntera(async () => ({ ok: true, valor: valor({ tipo: 'noExiste' }) }), () => false)
  check('una clave que ya no existe, tampoco', !r3.ok && /ya no existe/.test(r3.mensaje), j(r3))
  const r4 = await leerClaveEntera(async () => ({ ok: true, valor: valor({ tipo: 'otro', tipoServidor: 'TSDB-TYPE' }) }), () => false)
  check('un tipo de módulo se rechaza con su nombre', !r4.ok && /TSDB-TYPE/.test(r4.mensaje), j(r4))
  let veces = 0
  const infinita = async (): Promise<DbRespuesta<DbKvValor>> => ({ ok: true, valor: valor({ tipo: 'set', miembros: [txt(`m${veces++}`)], total: 9, siguiente: '5' }) })
  const r5 = await leerClaveEntera(infinita, () => veces >= 3)
  check('Stop entre trozos: lo dice y no sigue', !r5.ok && /detenida/.test(r5.mensaje) && veces === 3, j({ r5, veces }))
  const r6 = await leerClaveEntera(async () => ({ ok: false, error: { motivo: 'servidor', mensaje: 'NOPERM' } }), () => false)
  check('un fallo del servidor se devuelve con su mensaje', !r6.ok && r6.mensaje === 'NOPERM', j(r6))
  check('motivoNoExportable: null en los tipos con elementos', motivoNoExportable({ tipo: 'hash', pares: [], total: 0, siguiente: null }) === null, 'ok')

  hr('El documento')
  const base = doc(txt('usuario:1'), valor({ tipo: 'string', valor: txt('hola'), bytes: 4, truncado: false }, 5000)) as Record<string, unknown>
  check('cabecera: clave, tipo, ttlMs y valor', j(base) === j({ clave: 'usuario:1', tipo: 'string', ttlMs: 5000, valor: 'hola' }), j(base))
  const sinTtl = doc(txt('k'), valor({ tipo: 'string', valor: txt('v'), bytes: 1, truncado: false })) as Record<string, unknown>
  check('sin caducidad: ttlMs null', sinTtl.ttlMs === null, j(sinTtl))
  const binario = doc(bin(0xff, 0x00), valor({ tipo: 'string', valor: bin(1, 2), bytes: 2, truncado: false })) as { clave: unknown; valor: unknown }
  check('unos bytes que no son UTF-8 van en base64, también el nombre', j(binario.clave) === j({ base64: '/wA=' }) && j(binario.valor) === j({ base64: 'AQI=' }), j(binario))
  const h = doc(txt('h'), valor({ tipo: 'hash', pares: [{ campo: txt('a'), valor: txt('1') }, { campo: txt('b'), valor: txt('2') }], total: 2, siguiente: null })) as { valor: unknown }
  check('hash con campos de texto: un objeto', j(h.valor) === j({ a: '1', b: '2' }), j(h.valor))
  const hb = doc(txt('h'), valor({ tipo: 'hash', pares: [{ campo: bin(0xff), valor: txt('1') }], total: 1, siguiente: null })) as { valor: unknown }
  check('hash con un campo binario: lista de pares, sin perder el campo', j(hb.valor) === j([{ campo: { base64: '/w==' }, valor: '1' }]), j(hb.valor))
  const hp = doc(txt('h'), valor({ tipo: 'hash', pares: [{ campo: txt('__proto__'), valor: txt('1') }], total: 1, siguiente: null })) as { valor: Record<string, unknown> }
  check('un campo llamado __proto__ es un campo más', Object.keys(hp.valor).join() === '__proto__', j(Object.keys(hp.valor)))
  const l = doc(txt('l'), valor({ tipo: 'list', elementos: [txt('a'), txt('a')], total: 2, siguiente: null })) as { valor: unknown }
  check('list: array en orden y con repetidos', j(l.valor) === j(['a', 'a']), j(l.valor))
  const z = doc(txt('z'), valor({ tipo: 'zset', miembros: [{ miembro: txt('ana'), puntuacion: '1.5' }, { miembro: txt('luz'), puntuacion: 'inf' }], total: 2, siguiente: null })) as { valor: unknown }
  check('zset: la puntuación es número si es finita y texto si es inf', j(z.valor) === j([{ miembro: 'ana', puntuacion: 1.5 }, { miembro: 'luz', puntuacion: 'inf' }]), j(z.valor))
  const s = doc(txt('s'), valor({ tipo: 'stream', entradas: [{ id: '1-0', campos: [{ campo: txt('c'), valor: txt('1') }, { campo: txt('c'), valor: txt('2') }] }], total: 1, siguiente: null })) as { valor: unknown }
  check('stream: campos como pares (un campo puede repetirse)', j(s.valor) === j([{ id: '1-0', campos: [{ campo: 'c', valor: '1' }, { campo: 'c', valor: '2' }] }]), j(s.valor))
  const texto = documentoJsonDeClave(txt('doc'), valor({ tipo: 'json', texto: '{"n":12345678901234567890,"a":[1,2]}', truncado: false }))
  check('JSON del servidor: el texto tal cual (los enteros grandes no se redondean) y sangrado', texto.includes('12345678901234567890') && texto.includes('\n    "n": 12345678901234567890') && JSON.parse(texto.replace('12345678901234567890', '1')).tipo === 'json', texto)
  check('acaba en salto de línea', texto.endsWith('}\n'), j(texto.slice(-3)))

  const ok = results.filter((x) => x.pass).length
  console.log(`\nVEREDICTO: ${ok}/${results.length} PASS`)
  process.exit(ok === results.length ? 0 : 1)
}

void main()
