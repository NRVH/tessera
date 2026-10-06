// =============================================================================
// El agente de la terminal sobre la app empaquetada: a pantalla completa, el conmutador de la barra de
// estado lo muestra a la DERECHA (solo CSS, nada se desmonta) y lo oculta, también sin archivo abierto y
// sin botón suyo en la cabecera de la terminal; el agente falso (`agenteFalso.ts`, en nativo) arranca en
// la carpeta del perfil, no en la del proyecto; restaurar lo oculta sin cerrarlo y volver no lanza otro;
// el del proyecto conserva su pid; Ctrl+Alt+B / ⌥⌘B lo alterna; entrar o salir de pantalla completa no
// mueve el foco; terminal y agente conservan ~80 columnas a 1366 y a 1920 px; y «Cerrar» lo termina.
// Solo el modificador depende del sistema.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, vivo, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, MOD, PLATAFORMA, type SesionTessera } from './tessera'

/** El acorde de alternar el agente (`esAlternarAgente`), por su tecla física. */
const ACORDE_AGENTE = PLATAFORMA === 'mac' ? 'Meta+Alt+KeyB' : 'Control+Alt+KeyB'
/** Lo que vale pantalla completa en la franja (`esAlternarPantallaCompleta`). */
const ACORDE_PANTALLA_COMPLETA = `${MOD}+Shift+Enter`
/** La letra por defecto de las dos terminales (`DEFAULT_TERMINAL_FONT` a 13 px): con ella se cuentan las columnas. */
const LETRA = '13px "Cascadia Code", "Fira Code", Consolas, "Courier New", monospace'

const SHELL_XTERM = 'section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm'
const AGENTE_XTERM = '.right-panel .agent-pane:not(.hidden) .xterm'

interface Montaje {
  agentes: AgenteFalso
  repo: string
}

function montar(): Montaje {
  const agentes = montarAgenteFalso()
  const repo = join(agentes.raiz, 'repo')
  mkdirSync(repo)
  writeFileSync(join(repo, 'LEEME.txt'), 'hola\n')
  return { agentes, repo }
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

/** Deja que React confirme el render provocado por el gesto (dos fotogramas). */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** ¿Tiene el foco algo dentro de ese selector? */
function focoEn(win: Page, selector: string): Promise<boolean> {
  return win.evaluate((sel) => Boolean(document.activeElement?.closest(sel)), selector)
}

/** El conmutador de la barra de estado cuando es el del agente de la terminal: «Mostrar» u «Ocultar» según esté. */
function conmutadorAgente(win: Page, accion: 'Mostrar' | 'Ocultar'): Locator {
  return win.locator('footer.status-bar').getByRole('button', { name: `${accion} el agente de la terminal` })
}

/**
 * Columnas de la xterm a la vista: su pantalla mide columnas × celda, y la celda es la de xterm (el ancho
 * del carácter con la letra por defecto, redondeado hacia abajo a píxeles del dispositivo).
 */
async function columnas(win: Page, selector: string): Promise<number> {
  return win.evaluate(
    ({ sel, letra }) => {
      const pantalla = document.querySelector(`${sel} .xterm-screen`)
      const ctx = document.createElement('canvas').getContext('2d')
      if (!pantalla || !ctx) return 0
      ctx.font = letra
      const dpr = window.devicePixelRatio || 1
      const celda = Math.floor(ctx.measureText('W').width * dpr) / dpr
      return Math.round(pantalla.getBoundingClientRect().width / celda)
    },
    { sel: selector, letra: LETRA }
  )
}

test.describe.serial('El agente de la terminal', () => {
  let s: SesionTessera
  let m: Montaje
  let carpeta = ''
  let pidProyecto = 0
  let pidTerminal = 0
  const arranquesEn = (ruta: string): number[] =>
    m.agentes
      .arranques('claude')
      .filter((a) => mismaCarpeta(a.cwd, ruta))
      .map((a) => a.pid)

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.agentes.env, { sembrar: (datos) => sembrar(datos, m) })
    carpeta = join(s.datos, 'terminal', 'personal')
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) await borrarTemporal(m.agentes.raiz)
  })

  test('a pantalla completa, «Mostrar» lo pone a la derecha, arranca en la carpeta del perfil y se lleva el teclado', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    const panel = win.locator('section.terminal-panel')
    // El agente del proyecto arranca solo (nativo y a la vista): es el que no se puede tocar.
    await expect.poll(() => arranquesEn(m.repo).length, { message: 'arranca el agente del proyecto', timeout: 60_000 }).toBe(1)
    pidProyecto = arranquesEn(m.repo)[0]

    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(panel).toBeVisible()
    await expect(conmutadorAgente(win, 'Mostrar'), 'fuera de pantalla completa el del pie es el de la columna del proyecto').toHaveCount(0)
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    await asentar(win)
    await win.keyboard.press(ACORDE_PANTALLA_COMPLETA)
    await expect(shell).toHaveClass(/\bterminal-pantalla-completa\b/)
    expect(await focoEn(win, SHELL_XTERM), 'entrar en pantalla completa no mueve el foco').toBe(true)
    await expect(panel.getByRole('button', { name: /el agente de la terminal/ }), 'la cabecera de la terminal no lleva botón del agente').toHaveCount(0)

    // Sin archivo abierto el conmutador de la columna del proyecto estaría bloqueado: el del agente no.
    const mostrar = conmutadorAgente(win, 'Mostrar')
    await expect(mostrar, 'a pantalla completa el conmutador del pie es el del agente de la terminal').toBeEnabled()
    await expect(mostrar).toHaveAttribute('aria-pressed', 'false')
    await expect(mostrar, 'y su tooltip enseña el acorde').toHaveAttribute('title', /^Mostrar el agente de la terminal \(.+\)$/)
    await mostrar.click()
    await expect(shell).toHaveClass(/\bagente-terminal-visible\b/)
    await expect
      .poll(() => arranquesEn(carpeta).length, { message: 'arranca en <userData>/terminal/<perfil>', timeout: 60_000 })
      .toBe(1)
    pidTerminal = arranquesEn(carpeta)[0]
    expect(arranquesEn(m.repo), 'y no en el proyecto: allí sigue el de antes, solo').toEqual([pidProyecto])
    expect(readFileSync(join(carpeta, 'CLAUDE.md'), 'utf8'), 'con su contexto sembrado').toContain('<!-- tessera:ssh:start -->')

    const lienzo = await win.locator('.shell-main').boundingBox()
    const columna = await win.locator('.right-panel.cc-panel').boundingBox()
    const terminal = await panel.boundingBox()
    if (!lienzo || !columna || !terminal) throw new Error('falta una caja')
    expect(Math.abs(columna.x + columna.width - (lienzo.x + lienzo.width)), 'la columna llega al borde derecho del lienzo').toBeLessThanOrEqual(2)
    expect(terminal.x + terminal.width, 'y la terminal queda a su izquierda').toBeLessThanOrEqual(columna.x + 1)
    expect(Math.abs(terminal.height - lienzo.height), 'con el alto entero del lienzo').toBeLessThanOrEqual(3)
    await expect.poll(() => focoEn(win, AGENTE_XTERM), { message: '«Mostrar» lleva el teclado al agente' }).toBe(true)
    await expect(conmutadorAgente(win, 'Ocultar'), 'a la vista, el conmutador pasa a «Ocultar» y queda pulsado').toHaveAttribute('aria-pressed', 'true')
  })

  test('restaurar lo oculta sin cerrarlo, volver no lanza otro, y ni entrar ni salir mueven el foco', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    await win.locator('section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm-screen').click()
    await asentar(win)
    await win.keyboard.press(ACORDE_PANTALLA_COMPLETA)
    await expect(shell).not.toHaveClass(/\bfranja-pantalla-completa\b/)
    await expect(shell).not.toHaveClass(/\bagente-terminal-visible\b/)
    await asentar(win)
    expect(await focoEn(win, SHELL_XTERM), 'salir no mueve el foco (el agente del proyecto no lo roba)').toBe(true)
    expect(vivo(pidTerminal), 'oculto, no cerrado: su proceso sigue vivo').toBe(true)
    expect(vivo(pidProyecto), 'el del proyecto también').toBe(true)

    await win.keyboard.press(ACORDE_PANTALLA_COMPLETA)
    await expect(shell, 'la preferencia se conserva: vuelve a la derecha').toHaveClass(/\bagente-terminal-visible\b/)
    await asentar(win)
    expect(await focoEn(win, SHELL_XTERM), 'entrar tampoco mueve el foco').toBe(true)
    await win.waitForTimeout(1500)
    expect(arranquesEn(carpeta), 'volver no lanza otro agente').toEqual([pidTerminal])
    expect(arranquesEn(m.repo), 'y el del proyecto conserva su pid').toEqual([pidProyecto])
  })

  test('Ctrl+Alt+B / ⌥⌘B lo alterna a pantalla completa sin cerrarlo', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    await win.keyboard.press(ACORDE_AGENTE)
    await expect(shell).not.toHaveClass(/\bagente-terminal-visible\b/)
    await expect(shell, 'sigue a pantalla completa').toHaveClass(/\bterminal-pantalla-completa\b/)
    await expect.poll(() => focoEn(win, SHELL_XTERM), { message: 'al ocultarlo el teclado vuelve a la terminal' }).toBe(true)
    expect(vivo(pidTerminal)).toBe(true)
    await win.keyboard.press(ACORDE_AGENTE)
    await expect(shell).toHaveClass(/\bagente-terminal-visible\b/)
    await expect.poll(() => focoEn(win, AGENTE_XTERM), { message: 'al mostrarlo con el acorde se lleva el teclado' }).toBe(true)
    expect(arranquesEn(carpeta), 'el mismo agente').toEqual([pidTerminal])
  })

  test('el conmutador de la barra de estado lo oculta y lo muestra sin cerrarlo, y el teclado va donde toca', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    await conmutadorAgente(win, 'Ocultar').click()
    await expect(shell).not.toHaveClass(/\bagente-terminal-visible\b/)
    await expect(shell, 'sigue a pantalla completa').toHaveClass(/\bterminal-pantalla-completa\b/)
    await expect(conmutadorAgente(win, 'Mostrar'), 'oculto, el conmutador ofrece mostrarlo y queda suelto').toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => focoEn(win, SHELL_XTERM), { message: 'al ocultarlo con el clic el teclado vuelve a la terminal' }).toBe(true)
    expect(vivo(pidTerminal), 'oculto, no cerrado').toBe(true)
    await conmutadorAgente(win, 'Mostrar').click()
    await expect(shell).toHaveClass(/\bagente-terminal-visible\b/)
    await expect.poll(() => focoEn(win, AGENTE_XTERM), { message: 'al mostrarlo con el clic el teclado va al agente' }).toBe(true)
    await expect(conmutadorAgente(win, 'Ocultar')).toHaveAttribute('aria-pressed', 'true')
    expect(arranquesEn(carpeta), 'el mismo agente').toEqual([pidTerminal])
  })

  test('terminal y agente conservan unas 80 columnas a 1366×768 y a 1920×1080', async () => {
    const win = s.win
    for (const [ancho, alto] of [
      [1366, 768],
      [1920, 1080]
    ]) {
      await s.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [ancho, alto])
      await asentar(win)
      const real = await win.evaluate(() => window.innerWidth)
      await expect.poll(() => columnas(win, SHELL_XTERM), { message: `la terminal a ${real} px` }).toBeGreaterThanOrEqual(80)
      await expect.poll(() => columnas(win, AGENTE_XTERM), { message: `el agente a ${real} px` }).toBeGreaterThanOrEqual(80)
      console.log(`[agente-terminal] ${real} px: terminal ${await columnas(win, SHELL_XTERM)} col, agente ${await columnas(win, AGENTE_XTERM)} col`)
    }
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  })

  test('«Cerrar el agente de la terminal» lo termina y deja al del proyecto', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    const pane = win.locator('.right-panel .agent-pane:not(.hidden)')
    await pane.locator('.panel-header').hover()
    await pane.getByRole('button', { name: 'Cerrar el agente de la terminal' }).click()
    await expect(shell).not.toHaveClass(/\bagente-terminal-visible\b/)
    await expect.poll(() => vivo(pidTerminal), { message: 'su proceso termina', timeout: 30_000 }).toBe(false)
    expect(vivo(pidProyecto), 'el del proyecto sigue vivo').toBe(true)
    await expect(conmutadorAgente(win, 'Mostrar'), 'cerrado, el conmutador del pie ofrece volver a mostrarlo').toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => focoEn(win, SHELL_XTERM), { message: 'el teclado vuelve a la terminal' }).toBe(true)
  })
})
