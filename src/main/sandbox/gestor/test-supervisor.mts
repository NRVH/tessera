// =============================================================================
// Prueba del supervisor de contenedores (npm run test:supervisor-contenedores): la lectura de
// `docker events`, qué cuenta como muerte (con OOM, ajena, esperada) y qué no, la caída y la vuelta
// de Docker con un `docker events` falso, el diagnóstico que usa lo que vio, y, si hay Docker,
// contenedores reales de `alpine` matados desde fuera y por memoria (se salta con su motivo si no).
// Decisiones: docs/decisiones/sandbox/supervisor-de-contenedores.md
// =============================================================================

import { spawnSync, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { argsEventos, causaDeMuerte, esperaReconexion, leerEvento } from './eventosDocker.ts'
import { NucleoSandbox } from './NucleoSandbox.ts'
import { SupervisorContenedores } from './supervisor.ts'
import { DiagnosticoSandbox } from './diagnostico.ts'
import type { Profile } from '../../profiles/types.ts'
import type { EstadoDocker } from '../../../shared/sandbox-estado-ipc.ts'

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
function salta(name: string, motivo: string): void {
  saltadas.push(name)
  console.log(`  [SALTA] ${name} -> ${motivo}`)
}
const j = (v: unknown): string => JSON.stringify(v)
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Una línea como las de `docker events --format '{{json .}}'`. */
function linea(accion: string, id: string, nombre: string, exitCode?: number): string {
  const atributos: Record<string, string> = { name: nombre }
  if (exitCode !== undefined) atributos.exitCode = String(exitCode)
  return JSON.stringify({ status: accion, id, Type: 'container', Action: accion, Actor: { ID: id, Attributes: atributos } })
}

/** Un `docker events` falso: su stdout es un stream y `exit` lo emite la prueba. */
class ProcesoFalso extends EventEmitter {
  readonly stdout = new PassThrough()
  muerto = false
  kill(): boolean {
    this.muerto = true
    return true
  }
}

function nucleoCon(handles: Record<string, string>): NucleoSandbox {
  const n = new NucleoSandbox('', null)
  for (const [profileId, id] of Object.entries(handles)) {
    n.handles.set(profileId, { profileId, containerName: `tessera-${profileId}`, containerId: id, workspacePath: '/workspace', redHostAplicado: false })
  }
  return n
}

function eventos(): void {
  hr('(1) lectura de `docker events`')
  const die = leerEvento(linea('die', 'abc', 'tessera-qa', 137))
  check('un die trae acción, id, nombre y código', j(die) === j({ accion: 'die', id: 'abc', nombre: 'tessera-qa', exitCode: 137 }), j(die))
  const oom = leerEvento(linea('oom', 'abc', 'tessera-qa'))
  check('un oom no trae código', oom?.accion === 'oom' && oom.exitCode === null, j(oom))
  check(
    'NEGATIVO: lo que no interesa (exec_die, start), una línea rota o sin nombre',
    leerEvento(linea('exec_die', 'abc', 'tessera-qa')) === null &&
      leerEvento(linea('start', 'abc', 'tessera-qa')) === null &&
      leerEvento('{no es json') === null &&
      leerEvento(JSON.stringify({ Action: 'die', Actor: { ID: 'abc', Attributes: {} } })) === null,
    'null'
  )
  const conSello = argsEventos('ab12')
  const sinSello = argsEventos('')
  check(
    'escucha solo contenedores, solo die/oom/destroy y solo los de esta instancia',
    conSello.includes('type=container') &&
      ['event=die', 'event=oom', 'event=destroy'].every((e) => conSello.includes(e)) &&
      conSello.some((a) => a.endsWith('=ab12')) &&
      sinSello.includes('name=tessera-'),
    j(conSello)
  )
  check('la causa: sin memoria solo con OOM visto', causaDeMuerte(true) === 'sin-memoria' && causaDeMuerte(false) === 'murio', 'ok')
  check(
    'las esperas crecen y se quedan en la última',
    esperaReconexion(0) < esperaReconexion(1) && esperaReconexion(99) === esperaReconexion(4) && esperaReconexion(-1) === esperaReconexion(0),
    j([0, 1, 2, 3, 4, 9].map(esperaReconexion))
  )
}

function muertes(): void {
  hr('(2) qué cuenta como muerte')
  const n = nucleoCon({ qa: 'id-qa', otro: 'id-otro' })
  const sup = new SupervisorContenedores(n, { checkDocker: async () => ({ ok: true, detalle: '' }), ahora: () => 1000 })
  sup.alLinea(linea('die', 'id-qa', 'tessera-qa', 137))
  check(
    'el contenedor vivo de un perfil muere: deja de darse por vivo y se apunta «murio»',
    !n.handles.has('qa') && n.muertes.get('qa')?.causa === 'murio' && n.handles.has('otro'),
    j({ handles: [...n.handles.keys()], muertes: [...n.muertes] })
  )
  sup.alLinea(linea('oom', 'id-otro', 'tessera-otro'))
  sup.alLinea(linea('die', 'id-otro', 'tessera-otro', 137))
  check('con un OOM antes de su die: «sin-memoria»', n.muertes.get('otro')?.causa === 'sin-memoria', j(n.muertes.get('otro')))

  const m = nucleoCon({ qa: 'id-qa' })
  const sup2 = new SupervisorContenedores(m, { checkDocker: async () => ({ ok: true, detalle: '' }) })
  sup2.alLinea(linea('die', 'id-viejo', 'tessera-qa', 0))
  sup2.alLinea(linea('destroy', 'id-de-otra-instancia', 'tessera-zz-qa'))
  check('NEGATIVO: un Id que no es el vivo conocido (uno viejo o ajeno) no toca nada', m.handles.has('qa') && m.muertes.size === 0, j([...m.muertes]))
  m.paradasEsperadas.set('tessera-qa', 1)
  sup2.alLinea(linea('die', 'id-qa', 'tessera-qa', 0))
  check('NEGATIVO: el que para Tessera (hibernar, pizarra limpia) no es una muerte', m.handles.has('qa') && m.muertes.size === 0, j([...m.muertes]))

  const r = nucleoCon({})
  r.muertes.set('qa', { causa: 'murio', en: 1000 })
  check(
    'la muerte vale para el diagnóstico solo un rato',
    r.muerteReciente('qa', 2000) === 'murio' && r.muerteReciente('qa', 1000 + 120_001) === null && r.muerteReciente('otro', 2000) === null,
    'ok'
  )
}

async function caidaYVuelta(): Promise<void> {
  hr('(3) Docker se cae y vuelve (con un `docker events` falso)')
  const n = nucleoCon({ qa: 'id-qa' })
  const estados: EstadoDocker[] = []
  n.onEstadoDocker = (e): void => {
    estados.push(e)
  }
  const procesos: ProcesoFalso[] = []
  let dockerResponde = false
  const sup = new SupervisorContenedores(n, {
    checkDocker: async () => ({ ok: dockerResponde, detalle: '' }),
    lanzar: () => {
      const p = new ProcesoFalso()
      procesos.push(p)
      return p as unknown as ChildProcess
    },
    espera: () => 20
  })
  sup.iniciar()
  sup.iniciar()
  check('iniciar es idempotente: un solo `docker events`', procesos.length === 1, `${procesos.length}`)
  procesos[0].stdout.write(linea('die', 'id-qa', 'tessera-qa', 1) + '\n')
  await dormir(10)
  check('lee las líneas de su stdout', n.muertes.get('qa')?.causa === 'murio', j([...n.muertes]))

  procesos[0].emit('exit', 1)
  await dormir(80)
  check('el stream se corta y Docker no responde: «caido», una vez', n.dockerCaido && j(estados) === j(['caido']), j(estados))
  check('sin Docker no vuelve a escuchar', procesos.length === 1, `${procesos.length}`)
  dockerResponde = true
  await dormir(80)
  check('Docker vuelve: «disponible» y escucha otra vez', !n.dockerCaido && j(estados) === j(['caido', 'disponible']) && procesos.length === 2, j({ estados, procesos: procesos.length }))

  const diag = new DiagnosticoSandbox(n)
  const perfil = { id: 'qa' } as Profile
  n.dockerCaido = true
  check('el diagnóstico con Docker caído según el supervisor: «daemon-down» sin sonda', (await diag.diagnoseProfile(perfil)) === 'daemon-down', 'ok')
  n.dockerCaido = false
  n.muertes.set('qa', { causa: 'sin-memoria', en: Date.now() })
  check('con un OOM reciente: «sin-memoria»', (await diag.diagnoseProfile(perfil)) === 'sin-memoria', 'ok')

  // El contenedor vivo con un OOM reciente: solo es ESTA sesión si la mató un SIGKILL.
  const vivo = nucleoCon({ qa: 'id-qa' })
  vivo.oomRecientes.set('qa', Date.now())
  const diagVivo = new DiagnosticoSandbox(vivo)
  const sondaVivo = diagVivo as unknown as { diagnosticar: () => Promise<string> }
  sondaVivo.diagnosticar = async () => 'ok'
  check(
    'OOM con el contenedor vivo: «sin-memoria» con 137 o sin código, «ok» si salió por sí misma',
    (await diagVivo.diagnoseProfile(perfil, 137)) === 'sin-memoria' &&
      (await diagVivo.diagnoseProfile(perfil, null)) === 'sin-memoria' &&
      (await diagVivo.diagnoseProfile(perfil, 0)) === 'ok',
    'ok'
  )

  // Un diagnóstico que ve a Docker caído avisa al supervisor, que sondea hasta que vuelve.
  const otro = nucleoCon({})
  const vistos: EstadoDocker[] = []
  otro.onEstadoDocker = (e): void => {
    vistos.push(e)
  }
  let responde = false
  const sup2 = new SupervisorContenedores(otro, {
    checkDocker: async () => ({ ok: responde, detalle: '' }),
    lanzar: () => new ProcesoFalso() as unknown as ChildProcess,
    espera: () => 20
  })
  sup2.dockerCaidoSegunDiagnostico()
  await dormir(50)
  responde = true
  await dormir(80)
  check('Docker caído según un diagnóstico: «caido» y, cuando vuelve, «disponible»', j(vistos) === j(['caido', 'disponible']), j(vistos))
  sup2.detener()

  sup.detener()
  procesos[1].emit('exit', 0)
  await dormir(60)
  check('detener mata el stream y no sondea más', procesos[1].muerto && procesos.length === 2, j({ muerto: procesos[1].muerto, procesos: procesos.length }))
}

/** Nombres de los contenedores de esta prueba: con el prefijo que escucha el supervisor sin sello. */
const MATADO = 'tessera-pruebas-supervisor-rm'
const SIN_MEMORIA = 'tessera-pruebas-supervisor-oom'
const ESPERADO = 'tessera-pruebas-supervisor-stop'

function docker(args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000 })
  return { status: r.status, stdout: (r.stdout ?? '').trim() }
}

/** Un contenedor de `alpine` (la imagen del ayudante de montajes) que corre `cmd`; su Id o null. */
function arrancar(nombre: string, cmd: string[], extra: string[] = []): string | null {
  docker(['rm', '-f', nombre])
  const r = docker(['run', '-d', '--name', nombre, ...extra, 'alpine', ...cmd])
  return r.status === 0 && r.stdout !== '' ? r.stdout : null
}

async function esperarA(cond: () => boolean, ms: number): Promise<boolean> {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (cond()) return true
    await dormir(200)
  }
  return cond()
}

async function conDocker(): Promise<void> {
  hr('(4) con Docker: contenedores reales matados desde fuera')
  if (docker(['info', '--format', '{{.ServerVersion}}']).status !== 0) {
    salta('contenedores reales', 'Docker no responde')
    return
  }
  const idRm = arrancar(MATADO, ['sleep', '300'])
  const idOom = arrancar(SIN_MEMORIA, ['sleep', '300'], ['--memory', '32m', '--memory-swap', '32m'])
  const idStop = arrancar(ESPERADO, ['sleep', '300'])
  if (!idRm || !idOom || !idStop) {
    salta('contenedores reales', 'no se pudo arrancar alpine (¿sin red para descargarla?)')
    return
  }
  const n = nucleoCon({ rm: idRm, oom: idOom, stop: idStop })
  for (const [p, nombre] of [['rm', MATADO], ['oom', SIN_MEMORIA], ['stop', ESPERADO]]) {
    const h = n.handles.get(p)
    if (h) n.handles.set(p, { ...h, containerName: nombre })
  }
  const sup = new SupervisorContenedores(n, { checkDocker: async () => ({ ok: true, detalle: '' }) })
  try {
    sup.iniciar()
    await dormir(2000) // que `docker events` ya esté escuchando
    docker(['rm', '-f', MATADO])
    const visto = await esperarA(() => n.muertes.has('rm'), 15_000)
    check('un `docker rm -f` desde fuera: lo ve, lo da por muerto y apunta «murio»', visto && !n.handles.has('rm') && n.muertes.get('rm')?.causa === 'murio', j(n.muertes.get('rm')))

    // Un proceso dentro llena la memoria: el kernel lo mata a él y el contenedor (el `sleep`) sigue,
    // como cuando un agente agota la memoria del suyo.
    docker(['exec', '-d', SIN_MEMORIA, 'sh', '-c', 'x=a; while true; do x="$x$x"; done'])
    const oom = await esperarA(() => n.oomRecientes.has('oom'), 30_000)
    check(
      'sin memoria con el contenedor vivo: Docker avisa del OOM, se apunta y no se da por muerto',
      oom && n.handles.has('oom') && !n.muertes.has('oom') && n.oomReciente('oom', Date.now()),
      j({ oom, vivo: n.handles.has('oom'), muertes: [...n.muertes.keys()] })
    )

    n.paradasEsperadas.set(ESPERADO, 1)
    docker(['rm', '-f', ESPERADO])
    await dormir(2000)
    check('NEGATIVO: el que para Tessera no cuenta como muerte', n.handles.has('stop') && !n.muertes.has('stop'), j([...n.muertes.keys()]))
  } finally {
    sup.detener()
    for (const nombre of [MATADO, SIN_MEMORIA, ESPERADO]) docker(['rm', '-f', nombre])
  }
}

async function main(): Promise<void> {
  eventos()
  muertes()
  await caidaYVuelta()
  await conDocker()

  hr('RESULTADO (PASS/FAIL)')
  const passed = results.filter((r) => r.pass).length
  for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
  if (saltadas.length > 0) console.log(`SALTADAS: ${saltadas.join(', ')}`)
  hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(passed === results.length ? 0 : 1)
}

void main()
