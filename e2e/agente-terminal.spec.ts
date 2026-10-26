// =============================================================================
// El agente de la terminal sobre la app empaquetada: a pantalla completa, el conmutador de la barra de
// estado lo muestra a la DERECHA (solo CSS, nada se desmonta) y lo oculta, también sin archivo abierto y
// sin botón suyo en la cabecera de la terminal; el agente falso (`agenteFalso.ts`, en nativo) arranca en
// la carpeta del perfil, no en la del proyecto; restaurar lo oculta sin cerrarlo y volver no lanza otro;
// el del proyecto conserva su pid; Ctrl+Alt+B / ⌥⌘B lo alterna; entrar o salir de pantalla completa no
// mueve el foco; terminal y agente conservan ~80 columnas (78 en Mac) a 1366 y a 1920 px; y «Cerrar» lo termina.
// Solo el modificador depende del sistema.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CC_WIDTH_MIN } from '../src/shared/workspace-state-ipc.ts'
import { montarAgenteFalso, vivo, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, MOD, PLATAFORMA, type SesionTessera } from './tessera'

/** El acorde de alternar el agente (`esAlternarAgente`), por su tecla física. */
const ACORDE_AGENTE = PLATAFORMA === 'mac' ? 'Meta+Alt+KeyB' : 'Control+Alt+KeyB'
/** Lo que vale pantalla completa en la franja (`esAlternarPantallaCompleta`). */
const ACORDE_PANTALLA_COMPLETA = `${MOD}+Shift+Enter`
/** La letra por defecto de las dos terminales (`DEFAULT_TERMINAL_FONT` a 13 px): con ella se cuentan las columnas. */
const LETRA = '13px "Cascadia Code", "Fira Code", Consolas, Menlo, "Courier New", monospace'
/**
 * Columnas mínimas de cada una. En Mac la letra por defecto (Menlo) mide 0,60 em frente a los 0,55 de
 * Consolas: los 640 px del agente (`AGENTE_TERMINAL_ANCHO_POR_DEFECTO`) dan 78, y a 1366 px 80 y 80
 * pedirían unos 1378 con el marco. Un ancho propio de Mac daría 80 al agente quitándoselos a la terminal.
 */
const COLUMNAS_MINIMAS = PLATAFORMA === 'mac' ? 78 : 80

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

/**
 * Cuántos píxeles de la pantalla de la xterm (filas × celda) quedan por debajo de su zona visible: más de 0
 * es que tiene más filas de las que caben, y las últimas (la línea del prompt de un agente) no se ven.
 */
async function sobranteBajo(win: Page, selector: string): Promise<number> {
  return win.evaluate((sel) => {
    const pantalla = document.querySelector(`${sel} .xterm-screen`)?.getBoundingClientRect()
    const visible = document.querySelector(`${sel} .xterm-viewport`)?.getBoundingClientRect()
    return pantalla && visible ? Math.round(pantalla.bottom - visible.bottom) : 999
  }, selector)
}

/** Lo que la prueba lee y hace con el `Terminal` de una xterm. */
interface EstadoXterm {
  /** Cuántas líneas queda la vista por encima del fondo tras escribir, sin arrastrar nada (0 = en el fondo). */
  sinTocar: number
  pantalla: string
  viewportY: number
  baseY: number
  /** El `scrollbar-width` de su zona de desplazamiento: `none` = sin barra. */
  barra: string
}

/**
 * Escribe `texto` en la xterm de `selector` como si lo mandara su programa, lleva su barra al fondo como el usuario
 * arrastrándola y dice cómo queda. El `Terminal` se saca del estado de React del componente que la aloja (un ref
 * suelto o un objeto de refs).
 */
async function escribirYArrastrar(win: Page, selector: string, texto: string, arrastrar = true, subirAntes = 0): Promise<EstadoXterm | null> {
  return win.evaluate(
    async ({ sel, txt, arr, subir }) => {
      type Term = {
        buffer: { active: { viewportY: number; baseY: number; type: string } }
        cols: number
        write: (d: string, cb: () => void) => void
        scrollLines: (n: number) => void
      }
      const xterm = document.querySelector(sel)
      const host = xterm?.parentElement
      if (!host) return null
      const clave = Object.keys(host).find((k) => k.startsWith('__reactFiber$'))
      let fibra = clave ? (host as unknown as Record<string, { return: unknown; memoizedState: unknown } | undefined>)[clave] : undefined
      const esTerm = (x: unknown): x is Term => !!x && typeof x === 'object' && 'buffer' in x && 'cols' in x
      const buscar = (v: unknown): Term | null => {
        if (!v || typeof v !== 'object') return null
        const candidatos: unknown[] = [v, (v as { current?: unknown }).current]
        for (const c of [...candidatos]) if (c && typeof c === 'object') for (const p of Object.values(c)) candidatos.push(p, (p as { current?: unknown } | null)?.current)
        return (candidatos.find(esTerm) as Term | undefined) ?? null
      }
      let term: Term | null = null
      while (fibra && !term) {
        let hook = fibra.memoizedState as { memoizedState?: unknown; next?: unknown } | null
        while (hook && typeof hook === 'object' && !term) {
          term = buscar(hook.memoizedState)
          hook = (hook.next as typeof hook) ?? null
        }
        fibra = fibra.return as typeof fibra
      }
      if (!term) return null
      const t = term
      if (subir > 0) t.scrollLines(-subir)
      await new Promise<void>((r) => t.write(txt, r))
      const viewport = host.querySelector<HTMLElement>('.xterm-viewport')
      // Dos fotogramas: xterm recalcula su zona de desplazamiento al pintar, antes de que nadie pueda arrastrar.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      // Las dos a la vez: el agente falso escribe una línea por segundo y movería `baseY` entre medias.
      const sinTocar = t.buffer.active.viewportY - t.buffer.active.baseY
      if (viewport && arr) {
        viewport.scrollTop = viewport.scrollHeight
        viewport.dispatchEvent(new Event('scroll'))
      }
      await new Promise((r) => setTimeout(r, 300))
      return {
        sinTocar,
        pantalla: host.dataset.pantalla ?? '',
        viewportY: t.buffer.active.viewportY,
        baseY: t.buffer.active.baseY,
        barra: viewport ? getComputedStyle(viewport).scrollbarWidth : ''
      }
    },
    { sel: selector, txt: texto, arr: arrastrar, subir: subirAntes }
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
      await expect.poll(() => columnas(win, SHELL_XTERM), { message: `la terminal a ${real} px` }).toBeGreaterThanOrEqual(COLUMNAS_MINIMAS)
      await expect.poll(() => columnas(win, AGENTE_XTERM), { message: `el agente a ${real} px` }).toBeGreaterThanOrEqual(COLUMNAS_MINIMAS)
      console.log(`[agente-terminal] ${real} px: terminal ${await columnas(win, SHELL_XTERM)} col, agente ${await columnas(win, AGENTE_XTERM)} col`)
    }
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  })

  test('la pantalla del agente cabe en su caja: la última fila (la del prompt) siempre se ve, también al cambiar el alto', async () => {
    const win = s.win
    for (const alto of [950, 700, 1000]) {
      await s.app.evaluate(({ BrowserWindow }, h) => BrowserWindow.getAllWindows()[0].setSize(1500, h), alto)
      await asentar(win)
      console.log(`[agente-terminal] ${alto} px de alto: sobra ${await sobranteBajo(win, AGENTE_XTERM)} px en el agente, ${await sobranteBajo(win, SHELL_XTERM)} px en la terminal`)
      await expect.poll(() => sobranteBajo(win, AGENTE_XTERM), { message: `el agente de la terminal a ${alto} px de alto` }).toBeLessThanOrEqual(1)
      await expect.poll(() => sobranteBajo(win, SHELL_XTERM), { message: `la terminal a ${alto} px de alto` }).toBeLessThanOrEqual(1)
    }
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  })

  test('un agente a pantalla completa (pantalla alternativa) no deja barra de xterm que tape sus últimas filas; al salir vuelve', async () => {
    const win = s.win
    // Historial de sobra en la pantalla normal, como el que deja la sesión antes de que el agente pinte la suya.
    const relleno = Array.from({ length: 120 }, (_, i) => `línea ${i}\r\n`).join('')
    const normal = await escribirYArrastrar(win, AGENTE_XTERM, relleno)
    expect(normal, 'se encontró la xterm del agente').not.toBeNull()
    expect(normal?.pantalla, 'en la pantalla normal').toBe('normal')
    expect(normal?.baseY, 'con historial').toBeGreaterThan(0)
    expect(normal?.barra, 'en la normal hay barra').not.toBe('none')

    // Lo que hace Claude Code a pantalla completa al arrancar: pasa a la pantalla alternativa.
    // Con la vista subida en el historial, para que la vuelta al fondo al salir sea del arreglo y no de antes.
    // Sin arrastrar: en la pantalla alternativa no hay barra que el usuario pueda coger.
    const alterna = await escribirYArrastrar(win, AGENTE_XTERM, '\x1b[?1049h\x1b[2J\x1b[Hprompt del agente', false, 50)
    expect(alterna?.pantalla, 'pasa a la pantalla alternativa').toBe('alternativa')
    expect(alterna?.barra, 'sin barra de xterm que arrastrar, como en una terminal nativa').toBe('none')
    expect(alterna?.sinTocar, 'y se ve la pantalla del agente entera').toBe(0)

    const deVuelta = await escribirYArrastrar(win, AGENTE_XTERM, '\x1b[?1049l')
    expect(deVuelta?.pantalla, 'al salir, la normal').toBe('normal')
    expect(deVuelta?.barra, 'con su barra otra vez').not.toBe('none')
    expect(deVuelta?.sinTocar, 'y en el fondo sin tocar nada (cerrar `vim` no deja la vista al principio del historial)').toBe(0)
    expect(deVuelta?.viewportY, 'y la barra al fondo llega a la última línea').toBe(deVuelta?.baseY)
  })

  test('se maximiza sobre las terminales, salir y volver a pantalla completa lo conserva, y el chip de las terminales tapadas lo restaura', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    const panel = win.locator('section.terminal-panel')
    const pane = win.locator('.right-panel .agent-pane:not(.hidden)')
    const pila = panel.locator('.terminal-stack')
    await pane.locator('.panel-header').hover()
    await pane.getByRole('button', { name: 'Maximizar Claude Code' }).click()
    await expect(panel, 'la columna de la terminal se queda en su cabecera y su riel').toHaveClass(/\bsin-terminal\b/)
    await expect(pila).toBeHidden()
    await expect(pane.getByRole('button', { name: 'Restaurar terminales' })).toHaveCount(1)
    expect(vivo(pidTerminal), 'maximizar no cierra nada').toBe(true)

    await win.locator(`${AGENTE_XTERM}`).click()
    await win.keyboard.press(ACORDE_PANTALLA_COMPLETA)
    await expect(shell).not.toHaveClass(/\bagente-terminal-visible\b/)
    await win.locator('section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm-screen').click()
    await win.keyboard.press(ACORDE_PANTALLA_COMPLETA)
    await expect(shell).toHaveClass(/\bagente-terminal-visible\b/)
    await expect(panel, 'volver a pantalla completa lo devuelve maximizado: es lo último que eligió').toHaveClass(/\bsin-terminal\b/)

    await expect(panel.locator('.terminal-tab'), 'las pestañas tapadas no se dibujan').toHaveCount(0)
    const chip = panel.getByRole('button', { name: /^Restaurar terminales \(\d+ terminal(es)?\)$/ })
    await expect(chip.locator('.terminales-tapadas-n')).toHaveText(/^\d+$/)
    // Al desplegarse cambia el sitio que tiene el riel: no puede desmontarse por ello (perdería su filtro).
    // Una marca en su nodo dice si es el mismo después.
    const riel = win.locator('.ssh-riel')
    await riel.locator('.ssh-filtro').fill('sin-desmontar')
    await riel.evaluate((el) => el.setAttribute('data-e2e-mismo', '1'))
    await chip.click()
    await expect(panel, 'pulsar el chip vuelve a enseñar las terminales').not.toHaveClass(/\bsin-terminal\b/)
    await expect(win.locator('.ssh-riel[data-e2e-mismo="1"]'), 'el riel es el mismo nodo: no se desmontó al desplegar').toHaveCount(1)
    await expect(riel.locator('.ssh-filtro'), 'y conserva su filtro').toHaveValue('sin-desmontar')
    await riel.locator('.ssh-filtro').fill('')
    await expect(panel.locator('.terminal-tab.active')).toHaveCount(1)
    await expect(pila).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Maximizar Claude Code' })).toHaveCount(1)

    // El «+» junto al chip abre una terminal nueva en un solo gesto, y a la vista: no debajo del agente.
    const antes = await panel.locator('.terminal-tab').count()
    await pane.locator('.panel-header').hover()
    await pane.getByRole('button', { name: 'Maximizar Claude Code' }).click()
    await expect(panel).toHaveClass(/\bsin-terminal\b/)
    await panel.locator('> .panel-header').hover()
    await panel.locator('.terminales-tapadas-nueva').click()
    await expect(panel, 'las terminales vuelven a verse').not.toHaveClass(/\bsin-terminal\b/)
    await expect(panel.locator('.terminal-tab'), 'con una más').toHaveCount(antes + 1)
    await expect(panel.locator('.terminal-tab.active'), 'y la nueva es la activa').toHaveCount(1)
    await expect(panel.locator('.terminal-tab').last()).toHaveClass(/\bactive\b/)
    await expect(pila).toBeVisible()
  })

  // El «+» de la columna plegada: sin terminales va donde iría el chip; con el chip, a su lado y a la misma
  // distancia que el chip del título. Se mide el GLIFO (el svg), no el botón: el botón lleva relleno a los
  // lados y lo que el ojo compara son los dibujos.
  test('la columna plegada lleva el «+» en la línea del título: sin terminales donde iría el chip, y junto al chip con su mismo hueco', async () => {
    const info = test.info()
    const win = s.win
    const panel = win.locator('section.terminal-panel')
    const pane = win.locator('.right-panel .agent-pane:not(.hidden)')
    const cabecera = panel.locator('> .panel-header')
    type Caja = { l: number; r: number; cy: number }
    const medir = (): Promise<{ alto: number; titulo: Caja; chip: Caja | null; mas: Caja | null }> =>
      cabecera.evaluate((h) => {
        const caja = (r: DOMRect): Caja => ({ l: r.left, r: r.right, cy: (r.top + r.bottom) / 2 })
        const rango = document.createRange()
        rango.selectNodeContents(h.querySelector('.panel-title')!)
        const chip = h.querySelector('.terminales-tapadas')
        const mas = h.querySelector('.terminales-tapadas-nueva svg') ?? h.querySelector('.terminal-tabs-add svg')
        return {
          alto: h.getBoundingClientRect().height,
          titulo: caja(rango.getBoundingClientRect()),
          chip: chip ? caja(chip.getBoundingClientRect()) : null,
          mas: mas ? caja(mas.getBoundingClientRect()) : null
        }
      })
    const cerrarTodas = async (): Promise<void> => {
      for (let n = await panel.locator('.terminal-tab').count(); n > 0; n = await panel.locator('.terminal-tab').count()) {
        await panel.locator('.terminal-tab').first().hover()
        await panel.locator('.terminal-tab-kill').first().click()
        await expect(panel.locator('.terminal-tab')).toHaveCount(n - 1)
      }
    }

    for (const [ancho, alto] of [[1024, 700], [1366, 768], [1920, 1080]]) {
      await s.app.evaluate(({ BrowserWindow }, t) => BrowserWindow.getAllWindows()[0].setSize(t.ancho, t.alto), { ancho, alto })
      // Con el chip: el agente maximizado tapa las terminales.
      await pane.locator('.panel-header').hover()
      await pane.getByRole('button', { name: 'Maximizar Claude Code' }).click()
      await expect(panel).toHaveClass(/\bsin-terminal\b/)
      // Fijo como el chip: se ve con el ratón fuera del panel.
      await win.mouse.move(1, 1)
      await expect(panel.locator('.terminales-tapadas-nueva'), `el «+» junto al chip no se esconde — ${ancho}px`).toBeVisible()
      await asentar(win)
      const conChip = await medir()
      await cabecera.screenshot({ path: info.outputPath(`chip-${ancho}.png`) })
      await panel.getByRole('button', { name: /^Restaurar terminales/ }).click()
      await expect(panel).not.toHaveClass(/\bsin-terminal\b/)
      // Sin terminales: la columna se pliega igual, sin chip.
      await cerrarTodas()
      await expect(panel).toHaveClass(/\bsin-terminal\b/)
      await win.mouse.move(1, 1)
      await expect(panel.locator('.terminal-tabs-add button').first(), `sin terminales, el «+» tampoco se esconde — ${ancho}px`).toBeVisible()
      await asentar(win)
      const sinChip = await medir()
      await cabecera.screenshot({ path: info.outputPath(`sin-chip-${ancho}.png`) })
      const det = `${ancho}px: ${JSON.stringify({ conChip, sinChip })}`
      console.log(`[cabecera plegada] ${det}`)

      expect(conChip.alto, `con el chip, una sola línea — ${det}`).toBeLessThanOrEqual(36)
      expect(sinChip.alto, `sin terminales, una sola línea — ${det}`).toBeLessThanOrEqual(36)
      const chip = conChip.chip!
      const masConChip = conChip.mas!
      const masSolo = sinChip.mas!
      for (const [que, c] of [['chip', chip], ['«+» con chip', masConChip], ['«+» solo', masSolo]] as const) {
        expect(Math.abs(c.cy - conChip.titulo.cy), `${que} centrado con el título — ${det}`).toBeLessThanOrEqual(1)
      }
      const huecoTitulo = chip.l - conChip.titulo.r
      expect(Math.abs(masConChip.l - chip.r - huecoTitulo), `del chip al «+», el mismo hueco que del título al chip — ${det}`).toBeLessThanOrEqual(1)
      expect(Math.abs(masSolo.l - chip.l), `sin terminales, el «+» empieza donde empezaría el chip — ${det}`).toBeLessThanOrEqual(1)

      // Y el «+» de esa cabecera abre una: la columna vuelve a enseñarla.
      await cabecera.hover()
      await panel.locator('.terminal-tabs-add button').first().click()
      await expect(panel).not.toHaveClass(/\bsin-terminal\b/)
      await expect(panel.locator('.terminal-tab')).toHaveCount(1)
    }
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
  })

  test('con el agente maximizado, la cabecera de la terminal va en una línea y sin encimarse a 1024, 1366 y 1920 px, con el riel al mínimo, al máximo y oculto', async () => {
    const info = test.info()
    const win = s.win
    const panel = win.locator('section.terminal-panel')
    const pane = win.locator('.right-panel .agent-pane:not(.hidden)')
    const cabecera = panel.locator('> .panel-header')
    const divisor = panel.getByRole('separator', { name: 'Redimensionar la lista de conexiones SSH' })
    const botonRiel = panel.getByRole('button', { name: 'Panel de conexiones' })
    await pane.locator('.panel-header').hover()
    await pane.getByRole('button', { name: 'Maximizar Claude Code' }).click()
    await expect(panel).toHaveClass(/\bsin-terminal\b/)

    const arrastrarRiel = async (dx: number): Promise<void> => {
      const caja = await divisor.boundingBox()
      if (!caja) throw new Error('sin divisor del riel')
      const x = caja.x + caja.width / 2
      const y = caja.y + caja.height / 2
      await win.mouse.move(x, y)
      await win.mouse.down()
      await win.mouse.move(x + dx, y, { steps: 5 })
      await win.mouse.up()
    }
    const comprobar = async (caso: string): Promise<void> => {
      await asentar(win)
      await cabecera.screenshot({ path: info.outputPath(`cabecera-${caso}.png`) })
      await win.screenshot({ path: info.outputPath(`ventana-${caso}.png`) })
      await expect(cabecera.locator('.panel-title'), `el título cabe entero — ${caso}`).toHaveJSProperty('scrollWidth', await cabecera.locator('.panel-title').evaluate((e) => e.clientWidth))
      const m = await cabecera.evaluate((h) => {
        const c = h.getBoundingClientRect()
        const hijos = Array.from(h.children)
          .map((e) => ({ clase: e.className, r: e.getBoundingClientRect() }))
          .filter((e) => e.r.width > 0 && e.r.height > 0)
        return { alto: c.height, caja: { l: c.left, r: c.right, t: c.top, b: c.bottom }, hijos: hijos.map((e) => ({ clase: e.clase, l: e.r.left, r: e.r.right, t: e.r.top, b: e.r.bottom })) }
      })
      const det = `${caso}: ${JSON.stringify(m)}`
      expect(m.alto, `una sola línea — ${det}`).toBeLessThanOrEqual(36)
      for (const h of m.hijos) {
        expect(h.l >= m.caja.l - 0.5 && h.r <= m.caja.r + 0.5 && h.t >= m.caja.t - 0.5 && h.b <= m.caja.b + 0.5, `dentro de la cabecera — ${det}`).toBe(true)
      }
      for (let i = 1; i < m.hijos.length; i++) {
        expect(m.hijos[i].l, `sin encimarse — ${det}`).toBeGreaterThanOrEqual(m.hijos[i - 1].r - 0.5)
      }
      if ((await divisor.count()) > 0) {
        const [d, p] = await Promise.all([divisor.boundingBox(), panel.boundingBox()])
        expect(Math.abs((d?.x ?? 0) + (d?.width ?? 0) - ((p?.x ?? 0) + (p?.width ?? 0))), `el riel llena la columna — ${caso}`).toBeLessThanOrEqual(1)
        // El riel, ni arrastrado al máximo, deja al agente por debajo de su mínimo.
        const agente = await win.locator('.right-panel').boundingBox()
        expect(agente?.width ?? 0, `el agente conserva su mínimo — ${caso}`).toBeGreaterThanOrEqual(CC_WIDTH_MIN - 0.5)
      }
      await expect(panel.getByRole('button', { name: /^Restaurar terminales/ })).toBeInViewport({ ratio: 1 })
      await expect(cabecera.locator('.panel-actions'), `tapadas, la columna no lleva los botones del panel — ${caso}`).toHaveCount(0)
      await expect(win.getByRole('button', { name: 'Restaurar el panel de terminal' }), `el restaurar a la vista es el del agente — ${caso}`).toHaveCount(0)    }

    for (const [ancho, alto] of [[1024, 700], [1366, 768], [1920, 1080]]) {
      await s.app.evaluate(({ BrowserWindow }, t) => BrowserWindow.getAllWindows()[0].setSize(t.ancho, t.alto), { ancho, alto })
      await arrastrarRiel(-600)
      await comprobar(`${ancho}-riel-min`)
      await arrastrarRiel(600)
      await comprobar(`${ancho}-riel-max`)
      await botonRiel.click()
      await expect(win.locator('.ssh-riel')).toBeHidden()
      await comprobar(`${ancho}-riel-oculto`)
      await botonRiel.click()
      await expect(win.locator('.ssh-riel')).toBeVisible()
    }

    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
    await panel.getByRole('button', { name: /^Restaurar terminales/ }).click()
    await expect(panel).not.toHaveClass(/\bsin-terminal\b/)
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
