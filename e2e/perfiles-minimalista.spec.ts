// =============================================================================
// El modo minimalista de perfiles sobre la app empaquetada: sin banda ni línea de color, una
// pastilla en la barra de título con el perfil activo; al pulsarla, la lista de perfiles con su ⋯
// (el menú de siempre, con sus diálogos en coordenadas de la ventana), cambiar de perfil desde ella
// y renombrar en la propia fila, donde un clic fuera guarda y Esc solo cancela la edición.
// Decisiones: docs/decisiones/renderer/banda-de-perfiles.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrirTessera, type SesionTessera } from './tessera'

const perfil = (id: string, nombre: string, color: string): Record<string, unknown> => ({
  id,
  nombre,
  color,
  agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
  sandbox: { habilitado: false }
})
const PERFILES = JSON.stringify([perfil('alfa', 'Perfil Alfa', '#9814c8'), perfil('beta', 'Perfil Beta', '#1f8f5a')])

function sembrar(datos: string, minimalista: boolean): void {
  writeFileSync(join(datos, 'profiles.json'), PERFILES)
  writeFileSync(join(datos, 'workspace-state.json'), JSON.stringify({ version: 1, activeProfileId: 'alfa', byProfile: {}, settings: { hideProfileNames: minimalista } }))
}

test('sin el modo, la banda de perfiles como siempre y ninguna pastilla', async () => {
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera({}, { sembrar: (d) => sembrar(d, false) })
    await expect(s.win.locator('.tabs-profiles .profile-tab')).toHaveCount(2, { timeout: 30_000 })
    await expect(s.win.locator('.selector-perfil')).toHaveCount(0)
  } finally {
    await s?.cerrar()
  }
})

test('modo minimalista: pastilla con el activo, lista con ⋯, cambiar y renombrar en la fila', async () => {
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera({}, { sembrar: (d) => sembrar(d, true) })
    const win = s.win
    const pastilla = win.locator('.titlebar .selector-perfil-pastilla')
    await expect(pastilla, 'la pastilla va en la barra de título con el perfil activo').toHaveText(/Perfil Alfa/, { timeout: 30_000 })
    await expect(win.locator('.tabs-profiles'), 'sin banda ni línea de color').toHaveCount(0)
    await expect(pastilla, 'solo el activo: ningún otro nombre a la vista').not.toContainText('Beta')

    await pastilla.click()
    const lista = win.getByRole('menu', { name: 'Perfiles' })
    await expect(lista.getByRole('menuitemradio')).toHaveCount(2)
    await expect(lista.getByRole('menuitemradio', { name: /Perfil Alfa/ })).toHaveAttribute('aria-checked', 'true')

    const mas = lista.getByRole('button', { name: 'Opciones de Perfil Beta' })
    await mas.click()
    await expect(win.getByRole('menuitem', { name: 'Cambiar color' }), 'el ⋯ abre el menú de siempre').toBeVisible()
    // El menú y los diálogos van en coordenadas de la ventana, no de la pastilla (centrada con `transform`).
    const cajaMas = await mas.boundingBox()
    const cajaMenu = await win.locator('.ctx-menu').boundingBox()
    expect(Math.abs((cajaMenu?.x ?? -999) - (cajaMas?.x ?? 0)), 'el menú sale junto a su ⋯').toBeLessThan(40)
    await win.getByRole('menuitem', { name: 'Eliminar perfil…' }).click()
    const velo = win.locator('.modal-overlay')
    await expect(velo).toBeVisible()
    const cajaVelo = await velo.boundingBox()
    const ventana = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    expect(cajaVelo, 'el diálogo cubre la ventana entera').toEqual({ x: 0, y: 0, width: ventana.w, height: ventana.h })
    await win.keyboard.press('Escape')
    await expect(velo).toHaveCount(0)
    if ((await lista.count()) === 0) await pastilla.click()

    await lista.getByRole('button', { name: 'Opciones de Perfil Beta' }).click()
    await win.getByRole('menuitem', { name: 'Renombrar' }).click()
    const input = lista.locator('.profile-rename-input')
    await expect(input, 'renombrar en la propia fila, sin desplegar la banda').toBeVisible()
    await input.fill('Perfil Gamma')
    await input.press('Enter')
    await expect(lista.getByRole('menuitemradio', { name: /Perfil Gamma/ })).toBeVisible()
    await expect(win.locator('.tabs-profiles'), 'y la banda sigue sin aparecer').toHaveCount(0)

    // Un clic fuera cierra la lista y guarda el nombre a medio escribir, como el `blur` de la banda.
    await lista.getByRole('button', { name: 'Opciones de Perfil Gamma' }).click()
    await win.getByRole('menuitem', { name: 'Renombrar' }).click()
    await input.fill('Perfil Delta')
    await win.mouse.click(ventana.w / 2, ventana.h / 2)
    await expect(lista, 'el clic fuera cierra la lista').toHaveCount(0)
    await pastilla.click()
    await expect(lista.getByRole('menuitemradio', { name: /Perfil Delta/ }), 'y el nombre quedó guardado').toBeVisible()
    await expect(input, 'sin una edición colgada al reabrir').toHaveCount(0)
    await lista.getByRole('button', { name: 'Opciones de Perfil Delta' }).click()
    await win.getByRole('menuitem', { name: 'Renombrar' }).click()
    await input.press('Escape')
    await expect(input, 'Esc cancela el renombrado').toHaveCount(0)
    await expect(lista, 'y deja la lista abierta').toBeVisible()

    await lista.getByRole('menuitemradio', { name: /Perfil Delta/ }).click()
    await expect(lista, 'elegir cierra la lista').toHaveCount(0)
    await expect(pastilla, 'y cambia el perfil activo').toHaveText(/Perfil Delta/)

    await pastilla.click()
    await expect(lista).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(lista, 'Esc la cierra').toHaveCount(0)
  } finally {
    await s?.cerrar()
  }
})
