// =============================================================================
// El modo minimalista de perfiles sobre la app empaquetada: sin banda ni línea de color, una
// pastilla en la barra de título con el perfil activo; al pulsarla, la lista de perfiles con su ⋯
// (el menú de siempre, con sus diálogos en coordenadas de la ventana), cambiar de perfil desde ella
// y renombrar en la propia fila, donde un clic fuera guarda y Esc solo cancela la edición. La lista
// se reordena arrastrando y la banda queda en ese orden: es uno solo.
// Decisiones: docs/decisiones/renderer/banda-de-perfiles.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { abrirTessera, carpetaSshPruebas, type SesionTessera } from './tessera'

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

test('claves SSH del perfil: seleccionar, guardar, persistir y caber en 900×620', async () => {
  let sesion: SesionTessera | null = null
  try {
    sesion = await abrirTessera({}, { sembrar: (datos) => {
      sembrar(datos, false)
      const carpeta = carpetaSshPruebas(datos)
      const lineas: string[] = []
      for (let indice = 0; indice < 20; indice++) {
        const nombre = `id_prueba_${indice}_nombre_largo_para_comprobar_el_recorte`
        execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(carpeta, nombre)], { windowsHide: true })
        lineas.push(`Host alias_de_prueba_${indice}_con_nombre_largo\n IdentityFile ~/.ssh/${nombre}`)
      }
      writeFileSync(join(carpeta, 'config'), lineas.join('\n'))
      const perfiles = JSON.parse(PERFILES)
      perfiles[0].clavesSshPermitidas = []
      writeFileSync(join(datos, 'profiles.json'), JSON.stringify(perfiles))
    } })
    const { app, win, datos } = sesion
    await app.evaluate(({ BrowserWindow }) => {
      const ventana = BrowserWindow.getAllWindows()[0]
      ventana.unmaximize()
      ventana.setContentSize(900, 620)
    })
    const abrir = async (): Promise<void> => {
      await win.locator('.profile-tab[data-perfil-id="alfa"]').click({ button: 'right' })
      await win.getByRole('menuitem', { name: 'Agentes en Docker' }).click()
      await win.getByRole('menuitem', { name: 'Claves SSH…' }).click()
    }
    await abrir()
    const dialogo = win.getByRole('dialog', { name: 'Claves SSH de los agentes en Docker · Perfil Alfa' })
    await expect(dialogo.getByRole('switch')).toHaveCount(20)
    await expect(dialogo.getByRole('checkbox'), 'interruptores de Configuración, no casillas').toHaveCount(0)
    const interruptor = dialogo.getByRole('switch', { name: /id_prueba_0_/ })
    await expect(interruptor).toHaveAttribute('aria-checked', 'false')
    await interruptor.click()
    expect(await win.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true)
    const caja = await dialogo.boundingBox()
    expect(caja!.x).toBeGreaterThanOrEqual(0)
    expect(caja!.y + caja!.height).toBeLessThanOrEqual(620)
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect.poll(() => JSON.parse(readFileSync(join(datos, 'profiles.json'), 'utf8'))[0].clavesSshPermitidas).toContain(join(carpetaSshPruebas(datos), 'id_prueba_0_nombre_largo_para_comprobar_el_recorte'))
    await abrir()
    await expect(dialogo.getByRole('switch', { name: /id_prueba_0_/ })).toHaveAttribute('aria-checked', 'true')
    // Una línea por clave: todas las filas miden lo mismo, y la lista se desplaza en vez de hacer crecer la ventana.
    const alturas = await dialogo.locator('.claves-agente-fila').evaluateAll((filas) => filas.map((fila) => Math.round(fila.getBoundingClientRect().height)))
    expect(new Set(alturas).size, `filas de una sola línea: ${JSON.stringify([...new Set(alturas)])}`).toBe(1)
    expect(await dialogo.locator('.claves-agente-lista').evaluate((lista) => lista.scrollHeight > lista.clientHeight)).toBe(true)
    const nombre = dialogo.locator('.claves-agente-nombre').first()
    expect(await nombre.evaluate((n) => n.scrollWidth > n.clientWidth), 'el nombre largo se recorta').toBe(true)
    await dialogo.locator('.claves-agente-fila').first().hover()
    await expect(win.getByRole('tooltip'), 'el tooltip lleva el nombre entero y los alias').toContainText('nombre_largo_para_comprobar_el_recorte')
    await expect(win.getByRole('tooltip')).toContainText('alias_de_prueba_0_con_nombre_largo')
    expect(await win.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true)
    if (process.env.TESSERA_E2E_CAPTURAS) await win.screenshot({ path: join(process.env.TESSERA_E2E_CAPTURAS, 'claves-ssh.png') })
  } finally { await sesion?.cerrar() }
})

test('modo minimalista: la lista se reordena arrastrando y la banda sale en ese mismo orden', async () => {
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera({}, { sembrar: (d) => sembrar(d, true) })
    const win = s.win
    const pastilla = win.locator('.titlebar .selector-perfil-pastilla')
    await expect(pastilla).toHaveText(/Perfil Alfa/, { timeout: 30_000 })
    await pastilla.click()
    const filas = win.getByRole('menu', { name: 'Perfiles' }).getByRole('menuitemradio')
    await expect(filas, 'el orden de la banda').toHaveText([/Perfil Alfa/, /Perfil Beta/])

    await win.locator('.selector-perfil-fila', { hasText: 'Perfil Alfa' }).dragTo(win.locator('.selector-perfil-fila', { hasText: 'Perfil Beta' }))
    await expect(filas, 'Alfa pasa detrás de Beta').toHaveText([/Perfil Beta/, /Perfil Alfa/])
    await expect(pastilla, 'reordenar no cambia de perfil').toHaveText(/Perfil Alfa/)

    await win.keyboard.press('Escape')
    await win.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+,`)
    await win.locator('.ajustes-riel-item[data-cat="apariencia"]').click()
    await win.getByRole('switch', { name: 'Perfiles en un selector compacto' }).click()
    await win.keyboard.press('Escape')
    await expect(win.locator('.tabs-profiles .profile-tab'), 'la banda, con el orden de la lista').toHaveText([/Perfil Beta/, /Perfil Alfa/])
  } finally {
    await s?.cerrar()
  }
})

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

    const mas = lista.getByRole('button', { name: 'Más acciones de «Perfil Beta»', exact: true })
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

    await lista.getByRole('button', { name: 'Más acciones de «Perfil Beta»', exact: true }).click()
    await win.getByRole('menuitem', { name: 'Renombrar' }).click()
    const input = lista.locator('.profile-rename-input')
    await expect(input, 'renombrar en la propia fila, sin desplegar la banda').toBeVisible()
    await input.fill('Perfil Gamma')
    await input.press('Enter')
    await expect(lista.getByRole('menuitemradio', { name: /Perfil Gamma/ })).toBeVisible()
    await expect(win.locator('.tabs-profiles'), 'y la banda sigue sin aparecer').toHaveCount(0)

    // Un clic fuera cierra la lista y guarda el nombre a medio escribir, como el `blur` de la banda.
    await lista.getByRole('button', { name: 'Más acciones de «Perfil Gamma»', exact: true }).click()
    await win.getByRole('menuitem', { name: 'Renombrar' }).click()
    await input.fill('Perfil Delta')
    await win.mouse.click(ventana.w / 2, ventana.h / 2)
    await expect(lista, 'el clic fuera cierra la lista').toHaveCount(0)
    await pastilla.click()
    await expect(lista.getByRole('menuitemradio', { name: /Perfil Delta/ }), 'y el nombre quedó guardado').toBeVisible()
    await expect(input, 'sin una edición colgada al reabrir').toHaveCount(0)
    await lista.getByRole('button', { name: 'Más acciones de «Perfil Delta»', exact: true }).click()
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
