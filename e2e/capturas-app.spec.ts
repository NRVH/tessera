// =============================================================================
// Capturas de referencia de los paneles que compone `App.tsx` (explorador, pestañas,
// diff, cambios e historial de git, búsqueda y terminales), para comparar píxel a
// píxel antes y después de partirlo. Solo en Windows: son las únicas con referencia.
// Lo que varía entre corridas (fechas, terminales, cursores) va enmascarado.
// Montaje compartido con `humo-app.spec.ts` en `humoAyudas.ts`.
// =============================================================================

import { expect, test, type Locator, type Page, type PageAssertionsToHaveScreenshotOptions } from '@playwright/test'
import {
  abrirDesdeArbol,
  abrirHumo,
  asentar,
  cerrarHumo,
  filaArbol,
  MARCADOR_BUSQUEDA,
  type MontajeHumo
} from './humoAyudas'
import { MOD, PLATAFORMA, type SesionTessera } from './tessera'

test.skip(
  PLATAFORMA !== 'windows',
  'las referencias son de Windows; las de Mac las crearía la primera corrida ya refactorizada, sin valor de comparación'
)

/** Lo que cambia entre corridas: la salida de los pty (rutas temporales, pid) y las fechas (zona horaria). */
const VARIABLES = ['.xterm-screen', '.git-commit-fecha', '.git-detalle-fecha']

/**
 * El cursor de Monaco: el elemento y no su capa, que no tiene caja. Se resuelve en cada
 * disparo y sin filtro de visibilidad: parpadea alternándola, y nace sin caja hasta su
 * primer render, que en un diff recién abierto llega después de preparar las opciones.
 */
const CURSOR = '.monaco-editor .cursor'

/** Atributo que excluye de las máscaras lo que un scroll deja fuera de la vista. */
const RECORTADO = 'data-e2e-recortado'

/**
 * Marca los elementos con caja propia que no asoman dentro de la ventana ni de algún
 * ancestro que recorta. Su máscara se pintaría sobre la caja, encima de lo que haya allí.
 * Lo que aún no tiene caja no se marca: si aparece después, se enmascara.
 */
async function marcarRecortados(loc: Locator): Promise<void> {
  await loc.evaluateAll((els, atributo) => {
    for (const el of els) {
      const r = el.getBoundingClientRect()
      const caja = { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }
      const recortar = (c: { left: number; top: number; right: number; bottom: number }): void => {
        caja.x0 = Math.max(caja.x0, c.left)
        caja.y0 = Math.max(caja.y0, c.top)
        caja.x1 = Math.min(caja.x1, c.right)
        caja.y1 = Math.min(caja.y1, c.bottom)
      }
      recortar({ left: 0, top: 0, right: innerWidth, bottom: innerHeight })
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p)
        if (o.overflowX !== 'visible' || o.overflowY !== 'visible') recortar(p.getBoundingClientRect())
      }
      const tieneCaja = r.width > 0 && r.height > 0
      el.toggleAttribute(atributo, tieneCaja && !(caja.x1 > caja.x0 && caja.y1 > caja.y0))
    }
  }, RECORTADO)
}

/** Opciones de captura; las máscaras se resuelven en cada disparo, sin lo recortado. */
async function opciones(raiz: Page | Locator): Promise<PageAssertionsToHaveScreenshotOptions> {
  const mask: Locator[] = [raiz.locator(CURSOR)]
  for (const sel of VARIABLES) {
    await marcarRecortados(raiz.locator(sel))
    mask.push(raiz.locator(`${sel}:not([${RECORTADO}])`).filter({ visible: true }))
  }
  return { animations: 'disabled', caret: 'hide', mask }
}

/** Aparca el ratón en la marca de la barra de estado, que no reacciona al paso. */
async function aparcarRaton(win: Page): Promise<void> {
  const marca = await win.locator('.status-bar-marca').boundingBox()
  if (marca) await win.mouse.move(marca.x + marca.width / 2, marca.y + marca.height / 2)
  await asentar(win)
}

test.describe.serial('capturas de referencia de App.tsx', () => {
  let s: SesionTessera
  let m: MontajeHumo

  test.beforeAll(async () => {
    ;({ s, m } = await abrirHumo())
    await expect(filaArbol(s.win, 'src')).toBeVisible({ timeout: 30_000 })
  })

  test.afterAll(async () => {
    await cerrarHumo(s, m)
  })

  test('explorador con una carpeta abierta y un archivo en el editor', async () => {
    const win = s.win
    await filaArbol(win, 'src').click()
    await abrirDesdeArbol(win, 'uno.txt')
    await abrirDesdeArbol(win, 'dos.txt')
    await aparcarRaton(win)
    await expect(win).toHaveScreenshot('ventana-explorador.png', await opciones(win))
  })

  test('pestañas con una marcada como sucia', async () => {
    const win = s.win
    await win.locator('.editor-tab', { hasText: 'uno.txt' }).click()
    await win.locator('.monaco-editor .view-lines').filter({ visible: true }).click()
    await win.keyboard.type('X')
    await expect(win.locator('.editor-tab.dirty')).toHaveCount(1)
    await aparcarRaton(win)
    const tira = win.locator('.editor-tabs')
    await expect(tira).toHaveScreenshot('pestanas-sucia.png', await opciones(tira))
    await win.keyboard.press(`${MOD}+z`)
    await expect(win.locator('.editor-tab.dirty')).toHaveCount(0)
  })

  test('panel de cambios de git y diff del archivo modificado', async () => {
    const win = s.win
    await win.getByRole('button', { name: /^Git · Cambios/ }).click()
    await win.locator('.git-panel .git-arbol-fila', { hasText: 'uno.txt' }).dblclick()
    await expect(win.locator('.monaco-diff-editor').filter({ visible: true })).toContainText('linea dos cambiada')
    await aparcarRaton(win)
    await expect(win).toHaveScreenshot('ventana-diff-git.png', await opciones(win))
  })

  test('historial de git con el detalle de un commit', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Git · Log' }).click()
    await win.locator('.git-fila-commit', { hasText: 'segundo commit' }).click()
    await expect(win.locator('.git-log-detalle .git-detalle-asunto')).toHaveText('segundo commit: amplía dos.txt')
    await aparcarRaton(win)
    await expect(win).toHaveScreenshot('ventana-historial-git.png', await opciones(win))
  })

  test('buscar en archivos con un resultado', async () => {
    const win = s.win
    await win.keyboard.press(`${MOD}+Shift+F`)
    const modal = win.locator('.buscar-modal')
    await modal.getByRole('textbox', { name: 'Texto a buscar' }).fill(MARCADOR_BUSQUEDA)
    await expect(modal.locator('.buscar-contador')).toHaveText('1 coincidencia en 1 archivo')
    await expect(modal.locator('.monaco-editor')).toContainText(MARCADOR_BUSQUEDA)
    await aparcarRaton(win)
    await expect(modal).toHaveScreenshot('buscar-en-archivos.png', await opciones(modal))
    await win.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  })

  test('panel de terminales con dos terminales', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Terminal' }).click()
    const panel = win.locator('section.terminal-panel')
    await expect(panel.locator('.terminal-tab')).toHaveCount(1)
    await panel.getByRole('button', { name: 'Nueva terminal' }).click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(2)
    await aparcarRaton(win)
    await expect(win).toHaveScreenshot('ventana-terminales.png', await opciones(win))
  })
})
