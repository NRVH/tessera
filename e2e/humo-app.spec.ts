// =============================================================================
// Recorrido de humo de lo que compone `App.tsx`: explorador, pestañas del editor,
// diff desde git, panel de cambios, historial y detalle de commit, búsqueda en
// archivos y terminales. Es la red de caracterización antes de partir `App.tsx`.
// Corre en las dos plataformas (los acordes salen de `MOD`); en Mac, sin verificar.
// Montaje compartido con `capturas-app.spec.ts` en `humoAyudas.ts`.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  abrirDesdeArbol,
  abrirHumo,
  asentar,
  cerrarHumo,
  filaArbol,
  hashHead,
  MARCADOR_BUSQUEDA,
  NOMBRE_PROYECTO,
  type MontajeHumo
} from './humoAyudas'
import { MOD, type SesionTessera } from './tessera'

/** La salida que se busca en la terminal; la orden la escribe partida para no contarse a sí misma. */
const SALIDA_TERMINAL = 'SALIDA_HUMO'
const ORDEN_ECHO = "echo SAL''IDA_HUMO"

/** El editor de texto visible (hay instancias ocultas por las pestañas en segundo plano). */
function editorVisible(win: Page): Locator {
  return win.locator('.monaco-editor:not(.monaco-diff-editor .monaco-editor) .view-lines').filter({ visible: true })
}

/** Número de coincidencias que anuncia un buscador (`3 coincidencias` o `1 / 3`). */
function totalDe(etiqueta: string): number {
  const m = /(\d+) coincidencias|\d+ \/ (\d+)/.exec(etiqueta)
  return m ? Number(m[1] ?? m[2]) : 0
}

test.describe.serial('humo: lo que compone App.tsx', () => {
  let s: SesionTessera
  let m: MontajeHumo

  test.beforeAll(async () => {
    ;({ s, m } = await abrirHumo())
  })

  test.afterAll(async () => {
    await cerrarHumo(s, m)
  })

  test('abre el proyecto: pestaña activa y raíz del árbol', async () => {
    const win = s.win
    await expect(win.locator('.tabs-projects .project-tab.active', { hasText: NOMBRE_PROYECTO })).toHaveCount(1)
    await expect(filaArbol(win, 'src')).toBeVisible({ timeout: 30_000 })
    await expect(filaArbol(win, 'LEEME.txt')).toBeVisible()
    await expect(filaArbol(win, 'uno.txt'), 'la carpeta empieza plegada').toHaveCount(0)
  })

  test('árbol: expandir una carpeta y abrir un archivo con su marca de git', async () => {
    const win = s.win
    await filaArbol(win, 'src').click()
    await expect(filaArbol(win, 'uno.txt')).toBeVisible()
    await expect(filaArbol(win, 'dos.txt')).toBeVisible()
    await expect(filaArbol(win, 'uno.txt'), 'el archivo modificado lleva su letra').toContainText('M')
    await abrirDesdeArbol(win, 'uno.txt')
    await expect(editorVisible(win)).toContainText('linea dos cambiada')
  })

  test('pestañas: abrir dos, cambiar, marca de sucio al escribir y cerrar', async () => {
    const win = s.win
    await abrirDesdeArbol(win, 'dos.txt')
    await expect(win.locator('.editor-tab')).toHaveCount(2)
    await expect(editorVisible(win)).toContainText(MARCADOR_BUSQUEDA)

    await win.locator('.editor-tab', { hasText: 'uno.txt' }).click()
    await expect(win.locator('.editor-tab.active', { hasText: 'uno.txt' })).toHaveCount(1)
    await expect(editorVisible(win)).toContainText('linea dos cambiada')

    await editorVisible(win).click()
    await win.keyboard.type('X')
    await expect(win.locator('.editor-tab.dirty', { hasText: 'uno.txt' }), 'escribir marca la pestaña').toHaveCount(1)
    await expect(win.locator('.editor-tab.dirty .editor-tab-dot')).toHaveCount(1)
    await win.keyboard.press(`${MOD}+z`)
    await expect(win.locator('.editor-tab.dirty'), 'deshacer vuelve a la versión guardada').toHaveCount(0)

    const dos = win.locator('.editor-tab', { hasText: 'dos.txt' })
    await dos.hover()
    await dos.getByRole('button', { name: 'Cerrar dos.txt' }).click()
    await expect(win.locator('.editor-tab')).toHaveCount(1)
    await expect(win.locator('.editor-tab.active', { hasText: 'uno.txt' })).toHaveCount(1)
  })

  test('diff desde el panel de cambios de git', async () => {
    const win = s.win
    const cambios = win.getByRole('button', { name: /^Git · Cambios, 1 cambios sin confirmar$/ })
    await cambios.click()
    const panel = win.locator('.git-panel')
    const fila = panel.locator('.git-arbol-fila', { hasText: 'uno.txt' })
    await expect(fila).toBeVisible()
    await expect(panel.locator('.git-arbol-fila')).toHaveCount(1)

    await fila.dblclick()
    const pestana = win.locator('.editor-tab.active', { hasText: 'uno.txt' })
    await expect(pestana.locator('.editor-tab-kind')).toHaveText('diff')
    const diff = win.locator('.monaco-diff-editor').filter({ visible: true })
    await expect(diff).toContainText('linea dos cambiada')
    await expect(diff.locator('.editor.original')).toContainText('linea dos')
  })

  test('historial de git: log, detalle de un commit y su archivo', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Git · Log' }).click()
    const commits = win.locator('.git-fila-commit')
    await expect(commits).toHaveCount(2)
    await expect(commits.nth(0)).toContainText('segundo commit: amplía dos.txt')
    await expect(commits.nth(1)).toContainText('primer commit')

    await commits.nth(0).click()
    const detalle = win.locator('.git-log-detalle')
    await expect(detalle.locator('.git-detalle-asunto')).toHaveText('segundo commit: amplía dos.txt')
    await expect(detalle.locator('.git-detalle-autor')).toContainText('Prueba Humo')
    await expect(detalle.locator('.git-arbol-fila', { hasText: 'dos.txt' })).toBeVisible()
    const hash = hashHead(m.proyecto)
    const chip = (await detalle.locator('.git-hash-chip').innerText()).trim()
    expect(chip.length, 'el chip enseña un hash abreviado').toBeGreaterThanOrEqual(7)
    expect(hash.startsWith(chip), `el chip ${chip} es el principio de ${hash}`).toBe(true)
  })

  test('buscar en archivos y abrir el resultado', async () => {
    const win = s.win
    await win.keyboard.press(`${MOD}+Shift+F`)
    const modal = win.locator('.buscar-modal')
    await expect(modal).toBeVisible()
    await modal.getByRole('textbox', { name: 'Texto a buscar' }).fill(MARCADOR_BUSQUEDA)
    await expect(modal.locator('.buscar-contador')).toHaveText('1 coincidencia en 1 archivo')
    const resultado = modal.locator('.buscar-fila')
    await expect(resultado).toHaveCount(1)
    await expect(resultado.locator('.buscar-fila-nombre')).toHaveText('dos.txt')
    await expect(resultado.locator('.buscar-fila-linea')).toHaveText('2')

    await resultado.dblclick()
    await expect(modal).toHaveCount(0)
    const activa = win.locator('.editor-tab.active', { hasText: 'dos.txt' })
    await expect(activa).toHaveCount(1)
    await expect(activa.locator('.editor-tab-kind'), 'abre el archivo, no un diff').toHaveCount(0)
    await expect(editorVisible(win)).toContainText(MARCADOR_BUSQUEDA)
  })

  test('terminales: nueva terminal, echo y su salida', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Terminal' }).click()
    const panel = win.locator('section.terminal-panel')
    await expect(panel).toBeVisible()
    const pestanas = panel.locator('.terminal-tab')
    await expect(pestanas, 'abrir el panel crea la primera').toHaveCount(1)

    await panel.getByRole('button', { name: 'Nueva terminal' }).click()
    await expect(pestanas).toHaveCount(2)
    await expect(pestanas.nth(1)).toHaveClass(/\bactive\b/)

    const pantalla = panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen')
    await pantalla.click()
    await asentar(win)
    await win.keyboard.type(ORDEN_ECHO)
    await win.keyboard.press('Enter')

    await win.keyboard.press(`${MOD}+f`)
    const buscador = panel.locator('.terminal-pane[aria-hidden="false"] .search-box')
    await expect(buscador).toBeVisible()
    await buscador.locator('.search-box-input').fill(SALIDA_TERMINAL)
    await expect
      .poll(
        async () => {
          await buscador.locator('.search-box-input').press('Enter')
          return totalDe(await buscador.locator('.search-box-count').innerText())
        },
        { message: 'la salida del echo aparece una vez (la orden va partida)', timeout: 30_000 }
      )
      .toBe(1)
    await buscador.getByRole('button', { name: 'Cerrar buscador' }).click()
  })
})
