// =============================================================================
// La letra y el tema del editor de código sobre la app empaquetada: con un archivo abierto, cambiar el
// tamaño, la fuente y el tema en Configuración › Apariencia › Editor de código se ve al momento en el
// editor, sin reabrirlo (y en la vista previa del ajuste), y un archivo que se abre después ya nace así.
// Decisiones: docs/decisiones/renderer/monaco.md, docs/decisiones/renderer/temas-de-codigo.md
// =============================================================================

import { crearTemporal } from './temporales'
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirTessera, borrarTemporal, MOD, type SesionTessera } from './tessera'

/** El tamaño y la fuente con que pinta el editor visible. */
async function letraDelEditor(ventana: Page): Promise<{ tamano: number; fuente: string }> {
  const lineas = ventana.locator('.editor-area .monaco-editor .view-lines').filter({ visible: true }).first()
  return lineas.evaluate((el) => ({ tamano: parseFloat(getComputedStyle(el).fontSize), fuente: getComputedStyle(el).fontFamily }))
}

test('la fuente, el tamaño y el tema del editor de código se aplican al momento y a lo que se abre después', async () => {
  let s: SesionTessera | null = null
  const proyecto = crearTemporal(join(tmpdir(), 'tessera-e2e-letra-'))
  writeFileSync(join(proyecto, 'uno.txt'), 'uno')
  writeFileSync(join(proyecto, 'dos.txt'), 'dos')
  try {
    s = await abrirTessera({}, { args: [proyecto] })
    const ventana = s.ventana
    await ventana.locator('.sidebar .tree-row:visible', { hasText: 'uno.txt' }).first().click({ timeout: 30_000 })
    await expect(ventana.locator('.editor-area .monaco-editor .view-lines').filter({ visible: true }).first()).toHaveText('uno')
    expect((await letraDelEditor(ventana)).tamano, 'de partida, 13 px').toBe(13)

    await ventana.keyboard.press(`${MOD}+,`)
    const ajustes = ventana.locator('.ajustes-modal')
    await ajustes.locator('.ajustes-riel-item[data-cat="apariencia"]').click()
    const aumentar = ajustes.getByRole('button', { name: 'Aumentar el tamaño del editor de código' })
    await aumentar.click()
    await aumentar.click()
    await ajustes.getByRole('combobox', { name: 'Fuente del editor de código' }).selectOption({ label: 'Consolas' })
    // El tema: la vista previa del ajuste se colorea con él y el editor abierto cambia de fondo al momento.
    const previa = ajustes.getByRole('img', { name: 'Vista previa del tema del código' })
    await expect(previa.locator('span[class^="mtk"]').first(), 'la vista previa está coloreada por el editor').toBeVisible()
    await ajustes.getByRole('combobox', { name: 'Tema del código' }).selectOption({ label: 'Dracula' })
    await expect(previa, 'el fondo es el de Tessera en todos los temas').toHaveCSS('background-color', 'rgb(22, 23, 29)')
    // Y sus tokens, los colores del tema: la palabra clave de Dracula es rosa (#ff79c6).
    await expect(previa.locator('span', { hasText: /^export$/ }).first(), 'los tokens se vuelven a colorear con el tema nuevo').toHaveCSS(
      'color',
      'rgb(255, 121, 198)'
    )
    await ajustes.getByRole('button', { name: 'Cerrar', exact: true }).click()
    const fondo = ventana.locator('.editor-area .monaco-editor .monaco-editor-background').filter({ visible: true }).first()
    await expect(fondo, 'el editor abierto conserva el fondo de Tessera').toHaveCSS('background-color', 'rgb(22, 23, 29)')
    const texto = ventana.locator('.editor-area .monaco-editor .view-line span span').filter({ visible: true }).first()
    await expect(texto, 'y su texto toma el color del tema (#f8f8f2)').toHaveCSS('color', 'rgb(248, 248, 242)')

    await expect.poll(async () => (await letraDelEditor(ventana)).tamano, { message: 'el editor abierto cambia sin reabrirlo' }).toBe(15)
    expect((await letraDelEditor(ventana)).fuente, 'y con la fuente elegida').toMatch(/Consolas/)

    const editores = ventana.locator('.editor-area .monaco-editor')
    const antes = await editores.count()
    await ventana.locator('.sidebar .tree-row:visible', { hasText: 'dos.txt' }).first().click()
    await expect(ventana.locator('.editor-area .monaco-editor .view-lines').filter({ visible: true }).first()).toHaveText('dos')
    await expect(editores, 'dos.txt tiene su propio editor: se crea, no se reutiliza el de uno.txt').toHaveCount(antes + 1)
    expect((await letraDelEditor(ventana)).tamano, 'el que se abre después nace con ella').toBe(15)
  } finally {
    await s?.cerrar()
    await borrarTemporal(proyecto)
  }
})
