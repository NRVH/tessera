// =============================================================================
// Tessera Academy en la app empaquetada: su categoría de Configuración enseña el índice en rejilla;
// una tarjeta abre el artículo en el lector, encima, con su índice de secciones y sus capturas; un
// enlace al glosario lleva su definición; el buscador de Configuración encuentra artículos; las
// migajas del lector vuelven al índice (el grupo, a su sitio y resaltado); y el ⓘ
// de un diálogo abre el lector ENCIMA del diálogo, que sigue ahí al cerrarlo con Esc.
// Decisiones: docs/decisiones/configuracion/tessera-academy.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrirTessera, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

test('Tessera Academy: índice, lector, buscador y ⓘ sobre un diálogo', async () => {
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX) })
    const win = s.win
    const pestana = win.locator('.profile-tab[data-perfil-id="personal"]')
    await expect(pestana).toBeVisible({ timeout: 30_000 })

    // Índice: la categoría existe y su rejilla ocupa el ancho del panel (más de una columna).
    await win.keyboard.press(`${MOD}+,`)
    const ajustes = win.locator('.ajustes-modal')
    await expect(ajustes).toBeVisible()
    await ajustes.locator('.ajustes-riel-item[data-cat="academy"]').click()
    const tarjetas = ajustes.locator('.academy-tarjeta')
    await expect(tarjetas).toHaveCount(23)
    const columnas = await ajustes
      .locator('.academy-tarjetas')
      .first()
      .evaluate((ul) => getComputedStyle(ul).gridTemplateColumns.split(' ').length)
    expect(columnas, 'la rejilla usa el ancho').toBeGreaterThan(1)

    // Lector: una tarjeta lo abre encima de Configuración, con su captura pintada.
    await ajustes.locator('.academy-tarjeta[data-articulo="bienvenida"]').click()
    const lector = win.locator('.academy-lector')
    await expect(lector).toBeVisible()
    await expect(lector.locator('.academy-titulo')).toHaveText('Qué es Tessera')
    const captura = lector.locator('.academy-captura').first()
    await captura.scrollIntoViewIfNeeded()
    await expect.poll(() => captura.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

    // El índice del lector lleva a la sección y la marca como la que se lee.
    await lector.locator('.academy-lector-cuerpo').evaluate((c) => c.scrollTo({ top: 0 }))
    await lector.getByRole('button', { name: 'Siguiente' }).click()
    await expect(lector.locator('.academy-titulo')).toHaveText('Glosario')
    await lector.locator('.academy-pasar-boton', { hasText: 'Perfiles' }).click()
    await expect(lector.locator('.academy-titulo')).toHaveText('Perfiles')
    await lector.locator('.academy-toc-item').last().click()
    await expect(lector.locator('.academy-toc-item').last()).toHaveClass(/activa/)

    // Un enlace al glosario lleva su definición en el title y abre el término.
    await lector.locator('.academy-pasar-boton').first().click()
    await expect(lector.locator('.academy-titulo')).toHaveText('Glosario')
    await win.keyboard.press('Escape')
    await expect(lector, 'Esc cierra el lector').toHaveCount(0)
    await expect(ajustes, 'y Configuración sigue debajo').toBeVisible()
    await ajustes.locator('.academy-tarjeta[data-articulo="hibernar"]').click()
    const nativo = lector.locator('.academy-seccion .academy-enlace', { hasText: 'nativo' }).first()
    await expect(nativo).toHaveAttribute('title', /en su (equipo|Mac)/)
    await nativo.click()
    await expect(lector.locator('.academy-titulo')).toHaveText('Glosario')
    await expect(lector.locator('#academy-glosario-nativo')).toBeInViewport()
    await win.keyboard.press('Escape')

    // El buscador de Configuración encuentra artículos.
    await ajustes.locator('.ajustes-buscador input').fill('traspaso')
    await ajustes.locator('.academy-tarjeta[data-articulo="continuar-en-otro-agente"]').click()
    await expect(lector.locator('.academy-titulo')).toHaveText('Continuar en otro agente o cuenta')
    await win.keyboard.press('Escape')
    await expect(lector).toHaveCount(0)

    // Las migajas: el grupo lleva al índice, a ese grupo y resaltado; «Tessera Academy», al índice.
    await ajustes.locator('.ajustes-buscador input').fill('')
    await ajustes.locator('.academy-tarjeta[data-articulo="git"]').click()
    await lector.locator('.academy-migaja', { hasText: 'Código y terminales' }).click()
    await expect(lector, 'la migaja cierra el lector').toHaveCount(0)
    const grupoGit = ajustes.locator('#academy-grupo-codigo-y-terminales')
    await expect(grupoGit, 'y lleva a su grupo del índice').toBeInViewport()
    await expect(grupoGit, 'resaltado un momento').toHaveClass(/academy-destacada/)
    await ajustes.locator('.academy-tarjeta[data-articulo="git"]').click()
    await lector.locator('.academy-migaja', { hasText: 'Tessera Academy' }).click()
    await expect(lector).toHaveCount(0)
    await expect(ajustes.locator('.academy-tarjetas').first(), '«Tessera Academy» abre el índice').toBeVisible()
    await ajustes.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await expect(ajustes).toHaveCount(0)

    // El ⓘ de un diálogo abre el lector encima, en la sección que lo explica, sin Configuración.
    await pestana.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Reglas para los agentes…' }).click()
    const dialogo = win.locator('.contexto-modal')
    await expect(dialogo).toBeVisible()
    await dialogo.getByRole('button', { name: /Tessera Academy/ }).click()
    await expect(lector).toBeVisible()
    await expect(ajustes, 'no abre Configuración').toHaveCount(0)
    await expect(lector.locator('.academy-titulo')).toHaveText('Contexto de los agentes')
    await expect(lector.getByRole('button', { name: 'Cerrar', exact: true })).toHaveAttribute('title', 'Cerrar (Esc)')
    const encimaDelDialogo = await lector.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
    })
    expect(encimaDelDialogo, 'el lector queda encima del diálogo').toBe(true)
    const focoDentro = (): Promise<boolean> =>
      win.evaluate(() => document.querySelector('.academy-lector')?.contains(document.activeElement) === true)
    expect(await focoDentro(), 'el foco entra en el lector').toBe(true)
    await win.keyboard.press('Escape')
    await expect(lector, 'Esc cierra solo el lector').toHaveCount(0)
    await expect(dialogo, 'el diálogo de origen sigue abierto').toBeVisible()
    await win.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)

    // El agente propio abierto desde Configuración va en una capa propia por encima de ella: el
    // lector tiene que verse encima de esa capa, no detrás.
    await win.keyboard.press(`${MOD}+,`)
    await ajustes.locator('.ajustes-riel-item[data-cat="agentes"]').click()
    await ajustes.getByRole('button', { name: 'Añadir un agente propio (por su comando)…' }).click()
    const agenteNuevo = win.locator('.agman-modal')
    await agenteNuevo.getByRole('button', { name: /Tessera Academy/ }).click()
    await expect(lector).toBeVisible()
    const encima = await lector.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
    })
    expect(encima, 'el lector se ve encima del agente propio').toBe(true)
    await win.keyboard.press('Escape')
    await expect(lector).toHaveCount(0)
  } finally {
    await s?.cerrar()
  }
})
