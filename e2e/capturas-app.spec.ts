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
async function aparcarRaton(ventana: Page): Promise<void> {
  const marca = await ventana.locator('.status-bar-marca').boundingBox()
  if (marca) await ventana.mouse.move(marca.x + marca.width / 2, marca.y + marca.height / 2)
  await asentar(ventana)
}

/** Las barras de desplazamiento de los editores de diff que se ven. */
const BARRAS_DEL_DIFF = '.monaco-diff-editor .scrollbar'

/** Espera a que las barras de los diff que se ven hayan pasado a su estado oculto, el que se queda. */
async function esperarBarrasDelDiffOcultas(ventana: Page): Promise<void> {
  await expect
    .poll(() =>
      ventana.evaluate((sel) => {
        const visibles = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
          (b) => b.closest('.monaco-diff-editor')?.getClientRects().length
        )
        return visibles.length > 0 && visibles.every((b) => b.classList.contains('invisible'))
      }, BARRAS_DEL_DIFF)
    )
    .toBe(true)
}

test.describe.serial('capturas de referencia de App.tsx', () => {
  let s: SesionTessera
  let m: MontajeHumo

  test.beforeAll(async () => {
    ;({ s, m } = await abrirHumo())
    await expect(filaArbol(s.ventana, 'src')).toBeVisible({ timeout: 30_000 })
  })

  test.afterAll(async () => {
    await cerrarHumo(s, m)
  })

  test('explorador con una carpeta abierta y un archivo en el editor', async () => {
    const ventana = s.ventana
    await filaArbol(ventana, 'src').click()
    await abrirDesdeArbol(ventana, 'uno.txt')
    await abrirDesdeArbol(ventana, 'dos.txt')
    await aparcarRaton(ventana)
    await expect(ventana).toHaveScreenshot('ventana-explorador.png', await opciones(ventana))
  })

  test('pestañas con una marcada como sucia', async () => {
    const ventana = s.ventana
    await ventana.locator('.editor-tab', { hasText: 'uno.txt' }).click()
    await ventana.locator('.monaco-editor .view-lines').filter({ visible: true }).click()
    await ventana.keyboard.type('X')
    await expect(ventana.locator('.editor-tab.dirty')).toHaveCount(1)
    await aparcarRaton(ventana)
    const tira = ventana.locator('.editor-tabs')
    await expect(tira).toHaveScreenshot('pestanas-sucia.png', await opciones(tira))
    await ventana.keyboard.press(`${MOD}+z`)
    await expect(ventana.locator('.editor-tab.dirty')).toHaveCount(0)
  })

  test('panel de cambios de git y diff del archivo modificado', async () => {
    const ventana = s.ventana
    await ventana.getByRole('button', { name: /^Git · Cambios/ }).click()
    await ventana.locator('.git-panel .git-arbol-fila', { hasText: 'uno.txt' }).dblclick()
    await expect(ventana.locator('.monaco-diff-editor').filter({ visible: true })).toContainText('linea dos cambiada')
    await aparcarRaton(ventana)
    // Monaco muestra la barra del diff al pintarlo y la oculta a los 500 ms: se captura ya oculta, el estado que se queda.
    await esperarBarrasDelDiffOcultas(ventana)
    await expect(ventana).toHaveScreenshot('ventana-diff-git.png', await opciones(ventana))
  })

  test('historial de git con el detalle de un commit', async () => {
    const ventana = s.ventana
    await ventana.getByRole('button', { name: 'Git · Historial' }).click()
    await ventana.locator('.git-fila-commit', { hasText: 'segundo commit' }).click()
    await expect(ventana.locator('.git-log-detalle .git-detalle-asunto')).toHaveText('segundo commit: amplía dos.txt')
    // El commit abre el diff de su archivo: la captura no puede salir antes de que lo pinte.
    await expect(ventana.locator('.monaco-diff-editor').filter({ visible: true })).toContainText('beta')
    await aparcarRaton(ventana)
    await esperarBarrasDelDiffOcultas(ventana)
    await expect(ventana).toHaveScreenshot('ventana-historial-git.png', await opciones(ventana))
  })

  test('buscar en archivos con un resultado', async () => {
    const ventana = s.ventana
    await ventana.keyboard.press(`${MOD}+Shift+F`)
    const modal = ventana.locator('.buscar-modal')
    await modal.getByRole('textbox', { name: 'Texto a buscar' }).fill(MARCADOR_BUSQUEDA)
    await expect(modal.locator('.buscar-contador')).toHaveText('1 coincidencia en 1 archivo')
    await expect(modal.locator('.monaco-editor')).toContainText(MARCADOR_BUSQUEDA)
    await aparcarRaton(ventana)
    await expect(modal).toHaveScreenshot('buscar-en-archivos.png', await opciones(modal))
    await ventana.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  })

  test('panel de terminales con dos terminales', async () => {
    const ventana = s.ventana
    // La referencia lleva lo que dejan las pruebas anteriores (pestañas de diff, vista de
    // Cambios): corrida sola, con `-g`, fallaría o regeneraría una referencia que la serie no casa.
    await expect(ventana.locator('.editor-tab', { hasText: 'dos.txt' })).toHaveCount(2)
    await ventana.getByRole('button', { name: 'Terminal' }).click()
    const panel = ventana.locator('section.terminal-panel')
    await expect(panel.locator('.terminal-tab')).toHaveCount(1)
    await panel.getByRole('button', { name: 'Nueva terminal' }).click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(2)
    await aparcarRaton(ventana)
    await expect(ventana).toHaveScreenshot('ventana-terminales.png', await opciones(ventana))
  })
})
