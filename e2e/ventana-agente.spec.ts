// =============================================================================
// La ventana de agente empaquetada: abre el agente (el falso) nativo en la carpeta del usuario, sin
// CLAUDE.md ni AGENTS.md y fuera de la actividad de la principal; `--ventana-agente` abre otra en
// caliente o en frío; cerrar una mata su agente; cerrar la principal deja vivas las de agente y sin
// bandera la principal vuelve. Actualizar los agentes reinicia también su sesión, y tras actualizar
// Tessera y relanzar se reabren con su conversación.
// =============================================================================

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { abrirRegistroFalso, montarAgenteFalso, vivo, type AgenteFalso, type RegistroFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, carpetasAgentes, PLATAFORMA, rutaAppEmpaquetada, type SesionTessera } from './tessera'

const PERFIL_VENTANA = '_ventana-agente'
const XTERM_VENTANA = '.ventana-agente .agent-pane:not(.hidden) .xterm'

interface Montaje {
  agentes: AgenteFalso
  repo: string
  casa: string
  env: Record<string, string>
}

function montar(): Montaje {
  const agentes = montarAgenteFalso()
  const repo = join(agentes.raiz, 'repo')
  const casa = join(agentes.raiz, 'casa')
  mkdirSync(repo)
  mkdirSync(casa)
  writeFileSync(join(repo, 'LEEME.txt'), 'hola\n')
  return { agentes, repo, casa, env: { ...agentes.env, TESSERA_E2E_CARPETA_VENTANA_AGENTE: casa } }
}

/** Un perfil sin sandbox con el repo abierto en modo nativo (sin Docker ni modal de modo). */
function sembrar(datos: string, m: Montaje): void {
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify([
      {
        id: 'personal',
        nombre: 'Personal',
        color: '#9814c8',
        agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }],
        sandbox: { habilitado: false }
      }
    ])
  )
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: { personal: { openProjects: [{ projectHostPath: m.repo, name: 'repo', estado: 'active' }], activePath: m.repo } },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${m.repo}`] }
    })
  )
}

/** Una conversación de Claude Code en `ruta`, en la carpeta de configuración del agente de la prueba. */
function escribirConversacion(datos: string, ruta: string, id: string, cuando: string): void {
  const carpeta = join(carpetasAgentes(datos).claude, 'projects', ruta.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(carpeta, { recursive: true })
  const linea = (type: string, content: unknown): string =>
    JSON.stringify({ type, sessionId: id, cwd: ruta, timestamp: cuando, message: { role: type, content } })
  writeFileSync(join(carpeta, `${id}.jsonl`), `${linea('user', 'hola')}\n${linea('assistant', [{ type: 'text', text: 'hola' }])}\n`)
}

/** La misma carpeta: resuelta (en Mac `/var` es `/private/var`) y, en Windows, sin distinguir mayúsculas. */
function mismaCarpeta(a: string, b: string): boolean {
  const norma = (p: string): string => {
    let r = p
    try {
      r = realpathSync.native(p)
    } catch {
      // Una carpeta que ya no existe se compara tal cual.
    }
    return PLATAFORMA === 'windows' ? r.toLowerCase() : r
  }
  return norma(a) === norma(b)
}

function arranquesEn(m: Montaje, ruta: string): number[] {
  return m.agentes
    .arranques('claude')
    .filter((a) => mismaCarpeta(a.cwd, ruta))
    .map((a) => a.pid)
}

/** Las ventanas de agente abiertas (su página es `agente.html`). */
function ventanasAgente(app: ElectronApplication): Page[] {
  return app.windows().filter((p) => !p.isClosed() && p.url().includes('agente.html'))
}

/** Cierra una ventana como su X: `window.close()` emite el `close` de su BrowserWindow. */
async function cerrarVentana(p: Page): Promise<void> {
  await p.evaluate(() => window.close()).catch(() => {})
}

/**
 * Lanza el paquete como SEGUNDA instancia con `args` y espera a que salga. El cerrojo va atado al
 * userData: se comprueba que es el temporal de la prueba, o la petición llegaría a la Tessera de
 * quien la corre.
 */
async function lanzarSegundaInstancia(datos: string, args: string[], envExtra: Record<string, string>): Promise<void> {
  const exe = rutaAppEmpaquetada()
  if (exe === null) throw new Error('Tessera no se empaqueta para esta plataforma.')
  expect(resolve(datos).toLowerCase().startsWith(resolve(tmpdir()).toLowerCase()), 'el userData es un temporal').toBe(true)
  const env = { ...process.env, ...envExtra } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  await new Promise<void>((resolver, rechazar) => {
    const hijo = spawn(exe, [`--user-data-dir=${datos}`, ...args], { env, stdio: 'ignore' })
    const tope = setTimeout(() => {
      hijo.kill()
      rechazar(new Error('la segunda instancia no salió en 30 s'))
    }, 30_000)
    hijo.on('error', rechazar)
    hijo.on('exit', () => {
      clearTimeout(tope)
      resolver()
    })
  })
}

test.describe.serial('La ventana de agente', () => {
  let s: SesionTessera
  let m: Montaje
  let primera: Page
  let pidPrimera = 0
  let pidProyecto = 0

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.env, { sembrar: (datos) => sembrar(datos, m) })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) await borrarTemporal(m.agentes.raiz)
  })

  test('«Nueva ventana de agente», al pie de la ▾ de las terminales y con su «i», abre el agente nativo en la carpeta del usuario', async () => {
    const win = s.win
    await expect.poll(() => arranquesEn(m, m.repo).length, { message: 'arranca el agente del proyecto', timeout: 60_000 }).toBe(1)
    pidProyecto = arranquesEn(m, m.repo)[0]
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    const panel = win.locator('section.terminal-panel')
    await expect(panel).toBeVisible()
    await panel.locator('.panel-header').first().hover()
    await panel.getByRole('button', { name: 'Conexiones SSH', exact: true }).click()
    const lanzador = win.getByRole('dialog', { name: 'Conexiones SSH' })
    await expect(lanzador).toBeVisible()
    const boton = lanzador.getByRole('button', { name: 'Nueva ventana de agente', exact: true })
    await expect(boton.locator('.ssh-pie-info'), 'una «i» pegada al texto explica qué es').toHaveAttribute('title', /ventana aparte, en tu carpeta de usuario/)
    const [ventana] = await Promise.all([
      s.app.waitForEvent('window', { timeout: 30_000 }),
      boton.click()
    ])
    await expect(lanzador, 'el popover se cierra').toHaveCount(0)
    primera = ventana
    await primera.waitForSelector(XTERM_VENTANA, { timeout: 30_000 })
    await expect.poll(() => arranquesEn(m, m.casa).length, { message: 'arranca en la carpeta del usuario', timeout: 60_000 }).toBe(1)
    pidPrimera = arranquesEn(m, m.casa)[0]
    await expect.poll(() => primera.title(), { timeout: 15_000 }).toBe('Agente — Claude Code')
    expect(await primera.locator('.shell').count(), 'sin la ventana principal dentro').toBe(0)
    expect(existsSync(join(m.casa, 'CLAUDE.md')) || existsSync(join(m.casa, 'AGENTS.md')), 'no escribe instrucciones en la carpeta del usuario').toBe(false)
  })

  test('su sesión no aparece en la actividad de la principal, y sí en la suya', async () => {
    const enPrincipal = await s.win.evaluate(() => window.tessera.agentTerminal.activitySnapshot())
    expect(enPrincipal.some((a) => a.profileId === PERFIL_VENTANA), JSON.stringify(enPrincipal)).toBe(false)
    const enVentana = await primera.evaluate(() => window.tessera.agentTerminal.activitySnapshot())
    expect(enVentana.length > 0 && enVentana.every((a) => a.profileId === PERFIL_VENTANA), JSON.stringify(enVentana)).toBe(true)
  })

  test('una segunda instancia con `--ventana-agente` abre otra; cerrarla mata su agente y deja la primera', async () => {
    const [segunda] = await Promise.all([
      s.app.waitForEvent('window', { timeout: 30_000 }),
      lanzarSegundaInstancia(s.datos, ['--ventana-agente'], m.env)
    ])
    await segunda.waitForSelector(XTERM_VENTANA, { timeout: 30_000 })
    await expect.poll(() => arranquesEn(m, m.casa).length, { message: 'un segundo agente en la carpeta del usuario', timeout: 60_000 }).toBe(2)
    const pidSegunda = arranquesEn(m, m.casa).find((p) => p !== pidPrimera) ?? 0
    expect(ventanasAgente(s.app).length).toBe(2)
    await cerrarVentana(segunda)
    await expect.poll(() => vivo(pidSegunda), { message: 'su agente termina', timeout: 30_000 }).toBe(false)
    expect(vivo(pidPrimera), 'el de la otra ventana sigue').toBe(true)
    expect(vivo(pidProyecto), 'y el del proyecto').toBe(true)
  })

  test('cerrar la principal deja viva la ventana de agente y su agente; el del proyecto termina', async () => {
    // Como su X: el `close` de la BrowserWindow, que pasa por el cierre ordenado de la principal.
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))?.close())
    await expect.poll(() => s.app.windows().filter((p) => !p.isClosed()).length, { message: 'queda solo la de agente', timeout: 60_000 }).toBe(1)
    expect(readFileSync(join(s.datos, 'logs', 'cierre.log'), 'utf8'), 'cerró en orden solo la principal').toContain('principal cerrada')
    await expect.poll(() => vivo(pidProyecto), { message: 'el agente del proyecto termina', timeout: 30_000 }).toBe(false)
    expect(vivo(pidPrimera), 'el de la ventana de agente sigue trabajando').toBe(true)
    expect(ventanasAgente(s.app).length).toBe(1)
  })

  test('sin bandera, otra instancia vuelve a abrir la principal', async () => {
    const [principal] = await Promise.all([s.app.waitForEvent('window', { timeout: 30_000 }), lanzarSegundaInstancia(s.datos, [], m.env)])
    await principal.waitForSelector('.titlebar', { timeout: 30_000 })
    s.win = principal
    expect(vivo(pidPrimera), 'la ventana de agente no se toca').toBe(true)
  })
})

test.describe.serial('Arranque con --ventana-agente', () => {
  let s: SesionTessera
  let m: Montaje

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) await borrarTemporal(m.agentes.raiz)
  })

  test('nace una sola ventana, la de agente, con un chat nuevo y sin la principal; cerrarla cierra la app', async () => {
    m = montar()
    // Una conversación previa en la carpeta del usuario: la ventana no la retoma.
    const sembrarConChat = (datos: string): void => {
      sembrar(datos, m)
      escribirConversacion(datos, m.casa, CONVERSACION_RESTAURADA, new Date().toISOString())
    }
    s = await abrirTessera(m.env, { args: ['--ventana-agente'], esperar: '.ventana-agente', sembrar: sembrarConChat })
    await s.win.waitForSelector(XTERM_VENTANA, { timeout: 30_000 })
    await expect.poll(() => arranquesEn(m, m.casa).length, { message: 'arranca en la carpeta del usuario', timeout: 60_000 }).toBe(1)
    const argv = m.agentes.arranques('claude').find((a) => mismaCarpeta(a.cwd, m.casa))?.argv ?? []
    expect(argv.join(' '), 'con un chat nuevo, como al escribir el CLI en una terminal').not.toContain('--resume')
    const pid = arranquesEn(m, m.casa)[0]
    expect(s.app.windows().length, 'una sola ventana').toBe(1)
    expect(await s.win.locator('.shell').count(), 'sin la principal').toBe(0)
    expect(arranquesEn(m, m.repo).length, 'ni el agente del proyecto').toBe(0)
    const salida = new Promise<void>((r) => s.app.process().once('exit', () => r()))
    await cerrarVentana(s.win)
    const tope = new Promise<never>((_r, rechazar) => setTimeout(() => rechazar(new Error('la app no terminó en 60 s al cerrar su última ventana')), 60_000))
    await Promise.race([salida, tope])
    expect(vivo(pid), 'y su agente con ella').toBe(false)
  })
})

test.describe.serial('Actualizar los agentes con una ventana de agente abierta', () => {
  let s: SesionTessera
  let m: Montaje
  let registro: RegistroFalso

  test.afterAll(async () => {
    await s?.cerrar()
    await registro?.cerrar()
    if (m) await borrarTemporal(m.agentes.raiz)
  })

  test('su sesión entra en el lote: se reinicia una vez y la ventana sigue con su agente', async () => {
    test.setTimeout(240_000)
    registro = await abrirRegistroFalso({ claude: '2.1.281' })
    m = montar()
    s = await abrirTessera({ ...m.env, ...registro.env }, { sembrar: (datos) => sembrar(datos, m) })
    await expect.poll(() => arranquesEn(m, m.repo).length, { message: 'el agente del proyecto', timeout: 60_000 }).toBe(1)
    const [ventana] = await Promise.all([s.app.waitForEvent('window', { timeout: 30_000 }), lanzarSegundaInstancia(s.datos, ['--ventana-agente'], m.env)])
    await ventana.waitForSelector(XTERM_VENTANA, { timeout: 30_000 })
    await expect.poll(() => arranquesEn(m, m.casa).length, { message: 'el agente de la ventana', timeout: 60_000 }).toBe(1)
    const [pidVentana] = arranquesEn(m, m.casa)

    // Claude se subió en disco: las dos sesiones arrancaron con la vieja.
    m.agentes.fijarVersion('claude', '2.1.282')
    registro.publicado.claude = '2.1.282'
    await s.win.locator('.agentes-nativos-boton').click()
    const pop = s.win.locator('.agentes-nativos-pop')
    await expect(pop.locator('.actualizacion-pop-pie')).not.toContainText('Comprobando', { timeout: 60_000 })
    const accion = pop.locator('.agentes-nativos-acciones .btn').first()
    await expect(accion).toHaveText('Reiniciar 2 sesiones')
    await accion.click()
    await expect(pop.locator('.actualizacion-pop-titulo').first()).toHaveText('Agentes actualizados', { timeout: 150_000 })

    await expect.poll(() => arranquesEn(m, m.casa).length, { message: 'la de la ventana vuelve', timeout: 60_000 }).toBe(2)
    expect(vivo(pidVentana), 'la vieja ya no corre').toBe(false)
    expect(arranquesEn(m, m.repo).length, 'y la del proyecto también, una vez').toBe(2)
    await expect(ventana.locator(XTERM_VENTANA)).toHaveCount(1)
  })
})

/** Con forma de UUID, como los ids de los CLIs: otra forma no llega a la línea de arranque. */
const CONVERSACION_RESTAURADA = '3f1c2a4e-7b8d-4c19-9e2f-5a6b7c8d9e01'

test.describe.serial('Tras actualizar y relanzar', () => {
  let s: SesionTessera
  let m: Montaje

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) await borrarTemporal(m.agentes.raiz)
  })

  test('reabre las ventanas de agente del archivo de restauración, con su conversación, y lo consume', async () => {
    m = montar()
    let archivo = ''
    // Nacen tres ventanas a la vez y la primera que se ve puede ser una de agente, sin `.titlebar`.
    s = await abrirTessera(m.env, {
      esperar: 'body',
      sembrar: (datos) => {
        sembrar(datos, m)
        archivo = join(datos, 'ventanas-agente.json')
        const ventanas = [{ agente: 'claude-code', conversacion: CONVERSACION_RESTAURADA }, { agente: 'claude-code' }]
        writeFileSync(archivo, JSON.stringify({ escritoEn: Date.now(), ventanas }))
      }
    })
    await expect.poll(() => ventanasAgente(s.app).length, { message: 'las dos ventanas de agente', timeout: 30_000 }).toBe(2)
    const principal = s.app.windows().find((p) => !p.isClosed() && p.url().includes('index.html'))
    expect(principal, 'y la principal').toBeTruthy()
    await principal!.waitForSelector('.titlebar', { timeout: 30_000 })
    s.win = principal!
    await expect.poll(() => arranquesEn(m, m.casa).length, { message: 'un agente por ventana', timeout: 60_000 }).toBe(2)
    const argvs = m.agentes
      .arranques('claude')
      .filter((a) => mismaCarpeta(a.cwd, m.casa))
      .map((a) => (a.argv ?? []).join(' '))
    expect(argvs.filter((a) => a.includes(CONVERSACION_RESTAURADA)).length, `retoma su conversación: ${JSON.stringify(argvs)}`).toBe(1)
    expect(existsSync(archivo), 'se reabre una sola vez').toBe(false)
  })
})
