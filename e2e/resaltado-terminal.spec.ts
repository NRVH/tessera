// =============================================================================
// El resaltado de la salida en la terminal de shell de la app empaquetada: un log que llega sin color
// se pinta (error en rojo, info en azul) y con el interruptor de Configuración apagado deja de pintarse.
// Se mide en PÍXELES de una captura y no en el búfer: lo que se prueba es que el color llegue a la
// pantalla por el camino real (pty, contrapresión y el dibujo por GPU). La lógica de
// qué se pinta está en `test:resaltado-salida`.
// Decisiones: docs/decisiones/terminales/resaltado-de-la-salida.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, MOD, PLATAFORMA, type SesionTessera } from './tessera'

/** Los colores ANSI del tema de la terminal (`theme/atomOneDark.ts`): rojo y azul. */
const ROJO = [0xef, 0x6b, 0x74]
const AZUL = [0x6a, 0xa8, 0xff]

/** Un log sin colores, con varias líneas de cada clase para que el recuento de píxeles sea holgado. */
const REGISTRO = [
  ...Array.from({ length: 4 }, (_, i) => `2026-10-12 10:00:0${i} ERROR [main] java.io.IOException: Connection refused ${i}`),
  ...Array.from({ length: 4 }, (_, i) => `2026-10-12 10:00:1${i} INFO  [main] Servicio listo ${i}`),
  'fin del registro'
].join('\n')

interface Montaje {
  raiz: string
  env: Record<string, string>
  repo: string
}

function montar(): Montaje {
  const { raiz, env } = montarAgenteFalso()
  const repo = join(raiz, 'repo')
  mkdirSync(repo)
  writeFileSync(join(repo, 'registro.log'), `${REGISTRO}\n`)
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
      byProfile: { personal: { openProjects: [{ projectHostPath: m.repo, name: 'repo', estado: 'active' }], activePath: m.repo } },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${m.repo}`] }
    })
  )
}

const PANTALLA = 'section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm-screen'

/** Cuántos píxeles de la terminal a la vista son de cada color, con tolerancia por el suavizado. */
async function pixeles(win: Page): Promise<{ rojo: number; azul: number }> {
  const png = (await win.locator(PANTALLA).screenshot({ animations: 'disabled' })).toString('base64')
  return win.evaluate(
    async ({ datos, rojo, azul }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${datos}`
      await img.decode()
      const lienzo = document.createElement('canvas')
      lienzo.width = img.width
      lienzo.height = img.height
      const ctx = lienzo.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      // Solo la mitad izquierda, donde está el log: a la derecha pueden asomar avisos de la app.
      const d = ctx.getImageData(0, 0, Math.floor(img.width / 2), img.height).data
      const cerca = (i: number, c: number[]): boolean => Math.abs(d[i] - c[0]) < 28 && Math.abs(d[i + 1] - c[1]) < 28 && Math.abs(d[i + 2] - c[2]) < 28
      let r = 0
      let a = 0
      for (let i = 0; i < d.length; i += 4) {
        if (cerca(i, rojo)) r++
        else if (cerca(i, azul)) a++
      }
      return { rojo: r, azul: a }
    },
    { datos: png, rojo: ROJO, azul: AZUL }
  )
}

/** Cuántas veces sale `texto` en el búfer de la terminal, con su propio buscador (vale igual con GPU). */
async function contarEnTerminal(win: Page, texto: string): Promise<number> {
  const pane = win.locator('section.terminal-panel .terminal-pane[aria-hidden="false"]')
  await pane.locator('.xterm-screen').click()
  await win.keyboard.press(`${MOD}+f`)
  const buscador = pane.locator('.search-box')
  await expect(buscador).toBeVisible()
  const entrada = buscador.locator('.search-box-input')
  await entrada.fill(texto)
  await entrada.press('Enter')
  const etiqueta = await buscador.locator('.search-box-count').innerText()
  await buscador.getByRole('button', { name: 'Cerrar buscador' }).click()
  const m = /(\d+) coincidencias|\d+ \/ (\d+)/.exec(etiqueta)
  return m ? Number(m[1] ?? m[2]) : 0
}

/**
 * Limpia la pantalla, saca el log y espera a su marcador, que va partido con `''` en la orden para que
 * lo tecleado no cuente: cuando sale, el log ya está escrito entero.
 */
async function sacarRegistro(win: Page, vez: number): Promise<void> {
  await win.locator(PANTALLA).click()
  const volcar = PLATAFORMA === 'windows' ? 'Get-Content registro.log' : 'cat registro.log'
  await win.keyboard.type(`${PLATAFORMA === 'windows' ? 'cls' : 'clear'}; ${volcar}; echo LIS''TO${vez}`)
  await win.keyboard.press('Enter')
  await expect.poll(() => contarEnTerminal(win, `LISTO${vez}`), { timeout: 30_000 }).toBe(1)
  // El buscador ya se cerró: un par de fotogramas para que el dibujo quede sin su resaltado.
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

test.describe.serial('El resaltado de la salida en la terminal', () => {
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

  test('un log sin color sale con los errores en rojo y la etiqueta INFO en azul, y apagarlo en Configuración lo quita', async () => {
    const win = s.win
    const panel = win.locator('section.terminal-panel')
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(panel).toBeVisible()
    await expect(panel.locator('.terminal-tab')).toHaveCount(1)
    await expect(win.locator(PANTALLA)).toBeVisible({ timeout: 30_000 })

    await sacarRegistro(win, 1)
    const encendido = await pixeles(win)
    await win.locator(PANTALLA).screenshot({ path: test.info().outputPath('encendido.png') })
    console.log(`[resaltado] encendido ${JSON.stringify(encendido)}`)
    // Cuatro líneas rojas enteras dan miles de píxeles; los INFO, cientos. Lo de la propia shell
    // (el prompt, la orden tecleada) no es ni de este rojo ni de este azul.
    expect(encendido.rojo, `con el resaltado, las líneas de ERROR salen rojas — ${JSON.stringify(encendido)}`).toBeGreaterThan(800)
    expect(encendido.azul, `y las etiquetas INFO, azules — ${JSON.stringify(encendido)}`).toBeGreaterThan(80)

    await win.keyboard.press(`${MOD}+,`)
    await expect(win.locator('.ajustes-modal')).toHaveCount(1)
    await win.locator('.ajustes-riel-item[data-cat="terminales"]').click()
    const interruptor = win.getByRole('switch', { name: 'Resaltar logs y salidas' })
    await expect(interruptor).toHaveAttribute('aria-checked', 'true')
    await interruptor.click()
    await expect(interruptor).toHaveAttribute('aria-checked', 'false')
    await win.keyboard.press('Escape')
    await expect(win.locator('.ajustes-modal')).toHaveCount(0)

    await sacarRegistro(win, 2)
    const apagado = await pixeles(win)
    await win.locator(PANTALLA).screenshot({ path: test.info().outputPath('apagado.png') })
    console.log(`[resaltado] apagado ${JSON.stringify(apagado)}`)
    expect(apagado.rojo, `apagado, el log sale sin rojo — ${JSON.stringify(apagado)}`).toBeLessThan(encendido.rojo / 10)
    // El azul se compara entre las dos capturas: la selección que deja el buscador sobre el marcador
    // está en las dos, y algunas shells pintan su prompt de azul.
    expect(encendido.azul - apagado.azul, `ni las etiquetas en azul — ${JSON.stringify({ encendido, apagado })}`).toBeGreaterThan(80)
  })
})
