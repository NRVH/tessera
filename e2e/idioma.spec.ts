// =============================================================================
// Tessera en inglés, en la app empaquetada: el idioma llega a la ventana por el preload (el renderer
// no tiene `process`) y la interfaz lo habla. Dos arranques: uno con el idioma fijado por la variable
// de las pruebas y otro con el AJUSTE guardado, que es el camino del usuario. La comprobación fuerte
// es el barrido del modal de Configuración: en inglés no queda ni una letra acentuada.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrirTessera, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

/**
 * El texto de cada categoría del modal, sin los nombres de los idiomas (cada uno en el suyo) ni el
 * nombre del autor en «Acerca de», que son nombres propios.
 */
async function textosDelModal(win: Page): Promise<Array<{ cat: string; texto: string }>> {
  const cats = await win.locator('.ajustes-riel-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-cat') ?? ''))
  const out: Array<{ cat: string; texto: string }> = []
  for (const cat of cats) {
    await win.locator(`.ajustes-riel-item[data-cat="${cat}"]`).click()
    const texto = await win.locator('.ajustes-modal').evaluate((m) => {
      const copia = m.cloneNode(true) as HTMLElement
      copia.querySelectorAll('option, .ajustes-acerca-autor-nombre').forEach((o) => o.remove())
      return copia.innerText
    })
    out.push({ cat, texto })
  }
  return out
}

test.describe('con el idioma fijado a inglés', () => {
  let s: SesionTessera
  test.beforeAll(async () => {
    s = await abrirTessera(
      { TESSERA_FORZAR_IDIOMA: 'en' },
      { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX) }
    )
  })
  test.afterAll(async () => {
    await s?.cerrar()
  })

  test('la ventana sabe su idioma por el preload', async () => {
    expect(await s.win.evaluate(() => window.tessera.idioma)).toBe('en')
    expect(await s.win.evaluate(() => document.documentElement.lang)).toBe('en')
  })

  test('BARRIDO: la ventana principal, recién abierta, no deja texto en español', async () => {
    await expect(s.win.locator('body')).not.toBeEmpty()
    const texto = await s.win.evaluate(() => {
      // Con los `title` y `aria-label`: son la mitad de lo que se lee en una barra de iconos.
      const atributos = Array.from(document.querySelectorAll('[title], [aria-label]')).map(
        (e) => `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''}`
      )
      return `${document.body.innerText}\n${atributos.join('\n')}`
    })
    expect(texto.match(/[^\n]*[áéíóúñ¿¡][^\n]*/gi) ?? []).toEqual([])
  })

  test('Configuración habla inglés y ofrece el idioma', async () => {
    await s.win.keyboard.press(`${MOD}+,`)
    await expect(s.win.locator('.ajustes-modal')).toHaveCount(1)
    await expect(s.win.locator('.ajustes-riel-item[data-cat="apariencia"]')).toContainText('Appearance')
    await s.win.locator('.ajustes-riel-item[data-cat="apariencia"]').click()
    await expect(s.win.getByRole('combobox', { name: 'Language' })).toHaveValue('sistema')
  })

  test('BARRIDO: ninguna categoría del modal deja texto en español', async () => {
    const restos = (await textosDelModal(s.win))
      .map(({ cat, texto }) => ({ cat, letras: texto.match(/[^\n]*[áéíóúñ¿¡][^\n]*/gi) ?? [] }))
      .filter((r) => r.letras.length > 0)
    expect(restos).toEqual([])
  })
})

test.describe('con el idioma elegido en el ajuste', () => {
  let s: SesionTessera
  test.beforeAll(async () => {
    s = await abrirTessera(
      // Sin la variable: manda el ajuste guardado, que es lo que hace el usuario.
      { TESSERA_FORZAR_IDIOMA: '' },
      {
        sembrar: (datos) => {
          writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
          writeFileSync(
            join(datos, 'workspace-state.json'),
            JSON.stringify({ version: 1, activeProfileId: null, byProfile: {}, settings: { idioma: 'en' } })
          )
        }
      }
    )
  })
  test.afterAll(async () => {
    await s?.cerrar()
  })

  test('arranca en inglés y el selector enseña la elección', async () => {
    expect(await s.win.evaluate(() => window.tessera.idioma)).toBe('en')
    await s.win.keyboard.press(`${MOD}+,`)
    await s.win.locator('.ajustes-riel-item[data-cat="apariencia"]').click()
    await expect(s.win.getByRole('combobox', { name: 'Language' })).toHaveValue('en')
  })

  test('volver a «el del sistema» avisa de que hace falta reiniciar', async () => {
    await s.win.getByRole('combobox', { name: 'Language' }).selectOption('sistema')
    await expect(s.win.getByRole('button', { name: 'Restart now' })).toBeVisible()
    await expect(s.win.locator('.ajustes-modal')).toContainText('Tessera will switch language when it restarts.')
  })
})
