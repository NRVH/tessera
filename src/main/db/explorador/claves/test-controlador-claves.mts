#!/usr/bin/env node
// =============================================================================
// Prueba del `ControladorClaves` (Redis) con un gestor falso, sin servidor ni proceso: el historial de la
// consola (qué se anota, qué no, con qué resultado) y `GUARDAR_TEXTO` (validación, cancelación, fallos).
// El resto del controlador lo ejercita `test-db-redis.mts` con un servidor real.
// (node src/main/db/explorador/claves/test-controlador-claves.mts  ·  npm run test:controlador-claves)
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { KV_GUARDAR_MAX_CARACTERES, type DbKvResultado } from '../../../../shared/db-claves-ipc.ts'
import type { DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import { ControladorClaves, resultadoHistorialClaves, type EntradaHistorialClaves, type GestorClavesAtiende } from './ControladorClaves.ts'

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

const CON: DbConnection = { id: 'r1', profileId: 'p1', alias: 'REDIS', motor: 'redis', host: 'h', port: 6379, user: '', tieneSecreto: false, readonly: false }
const ok = (respuesta: DbKvResultado['respuesta'], base = 0): DbRespuesta<DbKvResultado> => ({ ok: true, valor: { respuesta, base, ms: 1 } })

/** Un gestor que contesta lo que se le diga a cada comando de la consola. */
function gestorFalso(contesta: (texto: string) => DbRespuesta<DbKvResultado>): GestorClavesAtiende {
  const sinUso = async (): Promise<never> => {
    throw new Error('no se usa')
  }
  return { bases: sinUso, escanear: sinUso, valor: sinUso, ejecutarConsola: async (req) => contesta(req.texto) }
}

function controlador(contesta: (t: string) => DbRespuesta<DbKvResultado>, extra: Partial<ConstructorParameters<typeof ControladorClaves>[0]> = {}): { c: ControladorClaves; hist: EntradaHistorialClaves[] } {
  const hist: EntradaHistorialClaves[] = []
  const c = new ControladorClaves({ conexiones: { get: (id) => (id === 'r1' ? CON : undefined) }, gestor: gestorFalso(contesta), alSentencia: (e) => hist.push(e), ...extra })
  return { c, hist }
}
const ejecutar = (c: ControladorClaves, texto: string, consolaId = 'consola-1', base = 0): Promise<DbRespuesta<unknown>> =>
  c.atender('CONSOLA_EJECUTAR', { perfilId: 'p1', consolaId, conexionId: 'r1', base, texto, desplazamiento: 0 })

async function main(): Promise<void> {
  hr('Historial de la consola')
  const a = controlador((t) => (t.startsWith('GET') ? ok({ tipo: 'bytes', valor: { texto: 'x', base64: 'eA==' } }) : ok({ tipo: 'error', texto: 'WRONGTYPE' })))
  await ejecutar(a.c, 'GET a')
  await ejecutar(a.c, 'HGET a f')
  check('un comando correcto se anota como ok, con la base como esquema', a.hist[0]?.resultado === 'ok' && a.hist[0].sql === 'GET a' && a.hist[0].esquema === 'db0' && a.hist[0].consolaId === 'consola-1', j(a.hist[0]))
  check('una respuesta de error de Redis (WRONGTYPE) sí llegó al servidor: error', a.hist[1]?.resultado === 'error', j(a.hist[1]))
  const b = controlador(() => ok({ tipo: 'simple', texto: 'OK' }, 3))
  await ejecutar(b.c, 'SELECT 3')
  check('la base que dice el resultado (SELECT) es la que se anota', b.hist[0]?.esquema === 'db3', j(b.hist[0]))
  await ejecutar(b.c, 'SET a 1', 'visor-1234')
  await ejecutar(b.c, 'UNLINK a b', 'visor-borrar-9')
  check('las sesiones del explorador (visor-…) no son consolas: no se anotan', b.hist.length === 1, j(b.hist))
  const errores: Array<[string, DbRespuesta<DbKvResultado>, string | null]> = [
    ['TESSERA-PRODUCCION', { ok: false, error: { motivo: 'produccion', mensaje: 'x', codigo: 'TESSERA-PRODUCCION' } }, null],
    ['TESSERA-PELIGROSO', { ok: false, error: { motivo: 'peligroso', mensaje: 'x', codigo: 'TESSERA-PELIGROSO' } }, null],
    ['cancelada', { ok: false, error: { motivo: 'cancelada', mensaje: 'x' } }, 'cancelada'],
    ['servidor', { ok: false, error: { motivo: 'servidor', mensaje: 'x' } }, 'error'],
    ['sesionPerdida', { ok: false, error: { motivo: 'sesionPerdida', mensaje: 'x' } }, 'error'],
    ['interno', { ok: false, error: { motivo: 'interno', mensaje: 'x' } }, null]
  ]
  for (const [nombre, r, esperado] of errores) check(`resultadoHistorialClaves: ${nombre}`, resultadoHistorialClaves(r) === esperado, String(resultadoHistorialClaves(r)))
  const sin = new ControladorClaves({ conexiones: { get: () => CON }, gestor: gestorFalso(() => ok({ tipo: 'nulo' })) })
  const r = await ejecutar(sin, 'GET a')
  check('sin historial inyectado, ejecuta igual', (r as { ok: boolean }).ok, j(r))
  const roto = controlador(() => ok({ tipo: 'nulo' }), {
    alSentencia: () => {
      throw new Error('disco lleno')
    }
  })
  const rr = await ejecutar(roto.c, 'GET a')
  check('un historial que lanza no rompe la respuesta', (rr as { ok: boolean }).ok, j(rr))

  hr('GUARDAR_TEXTO')
  const guardados: Array<[string, string]> = []
  const g = controlador(() => ok({ tipo: 'nulo' }), {
    guardarTexto: async (nombre, texto) => {
      guardados.push([nombre, texto])
      return nombre === 'cancelo' ? null : `${nombre}.json`
    }
  })
  const guardar = (req: Record<string, unknown>): Promise<DbRespuesta<unknown>> => g.c.atender('GUARDAR_TEXTO', { conexionId: 'r1', ...req })
  const g1 = await guardar({ nombre: 'usuario:1', texto: '{}' })
  check('guarda y devuelve solo el nombre del archivo', j(g1) === j({ ok: true, valor: { archivo: 'usuario:1.json' } }) && j(guardados[0]) === j(['usuario:1', '{}']), j(g1))
  const g2 = await guardar({ nombre: 'cancelo', texto: '{}' })
  check('el usuario cancela el diálogo: ok con null', j(g2) === j({ ok: true, valor: null }), j(g2))
  const malas: Array<[string, Record<string, unknown>]> = [
    ['sin nombre', { texto: '{}' }],
    ['nombre vacío', { nombre: '', texto: '{}' }],
    ['nombre larguísimo', { nombre: 'a'.repeat(300), texto: '{}' }],
    ['texto que no es texto', { nombre: 'a', texto: 5 }],
    ['texto por encima del tope', { nombre: 'a', texto: 'x'.repeat(KV_GUARDAR_MAX_CARACTERES + 1) }]
  ]
  for (const [nombre, req] of malas) {
    const antes = guardados.length
    const m = (await guardar(req)) as { ok: boolean }
    check(`petición inválida (${nombre}): se rechaza y no se abre el diálogo`, !m.ok && guardados.length === antes, j(m).slice(0, 120))
  }
  const sinDialogo = (await controlador(() => ok({ tipo: 'nulo' })).c.atender('GUARDAR_TEXTO', { conexionId: 'r1', nombre: 'a', texto: '{}' })) as { ok: boolean }
  check('sin diálogo inyectado, lo dice', !sinDialogo.ok, j(sinDialogo))
  const roto2 = controlador(() => ok({ tipo: 'nulo' }), {
    guardarTexto: async () => {
      throw new Error('EACCES: ruta secreta')
    }
  })
  const fallo = (await roto2.c.atender('GUARDAR_TEXTO', { conexionId: 'r1', nombre: 'a', texto: '{}' })) as { ok: boolean; error?: { mensaje: string } }
  check('un fallo al escribir da un mensaje sin la ruta del error de Node', !fallo.ok && !/EACCES|secreta/.test(fallo.error?.mensaje ?? ''), j(fallo))
  const ajena = (await g.c.atender('GUARDAR_TEXTO', { conexionId: 'no-existe', nombre: 'a', texto: '{}' })) as { ok: boolean }
  check('una conexión que no existe se rechaza', !ajena.ok, j(ajena))

  const bien = results.filter((x) => x.pass).length
  console.log(`\nVEREDICTO: ${bien}/${results.length} PASS`)
  process.exit(bien === results.length ? 0 : 1)
}

void main()
