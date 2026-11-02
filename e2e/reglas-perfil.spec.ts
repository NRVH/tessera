// =============================================================================
// Las reglas de un perfil para sus agentes, en la app empaquetada: «Reglas para los agentes…» abre el
// diálogo del perfil, lo escrito se guarda en el perfil (lo ve el main) y sigue al reabrir; pasado el
// tope el contador se pone en rojo y no deja guardar; dejarlo vacío quita el campo.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrirTessera, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const REGLAS = "Sube siempre a la rama de trabajo.\nNunca a la principal, que es de O'Brien."

test('reglas del perfil: escribir, guardar, reabrir, tope y vaciar', async () => {
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX) })
    const win = s.win
    const pestana = win.locator('.profile-tab[data-perfil-id="personal"]')
    await expect(pestana).toBeVisible({ timeout: 30_000 })
    /** Las reglas del perfil «personal» tal como las guardó el main. */
    const guardadas = (): Promise<string | null> =>
      win.evaluate(async () => (await window.tessera.getProfiles()).find((p) => p.id === 'personal')?.reglas ?? null)
    const abrir = async (): Promise<void> => {
      await pestana.click({ button: 'right' })
      await win.getByRole('menuitem', { name: 'Reglas para los agentes…' }).click()
    }
    const dialogo = win.getByRole('dialog', { name: /Reglas del perfil/ })
    const texto = dialogo.getByRole('textbox', { name: 'Reglas' })

    await abrir()
    await expect(dialogo).toBeVisible()
    await expect(texto, 'sin reglas, parte vacío').toHaveValue('')
    await texto.fill(REGLAS)
    await dialogo.getByRole('button', { name: 'Guardar' }).click()
    await expect(dialogo, 'Guardar cierra el diálogo').toHaveCount(0)
    await expect.poll(guardadas, { message: 'el perfil persistido trae las reglas', timeout: 10_000 }).toBe(REGLAS)

    await abrir()
    await expect(texto, 'al reabrir siguen').toHaveValue(REGLAS)

    await texto.fill('x'.repeat(6001))
    await expect(dialogo.getByTestId('reglas-contador'), 'pasado el tope, el contador avisa').toContainText('6001 / 6000')
    await expect(dialogo.getByRole('button', { name: 'Guardar' }), 'y no deja guardar').toBeDisabled()
    await win.keyboard.press('Escape')
    await expect(dialogo, 'Esc cierra').toHaveCount(0)
    expect(await guardadas(), 'cancelar no cambia lo guardado').toBe(REGLAS)

    await abrir()
    await texto.fill('  \n ')
    await dialogo.getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(guardadas, { message: 'vacío quita el campo', timeout: 10_000 }).toBeNull()
  } finally {
    await s?.cerrar()
  }
})
