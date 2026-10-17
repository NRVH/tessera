// =============================================================================
// El agente maximizado y la vista dividida sobre la app empaquetada. La regla
// (`maximizadoCoherente`) la fija `features/layout/test-layout-centro.mts`; lo que solo
// existe en el renderer es la CONEXIÓN, `useColumnaAgente.ts`, que corrige el store antes
// de pintar. Con el agente maximizado, pasar a un proyecto con el archivo dividido no deja
// los dos a la vez ni resucita el maximizado al volver; pasar a uno sin dividida lo
// conserva, y lo hecho en otro perfil no se lo quita. Al cerrar, con dos perfiles y sus
// agentes, no queda ninguno vivo. Agente falso (`agenteFalso.ts`).
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { montarAgenteFalso, vivo, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

/** Los de Personal (el que maximiza, el que tiene un Markdown dividido y uno normal) y el de Trabajo. */
const PROYECTOS = {
  alfa: ['alfa.txt', 'docs/nota.md'],
  beta: ['beta.txt', 'LEEME.md'],
  gamma: ['gamma.txt'],
  delta: ['delta.txt']
} as const
type NombreProyecto = keyof typeof PROYECTOS
const DE_PERSONAL: readonly NombreProyecto[] = ['alfa', 'beta', 'gamma']

interface Montaje {
  raiz: string
  env: Record<string, string>
  rutas: Record<NombreProyecto, string>
  agente: AgenteFalso
}

/** El agente falso, los tres proyectos con sus archivos y el entorno de la app. */
function montar(): Montaje {
  const agente = montarAgenteFalso()
  const { raiz, env } = agente
  const rutas = {} as Record<NombreProyecto, string>
  for (const [nombre, archivos] of Object.entries(PROYECTOS) as [NombreProyecto, readonly string[]][]) {
    rutas[nombre] = join(raiz, nombre)
    mkdirSync(rutas[nombre])
    for (const archivo of archivos) {
      const contenido = archivo.endsWith('.md') ? `# ${nombre}\n\nUn documento de prueba.\n` : `${nombre}\n`
      mkdirSync(dirname(join(rutas[nombre], archivo)), { recursive: true })
      writeFileSync(join(rutas[nombre], archivo), contenido)
    }
  }
  return { raiz, env, rutas, agente }
}

/** Un perfil sin sandbox, con su agente falso. */
function perfil(id: string, nombre: string, color: string): object {
  return { id, nombre, color, agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }], sandbox: { habilitado: false } }
}

/** `profiles.json` + `workspace-state.json`: Personal con tres proyectos y Trabajo con uno. */
function sembrar(datos: string, m: Montaje): void {
  writeFileSync(join(datos, 'profiles.json'), JSON.stringify([perfil('personal', 'Personal', '#9814c8'), perfil('trabajo', 'Trabajo', '#1f8f4e')]))
  const abierto = (n: NombreProyecto): object => ({ projectHostPath: m.rutas[n], name: n, estado: 'active' })
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: {
        personal: { openProjects: DE_PERSONAL.map(abierto), activePath: m.rutas.alfa },
        trabajo: { openProjects: [abierto('delta')], activePath: m.rutas.delta }
      },
      // Todos NATIVOS: sin Docker y sin el modal que pregunta el modo del proyecto.
      settings: {
        defaultProjectMode: 'windows',
        windowsModeProjects: [...DE_PERSONAL.map((n) => `personal|${m.rutas[n]}`), `trabajo|${m.rutas.delta}`]
      }
    })
  )
}

/** Pasa al perfil `nombre` por su pestaña y espera a su proyecto activo. */
async function irAlPerfil(win: Page, nombre: string, proyecto: NombreProyecto): Promise<void> {
  await win.locator('.tabs-profiles .profile-tab', { hasText: nombre }).first().click()
  await expect(win.locator('.tabs-projects .project-tab.active', { hasText: proyecto })).toHaveCount(1)
  await asentar(win)
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
  await win.locator('.sidebar .tree-row:visible', { hasText: archivo }).first().click({ timeout: 30_000 })
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
    // Con dos perfiles, cada uno con su agente: cerrar la app no deja ninguno vivo sin ella.
    const vivosTrasCerrar = (): number[] => (m ? m.agente.arranques().map((e) => e.pid).filter(vivo) : [])
    await expect.poll(vivosTrasCerrar, { message: 'cerrar Tessera no deja agentes vivos', timeout: 10_000 }).toEqual([])
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

  test('el maximizado es del PERFIL: abrir archivos en otro no se lo quita al volver', async () => {
    const win = s.win
    const editor = win.locator('.editor-area')
    const columna = win.locator('.right-panel.cc-panel')
    const maximizar = win.locator('.agent-pane:not(.hidden)').getByRole('button', { name: 'Maximizar Claude Code' })
    // Personal · alfa, con su pestaña de antes: se maximiza el agente.
    await irA(win, 'alfa')
    await win.locator('.agent-pane:not(.hidden) .panel-header').hover()
    await pulsarEnCabecera(maximizar)
    await expect(editor, 'maximizado en Personal').toBeHidden()

    // Trabajo nunca maximizó: abrir allí un archivo enseña su editor y deja su columna normal.
    await irAlPerfil(win, 'Trabajo', 'delta')
    await expect(win.locator('.sidebar .tree-row', { hasText: 'delta.txt' })).toBeVisible({ timeout: 30_000 })
    await abrir(win, 'delta.txt')
    await expect(editor, 'Trabajo enseña su archivo').toBeVisible()
    await expect(columna, 'y su columna no hereda el maximizado de Personal').not.toHaveClass(/\bcc-grow\b/)

    // De vuelta en Personal, tal cual se dejó.
    await irAlPerfil(win, 'Personal', 'alfa')
    await expect(editor, 'Personal vuelve maximizado: lo hecho en Trabajo no le toca').toBeHidden()
    await expect(columna).toHaveClass(/\bcc-grow\b/)
    await pulsarEnCabecera(win.locator('.agent-pane:not(.hidden)').getByRole('button', { name: 'Restaurar editor' }))
    await expect(editor).toBeVisible()
  })

  test('el explorador vuelve tal cual: la carpeta elegida en un proyecto sigue elegida al volver de otro perfil', async () => {
    const win = s.win
    await irA(win, 'alfa')
    const docs = win.locator('.sidebar .tree-row:visible', { hasText: 'docs' }).first()
    await docs.click()
    await expect(docs, 'elegir la carpeta la marca').toHaveClass(/\bselected-dir\b/)
    await expect(win.locator('.sidebar .tree-row', { hasText: 'nota.md' }), 'y la abre').toBeVisible()
    await irAlPerfil(win, 'Trabajo', 'delta')
    await expect(win.locator('.sidebar .tree-row:visible', { hasText: 'delta.txt' })).toBeVisible()
    await irAlPerfil(win, 'Personal', 'alfa')
    const docsDeVuelta = win.locator('.sidebar .tree-row:visible', { hasText: 'docs' }).first()
    await expect(docsDeVuelta, 'al volver, la carpeta sigue elegida: el árbol no se rehízo').toHaveClass(/\bselected-dir\b/)
    await expect(win.locator('.sidebar .tree-row:visible', { hasText: 'nota.md' })).toBeVisible()
  })
})
