// =============================================================================
// El menú contextual de los editores de código sobre la app empaquetada: el clic derecho en el
// texto abre el menú de Tessera (no el de serie del editor), en el idioma de la app, y sus
// opciones de portapapeles funcionan de verdad: copiar y pegar pasan por el sistema.
// Decisiones: docs/decisiones/renderer/menu-contextual.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirTessera, borrarTemporal, MOD, PLATAFORMA, type SesionTessera } from './tessera'

test('archivo de texto: el clic derecho abre el menú de Tessera y copiar y pegar funcionan', async () => {
  let s: SesionTessera | null = null
  const proyecto = mkdtempSync(join(tmpdir(), 'tessera-e2e-menu-'))
  writeFileSync(join(proyecto, 'nota.txt'), 'abc')
  try {
    s = await abrirTessera({}, { args: [proyecto] })
    const ventana = s.ventana
    await ventana.locator('.sidebar .tree-row:visible', { hasText: 'nota.txt' }).first().click({ timeout: 30_000 })
    await expect(ventana.locator('.editor-tab.active', { hasText: 'nota.txt' })).toHaveCount(1)
    const texto = ventana.locator('.editor-area .monaco-editor .view-lines').filter({ visible: true }).first()
    await expect(texto).toHaveText('abc')
    await texto.click()
    await ventana.keyboard.press(`${MOD}+a`)

    await texto.click({ button: 'right' })
    const menu = ventana.locator('.ctx-menu')
    await expect(menu, 'el menú de Tessera').toBeVisible()
    await expect(ventana.locator('.monaco-menu-container'), 'y no el de serie del editor').toHaveCount(0)
    await expect(menu.getByRole('menuitem')).toHaveText(['Cambiar todas las apariciones', 'Cortar', 'Copiar', 'Pegar', 'Seleccionar todo'])
    await menu.getByRole('menuitem', { name: 'Copiar' }).click()
    await expect(menu).toHaveCount(0)

    await ventana.keyboard.press('End')
    await texto.click({ button: 'right' })
    await ventana.locator('.ctx-menu').getByRole('menuitem', { name: 'Pegar' }).click()
    await expect(texto, 'pegar trae lo copiado').toHaveText('abcabc')

    // Desde el teclado, como en el resto de la app. En Mac el sistema no tiene ese gesto.
    if (PLATAFORMA === 'mac') await texto.click({ button: 'right' })
    else await ventana.keyboard.press('Shift+F10')
    await expect(ventana.locator('.ctx-menu'), 'Mayús+F10 abre el mismo menú').toBeVisible()
    await ventana.keyboard.press('Escape')
    await expect(ventana.locator('.ctx-menu'), 'Esc lo cierra').toHaveCount(0)
    await ventana.keyboard.type('!')
    await expect(texto, 'y el foco vuelve al editor').toHaveText(/!$/)
  } finally {
    await s?.cerrar()
    await borrarTemporal(proyecto)
  }
})
