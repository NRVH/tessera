#!/usr/bin/env node
// =============================================================================
// Prueba del flujo que confirma la huella de un servidor nuevo antes de conectar (npm run test:huella-nueva-ssh):
// pregunta un servidor a la vez y en el orden en que llegan (los bastiones primero), se para en cuanto la
// persona no confirma, devuelve el fallo tal cual, comparte la comprobación de una conexión entre quienes la
// piden a la vez y escribe el destino con la IPv6 entre corchetes. El IPC y el diálogo, falsos.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================

import type { SshHuellaNueva, SshReconocerHuella, SshReconocimiento } from '../../../../shared/ssh-ipc.ts'
import { asegurarHuellaCon, destinoHuella, unaPorConexion } from './huellaNuevaSsh.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const nueva = (alias: string, ficha: string, bastionDe?: string): SshReconocimiento => ({
  tipo: 'nueva',
  ficha,
  alias,
  host: '192.0.2.10',
  puerto: 22,
  metodo: 'contrasena',
  huellas: [{ algoritmo: 'ssh-ed25519', sha256: 'abc' }],
  ...(bastionDe === undefined ? {} : { bastionDe })
})

/** El main falso: devuelve en orden lo que haya y, al acabarse, «conocida». */
function mainFalso(respuestas: SshReconocimiento[]): { reconocer: (r: SshReconocerHuella) => Promise<SshReconocimiento>; pedidas: SshReconocerHuella[] } {
  const pedidas: SshReconocerHuella[] = []
  return {
    pedidas,
    reconocer: async (r) => {
      pedidas.push(r)
      return respuestas.shift() ?? { tipo: 'conocida' }
    }
  }
}

hr('1 - Un servidor a la vez, en orden, hasta que no quede ninguno')
{
  const m = mainFalso([nueva('bastion', 'f1', 'destino'), nueva('destino', 'f2')])
  const preguntadas: SshHuellaNueva[] = []
  const r = await asegurarHuellaCon({ reconocer: m.reconocer, preguntar: async (h) => (preguntadas.push(h), true) }, { id: 'c1', profileId: 'pa' })
  check('(1a) con las dos confirmadas: lista', r.tipo === 'lista', j(r))
  check('(1b) primero el bastión y luego el destino, cada uno con su ficha', j(preguntadas.map((h) => [h.alias, h.ficha, h.bastionDe ?? null])) === j([['bastion', 'f1', 'destino'], ['destino', 'f2', null]]), j(preguntadas))
  check('(1c) el diálogo no recibe el «tipo» del IPC', preguntadas.every((h) => !('tipo' in h)), j(preguntadas[0]))
  check('(1d) y vuelve a preguntar al main tras cada una, con la misma petición', m.pedidas.length === 3 && m.pedidas.every((p) => p.id === 'c1' && p.profileId === 'pa'), j(m.pedidas))
}

hr('2 - Si la persona no confirma, se para y no conecta')
{
  const m = mainFalso([nueva('bastion', 'f1'), nueva('destino', 'f2')])
  let preguntas = 0
  const r = await asegurarHuellaCon({ reconocer: m.reconocer, preguntar: async () => (preguntas++, false) }, { id: 'c1' })
  check('(2a) cancelada a la primera, sin preguntar por el destino ni volver al main', r.tipo === 'cancelada' && preguntas === 1 && m.pedidas.length === 1, `${j(r)} preguntas=${preguntas} pedidas=${m.pedidas.length}`)
}

hr('3 - Lo conocido y el fallo, tal cual')
{
  let preguntas = 0
  const preguntar = async (): Promise<boolean> => (preguntas++, true)
  const conocida = await asegurarHuellaCon({ reconocer: mainFalso([]).reconocer, preguntar }, { id: 'c1' })
  check('(3a) todo conocido: lista, sin preguntar', conocida.tipo === 'lista' && preguntas === 0, j(conocida))
  const resultado = { ok: false as const, ms: 10, huellas: [], motivo: 'ssh-inalcanzable' as const, detalle: 'ssh: connect to host 192.0.2.10 port 22: Connection timed out' }
  const fallo = await asegurarHuellaCon({ reconocer: mainFalso([{ tipo: 'fallo', resultado }]).reconocer, preguntar }, { id: 'c1', prueba: true })
  check('(3b) sin poder traerla: el fallo con su resultado, sin preguntar', fallo.tipo === 'fallo' && j(fallo.resultado) === j(resultado) && preguntas === 0, j(fallo))
  const siempre = { reconocer: async (): Promise<SshReconocimiento> => nueva('x', 'f'), preguntar }
  const tope = await asegurarHuellaCon(siempre, { id: 'c1' })
  check('(3c) con un main que no deja de pedir, el bucle tiene tope (la línea estricta de ssh decide)', tope.tipo === 'lista' && preguntas === 5, `preguntas=${preguntas}`)
}

hr('4 - Una comprobación por conexión a la vez')
{
  let llamadas = 0
  const esperando: Array<() => void> = []
  const soltarTodas = (): void => {
    for (const r of esperando.splice(0)) r()
  }
  const f = unaPorConexion(async (req) => {
    llamadas++
    await new Promise<void>((r) => esperando.push(r))
    return req.id
  })
  const a = f({ id: 'c1', profileId: 'pa' })
  const b = f({ id: 'c1', profileId: 'pa' })
  const c = f({ id: 'c2' })
  check('(4a) dos peticiones de la misma conexión esperan a la misma; otra conexión va aparte', a === b && a !== c && llamadas === 2, `llamadas=${llamadas}`)
  soltarTodas()
  await Promise.all([a, b, c])
  const d = f({ id: 'c1' })
  check('(4b) acabada, la siguiente vuelve a comprobar', d !== a && llamadas === 3, `llamadas=${llamadas}`)
  soltarTodas()
  await d
}

hr('5 - El destino que se enseña')
{
  check('(5a) host y puerto', destinoHuella('10.20.0.5', 22) === '10.20.0.5:22', destinoHuella('10.20.0.5', 22))
  check('(5b) una IPv6, entre corchetes', destinoHuella('2001:db8::5', 2222) === '[2001:db8::5]:2222', destinoHuella('2001:db8::5', 2222))
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
