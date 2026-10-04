// =============================================================================
// El agente maximizado y la vista dividida sobre la app empaquetada. La regla
// (`maximizadoCoherente`) la fija `features/layout/test-layout-centro.mts`; lo que solo
// existe en el renderer es la CONEXIÓN, `useColumnaAgente.ts`, que corrige el store antes
// de pintar. Con el agente maximizado, pasar a un proyecto con el archivo dividido no deja
// los dos a la vez ni resucita el maximizado al volver; pasar a uno sin dividida lo
// conserva. Agente falso (`agenteFalso.ts`). Nada depende del sistema.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

/** Los tres proyectos: el que maximiza, el que tiene un Markdown dividido y uno normal. */
const PROYECTOS = {
  alfa: ['alfa.txt'],
  beta: ['beta.txt', 'LEEME.md'],
  gamma: ['gamma.txt']
} as const
type NombreProyecto = keyof typeof PROYECTOS

interface Montaje {
  raiz: string
  env: Record<string, string>
  rutas: Record<NombreProyecto, string>
}

/** El agente falso, los tres proyectos con sus archivos y el entorno de la app. */
function montar(): Montaje {
  const { raiz, env } = montarAgenteFalso()
  const rutas = {} as Record<NombreProyecto, string>
  for (const [nombre, archivos] of Object.entries(PROYECTOS) as [NombreProyecto, readonly string[]][]) {
    rutas[nombre] = join(raiz, nombre)
    mkdirSync(rutas[nombre])
    for (const archivo of archivos) {
      const contenido = archivo.endsWith('.md') ? `# ${nombre}\n\nUn documento de prueba.\n` : `${nombre}\n`
      writeFileSync(join(rutas[nombre], archivo), contenido)
    }
  }
  return { raiz, env, rutas }
}

/** `profiles.json` + `workspace-state.json`: un perfil sin sandbox con los tres abiertos. */
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
  const nombres = Object.keys(PROYECTOS) as NombreProyecto[]
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: {
        personal: {
          openProjects: nombres.map((n) => ({ projectHostPath: m.rutas[n], name: n, estado: 'active' })),
          activePath: m.rutas.alfa
        }
      },
      // Todos NATIVOS: sin Docker y sin el modal que pregunta el modo del proyecto.
      settings: {
        defaultProjectMode: 'windows',
        windowsModeProjects: nombres.map((n) => `personal|${m.rutas[n]}`)
      }
    })
  )
}

/** Deja que React confirme el render provocado por el gesto (ver `atajos.spec.ts`). */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Lleva a un proyecto por su pestaña y espera a que sea el activo. */
async function irA(win: Page, nombre: NombreProyecto): Promise<void> {
  await win.locator('.tabs-projects .project-tab', { hasText: nombre }).first().click()
  await expect(win.locator('.tabs-projects .project-tab.active', { hasText: nombre })).toHaveCount(1)
  await asentar(win)
}

/** Abre un archivo desde el explorador (un clic, como el usuario) y espera su pestaña. */
async function abrir(win: Page, archivo: string): Promise<void> {
  await win.locator('.sidebar .tree-row', { hasText: archivo }).first().click({ timeout: 30_000 })
  await expect(win.locator('.editor-tab.active', { hasText: archivo })).toHaveCount(1)
}

/**
 * Pulsa un botón de la cabecera del agente justo después de cambiar de proyecto.
 *
 * COMPRUEBA A MANO Y PULSA CON `dispatchEvent`, por la misma trampa que documenta
 * `pulsarAgente` en `mosaico.spec.ts`: en macOS, un clic normal en esa cabecera recién
 * cambiado el proyecto dejaba la comprobación de accionabilidad de Playwright atascada
 * en «element is not visible» durante todo el plazo, con el botón a la vista. Lo que
 * `dispatchEvent` se salta se comprueba aquí: que el botón se ve y que nada lo tapa.
 */
async function pulsarEnCabecera(boton: Locator): Promise<void> {
  await expect(boton).toBeVisible()
  await expect
    .poll(
      async () =>
        boton.evaluate((b) => {
          const r = b.getBoundingClientRect()
          const enElPunto = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return enElPunto !== null && (enElPunto === b || b.contains(enElPunto))
        }),
      { message: 'algo tapa el botón de la cabecera del agente' }
    )
    .toBe(true)
  await boton.dispatchEvent('click')
}

test.describe('agente maximizado y vista dividida', () => {
  let s: SesionTessera
  let m: Montaje

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.env, { sembrar: (datos) => sembrar(datos, m) })
    // Ventana de tamaño conocido: la cabecera del agente tiene un tope de ancho y el
    // botón de maximizar tiene que caber a la vista.
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

  test('ocultar por la vista dividida CANCELA el maximizado, y un clic en otra pestaña no lo resucita', async () => {
    const win = s.win
    const editor = win.locator('.editor-area')
    const columna = win.locator('.right-panel.cc-panel')
    const maximizar = win.locator('.agent-pane:not(.hidden)').getByRole('button', { name: 'Maximizar Claude Code' })
    // Con CSS y no por rol: cuenta también el pane del proyecto activo cuando su columna
    // está escondida (sigue recibiendo `expanded`; los demás panes ya no lo reciben). Es
    // la lectura directa del ESTADO, no de lo que se pinta.
    const restaurarEnCualquierPane = win.locator('.agent-pane button[aria-label="Restaurar editor"]')

    // --- Preparación: una pestaña en cada proyecto, y el Markdown de beta dividido ---
    await expect(win.locator('.sidebar .tree-row', { hasText: 'alfa.txt' })).toBeVisible({ timeout: 30_000 })
    await abrir(win, 'alfa.txt')

    await irA(win, 'beta')
    await abrir(win, 'beta.txt')
    await abrir(win, 'LEEME.md')
    // Un .md abre renderizado; se pasa a «editor y vista previa» desde su cabecera.
    const dividida = win.getByRole('radio', { name: 'Editor y vista previa' })
    await dividida.click()
    await expect(dividida).toHaveAttribute('aria-checked', 'true')
    await expect(columna, 'la vista dividida esconde la columna del agente').toHaveClass(/\bcc-hidden\b/)

    await irA(win, 'gamma')
    await abrir(win, 'gamma.txt')
    await expect(columna).not.toHaveClass(/\bcc-hidden\b/)

    // --- Maximizar en alfa ---
    await irA(win, 'alfa')
    await expect(columna).not.toHaveClass(/\bcc-hidden\b/)
    await pulsarEnCabecera(maximizar)
    await expect(editor, 'maximizado: el editor se esconde').toBeHidden()
    await expect(columna, 'maximizado: la columna crece').toHaveClass(/\bcc-grow\b/)

    // --- NEGATIVO: sin vista dividida, el maximizado es de la ventana (lo de siempre) ---
    await irA(win, 'gamma')
    await expect(editor, 'gamma no está dividido: sigue maximizado').toBeHidden()
    await expect(columna).toHaveClass(/\bcc-grow\b/)
    await irA(win, 'alfa')
    await expect(editor, 'y al volver a alfa, también').toBeHidden()
    await expect(columna).toHaveClass(/\bcc-grow\b/)

    // --- beta: su Markdown está dividido. Se ve el editor y el maximizado se CANCELA ---
    await irA(win, 'beta')
    await expect(columna, 'la dividida esconde la columna').toHaveClass(/\bcc-hidden\b/)
    await expect(editor, 'se ve el editor dividido, no un centro vacío').toBeVisible()
    await expect(
      restaurarEnCualquierPane,
      'el maximizado queda CANCELADO en el estado, no sólo escondido: ningún pane dice «Restaurar editor»'
    ).toHaveCount(0)

    // --- El clic que antes escondía el editor bajo el ratón ---
    await win.locator('.editor-tab', { hasText: 'beta.txt' }).first().click()
    await expect(win.locator('.editor-tab.active', { hasText: 'beta.txt' })).toHaveCount(1)
    await asentar(win)
    // Se espera a que la columna VUELVA (sale de la dividida): el cambio del maximizado,
    // si lo hubiera, llega en ese mismo render, así que lo de debajo ya es definitivo.
    await expect(columna, 'fuera de la dividida vuelve la columna').not.toHaveClass(/\bcc-hidden\b/)
    await expect(editor, 'el editor sigue a la vista tras el clic (antes desaparecía)').toBeVisible()
    await expect(columna, 'y el agente no resucita maximizado').not.toHaveClass(/\bcc-grow\b/)
    // Se OFRECE maximizar, no restaurar. Con el ratón encima de la cabecera: sus acciones
    // están en reposo (`visibility: hidden`) mientras el foco no esté en el pane, y aquí
    // está en el editor por el clic de la pestaña. En alfa no hacía falta porque cambiar
    // de proyecto deja el foco en la terminal del agente (`:focus-within`).
    await win.locator('.agent-pane:not(.hidden) .panel-header').hover()
    await expect(maximizar).toBeVisible()

    // --- El precio, a sabiendas: de vuelta en alfa ya no está maximizado ---
    await irA(win, 'alfa')
    await expect(win.locator('.editor-tab.active', { hasText: 'alfa.txt' })).toHaveCount(1)
    await expect(editor, 'en alfa se ve el editor: el maximizado se canceló, no se aparcó').toBeVisible()
    await expect(columna).not.toHaveClass(/\bcc-grow\b/)
  })
})
