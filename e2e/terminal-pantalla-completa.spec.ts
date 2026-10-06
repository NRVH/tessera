// =============================================================================
// La terminal de abajo a pantalla completa sobre la app empaquetada: el botón de maximizar se
// revela como sus hermanos, tapa lateral, editor y agente sin desmontarlos, la terminal crece y
// no se remonta, y los de restaurar y ocultar (las dos salidas del modo) se quedan fijos; con el
// botón, maximizar y restaurar devuelven el foco a la xterm. Ctrl+`, cambiar a Git·Log y abrir una
// pestaña (Mod+N) salen del modo; Mod+Shift+↩ lo alterna solo con el foco en la franja y no manda
// un CR a la shell. La regla la fija `features/layout/test-layout-centro.mts`. Agente falso
// (`agenteFalso.ts`); nada depende del sistema. `TESSERA_E2E_CAPTURAS` guarda capturas.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, MOD, PLATAFORMA, type SesionTessera } from './tessera'

/** Lo que escribe la shell: las órdenes van partidas con `''` para que lo tecleado no se cuente a sí mismo. */
const MARCADOR = 'MARCADOR_FRANJA'
const ORDEN_MARCADOR = "echo MARC''ADOR_FRANJA"
const SIN_CR = 'SINCR_FRANJA'
const ORDEN_SIN_CR = "echo SIN''CR_FRANJA"
/** Lo que se teclea para probar el foco: sin Enter, para no ejecutar nada, y se borra después. */
const TECLAS_FOCO = 'FOCOFRANJA'

/** El acorde que enseña el botón, como lo pinta `etiquetaAcorde('pantallaCompleta')` en esta plataforma. */
const ACORDE = PLATAFORMA === 'mac' ? '⇧⌘↩' : 'Ctrl+Shift+Enter'

interface Montaje {
  raiz: string
  env: Record<string, string>
  repo: string
}

/** El agente falso y un repo de git con un commit (git del sistema, sin config global). */
function montar(): Montaje {
  const { raiz, env } = montarAgenteFalso()
  const repo = join(raiz, 'repo')
  mkdirSync(repo)
  writeFileSync(join(repo, 'LEEME.txt'), 'hola\n')
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=Pruebas', '-c', 'user.email=pruebas@example.invalid', ...args], {
      cwd: repo,
      stdio: 'ignore'
    })
  }
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '-m', 'Primer commit de la prueba')
  return { raiz, env, repo }
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
      byProfile: {
        personal: { openProjects: [{ projectHostPath: m.repo, name: 'repo', estado: 'active' }], activePath: m.repo }
      },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${m.repo}`] }
    })
  )
}

/** Saca el ratón y el foco del panel y espera al fundido de las acciones en reposo (350 ms). */
async function enReposo(win: Page): Promise<void> {
  await win.locator('.status-bar').hover()
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await win.waitForTimeout(600)
}

/** Deja que React confirme el render provocado por la tecla (dos fotogramas). */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Alto de un elemento visible, redondeado. */
async function alto(l: Locator): Promise<number> {
  const caja = await l.boundingBox()
  if (caja === null) throw new Error('el elemento no tiene caja')
  return Math.round(caja.height)
}

/** Número de coincidencias que anuncia el buscador de la terminal (`3 coincidencias` o `1 / 3`). */
function totalDe(etiqueta: string): number {
  const m = /(\d+) coincidencias|\d+ \/ (\d+)/.exec(etiqueta)
  return m ? Number(m[1] ?? m[2]) : 0
}

/**
 * Cuántas veces sale `texto` en el búfer de la terminal a la vista, con el buscador de la propia
 * terminal: mira el búfer y no el dibujo, así que vale igual con WebGL que con el renderer DOM.
 */
async function contarEnTerminal(win: Page, texto: string): Promise<number> {
  const pane = win.locator('section.terminal-panel .terminal-pane[aria-hidden="false"]')
  await pane.locator('.xterm-screen').click()
  await win.keyboard.press(`${MOD}+f`)
  const buscador = pane.locator('.search-box')
  await expect(buscador).toBeVisible()
  const entrada = buscador.locator('.search-box-input')
  await entrada.fill(texto)
  await entrada.press('Enter')
  const cuenta = totalDe(await buscador.locator('.search-box-count').innerText())
  await buscador.getByRole('button', { name: 'Cerrar buscador' }).click()
  return cuenta
}

/**
 * Tras pulsar el botón de maximizar o de restaurar el foco tiene que estar dentro de la xterm
 * que se ve y no en el botón, donde Espacio o Intro volverían a pulsarlo y saldrían del modo.
 * Se mira `document.activeElement` y se prueba con teclas de verdad: llegan a la shell y se
 * borran. Va PEGADA al clic: `contarEnTerminal` pulsa la terminal y le daría el foco ella sola.
 */
async function comprobarFocoEnLaTerminal(win: Page, tras: string): Promise<void> {
  const visible = 'section.terminal-panel .terminal-pane[aria-hidden="false"]'
  const focoEnLaXterm = (): Promise<boolean> =>
    win.evaluate((sel) => Boolean(document.activeElement?.closest(`${sel} .xterm`)), visible)
  await expect
    .poll(focoEnLaXterm, { message: `tras ${tras}, el foco está dentro de la xterm que se ve` })
    .toBe(true)
  await win.keyboard.type(TECLAS_FOCO)
  await expect
    .poll(() => contarEnTerminal(win, TECLAS_FOCO), {
      message: `tras ${tras}, lo tecleado llega a la terminal`,
      timeout: 30_000
    })
    .toBe(1)
  await win.locator(`${visible} .xterm-screen`).click()
  for (let i = 0; i < TECLAS_FOCO.length; i++) await win.keyboard.press('Backspace')
  await expect
    .poll(() => contarEnTerminal(win, TECLAS_FOCO), {
      message: `tras ${tras}, lo tecleado se borra y la línea queda limpia`,
      timeout: 30_000
    })
    .toBe(0)
}

/** Captura opcional: solo si quien corre la prueba pide dónde guardarla. */
async function capturar(win: Page, nombre: string): Promise<void> {
  const dir = process.env.TESSERA_E2E_CAPTURAS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await win.screenshot({ path: join(dir, `${nombre}.png`), animations: 'disabled' })
}

test.describe.serial('La terminal a pantalla completa', () => {
  let s: SesionTessera
  let m: Montaje

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.env, { sembrar: (datos) => sembrar(datos, m) })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) await borrarTemporal(m.raiz)
  })

  test('maximizar tapa el área de trabajo sin desmontar nada, la terminal crece y no se remonta; restaurar devuelve el layout', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    const lateral = win.locator('.sidebar').first()
    const editor = win.locator('.editor-area')
    const agente = win.locator('.right-panel.cc-panel')
    const panel = win.locator('section.terminal-panel')
    const pantalla = panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen')
    const maximizar = panel.getByRole('button', { name: 'Maximizar el panel de terminal' })
    const restaurar = panel.getByRole('button', { name: 'Restaurar el panel de terminal' })
    const ocultar = panel.getByRole('button', { name: 'Ocultar el panel de terminal' })

    // --- Preparación: un archivo abierto (editor a la vista), la terminal en la franja y un marcador escrito ---
    await win.locator('.sidebar .tree-row', { hasText: 'LEEME.txt' }).first().click({ timeout: 30_000 })
    await expect(win.locator('.editor-tab.active', { hasText: 'LEEME.txt' })).toHaveCount(1)
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(panel).toBeVisible()
    await expect(panel.locator('.terminal-tab')).toHaveCount(1)
    await pantalla.click()
    await asentar(win)
    await win.keyboard.type(ORDEN_MARCADOR)
    await win.keyboard.press('Enter')
    await expect
      .poll(() => contarEnTerminal(win, MARCADOR), { message: 'la salida del echo aparece una vez', timeout: 30_000 })
      .toBe(1)

    // Cada pane de terminal lleva una marca en el DOM: si alguno se remontara, la perdería.
    await win.evaluate(() =>
      document.querySelectorAll('.terminal-pane').forEach((p) => p.setAttribute('data-e2e-marca', '1'))
    )
    const panesTerminal = await win.locator('.terminal-pane').count()
    const panesAgente = await win.locator('.agent-pane').count()
    const altoFranja = await alto(panel)
    const altoEditor = await alto(editor)
    const altoPantalla = await alto(pantalla)
    const marcados = (): Promise<number> => win.locator('.terminal-pane[data-e2e-marca]').count()

    // --- El botón nuevo aparece y desaparece IGUAL que sus hermanos ---
    await enReposo(win)
    await expect(ocultar, 'en reposo ocultar se esconde').toBeHidden()
    await expect(maximizar, 'y maximizar con él').toBeHidden()
    await panel.locator('.panel-header').first().hover()
    await expect(ocultar).toBeVisible()
    await expect(maximizar, 'con el ratón en el panel se ve').toBeVisible()
    await expect(maximizar, 'y su tooltip enseña el acorde').toHaveAttribute(
      'title',
      `Maximizar el panel de terminal (${ACORDE})`
    )
    await capturar(win, 'terminal-franja-con-boton')

    // --- Pantalla completa: la terminal ocupa el lienzo; lo demás se tapa, no se desmonta ---
    await maximizar.click()
    await expect(shell).toHaveClass(/\bfranja-pantalla-completa\b/)
    await expect(shell).toHaveClass(/\bterminal-pantalla-completa\b/)
    await expect(shell, 'la clase de Git no se cuela').not.toHaveClass(/\bgit-pantalla-completa\b/)
    // Con el botón el foco se queda en él (Espacio o Intro saldrían del modo): vuelve a la xterm.
    await comprobarFocoEnLaTerminal(win, 'maximizar')
    await expect(lateral, 'el explorador queda tapado').toBeHidden()
    await expect(editor, 'el editor queda tapado').toBeHidden()
    await expect(agente, 'la columna del agente queda tapada').toBeHidden()
    const lienzo = await alto(win.locator('.shell-main'))
    expect(Math.abs((await alto(panel)) - lienzo), 'el panel ocupa el alto entero del lienzo').toBeLessThanOrEqual(3)
    for (const cromo of ['.titlebar', '.tabs-projects', '.activity-bar', '.status-bar']) {
      await expect(win.locator(cromo).first(), `${cromo} se queda`).toBeVisible()
    }
    expect(await win.locator('.agent-pane').count(), 'los panes del agente siguen montados').toBe(panesAgente)
    await expect(win.locator('.editor-tab', { hasText: 'LEEME.txt' }), 'la pestaña sigue abierta').toHaveCount(1)

    // La terminal SÍ cambia de tamaño (su observador la reajusta), y no se remonta: lo escrito sigue ahí.
    await expect
      .poll(() => alto(pantalla), { message: 'el lienzo de xterm crece con el panel' })
      .toBeGreaterThan(altoPantalla + 200)
    expect(await marcados(), 'ningún pane de terminal se remontó').toBe(panesTerminal)
    expect(await contarEnTerminal(win, MARCADOR), 'lo escrito antes sigue en pantalla').toBe(1)

    // --- Restaurar y ocultar están FIJOS: son las dos salidas del modo y se ven sin ratón ni foco ---
    await enReposo(win)
    await expect(restaurar, 'restaurar no se esconde en reposo').toBeVisible()
    await expect(ocultar, 'ocultar tampoco: es la otra salida del modo').toBeVisible()
    await expect(panel.locator('.terminal-reload-btn'), 'y reiniciar, que no sale del modo, sí se esconde').toBeHidden()
    await expect(restaurar).toHaveAttribute('title', `Restaurar el panel de terminal (${ACORDE})`)
    await capturar(win, 'terminal-pantalla-completa')

    // --- Restaurar devuelve el layout de antes, con el alto de la franja y la terminal viva ---
    await restaurar.click()
    await expect(shell).not.toHaveClass(/\bfranja-pantalla-completa\b/)
    await comprobarFocoEnLaTerminal(win, 'restaurar')
    await expect(lateral).toBeVisible()
    await expect(editor).toBeVisible()
    await expect(agente).toBeVisible()
    expect(await alto(panel), 'la franja recupera su alto').toBe(altoFranja)
    expect(await alto(editor), 'y el editor el suyo').toBe(altoEditor)
    await expect
      .poll(async () => Math.abs((await alto(pantalla)) - altoPantalla), { message: 'y la terminal vuelve a su tamaño' })
      .toBeLessThanOrEqual(2)
    expect(await marcados(), 'tampoco se remontó al volver').toBe(panesTerminal)
    await enReposo(win)
    await expect(ocultar, 'fuera de pantalla completa ocultar vuelve a esconderse en reposo').toBeHidden()
    expect(await contarEnTerminal(win, MARCADOR), 'y lo escrito sigue en pantalla').toBe(1)
  })

  test('Ctrl+`, cambiar a Git·Log y abrir una pestaña (Mod+N) salen del modo, y reabrir el panel no lo resucita', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    const lateral = win.locator('.sidebar').first()
    const editor = win.locator('.editor-area')
    const agente = win.locator('.right-panel.cc-panel')
    const panel = win.locator('section.terminal-panel')
    const git = win.locator('.git-log-panel')
    const maximizar = panel.getByRole('button', { name: 'Maximizar el panel de terminal' })
    const riel = (nombre: string): Locator => win.getByRole('button', { name: nombre, exact: true })
    const modo = /\bfranja-pantalla-completa\b/
    /** Lleva la terminal a pantalla completa con el botón, como lo haría el usuario. */
    const maximizarTerminal = async (): Promise<void> => {
      await panel.locator('.panel-header').first().hover()
      await maximizar.click()
      await expect(shell).toHaveClass(/\bterminal-pantalla-completa\b/)
    }

    await expect(panel).toBeVisible()
    await expect(shell).not.toHaveClass(modo)

    // --- Ctrl+`: alterna la terminal, o sea la cierra, y con ella el modo ---
    await maximizarTerminal()
    await win.keyboard.press('Control+`')
    await expect(shell, 'Ctrl+` sale del modo').not.toHaveClass(modo)
    await expect(win.locator('section.terminal-panel:not(.hidden)')).toHaveCount(0)
    await expect(lateral).toBeVisible()
    await expect(editor).toBeVisible()
    await expect(agente).toBeVisible()
    await win.keyboard.press('Control+`')
    await expect(panel).toBeVisible()
    await expect(shell, 'reabrir la terminal no resucita el modo').not.toHaveClass(modo)

    // --- Cambiar a Git·Log: el panel que se ve es otro, y Git llega a la franja, no maximizado ---
    await maximizarTerminal()
    await riel('Git · Log').click()
    await expect(git).toBeVisible()
    await expect(shell, 'cambiar a Git·Log sale del modo').not.toHaveClass(modo)
    await expect(panel).toBeHidden()
    await expect(lateral).toBeVisible()
    await expect(editor).toBeVisible()
    await riel('Terminal').click()
    await expect(panel).toBeVisible()
    await expect(shell, 'volver a la terminal tampoco lo resucita').not.toHaveClass(modo)

    // --- Abrir una pestaña (archivo nuevo): no se abre a ciegas, sale del modo y se ve ---
    await maximizarTerminal()
    await expect(editor).toBeHidden()
    // El botón devuelve el foco a la xterm y, en Windows, ella se queda con Ctrl+N (es el ^N de
    // la shell): se espera a que el foco llegue y se saca de la terminal, como quien pulsa el
    // atajo desde otra zona.
    await asentar(win)
    await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await win.keyboard.press(`${MOD}+n`)
    await expect(shell, 'abrir una pestaña sale del modo').not.toHaveClass(modo)
    await expect(win.locator('.editor-tab.active', { hasText: 'Sin título' })).toHaveCount(1)
    await expect(editor).toBeVisible()
    await expect(win.locator('.editor-area .monaco-editor').filter({ visible: true }).first()).toBeVisible()
    await expect(panel, 'la terminal sigue en la franja').toBeVisible()
  })

  test('Mod+Shift+↩ alterna la pantalla completa con el foco en la franja, no manda un CR a la shell y no actúa con el foco fuera', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    const panel = win.locator('section.terminal-panel')
    const pantalla = panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen')
    const git = win.locator('.git-log-panel')
    const acorde = `${MOD}+Shift+Enter`

    await expect(panel).toBeVisible()
    await expect(shell).not.toHaveClass(/\bfranja-pantalla-completa\b/)

    // --- Con el foco en la shell: una orden SIN Enter, y el acorde dos veces (entra y sale) ---
    // Si el acorde llegara a xterm saldría como un CR y ejecutaría lo escrito.
    await pantalla.click()
    await asentar(win)
    await win.keyboard.type(ORDEN_SIN_CR)
    await win.keyboard.press(acorde)
    await expect(shell, 'con el foco en la terminal, el acorde la maximiza').toHaveClass(/\bterminal-pantalla-completa\b/)
    await win.keyboard.press(acorde)
    await expect(shell, 'y la segunda pulsación restaura').not.toHaveClass(/\bfranja-pantalla-completa\b/)

    // --- Mantenerlo pulsado: la autorrepetición se traga, así que alterna UNA vez ---
    await win.keyboard.down(MOD)
    await win.keyboard.down('Shift')
    for (let i = 0; i < 4; i++) await win.keyboard.down('Enter')
    await win.keyboard.up('Enter')
    await win.keyboard.up('Shift')
    await win.keyboard.up(MOD)
    await expect(shell, 'una pulsación sostenida alterna una sola vez').toHaveClass(/\bterminal-pantalla-completa\b/)
    await win.keyboard.press(acorde)
    await expect(shell).not.toHaveClass(/\bfranja-pantalla-completa\b/)

    // --- Ningún CR llegó a la shell: la orden sigue sin ejecutar, y se ejecuta al pulsar Enter ---
    await win.waitForTimeout(1_500)
    expect(await contarEnTerminal(win, SIN_CR), 'el acorde no mandó el prompt a medio escribir').toBe(0)
    await pantalla.click()
    await win.keyboard.press('Enter')
    await expect
      .poll(() => contarEnTerminal(win, SIN_CR), { message: 'lo escrito llegó entero a la shell', timeout: 30_000 })
      .toBe(1)

    // --- Con el foco FUERA de la franja el acorde no hace nada ---
    await win.locator('.sidebar .tree-row', { hasText: 'LEEME.txt' }).first().click()
    await win.keyboard.press(acorde)
    await asentar(win)
    await expect(shell, 'con el foco en el explorador no alterna').not.toHaveClass(/\bfranja-pantalla-completa\b/)

    // --- En Git·Log alterna el suyo: es el panel que se ve ---
    await win.getByRole('button', { name: 'Git · Log', exact: true }).click()
    await expect(git).toBeVisible()
    await expect(git.locator('.git-fila-commit').first()).toBeVisible({ timeout: 30_000 })
    await git.locator('.git-fila-commit').first().click()
    await win.keyboard.press(acorde)
    await expect(shell, 'con el foco en Git·Log maximiza Git·Log').toHaveClass(/\bgit-pantalla-completa\b/)
    await expect(shell).not.toHaveClass(/\bterminal-pantalla-completa\b/)
    await win.keyboard.press(acorde)
    await expect(shell).not.toHaveClass(/\bfranja-pantalla-completa\b/)
  })
})
