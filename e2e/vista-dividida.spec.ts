// =============================================================================
// La vista dividida de un Markdown sobre la app empaquetada: bajar por el código lleva la
// vista renderizada a la misma fracción de su recorrido, y mover la vista lleva al código.
// Lo que `test:scroll-sincronizado` no puede ver: que Monaco y el DOM de verdad avisen y
// se muevan. Proyecto propio sin git (los commits de humo tienen hashes fijados en capturas).
// Decisiones: docs/decisiones/editor/scroll-sincronizado-vista-dividida.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, PLATAFORMA, type SesionTessera } from './tessera'

/** Un Markdown largo de verdad: muchas secciones, para que los dos lados tengan recorrido. */
const GUIA = Array.from({ length: 120 }, (_, i) => `## Sección ${i + 1}\n\nPárrafo de la sección ${i + 1}, con texto suficiente para ocupar una línea.\n`).join('\n')

/** Las líneas del Markdown de arriba, para medir en qué fracción del código está el editor. */
const LINEAS = GUIA.split('\n').length

interface Medidas {
  vista: number
  vistaMax: number
  /** Fracción del recorrido de la vista (0 arriba, 1 abajo). */
  fraccionVista: number
  lineaVisible: number
  /** Fracción del recorrido del código, por sus números de línea visibles. */
  fraccionCodigo: number
}

async function medidas(win: Page): Promise<Medidas> {
  return win.evaluate((lineas) => {
    const vista = document.querySelector<HTMLElement>('.editor-cuerpo.dividida > .markdown-preview')!
    const numeros = Array.from(document.querySelectorAll<HTMLElement>('.editor-cuerpo.dividida .margin-view-overlays .line-numbers'))
      .map((el) => Number(el.textContent))
      .filter((n) => Number.isFinite(n) && n > 0)
    const vistaMax = vista.scrollHeight - vista.clientHeight
    const comun = { vista: vista.scrollTop, vistaMax, fraccionVista: vistaMax > 0 ? vista.scrollTop / vistaMax : 0 }
    // Margen a medio pintar: 0 (y el `poll` reintenta) antes que un Infinity que no dice nada.
    if (numeros.length === 0) return { ...comun, lineaVisible: 0, fraccionCodigo: 0 }
    const primera = Math.min(...numeros)
    const visibles = Math.max(...numeros) - primera + 1
    return { ...comun, lineaVisible: primera, fraccionCodigo: (primera - 1) / Math.max(1, lineas - visibles) }
  }, LINEAS)
}

test.describe('vista dividida de un Markdown', () => {
  let s: SesionTessera
  let agente: AgenteFalso

  test.beforeAll(async () => {
    agente = montarAgenteFalso()
    const proyecto = join(agente.raiz, 'docs')
    mkdirSync(proyecto)
    writeFileSync(join(proyecto, 'GUIA.md'), GUIA)
    s = await abrirTessera(agente.env, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: 'personal',
            byProfile: { personal: { openProjects: [{ projectHostPath: proyecto, name: 'docs', estado: 'active' }], activePath: proyecto } },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`] }
          })
        )
      }
    })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
    const win = s.win
    await win.locator('.sidebar .tree-row', { hasText: 'GUIA.md' }).first().click({ timeout: 30_000 })
    await expect(win.locator('.editor-tab.active', { hasText: 'GUIA.md' })).toHaveCount(1)
    await win.getByRole('radio', { name: 'Editor y vista previa' }).click()
    await expect(win.locator('.editor-cuerpo.dividida > .markdown-preview')).toBeVisible()
    await expect(win.locator('.editor-cuerpo.dividida .margin-view-overlays .line-numbers').first()).toBeVisible()
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agente) await borrarTemporal(agente.raiz)
  })

  test('bajar por el código lleva la vista a la misma fracción; hasta el final, al final', async () => {
    const win = s.win
    const antes = await medidas(win)
    expect(antes.vista, 'la vista empieza arriba').toBe(0)
    // Sobre `.editor-host` (el visor) y NUNCA sobre `.view-lines`: ese mide el documento entero
    // (9600 px aquí), y cuando Playwright reintenta un clic porque el elemento se mueve (la
    // animación del scroll) lo centra con `scrollIntoView`, que Monaco traduce a ir a la MITAD
    // del documento (medido: dejaba los dos lados al 50 % y el Ctrl+Fin perdido).
    const editor = win.locator('.editor-cuerpo.dividida > .editor-host')
    await editor.hover()
    await win.mouse.wheel(0, 1500)
    await expect.poll(() => medidas(win).then((m) => m.vista), 'la vista se mueve con el código').toBeGreaterThan(0)
    const aMedias = await medidas(win)
    expect(aMedias.vista, 'y no está al final: es proporcional').toBeLessThan(aMedias.vistaMax - 50)
    expect(
      Math.abs(aMedias.fraccionVista - aMedias.fraccionCodigo),
      `la vista va por la misma fracción que el código (vista ${aMedias.fraccionVista.toFixed(2)}, código ${aMedias.fraccionCodigo.toFixed(2)})`
    ).toBeLessThan(0.1)
    // Al final del documento con el teclado: la rueda, con el scroll suave de Monaco, se
    // queda a medias por mucho que se insista (medido). Ctrl+Fin aquí, ⌘↓ en Mac.
    await editor.click()
    await win.keyboard.press(PLATAFORMA === 'mac' ? 'Meta+ArrowDown' : 'Control+End')
    await expect.poll(() => medidas(win).then((m) => m.vistaMax - m.vista), 'con el código al final, la vista al final').toBeLessThanOrEqual(2)
  })

  test('mover la vista lleva al código, y volver arriba vuelve a la línea 1', async () => {
    const win = s.win
    const vista = win.locator('.editor-cuerpo.dividida > .markdown-preview')
    await vista.hover()
    await win.mouse.wheel(0, -100_000)
    await expect.poll(() => medidas(win).then((m) => m.vista)).toBe(0)
    await expect.poll(() => medidas(win).then((m) => m.lineaVisible), 'el código vuelve a la primera línea').toBe(1)
    await win.mouse.wheel(0, 2000)
    await expect.poll(() => medidas(win).then((m) => m.lineaVisible), 'y al bajar la vista, el código baja').toBeGreaterThan(20)
  })
})
