// =============================================================================
// Tessera en inglés, en la app empaquetada: el idioma llega a la ventana por el preload (el renderer
// no tiene `process`) y la interfaz lo habla. Dos arranques: uno con el idioma fijado por la variable
// de las pruebas y otro con el AJUSTE guardado, que es el camino del usuario. La comprobación fuerte
// es el barrido del modal de Configuración: en inglés no queda ni una letra acentuada, tampoco en
// los artículos de Tessera Academy ni en sus capturas, y su ⓘ abre el artículo en inglés.
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

  test('BARRIDO: Tessera Academy, artículo a artículo, en inglés y con sus capturas en inglés', async () => {
    const modal = s.win.locator('.ajustes-modal')
    await s.win.locator('.ajustes-riel-item[data-cat="academy"]').click()
    const ids = await modal.locator('.academy-tarjeta').evaluateAll((els) => els.map((e) => e.getAttribute('data-articulo') ?? ''))
    expect(ids).toHaveLength(22)
    const restos: string[] = []
    let capturas = 0
    for (const id of ids) {
      await modal.locator(`.academy-tarjeta[data-articulo="${id}"]`).click()
      const articulo = s.win.locator('.academy-lector')
      await expect(articulo).toBeVisible()
      const texto = await articulo.evaluate((a) => {
        const titulos = Array.from(a.querySelectorAll('[title]')).map((e) => e.getAttribute('title') ?? '')
        const alts = Array.from(a.querySelectorAll('img')).map((e) => `${e.getAttribute('alt') ?? ''} ${e.getAttribute('src') ?? ''}`)
        return [(a as HTMLElement).innerText, ...titulos, ...alts].join('\n')
      })
      for (const l of texto.match(/[^\n]*[áéíóúñ¿¡][^\n]*/gi) ?? []) restos.push(`${id}: ${l}`)
      // La captura en inglés y no la española de reserva. Vite les pone un hash: `ventana.en-Ab12.webp`.
      for (const src of texto.match(/\S+\.(es|en)-[\w-]+\.webp/g) ?? []) {
        capturas++
        if (/\.es-[\w-]+\.webp/.test(src)) restos.push(`${id}: ${src}`)
      }
      await s.win.keyboard.press('Escape')
      await expect(articulo).toHaveCount(0)
    }
    expect(restos).toEqual([])
    expect(capturas, 'el barrido vio las capturas').toBeGreaterThan(5)
  })

  test('el ⓘ de un diálogo habla inglés y abre el artículo en inglés', async () => {
    await s.win.keyboard.press('Escape')
    await expect(s.win.locator('.ajustes-modal')).toHaveCount(0)
    await s.win.locator('.profile-tab[data-perfil-id="personal"]').click({ button: 'right' })
    await s.win.getByRole('menuitem', { name: 'Rules for agents…' }).click()
    const ayuda = s.win.getByRole('dialog').getByRole('button', { name: /Tessera Academy/ })
    await expect(ayuda).toHaveAttribute('title', /^Explained in Tessera Academy: [^áéíóúñ]+$/)
    await ayuda.click()
    await expect(s.win.locator('.academy-lector .academy-articulo[data-articulo="reglas-del-perfil"]')).toBeVisible()
    await s.win.keyboard.press('Escape')
    await expect(s.win.locator('.academy-lector')).toHaveCount(0)
    await s.win.keyboard.press('Escape')
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
