// =============================================================================
// El selector de color de un perfil sobre la app empaquetada: «Cambiar color» abre un popover
// bajo la pestaña (no el selector del sistema), elegir una muestra tiñe la pestaña en el acto,
// un color personalizado se puede fijar y se guarda en los ajustes, y Esc deshace lo elegido.
// =============================================================================

import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrirTessera, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

/** Los colores fijados que dice el estado persistido; `[]` si aún no hay archivo. */
function fijadosPersistidos(datos: string): string[] {
  const ruta = join(datos, 'workspace-state.json')
  if (!existsSync(ruta)) return []
  try {
    const doc = JSON.parse(readFileSync(ruta, 'utf8')) as { settings?: { coloresPerfilFijados?: string[] } }
    return doc.settings?.coloresPerfilFijados ?? []
  } catch {
    return [] // a medio escribir: la siguiente vuelta del poll lo verá entero
  }
}

test('cambiar el color de un perfil: popover bajo la pestaña, muestra, fijar y Esc deshace', async () => {
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX) })
    const win = s.win
    const pestana = win.locator('.profile-tab[data-perfil-id="personal"]')
    await expect(pestana).toBeVisible({ timeout: 30_000 })
    const colorDe = (): Promise<string> => pestana.evaluate((el) => el.style.getPropertyValue('--profile-color'))
    const original = await colorDe()

    await pestana.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Cambiar color' }).click()
    const selector = win.getByRole('dialog', { name: 'Color de Personal' })
    await expect(selector).toBeVisible()
    const [cajaPestana, cajaSelector] = await Promise.all([pestana.boundingBox(), selector.boundingBox()])
    expect(cajaSelector!.y, 'se abre debajo de la pestaña').toBeGreaterThanOrEqual(cajaPestana!.y + cajaPestana!.height)

    const hex = selector.getByLabel('Color en hexadecimal')
    const sembrado = (JSON.parse(PERFILES_SIN_SANDBOX) as { id: string; color: string }[]).find((x) => x.id === 'personal')!.color
    await expect(hex, 'el personalizado parte del color tal cual: Aplicar sin tocar no lo cambia').toHaveValue(sembrado.toLowerCase())
    await selector.locator('.selector-color-muestra').nth(1).click()
    await expect.poll(colorDe, 'elegir una muestra tiñe la pestaña en el acto').not.toBe(original)
    await expect(hex, 'y el personalizado sigue a la muestra elegida').not.toHaveValue(sembrado.toLowerCase())

    await hex.fill('#aa5566')
    await selector.getByRole('button', { name: 'Fijar' }).click()
    await expect(selector.locator('.selector-color-rejilla').nth(1).locator('.selector-color-muestra'), 'queda fijado').toHaveCount(1)
    await expect.poll(() => fijadosPersistidos(s!.datos), { message: 'y se guarda en los ajustes', timeout: 10_000 }).toEqual(['#aa5566'])

    await win.keyboard.press('Escape')
    await expect(selector, 'Esc cierra').toHaveCount(0)
    await expect.poll(colorDe, 'y deshace lo elegido desde que se abrió').toBe(original)

    // «Aplicar» confirma: cierra el popover y el color se queda.
    await pestana.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Cambiar color' }).click()
    await expect(selector).toBeVisible()
    await hex.fill('#3366aa')
    await selector.getByRole('button', { name: 'Aplicar' }).click()
    await expect(selector, 'Aplicar cierra el popover').toHaveCount(0)
    await expect.poll(colorDe, 'y el color aplicado se queda').not.toBe(original)
  } finally {
    await s?.cerrar()
  }
})
