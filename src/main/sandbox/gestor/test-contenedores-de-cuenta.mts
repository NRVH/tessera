// =============================================================================
// Prueba de los contenedores de cuenta (npm run test:contenedores-de-cuenta): el id y el nombre del
// contenedor de cada cuenta y de quién es; y, si hay Docker con la imagen del sandbox, dos cuentas
// del mismo perfil en contenedores separados que NO se ven las credenciales, parar el perfil que
// para también sus cuentas, y la parada diferida que un `ensureContainer` cancela.
// Decisiones: docs/decisiones/sandbox/contenedor-por-cuenta.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { nombreContenedorPara, cuentasDelPerfil, esDeCuenta, hostnameDe, idBase, perfilDeCuenta } from './nombres.ts'
import { GestorSandbox } from '../GestorSandbox.ts'
import type { Perfil } from '../../perfiles/types.ts'
import { esMac } from '../../../shared/plataforma.ts'

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
const saltadas: string[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
function salta(nombre: string, motivo: string): void {
  saltadas.push(nombre)
  console.log(`  [SALTA] ${nombre} -> ${motivo}`)
}
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const PERFIL: Perfil = {
  id: 'pruebascuentas',
  nombre: 'PruebasCuentas',
  color: '#61afef',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/pruebascuentas/claude' }],
  sandbox: { habilitado: true }
}

function nombres(): void {
  hr('(1) id y nombre del contenedor de cada cuenta')
  const a = perfilDeCuenta(PERFIL, 'cuenta-a')
  const a2 = perfilDeCuenta(PERFIL, 'cuenta-a')
  const b = perfilDeCuenta(PERFIL, 'cuenta-b')
  check('el de una cuenta es estable y distinto del de otra', a.id === a2.id && a.id !== b.id && a.id.startsWith(`${PERFIL.id}--`), `${a.id} / ${b.id}`)
  check('lleva el resto del perfil (nombre, .ssh, red)', a.nombre === PERFIL.nombre && a.sandbox === PERFIL.sandbox, a.nombre)
  check(
    'sabe de quién es; el del perfil no es de cuenta',
    idBase(a.id) === PERFIL.id && esDeCuenta(a.id) && !esDeCuenta(PERFIL.id) && idBase(PERFIL.id) === PERFIL.id,
    'ok'
  )
  check(
    'el perfil conoce sus cuentas, no las de otro',
    cuentasDelPerfil(PERFIL.id).includes(a.id) && cuentasDelPerfil(PERFIL.id).includes(b.id) && cuentasDelPerfil('otro').length === 0,
    cuentasDelPerfil(PERFIL.id).join(',')
  )
  check('derivar de un derivado da el mismo (no se anida)', perfilDeCuenta(a, 'cuenta-b').id === b.id, perfilDeCuenta(a, 'cuenta-b').id)
  const largo = perfilDeCuenta({ ...PERFIL, id: 'un-perfil-con-un-nombre-bastante-largo-de-verdad' }, 'f'.repeat(36))
  check('el hostname no pasa de 63 aunque el perfil sea largo', hostnameDe(largo).length <= 63, `${hostnameDe(largo).length}`)
  check('el contenedor se nombra con su id', nombreContenedorPara(a).endsWith(a.id), nombreContenedorPara(a))
}

function docker(args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000 })
  return { status: r.status, stdout: (r.stdout ?? '').trim() }
}

const vivo = (nombre: string): boolean => docker(['ps', '--filter', `name=^${nombre}$`, '--format', '{{.Names}}']).stdout === nombre

async function conDocker(): Promise<void> {
  hr('(2) con Docker: dos cuentas, dos contenedores que no se ven')
  if (docker(['info', '--format', '{{.ServerVersion}}']).status !== 0) {
    salta('contenedores de cuenta reales', 'Docker no responde')
    return
  }
  // La imagen es la de pruebas: el gestor la construye si falta, nunca usa la del usuario.
  const gestor = new GestorSandbox()
  const a = perfilDeCuenta(PERFIL, 'cuenta-a')
  const b = perfilDeCuenta(PERFIL, 'cuenta-b')
  // Docker Desktop para Mac no comparte el temporal del sistema: lo que se monta, bajo `/Users`.
  const base = esMac() ? os.homedir() : os.tmpdir()
  const tmp = mkdtempSync(path.join(base, '.tessera-cuentas-'))
  const credA = path.join(tmp, 'a')
  const credB = path.join(tmp, 'b')
  const proyecto = path.join(tmp, 'proyecto')
  for (const d of [credA, credB, proyecto]) mkdirSync(d, { recursive: true })
  writeFileSync(path.join(credA, '.credentials.json'), 'secreto-a')
  writeFileSync(path.join(credB, '.credentials.json'), 'secreto-b')
  writeFileSync(path.join(proyecto, 'LEEME.txt'), 'hola')
  try {
    const ha = await gestor.ensureContainer(a)
    const hb = await gestor.ensureContainer(b)
    check('cada cuenta tiene su contenedor', ha.nombreContenedor !== hb.nombreContenedor && vivo(ha.nombreContenedor) && vivo(hb.nombreContenedor), `${ha.nombreContenedor} / ${hb.nombreContenedor}`)
    await gestor.mountAgentConfig(a, 'claude-code', 'cuenta-a', credA)
    await gestor.mountAgentConfig(b, 'claude-code', 'cuenta-b', credB)
    await gestor.addProject(a, proyecto)
    const enA = await gestor.exec(a, 'ls /agent-config/claude-code; cat /agent-config/claude-code/*/.credentials.json')
    const enB = await gestor.exec(b, 'ls /agent-config/claude-code; cat /agent-config/claude-code/*/.credentials.json')
    check(
      'la cuenta A solo ve su credencial',
      enA.stdout.includes('cuenta-a') && enA.stdout.includes('secreto-a') && !enA.stdout.includes('cuenta-b') && !enA.stdout.includes('secreto-b'),
      JSON.stringify(enA.stdout)
    )
    check(
      'NEGATIVO: la cuenta B no llega a la de A, ni con un cat',
      enB.stdout.includes('secreto-b') && !enB.stdout.includes('secreto-a'),
      JSON.stringify(enB.stdout)
    )
    const leeme = await gestor.exec(a, 'cat /workspace/proyecto/LEEME.txt')
    check('el proyecto se ve en el contenedor de la cuenta', leeme.stdout.trim() === 'hola', JSON.stringify(leeme.stdout))

    hr('(3) parada diferida')
    gestor.programarParada(b, 500)
    await gestor.ensureContainer(b)
    await dormir(1500)
    check('un ensureContainer cancela la parada programada', vivo(hb.nombreContenedor), `vivo=${vivo(hb.nombreContenedor)}`)
    // Una sesión que se abrió mientras se cerraba la última ya está registrada: con ella no se para.
    gestor.retainSession(b.id, 'agent:prueba')
    gestor.programarParada(b, 300)
    await dormir(1500)
    check('NEGATIVO: con una sesión registrada dentro, la parada no lo mata', vivo(hb.nombreContenedor), `vivo=${vivo(hb.nombreContenedor)}`)
    gestor.releaseSession(b, 'agent:prueba')
    gestor.programarParada(a, 300)
    let parado = false
    for (let i = 0; i < 40 && !parado; i++) {
      await dormir(500)
      parado = !vivo(ha.nombreContenedor)
    }
    check('sin nadie que lo pida, se para solo', parado, `parado=${parado}`)

    hr('(4) parar el perfil para también sus cuentas')
    await gestor.ensureContainer(a)
    await gestor.detenerContenedor(PERFIL)
    check('ni A ni B quedan vivos', !vivo(ha.nombreContenedor) && !vivo(hb.nombreContenedor), `A=${vivo(ha.nombreContenedor)} B=${vivo(hb.nombreContenedor)}`)
  } finally {
    gestor.detenerSupervision()
    try {
      await gestor.detenerContenedor(PERFIL)
    } catch {
      /* lo que quede lo barre el arranque */
    }
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  nombres()
  await conDocker()
  hr('RESULTADO (PASS/FAIL)')
  const passed = results.filter((r) => r.pass).length
  for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
  if (saltadas.length > 0) console.log(`SALTADAS: ${saltadas.join(', ')}`)
  hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(passed === results.length ? 0 : 1)
}

void main()
