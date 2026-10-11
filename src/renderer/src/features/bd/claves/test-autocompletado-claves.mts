#!/usr/bin/env node
// =============================================================================
// Prueba del autocompletado y del historial de la consola de Redis, sin Monaco (npm run
// test:autocompletado-claves; lógica pura de `autocompletadoClaves.ts`, `comandosRedisCatalogo.ts` y
// `historialClaves.ts`): dónde se sugiere, qué casa, el catálogo y qué se inserta al elegir del historial.
// =============================================================================

import { MAX_SUGERENCIAS_CLAVES, candidatosClaves, parcialDeComando } from './autocompletadoClaves.ts'
import { COMANDOS_REDIS } from './comandosRedisCatalogo.ts'
import { insercionHistorialClaves } from './historialClaves.ts'

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
const nombres = (p: string): string[] => candidatosClaves(p).map((c) => c.etiqueta)

hr('Dónde se sugiere')
check('en la primera palabra de la línea', parcialDeComando('') === '' && parcialDeComando('  hg') === 'hg' && parcialDeComando('JSON.G') === 'JSON.G', 'ok')
check('en la segunda de un subcomando (CONFIG G)', parcialDeComando('object e') === 'object e' && parcialDeComando('XINFO ') === 'XINFO ', 'ok')
check('no en los argumentos, entre comillas ni en un comentario', parcialDeComando('SET clave v') === null && parcialDeComando('GET "ab') === null && parcialDeComando('# nota') === null && parcialDeComando('GET a ') === null, 'ok')

hr('Qué casa')
check('por prefijo y sin distinguir caja: hg → HGET…', nombres('hg').includes('HGET') && nombres('hg').includes('HGETALL') && nombres('hg').every((n) => n.startsWith('HG')), j(nombres('hg')))
check('un subcomando: object e → OBJECT ENCODING', j(nombres('object e')) === j(['OBJECT ENCODING']), j(nombres('object e')))
check('lo que no existe no sugiere nada', nombres('zzz').length === 0, '')
check('el tope de sugerencias', candidatosClaves('').length === MAX_SUGERENCIAS_CLAVES, String(candidatosClaves('').length))
const get = candidatosClaves('GET').find((c) => c.etiqueta === 'GET')
check('al elegir uno con argumentos se deja el espacio; con la sintaxis al lado', get?.insertar === 'GET ' && get.detalle === 'key', j(get))
check('uno sin argumentos (PING sí los tiene; DBSIZE no) no deja espacio', candidatosClaves('DBSIZE')[0]?.insertar === 'DBSIZE', j(candidatosClaves('DBSIZE')))
const enCluster = (p: string): string[] => candidatosClaves(p, { cluster: true }).map((c) => c.etiqueta)
check('en Cluster no se ofrece SELECT (solo la base 0); los demás, sí', !enCluster('SE').includes('SELECT') && enCluster('SE').includes('SET'), j(enCluster('SE')))
check('MITAD NEGATIVA: fuera de Cluster, SELECT sí', nombres('SEL').includes('SELECT'), '')

hr('El catálogo')
const nombresCat = COMANDOS_REDIS.map((c) => c.nombre)
check('sin repetidos ni nombres vacíos', new Set(nombresCat).size === nombresCat.length && nombresCat.every((n) => n !== ''), String(nombresCat.length))
check('trae los de escribir y borrar que usa el explorador', ['SET', 'DEL', 'UNLINK', 'LSET', 'ZADD', 'XADD', 'XDEL', 'HSET', 'RENAMENX', 'PERSIST', 'EXPIRE'].every((n) => nombresCat.includes(n)), '')
check('la sintaxis conserva las alternativas con barra (BITOP)', COMANDOS_REDIS.find((c) => c.nombre === 'BITOP')?.sintaxis.startsWith('AND|OR|XOR|NOT') === true, '')

hr('Historial: qué se inserta')
const sinTexto = { antes: '', despues: '' }
check('en un editor vacío: el comando recortado, sin terminador', j(insercionHistorialClaves('  GET a \n', sinTexto)) === j({ texto: 'GET a', cursor: 5 }), j(insercionHistorialClaves('  GET a \n', sinTexto)))
check('con texto antes del cursor: en una línea nueva', insercionHistorialClaves('GET a', { antes: 'SET x 1', despues: '' }).texto === '\nGET a', j(insercionHistorialClaves('GET a', { antes: 'SET x 1', despues: '' })))
check('con texto después: la línea se cierra con salto', insercionHistorialClaves('GET a', { antes: '', despues: 'SET x 1' }).texto === 'GET a\n', '')
check('con el fin de línea del modelo (CRLF)', insercionHistorialClaves('GET a', { antes: 'x', despues: 'y' }, '\r\n').texto === '\r\nGET a\r\n', j(insercionHistorialClaves('GET a', { antes: 'x', despues: 'y' }, '\r\n')))

const ok = results.filter((r) => r.pass).length
console.log(`\nVEREDICTO: ${ok}/${results.length} PASS`)
process.exit(ok === results.length ? 0 : 1)
