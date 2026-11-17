// =============================================================================
// El contexto de los agentes, en la app empaquetada: «Reglas para los agentes…» abre el diálogo en las reglas del
// perfil; lo escrito se guarda en el perfil (lo ve el main) y sigue al reabrir; pasado el tope el contador avisa y
// no deja guardar; cambiar de nivel con cambios pide confirmarlo; las reglas globales se guardan en el main; el
// interruptor del global se guarda en el perfil, y el resumen (lo que recibe un agente) enseña las dos.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrirTessera, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const REGLAS = "Sube siempre a la rama de trabajo.\nNunca a la principal, que es de O'Brien."
const GLOBALES = 'Responde siempre en español.'

test('contexto de los agentes: reglas del perfil y globales, tope, confirmación y lo que recibe', async () => {
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX) })
    const ventana = s.ventana
    const pestana = ventana.locator('.profile-tab[data-perfil-id="personal"]')
    await expect(pestana).toBeVisible({ timeout: 30_000 })
    const perfil = (): Promise<{ reglas: string | null; global: boolean }> =>
      ventana.evaluate(async () => {
        const p = (await window.tessera.obtenerPerfiles()).find((x) => x.id === 'personal')
        return { reglas: p?.reglas ?? null, global: p?.contextoGlobal !== false }
      })
    const globales = (): Promise<string> => ventana.evaluate(async () => (await window.tessera.contextoGlobal.leer()).reglas)

    await pestana.click({ button: 'right' })
    await ventana.getByRole('menuitem', { name: 'Reglas para los agentes…' }).click()
    const dialogo = ventana.getByRole('dialog', { name: 'Contexto de los agentes' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByRole('tab', { name: 'Reglas', exact: true }), 'se abre en las reglas').toHaveAttribute('aria-selected', 'true')
    const texto = dialogo.getByTestId('contexto-reglas')
    const guardar = dialogo.getByRole('button', { name: 'Guardar', exact: true })
    await expect(texto, 'sin reglas, parte vacío').toHaveValue('')
    await expect(guardar, 'sin cambios no hay nada que guardar').toBeDisabled()

    await texto.fill(REGLAS)
    await guardar.click()
    await expect(dialogo.locator('.boton-guardar.ok'), 'el botón confirma en sí mismo').toHaveAttribute('aria-label', 'Guardado')
    await expect(dialogo.getByRole('status').filter({ hasText: 'Guardado' }), 'y el lector de pantalla lo oye').toBeAttached()
    await expect.poll(async () => (await perfil()).reglas, { message: 'el perfil persistido trae las reglas', timeout: 10_000 }).toBe(REGLAS)

    await texto.fill('x'.repeat(6001))
    await expect(dialogo.getByTestId('reglas-contador'), 'pasado el tope, el contador avisa').toContainText('6001 de 6000')
    await expect(guardar, 'y no deja guardar').toBeDisabled()

    // Ir a otro nivel con cambios a medias pide confirmarlo; descartar no guarda.
    await dialogo.getByRole('tab', { name: /^Global/ }).click()
    await expect(dialogo.getByText('Hay cambios sin guardar.')).toBeVisible()
    await dialogo.getByRole('button', { name: 'Descartar los cambios' }).click()
    await expect(dialogo.getByText('Contexto global', { exact: true })).toBeVisible()
    expect((await perfil()).reglas, 'descartar no cambia lo guardado').toBe(REGLAS)

    await dialogo.getByTestId('contexto-reglas').fill(GLOBALES)
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect.poll(globales, { message: 'el main guarda las reglas globales', timeout: 10_000 }).toBe(GLOBALES)

    await dialogo.getByRole('tab', { name: /^Personal/ }).click()
    await dialogo.getByRole('button', { name: 'Resumen', exact: true }).click()
    const recibe = dialogo.getByTestId('contexto-recibe')
    await expect(recibe, 'recibe las globales').toContainText(GLOBALES)
    await expect(recibe, 'y las del perfil').toContainText('Sube siempre a la rama de trabajo.')

    // El resumen es de solo lectura: se cierra para volver a configurar.
    await dialogo.getByRole('button', { name: 'Cerrar el resumen' }).click()
    await expect(recibe).toHaveCount(0)
    await dialogo.getByRole('switch', { name: 'Usar el contexto global en este perfil' }).click()
    await expect.poll(async () => (await perfil()).global, { message: 'el perfil deja de usar el global', timeout: 10_000 }).toBe(false)
    await dialogo.getByRole('button', { name: 'Resumen', exact: true }).click()
    await expect(recibe, 'y ya no recibe las globales').not.toContainText(GLOBALES)
    await expect(recibe).toContainText('Este perfil no usa el contexto global.')

    await dialogo.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
  } finally {
    await s?.cerrar()
  }
})
