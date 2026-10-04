// =============================================================================
// Git·Log a pantalla completa sobre la app empaquetada: el botón de maximizar se revela
// como sus hermanos, tapa lateral, editor y agente sin desmontarlos, el de restaurar se
// queda fijo, restaurar devuelve el alto de la franja y la X a pantalla completa cierra
// y restaura. Moverse por los commits no abre nada; abrir un archivo, el historial o el
// fuente sale del modo. La regla la fija `features/layout/test-layout-centro.mts`. Agente
// falso (`agenteFalso.ts`); nada depende del sistema. `TESSERA_E2E_CAPTURAS` guarda capturas.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

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
  // El segundo da a la auto-apertura un commit al que moverse y al detalle dos archivos.
  writeFileSync(join(repo, 'LEEME.txt'), 'hola\nadiós\n')
  writeFileSync(join(repo, 'OTRO.txt'), 'otro\n')
  git('add', '.')
  git('commit', '-q', '-m', 'Segundo commit de la prueba')
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

/** Alto de un elemento visible, redondeado. */
async function alto(l: Locator): Promise<number> {
  const caja = await l.boundingBox()
  if (caja === null) throw new Error('el elemento no tiene caja')
  return Math.round(caja.height)
}

/** Captura opcional: solo si quien corre la prueba pide dónde guardarla. */
async function capturar(win: Page, nombre: string): Promise<void> {
  const dir = process.env.TESSERA_E2E_CAPTURAS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await win.screenshot({ path: join(dir, `${nombre}.png`), animations: 'disabled' })
}

test.describe('Git·Log a pantalla completa', () => {
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

  test('maximizar tapa el área de trabajo sin desmontar nada; restaurar y la X devuelven el layout', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    const lateral = win.locator('.sidebar').first()
    const editor = win.locator('.editor-area')
    const agente = win.locator('.right-panel.cc-panel')
    const panel = win.locator('.git-log-panel')
    const maximizar = panel.getByRole('button', { name: 'Maximizar el panel de git' })
    const restaurar = panel.getByRole('button', { name: 'Restaurar el panel de git' })
    const cerrar = panel.getByRole('button', { name: 'Cerrar el panel de git' })
    const recargar = panel.getByRole('button', { name: 'Recargar el historial y las ramas' })

    // --- Preparación: un archivo abierto (editor a la vista) y Git·Log en la franja ---
    await win.locator('.sidebar .tree-row', { hasText: 'LEEME.txt' }).first().click({ timeout: 30_000 })
    await expect(win.locator('.editor-tab.active', { hasText: 'LEEME.txt' })).toHaveCount(1)
    await win.getByRole('button', { name: 'Git · Log' }).click()
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Primer commit de la prueba', { timeout: 30_000 })
    const altoFranja = await alto(panel)
    const altoEditor = await alto(editor)
    const panesAgente = await win.locator('.agent-pane').count()

    // --- El botón nuevo aparece y desaparece IGUAL que sus dos hermanos ---
    await enReposo(win)
    await expect(cerrar, 'en reposo la X se esconde').toBeHidden()
    await expect(recargar).toBeHidden()
    await expect(maximizar, 'y maximizar con ella').toBeHidden()
    await panel.locator('.panel-header').first().hover()
    await expect(cerrar).toBeVisible()
    await expect(maximizar, 'con el ratón encima se ve').toBeVisible()
    await capturar(win, 'git-franja-con-boton')

    // --- Pantalla completa: Git ocupa el lienzo; lo demás se tapa, no se desmonta ---
    await maximizar.click()
    await expect(shell).toHaveClass(/\bgit-pantalla-completa\b/)
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

    // --- Restaurar está FIJO: visible sin ratón ni foco, cuando la X ya se ha ido ---
    await enReposo(win)
    await expect(cerrar).toBeHidden()
    await expect(restaurar, 'restaurar no se esconde en reposo').toBeVisible()
    await capturar(win, 'git-pantalla-completa')

    // --- Restaurar devuelve el layout de antes, con el alto de la franja ---
    await restaurar.click()
    await expect(shell).not.toHaveClass(/\bgit-pantalla-completa\b/)
    await expect(lateral).toBeVisible()
    await expect(editor).toBeVisible()
    await expect(agente).toBeVisible()
    expect(await alto(panel), 'la franja recupera su alto').toBe(altoFranja)
    expect(await alto(editor), 'y el editor el suyo').toBe(altoEditor)

    // --- La X a pantalla completa cierra Git y restaura; al reabrir vuelve a la franja ---
    await panel.locator('.panel-header').first().hover()
    await maximizar.click()
    await expect(shell).toHaveClass(/\bgit-pantalla-completa\b/)
    await panel.locator('.panel-header').first().hover()
    await cerrar.click()
    await expect(panel).toHaveCount(0)
    await expect(shell).not.toHaveClass(/\bgit-pantalla-completa\b/)
    await expect(lateral).toBeVisible()
    await expect(editor).toBeVisible()
    await expect(agente).toBeVisible()
    await win.getByRole('button', { name: 'Git · Log' }).click()
    await expect(panel).toBeVisible()
    await expect(shell, 'reabrir Git no resucita la pantalla completa').not.toHaveClass(/\bgit-pantalla-completa\b/)
    expect(await alto(panel)).toBe(altoFranja)
  })

  test('a pantalla completa, moverse por los commits no abre nada y abrir algo a mano sale del modo', async () => {
    const win = s.win
    const shell = win.locator('.shell')
    const agente = win.locator('.right-panel.cc-panel')
    const panel = win.locator('.git-log-panel')
    const maximizar = panel.getByRole('button', { name: 'Maximizar el panel de git' })
    const restaurar = panel.getByRole('button', { name: 'Restaurar el panel de git' })
    const commits = panel.locator('.git-fila-commit')
    const detalle = panel.locator('.git-log-detalle')
    const asunto = detalle.locator('.git-detalle-asunto')
    const archivoDelCommit = (nombre: string): Locator => detalle.locator('.git-arbol-fila', { hasText: nombre })
    const pestanaActiva = win.locator('.editor-tab.active')
    const diffVisible = win.locator('.editor-area .monaco-diff-editor').filter({ visible: true })
    /** Espera a que el detalle enseñe el commit y deja pasar de sobra el antirrebote (180 ms). */
    const elegido = async (texto: string): Promise<void> => {
      await expect(asunto).toHaveText(texto)
      await expect(detalle.locator('.git-arbol-fila').first()).toBeVisible()
      await win.waitForTimeout(800)
    }

    // --- Punto de partida (lo deja la prueba anterior): Git en la franja, LEEME.txt en el editor ---
    await expect(panel).toBeVisible()
    await expect(shell).not.toHaveClass(/\bgit-pantalla-completa\b/)
    await expect(commits).toHaveCount(2, { timeout: 30_000 })
    await expect(pestanaActiva).toContainText('LEEME.txt')
    await expect(agente).not.toHaveClass(/\bcc-hidden\b/)
    const pestanasAntes = await win.locator('.editor-tab').count()

    // --- (b) La auto-apertura: a pantalla completa, clic y flechas en los commits no abren nada ---
    await panel.locator('.panel-header').first().hover()
    await maximizar.click()
    await expect(shell).toHaveClass(/\bgit-pantalla-completa\b/)
    await commits.nth(1).click()
    await elegido('Primer commit de la prueba')
    await win.keyboard.press('ArrowUp')
    await elegido('Segundo commit de la prueba')
    await expect(shell, 'moverse por los commits no saca del modo').toHaveClass(/\bgit-pantalla-completa\b/)
    await restaurar.click()
    await expect(shell).not.toHaveClass(/\bgit-pantalla-completa\b/)
    expect(await win.locator('.editor-tab').count(), 'no se abrió ninguna pestaña').toBe(pestanasAntes)
    await expect(pestanaActiva, 'la activa sigue siendo la de antes').toContainText('LEEME.txt')
    await expect(pestanaActiva.locator('.editor-tab-kind')).toHaveCount(0)
    await expect(agente, 'ni se colapsó el agente a escondidas').not.toHaveClass(/\bcc-hidden\b/)

    // Control: fuera del modo la misma selección SÍ abre (la prueba de arriba no es vacía).
    await commits.nth(1).click()
    await expect(asunto).toHaveText('Primer commit de la prueba')
    await expect(pestanaActiva.locator('.editor-tab-kind'), 'fuera del modo abre su diff').toHaveText('diff')
    await expect(agente, 'y colapsa el agente, como siempre').toHaveClass(/\bcc-hidden\b/)
    await commits.nth(0).click()
    await elegido('Segundo commit de la prueba')

    // --- (a) Clic en un archivo del commit a pantalla completa: sale del modo y abre su diff ---
    await panel.locator('.panel-header').first().hover()
    await maximizar.click()
    await expect(shell).toHaveClass(/\bgit-pantalla-completa\b/)
    await archivoDelCommit('OTRO.txt').click()
    await expect(shell, 'el clic sale del modo').not.toHaveClass(/\bgit-pantalla-completa\b/)
    await expect(pestanaActiva).toContainText('OTRO.txt')
    await expect(pestanaActiva.locator('.editor-tab-kind')).toHaveText('diff')
    await expect(diffVisible, 'y el diff se ve en el editor').toContainText('otro')

    // --- Doble clic, igual ---
    await panel.locator('.panel-header').first().hover()
    await maximizar.click()
    await expect(shell).toHaveClass(/\bgit-pantalla-completa\b/)
    await archivoDelCommit('LEEME.txt').dblclick()
    await expect(shell, 'el doble clic sale del modo').not.toHaveClass(/\bgit-pantalla-completa\b/)
    await expect(pestanaActiva).toContainText('LEEME.txt')
    await expect(pestanaActiva.locator('.editor-tab-kind')).toHaveText('diff')
    await expect(diffVisible).toContainText('adiós')

    // --- (c) Historial de un archivo: doble clic en una versión y «Saltar al fuente» salen del modo ---
    await win.locator('.sidebar .tree-row', { hasText: 'LEEME.txt' }).first().click({ button: 'right' })
    await win.locator('.ctx-menu').getByRole('menuitem', { name: 'Historial del archivo' }).click()
    const versiones = panel.locator('.git-hist-fila')
    await expect(versiones).toHaveCount(2, { timeout: 30_000 })
    // De aquí en adelante hay dos `.panel-header`: el visor del historial trae la suya.
    await panel.locator('.panel-header').first().hover()
    await maximizar.click()
    await expect(shell).toHaveClass(/\bgit-pantalla-completa\b/)
    await versiones.first().click()
    const saltar = panel.getByRole('button', { name: 'Saltar al fuente' })
    await expect(saltar).toBeEnabled({ timeout: 30_000 })
    await expect(shell, 'elegir una versión no sale (el diff se ve dentro del panel)').toHaveClass(
      /\bgit-pantalla-completa\b/
    )
    await saltar.click()
    await expect(shell, 'saltar al fuente sale del modo').not.toHaveClass(/\bgit-pantalla-completa\b/)
    await expect(pestanaActiva).toContainText('LEEME.txt')
    await expect(pestanaActiva.locator('.editor-tab-kind'), 'abre el archivo, no un diff').toHaveCount(0)

    await panel.locator('.panel-header').first().hover()
    await maximizar.click()
    await expect(shell).toHaveClass(/\bgit-pantalla-completa\b/)
    await versiones.first().dblclick()
    await expect(shell, 'el doble clic en el historial sale del modo').not.toHaveClass(/\bgit-pantalla-completa\b/)
    await expect(pestanaActiva).toContainText('LEEME.txt')
    await expect(pestanaActiva.locator('.editor-tab-kind')).toHaveText('diff')
    await expect(diffVisible).toContainText('adiós')
  })
})
