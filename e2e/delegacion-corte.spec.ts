// =============================================================================
// Las tareas delegadas ante un apagado, en la app empaquetada y con Docker de verdad: un agente de mentira dentro del
// contenedor de la cuenta se queda trabajando, Tessera muere por su PID o se cierra, y al volver la tarea figura como
// interrumpida y se puede reanudar o cancelar. También, el catálogo de modelos real que anuncia Codex en el contenedor.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================

import { crearTemporal } from './temporales'
import { expect, test } from '@playwright/test'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { dockerMontaProyectos } from './loginCuenta'
import { abrirTessera, borrarTemporal, carpetasAgentes, PLATAFORMA, type SesionTessera } from './tessera'

const PERFIL = 'corte-e2e'
const ID_NATIVA = 'c1a0de00-0000-4000-8000-0000000000ab'
const ID_DELEGADA = '0d1c2b3a-1111-2222-3333-444455556666'
const TCTX = resolve(process.cwd(), 'src', 'tctx', 'tctx.cjs')
/** Lo que queda del `userData` de un arranque al siguiente: lo que un apagado deja en el disco. */
const QUE_SOBREVIVE = ['profiles.json', 'workspace-state.json', 'agent-accounts.json', 'tareas-delegadas.json', '.tessera']
/** Un CLI que abre su conversación y se queda trabajando. */
const AGENTE_OCUPADO = [
  '#!/bin/bash',
  'cat > /dev/null',
  `echo '{"type":"system","subtype":"init","session_id":"${ID_DELEGADA}"}'`,
  'echo \'{"type":"assistant","message":{"content":[{"type":"text","text":"Trabajando"}]}}\'',
  'exec sleep 900'
].join('\n')
/** Un CLI que apunta con qué lo arrancaron y termina bien. */
const AGENTE_QUE_TERMINA = [
  '#!/bin/bash',
  'cat > /dev/null',
  'echo "$*" > /tmp/argumentos-claude',
  `echo '{"type":"system","subtype":"init","session_id":"${ID_DELEGADA}"}'`,
  `echo '{"type":"result","subtype":"success","is_error":false,"result":"Reanudada","session_id":"${ID_DELEGADA}"}'`
].join('\n')

function poner(ruta: string, texto: string): void {
  mkdirSync(join(ruta, '..'), { recursive: true })
  writeFileSync(ruta, texto)
}

function sembrar(datos: string, proyecto: string): void {
  writeFileSync(join(datos, 'profiles.json'), JSON.stringify([{ id: PERFIL, nombre: 'Corte', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${PERFIL}/claude` }, { tipo: 'codex', configDir: `./.tessera/perfiles/${PERFIL}/codex` }], sandbox: { habilitado: false } }]))
  writeFileSync(join(datos, 'workspace-state.json'), JSON.stringify({ version: 1, activeProfileId: PERFIL, byProfile: { [PERFIL]: { openProjects: [{ projectHostPath: proyecto, name: 'proyecto', estado: 'active' }], activePath: proyecto } }, settings: { menuWindowsAvisado: true } }))
  writeFileSync(join(datos, 'agent-accounts.json'), JSON.stringify({ version: 1, accounts: [{ id: 'cuenta-claude', nombre: 'Claude Uno', agente: 'claude-code', profileId: PERFIL }, { id: 'cuenta-codex', nombre: 'Codex Uno', agente: 'codex', profileId: PERFIL }] }))
  const base = join(datos, '.tessera', 'perfiles', PERFIL)
  poner(join(base, 'claude-cuentas', 'cuenta-claude', '.credentials.json'), '{}')
  poner(join(base, 'codex-cuentas', 'cuenta-codex', 'auth.json'), '{}')
  poner(join(carpetasAgentes(datos).claude, 'projects', proyecto.replace(/[^A-Za-z0-9]/g, '-'), `${ID_NATIVA}.jsonl`), `${JSON.stringify({ type: 'user', sessionId: ID_NATIVA, cwd: proyecto, timestamp: '2026-10-01T10:00:00.000Z', message: { role: 'user', content: 'hola' } })}\n`)
}

const docker = (...args: string[]): SpawnSyncReturns<string> => spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000 })
const contenedores = (): string[] => docker('ps', '-a', '--format', '{{.Names}}').stdout.split(/\r?\n/).filter((n) => n.includes(`${PERFIL}--`))

function quitarContenedores(): void {
  for (const c of contenedores()) docker('rm', '-f', c)
}

function instalarAgente(guion: string): void {
  const nombres = contenedores()
  expect(nombres.length, 'el contenedor de la cuenta está levantado').toBeGreaterThan(0)
  for (const c of nombres) {
    const r = spawnSync('docker', ['exec', '-i', '-u', 'root', c, 'bash', '-c', 'rm -f /usr/local/bin/claude && cat > /usr/local/bin/claude && chmod 755 /usr/local/bin/claude'], { input: `${guion}\n`, encoding: 'utf8', timeout: 30_000 })
    expect(r.status, r.stderr).toBe(0)
  }
}

/** Como muere en un corte: sin avisar, por su PID y con sus procesos hijos. */
function matar(pid: number): void {
  if (PLATAFORMA === 'windows') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'])
  else process.kill(pid, 'SIGKILL')
}

interface Registrada {
  vista: { id: string; estado: string; conversacion?: string }
}
function registro(datos: string): Registrada[] {
  const ruta = join(datos, 'tareas-delegadas.json')
  return existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as Registrada[]) : []
}

test.describe.serial('tareas delegadas ante un apagado', () => {
  test.skip(!dockerMontaProyectos(), 'Docker no responde o no ve las carpetas de este sistema')
  test.setTimeout(420_000)

  let copia: string
  let agente: AgenteFalso
  let s: SesionTessera | null = null
  let proyecto = ''
  let entorno: NodeJS.ProcessEnv = {}
  let idTarea = ''

  const tctx = (args: string[], entrada = ''): SpawnSyncReturns<string> => spawnSync(process.execPath, [TCTX, ...args], { env: entorno, input: entrada, encoding: 'utf8', timeout: 150_000 })

  async function arrancar(sembrador: (datos: string) => void, entornoExtra: Record<string, string> = {}): Promise<void> {
    const previos = agente.arranques('claude').length
    s = await abrirTessera({ ...agente.env, ...entornoExtra }, { sembrar: sembrador })
    await expect.poll(() => agente.arranques('claude').length, { message: 'el agente nativo arranca', timeout: 60_000 }).toBeGreaterThan(previos)
    const nativo = agente.arranques('claude').at(-1)!
    expect(nativo.pipe && nativo.sesion, 'el nativo lleva su puente').toBeTruthy()
    entorno = { ...process.env, TESSERA_DB_PIPE: nativo.pipe!, TESSERA_DB_SESSION: nativo.sesion!, TESSERA_IDIOMA: 'es' }
  }

  function guardarDisco(datos: string): void {
    rmSync(join(copia, 'datos'), { recursive: true, force: true })
    for (const nombre of QUE_SOBREVIVE) if (existsSync(join(datos, nombre))) cpSync(join(datos, nombre), join(copia, 'datos', nombre), { recursive: true })
  }

  const restaurarDisco = (datos: string): void => cpSync(join(copia, 'datos'), datos, { recursive: true })

  /** Levanta el contenedor de la cuenta, le pone el agente de mentira y lanza una tarea hasta que tiene conversación. */
  async function lanzarTareaOcupada(datos: string): Promise<string> {
    tctx(['modelos', '--agente', 'claude-code', '--cuenta', 'Claude Uno'])
    instalarAgente(AGENTE_OCUPADO)
    const r = tctx(['delegar', '--agente', 'claude-code', '--cuenta', 'Claude Uno', '--esfuerzo', 'high', '--sin-esperar'], 'Haga el trabajo largo')
    expect(r.status, r.stderr).toBe(0)
    const id = r.stdout.trim()
    await expect.poll(() => registro(datos).find((e) => e.vista.id === id)?.vista.conversacion, { message: 'el registro guarda su conversación', timeout: 90_000 }).toBe(ID_DELEGADA)
    return id
  }

  test.beforeAll(async () => {
    copia = crearTemporal(join(tmpdir(), 'tessera-corte-e2e-'))
    agente = montarAgenteFalso()
    proyecto = join(agente.raiz, 'proyecto')
    mkdirSync(proyecto)
    await arrancar((datos) => sembrar(datos, proyecto))
  })

  test.afterAll(async () => {
    await s?.cerrar().catch(() => undefined)
    try {
      quitarContenedores()
    } finally {
      if (agente) await borrarTemporal(agente.raiz)
      if (copia) await borrarTemporal(copia)
    }
  })

  test('las peticiones mal formadas se rechazan antes de tocar la cuenta', () => {
    const cuentas = tctx(['cuentas'])
    expect(cuentas.status, cuentas.stderr).toBe(0)
    expect(cuentas.stdout).toContain('Claude Uno')
    const inyeccion = tctx(['delegar', '--agente', 'claude-code', '--modelo', 'x;id'], 'Orden')
    expect(inyeccion.status, 'un modelo con forma de orden').toBe(4)
    expect(inyeccion.stderr).toContain('no es válido')
    expect(tctx(['tareas']).stdout).toContain('No hay tareas')
  })

  test('muerte súbita: la tarea vuelve interrumpida, se reanuda y su orden no queda atrás', async () => {
    idTarea = await lanzarTareaOcupada(s!.datos)
    const antes = tctx(['tareas'])
    expect(antes.stdout).toContain(idTarea)
    expect(antes.stdout).toContain('en marcha')
    const carpetaOrdenes = join(s!.datos, '.tessera', 'perfiles', PERFIL, 'claude-cuentas', 'cuenta-claude', '.tessera-delegadas')
    expect(readdirSync(carpetaOrdenes).length, 'la orden espera en la carpeta de la cuenta').toBe(1)

    const datosAntes = s!.datos
    matar(s!.app.process().pid!)
    quitarContenedores()
    guardarDisco(datosAntes)
    s = null
    await borrarTemporal(datosAntes)

    await arrancar(restaurarDisco)
    const listado = tctx(['tareas'])
    expect(listado.status, listado.stderr).toBe(0)
    expect(listado.stdout).toContain(idTarea)
    expect(listado.stdout).toContain('interrumpida')
    const consulta = tctx(['tarea', idTarea])
    expect(consulta.status, 'el código propio de una interrumpida').toBe(8)
    expect(consulta.stderr).toContain('--continuar')
    expect(readdirSync(join(s!.datos, '.tessera', 'perfiles', PERFIL, 'claude-cuentas', 'cuenta-claude', '.tessera-delegadas')).length, 'la orden huérfana se borra al arrancar').toBe(0)

    tctx(['modelos', '--agente', 'claude-code', '--cuenta', 'Claude Uno'])
    instalarAgente(AGENTE_QUE_TERMINA)
    const continuar = tctx(['tarea', idTarea, '--continuar', '--sin-esperar'], 'Revise lo que quedó hecho y siga')
    expect(continuar.status, continuar.stderr).toBe(0)
    const final = tctx(['tarea', idTarea, '--esperar', '--max-segundos', '120'])
    expect(final.status, `${final.stdout}\n${final.stderr}`).toBe(0)
    expect(final.stdout).toContain('Reanudada')
    const argumentos = docker('exec', contenedores()[0], 'cat', '/tmp/argumentos-claude').stdout
    expect(argumentos, 'reanuda la misma conversación').toContain(`--resume ${ID_DELEGADA}`)
    expect(argumentos, 'y conserva el esfuerzo pedido antes del corte').toContain('--effort high')
    expect(registro(s!.datos).some((e) => e.vista.id === idTarea), 'una tarea terminada sale del registro').toBe(false)
  })

  test('cierre normal: la tarea en marcha también vuelve interrumpida y se puede cancelar', async () => {
    const datosPrevios = s!.datos
    idTarea = await lanzarTareaOcupada(datosPrevios)
    await s!.cerrar({ conservarDatos: true })
    s = null
    expect(registro(datosPrevios).find((e) => e.vista.id === idTarea)?.vista.estado, 'cerrar la app no la da por terminada').toBe('en-marcha')
    guardarDisco(datosPrevios)
    await borrarTemporal(datosPrevios)

    await arrancar(restaurarDisco)
    expect(tctx(['tareas']).stdout).toContain('interrumpida')
    const cancelar = tctx(['tarea', idTarea, '--cancelar'])
    expect(cancelar.status, cancelar.stderr).toBe(0)
    expect(registro(s!.datos).some((e) => e.vista.id === idTarea), 'cancelada, ya no se ofrece reanudarla').toBe(false)
  })

  test('el catálogo real de Codex llega por tctx modelos desde su contenedor', () => {
    const r = tctx(['modelos', '--agente', 'codex', '--cuenta', 'Codex Uno'])
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('Modelos de Codex en la cuenta Codex Uno')
    expect(r.stdout).toContain('esfuerzos:')
    const noHay = tctx(['delegar', '--agente', 'codex', '--cuenta', 'Codex Uno', '--modelo', 'modelo-inexistente'], 'Orden')
    expect(noHay.status, 'un modelo que la cuenta no ofrece').toBe(4)
    expect(noHay.stderr).toContain('Disponibles:')
    const config = tctx(['config', '--agente', 'codex'])
    expect(config.stdout, 'un nativo de Claude Code ve la configuración de Codex').toContain('Configuración técnica de Codex')
  })

  test('con Docker sin responder, la tarea se acepta, lo anuncia y sigue en cuanto el motor contesta', async () => {
    // Un puerto sin nadie es un motor apagado para esta instancia, sin tocar el Docker de quien corre la prueba.
    const servidor = createServer()
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
    const puerto = (servidor.address() as AddressInfo).port
    await new Promise<void>((r) => servidor.close(() => r()))
    const datosPrevios = s!.datos
    await s!.cerrar({ conservarDatos: true })
    s = null
    quitarContenedores()
    guardarDisco(datosPrevios)
    await borrarTemporal(datosPrevios)
    await arrancar(restaurarDisco, { DOCKER_HOST: `tcp://127.0.0.1:${puerto}` })

    const r = tctx(['delegar', '--agente', 'claude-code', '--cuenta', 'Claude Uno', '--sin-esperar'], 'Haga el trabajo')
    expect(r.status, 'se acepta aunque Docker no responda').toBe(0)
    const id = r.stdout.trim()
    await expect.poll(() => tctx(['tarea', id]).stdout, { message: 'la actividad anuncia que lo inicia', timeout: 40_000 }).toContain('Tessera lo está iniciando')
    expect(contenedores().length, 'mientras no contesta no hay contenedor').toBe(0)

    // El motor «vuelve»: un puente del puerto al Docker real.
    const motor = docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}').stdout.trim().replace(/^(npipe|unix):\/\//, '').replaceAll('/', PLATAFORMA === 'windows' ? '\\' : '/')
    const puente = createServer((cliente) => {
      const destino = connect(PLATAFORMA === 'windows' ? motor : `/${motor.replace(/^\/+/, '')}`)
      cliente.pipe(destino).pipe(cliente)
      const cortar = (): void => {
        cliente.destroy()
        destino.destroy()
      }
      cliente.on('error', cortar)
      destino.on('error', cortar)
    })
    await new Promise<void>((resolver) => puente.listen(puerto, '127.0.0.1', resolver))
    try {
      await expect.poll(() => contenedores().length, { message: 'con el motor de vuelta, la tarea levanta su contenedor', timeout: 150_000 }).toBeGreaterThan(0)
      tctx(['tarea', id, '--cancelar'])
    } finally {
      await new Promise<void>((resolver) => {
        puente.close(() => resolver())
        setTimeout(resolver, 2000)
      })
    }
  })
})
