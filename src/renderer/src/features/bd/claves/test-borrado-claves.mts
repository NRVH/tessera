#!/usr/bin/env node
// =============================================================================
// Prueba del borrado por patrón, sin servidor (npm run test:borrado-claves; lógica pura de
// `borradoClaves.ts`): la recogida por SCAN (sin repetir, con tope y con Stop), los lotes de UNLINK y el
// envío (suma de lo borrado, parada en el primer fallo y por Stop).
// =============================================================================

import type { DbKvBytes, DbKvPaginaClaves, DbKvResultado } from '../../../../../shared/db-claves-ipc.ts'
import type { DbRespuesta } from '../../../../../shared/db-explorador-ipc.ts'
import { casaConTodas, ejecutarBorrado, lotesDeBorrado, recogerClaves, resumenVistaPrevia, textoClaves } from './borradoClaves.ts'

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
const pagina = (cursor: string, ...nombres: string[]): DbRespuesta<DbKvPaginaClaves> => ({
  ok: true,
  valor: { cursor, claves: nombres.map((n) => ({ nombre: txt(n), tipo: 'string' as const, ttlMs: null })), ms: 1 }
})
/** Un escáner que devuelve las páginas en orden y cuenta las llamadas. */
function escaner(paginas: DbRespuesta<DbKvPaginaClaves>[]): { escanear: (c: string) => Promise<DbRespuesta<DbKvPaginaClaves>>; cursores: string[] } {
  const cursores: string[] = []
  let i = 0
  return {
    cursores,
    escanear: async (c) => {
      cursores.push(c)
      return paginas[Math.min(i++, paginas.length - 1)]
    }
  }
}
const resp = (r: DbKvResultado['respuesta']): DbRespuesta<DbKvResultado> => ({ ok: true, valor: { respuesta: r, base: 0, ms: 1 } })

async function main(): Promise<void> {
  hr('Recoger lo que casa')
  const a = escaner([pagina('7', 'a', 'b'), pagina('0', 'b', 'c')])
  const r1 = await recogerClaves(a.escanear, { cancelada: () => false })
  check('hasta que el cursor vuelve a 0, sin repetir (SCAN puede dar una clave dos veces)', r1.ok && r1.valor.fin === 'completa' && r1.valor.claves.map((k) => k.texto).join() === 'a,b,c', j(r1))
  check('… y cada vuelta pide con el cursor de la anterior', j(a.cursores) === j(['0', '7']), j(a.cursores))
  const b = escaner([pagina('7', 'a', 'b', 'c'), pagina('0', 'd')])
  const r2 = await recogerClaves(b.escanear, { tope: 2, cancelada: () => false })
  check('con tope: se corta ahí, dice «tope» y no pide más', r2.ok && r2.valor.fin === 'tope' && r2.valor.claves.length === 2 && b.cursores.length === 1, j(r2))
  let n = 0
  const c = escaner([pagina('7', 'a'), pagina('7', 'b'), pagina('0', 'c')])
  const r3 = await recogerClaves(c.escanear, { cancelada: () => n++ >= 1 })
  check('Stop entre vueltas: «detenida» con lo reunido', r3.ok && r3.valor.fin === 'detenida' && r3.valor.claves.length === 1, j(r3))
  const d = escaner([pagina('7', 'a'), { ok: false, error: { motivo: 'servidor', mensaje: 'NOPERM' } }])
  const r4 = await recogerClaves(d.escanear, { cancelada: () => false })
  check('una vuelta que falla es el fallo de la recogida', !r4.ok && r4.error.mensaje === 'NOPERM', j(r4))
  const e = escaner([pagina('3'), pagina('0', 'x')])
  const r5 = await recogerClaves(e.escanear, { cancelada: () => false })
  check('vueltas vacías con cursor abierto no la cortan (SCAN lo hace con MATCH)', r5.ok && r5.valor.claves.length === 1, j(r5))
  const progreso: number[] = []
  await recogerClaves(escaner([pagina('7', 'a'), pagina('0', 'b')]).escanear, { cancelada: () => false, alProgreso: (k) => progreso.push(k) })
  check('el progreso cuenta las claves reunidas', j(progreso) === j([1, 2]), j(progreso))

  hr('Los lotes de UNLINK')
  const veinte = Array.from({ length: 5 }, (_, i) => txt(`k${i}`))
  check('de N en N, cada uno un UNLINK', j(lotesDeBorrado(veinte, 2)) === j(['UNLINK k0 k1', 'UNLINK k2 k3', 'UNLINK k4']), j(lotesDeBorrado(veinte, 2)))
  check('sin claves, sin comandos', lotesDeBorrado([]).length === 0, '')
  check('una clave con espacios o binaria va citada', j(lotesDeBorrado([txt('a b'), { base64: Buffer.from([0, 0x41]).toString('base64') }])) === j(['UNLINK "a b" "\\x00A"']), j(lotesDeBorrado([txt('a b')])))
  const largas = Array.from({ length: 3 }, (_, i) => txt(`${i}`.repeat(150_000)))
  check('el tope de texto de un lote parte aunque no se llegue al número de claves', lotesDeBorrado(largas).length === 3, String(lotesDeBorrado(largas).length))

  hr('Enviar')
  const enviados: string[] = []
  const r6 = await ejecutarBorrado(['UNLINK a', 'UNLINK b'], async (t) => (enviados.push(t), resp({ tipo: 'entero', valor: '2' })), () => false)
  check('suma lo que Redis dice haber borrado', r6.borradas === 4 && r6.enviados === 2 && r6.paro === undefined, j(r6))
  const r7 = await ejecutarBorrado(['UNLINK a', 'UNLINK b', 'UNLINK c'], async (t) => (t === 'UNLINK b' ? { ok: false, error: { motivo: 'soloLectura', mensaje: 'solo lectura' } } : resp({ tipo: 'entero', valor: '1' })), () => false)
  check('al primer fallo para, y dice qué se borró hasta ahí', r7.borradas === 1 && r7.enviados === 1 && r7.paro?.tipo === 'error', j(r7))
  const r8 = await ejecutarBorrado(['UNLINK a'], async () => resp({ tipo: 'error', texto: 'ERR algo' }), () => false)
  check('una respuesta de error de Redis también para', r8.paro?.tipo === 'error' && r8.borradas === 0, j(r8))
  let k = 0
  const r9 = await ejecutarBorrado(['UNLINK a', 'UNLINK b'], async () => resp({ tipo: 'entero', valor: '1' }), () => k++ >= 1)
  check('Stop entre lotes: lo ya borrado cuenta y no sigue', r9.borradas === 1 && r9.paro?.tipo === 'detenido', j(r9))

  hr('Textos')
  check('casaConTodas: solo * (o varios)', casaConTodas('*') && casaConTodas('**') && !casaConTodas('a*') && !casaConTodas(''), 'ok')
  check('textoClaves: singular y plural con miles', textoClaves(1) === '1 clave' && textoClaves(2345).endsWith('claves'), `${textoClaves(1)} ${textoClaves(2345)}`)
  check('el resumen distingue completa, tope y detenida', resumenVistaPrevia({ claves: [txt('a')], fin: 'completa' }) === 'Se borrarán 1 clave.' && /parado/.test(resumenVistaPrevia({ claves: [txt('a')], fin: 'tope' })) && /detenida/i.test(resumenVistaPrevia({ claves: [], fin: 'detenida' })), 'ok')
  check('sin claves: lo dice', /Ninguna/.test(resumenVistaPrevia({ claves: [], fin: 'completa' })), resumenVistaPrevia({ claves: [], fin: 'completa' }))

  const ok = results.filter((x) => x.pass).length
  console.log(`\nVEREDICTO: ${ok}/${results.length} PASS`)
  process.exit(ok === results.length ? 0 : 1)
}

void main()
