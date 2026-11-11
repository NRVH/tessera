// =============================================================================
// El movimiento de la interfaz, con las animaciones ENCENDIDAS (el resto de specs las apaga para ser estables, así
// que solo este caza una regresión de movimiento). Fija el contrato de `docs/decisiones/renderer/movimiento.md`:
// abrir una zona viaja; cerrarla es una transición propia, con la zona que se va marcada aparte (el último archivo, la terminal y
// el agente de la terminal, aunque su columna siga en la página); cambiar de vista es instantáneo; Configuración
// entra y, al cerrarse, deja su copia de despedida. Agente falso; nada depende del sistema.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirLogin, dockerMontaProyectos, sembrarLogin } from './loginCuenta'
import { abrirTessera, borrarTemporal, MOD, type SesionTessera } from './tessera'
import { abrirUsoCuentas } from './usoCuentasAyudas'

test('la cuenta fijada entra en la barra de estado y conserva su contenido mientras sale', async () => {
  const { s, cerrar } = await abrirUsoCuentas({ conMovimiento: true })
  try {
    const abrir = s.win.locator('footer.status-bar .uso-cuentas-boton')
    // Abrir la lista anima solo la lista: ni la marca ni lo que lleva el botón se mueven por el clic (el fondo del
    // botón al pasar el puntero sí tiene su transición, y no cuenta).
    await abrir.click()
    const fueraDeLaLista = await s.win.evaluate(() => document.getAnimations()
      .map((a) => (a.effect as KeyframeEffect | null)?.target)
      .filter((el): el is Element => el instanceof Element && !!el.closest('.status-bar-marca, .uso-cuentas-boton > *')).length)
    expect(fueraDeLaLista, 'abrir la lista no anima la barra de estado').toBe(0)
    const boton = s.win.locator('.uso-cuentas-panel .uso-cuentas-fila').filter({ hasText: 'En su equipo' }).getByRole('button')
    await expect(boton).toBeEnabled()
    const presencia = s.win.locator('footer.status-bar .uso-fijada-presencia')
    await s.win.clock.install()
    await boton.click()
    await expect(presencia).toHaveClass(/mov-aparece/)
    expect(await presencia.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) > 0)).toBe(true)
    await s.win.clock.runFor(300)
    await boton.click()
    await expect(presencia).toHaveAttribute('data-saliendo', '')
    await expect(presencia.locator('.uso-fijada-nombre')).toHaveText('Codex')
    await s.win.clock.runFor(300)
    await expect(presencia).toHaveCount(0)
    // La vista de agentes no es la de un perfil: «Uso de las cuentas» sale de la barra con un fundido y vuelve igual.
    const uso = s.win.locator('footer.status-bar .uso-cuentas-presencia')
    await s.win.keyboard.press('Escape')
    await s.win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(uso).toHaveAttribute('data-saliendo', '')
    await s.win.clock.runFor(300)
    await expect(uso).toHaveCount(0)
    await s.win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(uso).toHaveClass(/mov-aparece/)
    await expect(uso).not.toHaveAttribute('data-saliendo')
  } finally { await cerrar() }
})

/** Lo que se anotó de cada transición del reparto al empezar: si era un cierre y qué zonas se iban. */
interface Transicion {
  cierre: boolean
  seVan: string[]
}

/** Envuelve `startViewTransition` para anotar cada transición del reparto. */
async function espiarTransiciones(win: Page): Promise<void> {
  await win.evaluate(() => {
    const w = window as unknown as { __transiciones: Transicion[] }
    w.__transiciones = []
    const original = document.startViewTransition.bind(document)
    document.startViewTransition = ((cb: () => void) => {
      w.__transiciones.push({
        cierre: document.documentElement.classList.contains('transicion-cierre'),
        seVan: Array.from(document.querySelectorAll('[data-transicion-se-va]'), (el) => (el as HTMLElement).className.split(' ')[0])
      })
      return original(cb)
    }) as typeof document.startViewTransition
  })
}

/** Las transiciones que ocurren mientras se hace `accion` (espera a que el reparto se asiente). */
async function transicionesDe(win: Page, accion: () => Promise<void>): Promise<Transicion[]> {
  const antes = await win.evaluate(() => (window as unknown as { __transiciones: Transicion[] }).__transiciones.length)
  await accion()
  await win.waitForTimeout(700)
  return win.evaluate((n) => (window as unknown as { __transiciones: Transicion[] }).__transiciones.slice(n), antes)
}

/** Las animaciones vivas justo después de `accion`, con el elemento o la zona de cada una. */
async function animacionesTras(win: Page, accion: () => Promise<void>): Promise<string[]> {
  await accion()
  return win.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return document.getAnimations().map((a) => `${(a as CSSAnimation).animationName}${(a.effect as KeyframeEffect).pseudoElement ?? ''}`)
  })
}

function sembrar(datos: string, repo: string, ajustes: Record<string, unknown> = {}): void {
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify([
      { id: 'personal', nombre: 'Personal', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }], sandbox: { habilitado: false } }
    ])
  )
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: { personal: { openProjects: [{ projectHostPath: repo, name: 'repo', estado: 'active' }], activePath: repo } },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${repo}`], ...ajustes }
    })
  )
}

test.describe.serial('El inicio de sesión de una cuenta, con las animaciones encendidas', () => {
  test.skip(!dockerMontaProyectos(), 'Docker no responde o no ve las carpetas de este sistema')
  test.setTimeout(300_000)

  test('la ayuda del minuto y la terminal entran con su transición', async () => {
    const agente = montarAgenteFalso()
    const s = await abrirTessera(agente.env, { conMovimiento: true, sembrar: (datos) => sembrarLogin(datos, join(agente.raiz, 'proyecto')) })
    try {
      await s.win.clock.install()
      const modal = await abrirLogin(s.win)
      const transiciones = (): Promise<string[]> => s.win.evaluate(async () => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        return document.getAnimations().flatMap((a) => (a instanceof CSSTransition ? [`${Number(a.effect?.getComputedTiming().duration ?? 0) > 0 ? 'con-duracion' : 'sin'}:${a.transitionProperty}:${(a.effect as KeyframeEffect).target instanceof Element ? ((a.effect as KeyframeEffect).target as Element).className : ''}`] : []))
      })
      const [ayuda] = await Promise.all([
        modal.locator('.cuentas-login-ayuda').waitFor().then(transiciones),
        s.win.clock.fastForward(61_000)
      ])
      expect(ayuda.some((x) => x.startsWith('con-duracion:opacity') && x.includes('cuentas-login-ayuda')), `la ayuda se funde: ${ayuda.join(', ')}`).toBe(true)
      await s.win.waitForTimeout(400)
      await modal.locator('.cuentas-login-ver').click()
      const terminal = await transiciones()
      expect(terminal.some((x) => x.startsWith('con-duracion:height') && x.includes('cuentas-login-plegable')), `la terminal se despliega: ${terminal.join(', ')}`).toBe(true)
    } finally {
      await s.cerrar()
      await borrarTemporal(agente.raiz)
    }
  })
})

test.describe.serial('El movimiento de la interfaz, con las animaciones encendidas', () => {
  let s: SesionTessera
  let agentes: AgenteFalso

  test.beforeAll(async () => {
    agentes = montarAgenteFalso()
    const repo = join(agentes.raiz, 'repo')
    mkdirSync(repo)
    writeFileSync(join(repo, 'LEEME.txt'), 'hola\n')
    s = await abrirTessera(agentes.env, { conMovimiento: true, sembrar: (datos) => sembrar(datos, repo) })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
    const win = s.win
    await expect(win.locator('.right-panel .agent-pane:not(.hidden)')).toBeVisible({ timeout: 60_000 })
    expect(await win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'el movimiento está encendido').toBe(false)
    await espiarTransiciones(win)
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agentes) await borrarTemporal(agentes.raiz)
  })

  test('abrir el primer archivo viaja y cerrarlo se funde, con el editor marcado como la zona que se va', async () => {
    const win = s.win
    const abrir = await transicionesDe(win, () => win.locator('.sidebar .tree-row:visible', { hasText: 'LEEME.txt' }).first().click())
    expect(abrir, 'abrir el primer archivo es una transición').toHaveLength(1)
    expect(abrir[0].cierre, 'una apertura, no un cierre').toBe(false)

    const cerrar = await transicionesDe(win, () => win.locator('.editor-tab.active .editor-tab-close').click())
    expect(cerrar, 'cerrar el último archivo también es una transición: nada desaparece de golpe').toHaveLength(1)
    expect(cerrar[0].cierre, 'un cierre').toBe(true)
    expect(cerrar[0].seVan, 'se va el editor').toEqual(['editor-area'])
  })

  test('abrir la terminal es una apertura y ocultarla un cierre, con la franja marcada como la zona que se va', async () => {
    const win = s.win
    const abrir = await transicionesDe(win, () => win.getByRole('button', { name: 'Terminal', exact: true }).click())
    expect(abrir).toHaveLength(1)
    expect(abrir[0].cierre).toBe(false)
    await expect(win.locator('section.terminal-panel')).toBeVisible()
    const cerrar = await transicionesDe(win, () => win.getByRole('button', { name: 'Terminal', exact: true }).click())
    expect(cerrar, 'ocultar la terminal es una transición').toHaveLength(1)
    expect(cerrar[0].cierre).toBe(true)
    expect(cerrar[0].seVan, 'se va la franja de terminales').toEqual(['terminal-panel'])
  })

  test('la terminal sube con su texto a la vista y la vista del lateral se funde', async () => {
    const win = s.win
    const terminal = win.getByRole('button', { name: 'Terminal', exact: true })
    const abrir = await animacionesTras(win, () => terminal.click())
    expect(abrir, 'la franja entra por abajo').toContain('mov-zona-sube::view-transition-image-pair(zona-terminales)')
    const opacidad = await win.locator('section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm-screen').evaluate((el) => getComputedStyle(el).opacity)
    expect(opacidad, 'con su texto a la vista').toBe('1')
    await win.waitForTimeout(700)
    const cerrar = await animacionesTras(win, () => terminal.click())
    expect(cerrar, 'y sale por donde entró').toContain('mov-zona-baja::view-transition-image-pair(zona-que-se-va)')
    await win.waitForTimeout(700)
    const vista = await animacionesTras(win, () => win.locator('.activity-item[title="Git · Cambios"]').click())
    expect(vista, 'la vista del lateral se funde').toContain('mov-lateral-funde')
    await win.locator('.activity-item[title="Archivos"]').click()
    await win.waitForTimeout(300)
  })

  test('al maximizar y restaurar, la lista de conexiones se abre y se cierra con el borde de la terminal', async () => {
    const win = s.win
    const terminal = win.getByRole('button', { name: 'Terminal', exact: true })
    await terminal.click()
    const panel = win.locator('section.terminal-panel')
    await expect(panel).toBeVisible()
    await win.waitForTimeout(700)
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    const maximizar = await animacionesTras(win, () => win.keyboard.press(`${MOD}+Shift+Enter`))
    expect(maximizar, 'el texto se desplaza con la lista').toContain('mov-morfa-texto-abre::view-transition-new(zona-terminales)')
    expect(maximizar, 'y la lista se abre').toContain('mov-morfa-riel-abre::view-transition-image-pair(zona-riel)')
    await win.waitForTimeout(700)
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    const restaurar = await animacionesTras(win, () => win.keyboard.press(`${MOD}+Shift+Enter`))
    expect(restaurar, 'al restaurar la lista se cierra con su contenido').toContain('mov-morfa-riel-cierra::view-transition-image-pair(zona-riel)')
    const grupos = await win.evaluate(() => document.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).pseudoElement ?? []))
    expect(grupos, 'y su captura es solo la vieja: una nueva en blanco dejaría el cajón vacío').not.toContain('::view-transition-new(zona-riel)')
    await win.waitForTimeout(700)
    await terminal.click()
    await win.waitForTimeout(700)
  })

  test('maximizar, ocultar y volver a abrir la terminal también se mueve', async () => {
    const win = s.win
    const terminal = win.getByRole('button', { name: 'Terminal', exact: true })
    await terminal.click()
    const panel = win.locator('section.terminal-panel')
    await expect(panel).toBeVisible()
    await win.waitForTimeout(700)
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    const shell = win.locator('.shell')
    const maximizar = await transicionesDe(win, () => win.keyboard.press(`${MOD}+Shift+Enter`))
    await expect(shell).toHaveClass(/terminal-pantalla-completa/)
    expect(maximizar, 'maximizar es una transición').toHaveLength(1)
    const ocultar = await transicionesDe(win, () => win.locator('.activity-bar').getByRole('button', { name: 'Ocultar el panel de terminal' }).click())
    expect(ocultar, 'ocultarla maximizada también').toHaveLength(1)
    expect(ocultar[0].seVan, 'y se va la franja').toEqual(['terminal-panel'])
    await expect(win.locator('.activity-bar:not(.riel-pantalla-completa) .activity-item[aria-label="Terminal"]'), 'el foco vuelve a su icono').toBeFocused()
    const abrir = await transicionesDe(win, () => terminal.click())
    expect(abrir, 'volver a abrirla maximizada también').toHaveLength(1)
    await expect(shell).toHaveClass(/terminal-pantalla-completa/)
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    const restaurar = await transicionesDe(win, () => win.keyboard.press(`${MOD}+Shift+Enter`))
    expect(restaurar, 'y restaurarla').toHaveLength(1)
    await expect(shell).not.toHaveClass(/terminal-pantalla-completa/)
    await terminal.click()
    await win.waitForTimeout(500)
  })

  test('cambiar de vista es instantáneo, también de ida y vuelta', async () => {
    const win = s.win
    const ida = await transicionesDe(win, () => win.locator('.activity-item[title="Git · Cambios"]').click())
    const vuelta = await transicionesDe(win, () => win.locator('.activity-item[title="Archivos"]').click())
    expect([...ida, ...vuelta], 'ninguna transición del reparto').toHaveLength(0)
  })

  test('cerrar el agente de la terminal es un cierre aunque su columna siga en la página', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    const panel = win.locator('section.terminal-panel')
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    await win.keyboard.press(`${MOD}+Shift+Enter`)
    await expect(win.locator('.shell')).toHaveClass(/terminal-pantalla-completa/)
    await win.locator('.status-bar').getByRole('button', { name: /Mostrar el agente de la terminal/ }).click()
    const pane = win.locator('.right-panel .agent-pane:not(.hidden)')
    await expect(win.locator('.shell')).toHaveClass(/agente-terminal-visible/, { timeout: 30_000 })
    await win.waitForTimeout(800)
    const cerrar = await transicionesDe(win, async () => {
      await pane.locator('.panel-header').hover()
      await pane.getByRole('button', { name: 'Cerrar el agente de la terminal' }).click()
    })
    expect(cerrar, 'cerrarlo es una transición').toHaveLength(1)
    expect(cerrar[0].cierre).toBe(true)
    expect(cerrar[0].seVan, 'se va la columna del agente, aunque siga en la página con el del proyecto').toEqual(['right-panel'])
    await win.locator('.activity-bar').getByRole('button', { name: 'Restaurar el panel de terminal' }).click()
  })

  test('Configuración entra con su transición y, al cerrarse, deja su copia de despedida', async () => {
    const win = s.win
    await win.keyboard.press(`${MOD}+,`)
    const modal = win.locator('.ajustes-modal')
    await expect(modal).toBeVisible()
    const entrada = await modal.evaluate((card) => {
      const velo = card.closest('.modal-overlay') as HTMLElement
      const a = (el: Element): string => `${getComputedStyle(el).animationName} ${getComputedStyle(el).animationDuration}`
      return { velo: a(velo), tarjeta: a(card) }
    })
    const conDuracion = (v: string, nombre: string): boolean => v.startsWith(`${nombre} `) && parseFloat(v.split(' ')[1]) > 0
    expect(conDuracion(entrada.velo, 'modal-fade'), `el velo entra con su fundido (${entrada.velo})`).toBe(true)
    expect(conDuracion(entrada.tarjeta, 'modal-pop'), `y la tarjeta con su entrada (${entrada.tarjeta})`).toBe(true)
    await win.keyboard.press('Escape')
    await expect(win.locator('.mov-despedida'), 'al cerrarse deja una copia que hace la salida').not.toHaveCount(0)
    await expect(win.locator('.mov-despedida'), 'y la copia se borra al terminar').toHaveCount(0)
  })

  test('un submenú entra y sale con el mismo fundido que su menú', async () => {
    const win = s.win
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 620))
    await win.locator('.profile-tab-name', { hasText: 'Personal' }).click({ button: 'right' })
    const fila = win.getByRole('menuitem', { name: 'Agentes en Docker' })
    await fila.hover()
    const panel = win.getByRole('menu', { name: 'Agentes en Docker' })
    await expect(panel, 'se abre al detener el ratón').toBeVisible()
    await expect(panel).toHaveClass(/mov-aparece/)
    if (process.env.TESSERA_E2E_CAPTURAS) await win.screenshot({ path: join(process.env.TESSERA_E2E_CAPTURAS, 'submenu-perfil.png') })
    const caja = await panel.boundingBox()
    expect(caja !== null && caja.x >= 0 && caja.x + caja.width <= 900 && caja.y + caja.height <= 620, 'cabe en 900 × 620').toBe(true)
    expect(await panel.evaluate((p) => p.scrollWidth === p.clientWidth), 'sin desbordes').toBe(true)
    await win.keyboard.press('ArrowRight')
    await expect(panel.getByRole('menuitem').first(), '→ entra en él').toBeFocused()
    await win.keyboard.press('ArrowLeft')
    await expect(panel, '← lo cierra').toHaveCount(0)
    await expect(fila, 'y el foco vuelve a su fila').toBeFocused()
    await win.keyboard.press('ArrowRight')
    await expect(panel).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(panel, 'Esc cierra solo el submenú').toHaveCount(0)
    await win.keyboard.press('Escape')
    await expect(win.locator('.ctx-menu:not(.mov-despedida)')).toHaveCount(0)
    await expect(win.locator('.mov-despedida'), 'y la copia se borra al terminar').toHaveCount(0)
  })
})

/** Lo que se ve del diff en un cuadro: su opacidad real y si se pinta una línea que el plegado esconde. */
interface CuadroDiff {
  t: number
  op: number
  sinPlegar: boolean
}

/** Graba cuadro a cuadro el diff visible mientras se hace `accion` y hasta que se asienta. */
async function grabarDiff(win: Page, accion: () => Promise<void>): Promise<CuadroDiff[]> {
  await win.evaluate(() => {
    const w = window as unknown as { __cuadros: CuadroDiff[]; __grabando: boolean }
    w.__cuadros = []
    w.__grabando = true
    const inicio = performance.now()
    const paso = (): void => {
      if (!w.__grabando) return
      const seccion = Array.from(document.querySelectorAll('section[aria-label="Diff"]')).find((s) => !s.classList.contains('hidden'))
      const host = seccion?.querySelector<HTMLElement>('.editor-host')
      let op = 0
      if (host) {
        op = 1
        for (let e: HTMLElement | null = host; e && e !== document.body; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
      }
      w.__cuadros.push({
        t: Math.round(performance.now() - inicio),
        op: Math.round(op * 100) / 100,
        sinPlegar: /l[ií]nea\s5(?!\d)/.test(host?.querySelector('.editor.modified .view-lines')?.textContent ?? '')
      })
      requestAnimationFrame(paso)
    }
    requestAnimationFrame(paso)
  })
  await accion()
  await win.waitForTimeout(1500)
  return win.evaluate(() => {
    const w = window as unknown as { __cuadros: CuadroDiff[]; __grabando: boolean }
    w.__grabando = false
    return w.__cuadros
  })
}

/** Cuántas veces baja la opacidad después de haber empezado a subir: 0 es un solo fundido, sin parpadeos. */
function caidasDeOpacidad(cuadros: CuadroDiff[]): number {
  let subio = false
  let caidas = 0
  for (let i = 1; i < cuadros.length; i++) {
    if (cuadros[i].op > cuadros[i - 1].op) subio = true
    else if (subio && cuadros[i].op < cuadros[i - 1].op - 0.05) caidas++
  }
  return caidas
}

test.describe.serial('La entrada del diff, con las animaciones encendidas', () => {
  let s: SesionTessera
  let agentes: AgenteFalso

  test.beforeAll(async () => {
    agentes = montarAgenteFalso()
    const repo = join(agentes.raiz, 'repo')
    mkdirSync(repo)
    const git = (...a: string[]): void => void execFileSync('git', a, { cwd: repo })
    const contenido = (marca: string): string => Array.from({ length: 400 }, (_, i) => (i === 200 ? marca : `línea ${i}`)).join('\n') + '\n'
    const archivos = ['uno.txt', 'dos.txt', 'tres.txt', 'cuatro.txt']
    for (const a of archivos) writeFileSync(join(repo, a), contenido('original'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Pruebas')
    git('config', 'user.email', 'pruebas@example.invalid')
    git('add', '.')
    git('commit', '-qm', 'inicial')
    for (const a of archivos) writeFileSync(join(repo, a), contenido('cambiada'))
    s = await abrirTessera(agentes.env, { conMovimiento: true, sembrar: (datos) => sembrar(datos, repo, { diffColapsarSinCambios: true }) })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
    await s.win.getByRole('button', { name: /^Git · Cambios/ }).click()
    await expect(s.win.locator('.git-panel .git-arbol-fila', { hasText: 'uno.txt' }).first()).toBeVisible({ timeout: 30_000 })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agentes) await borrarTemporal(agentes.raiz)
  })

  const abrir = (nombre: string) => (): Promise<void> => s.win.locator('.git-panel .git-arbol-fila', { hasText: nombre }).first().dblclick()

  test('con el plegado activo nunca se ve el archivo entero, y el texto entra con un solo fundido', async () => {
    await abrir('uno.txt')()
    await expect(s.win.locator('section[aria-label="Diff"]:not(.hidden) .diff-hidden-lines').first()).toBeAttached({ timeout: 15_000 })
    await s.win.waitForTimeout(500)
    const cuadros = await grabarDiff(s.win, abrir('dos.txt'))
    const enteros = cuadros.filter((c) => c.op > 0.02 && c.sinPlegar)
    expect(enteros, `cuadros con el archivo entero a la vista: ${JSON.stringify(enteros.slice(0, 8))}`).toHaveLength(0)
    expect(caidasDeOpacidad(cuadros), 'un solo fundido').toBe(0)
    expect(cuadros.at(-1)?.op, 'termina visible').toBe(1)
  })

  test('sin el plegado, el texto también entra con un solo fundido', async () => {
    await s.win.getByRole('button', { name: /Contraer los fragmentos sin cambios/ }).click()
    await s.win.waitForTimeout(500)
    const cuadros = await grabarDiff(s.win, abrir('tres.txt'))
    expect(caidasDeOpacidad(cuadros), 'un solo fundido').toBe(0)
    expect(cuadros.at(-1)?.op, 'termina visible').toBe(1)
  })
})
