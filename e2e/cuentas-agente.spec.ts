// =============================================================================
// El selector de cuenta del agente con cuentas de Docker, sin Docker: se crean por IPC y el agente
// sigue nativo, así que solo se listan y nada levanta un contenedor. Fija renombrar (con el rechazo
// de un nombre repetido a la vista y sin salir de la edición) y que eliminar desde el diálogo deja el
// selector abierto con la lista ya sin ella, para seguir administrando o eligiendo.
// =============================================================================

import { expect, test } from '@playwright/test'
import { abrirHumo, cerrarHumo, filaArbol } from './humoAyudas'

type ApiCuentas = {
  getProfiles: () => Promise<{ id: string }[]>
  agentAccounts: { create: (r: { nombre: string; agente: string; profileId: string }) => Promise<unknown> }
}

test('renombrar y eliminar cuentas de Docker desde el selector, que sigue abierto', async () => {
  const { s, m } = await abrirHumo()
  try {
    const win = s.win
    await expect(filaArbol(win, 'src')).toBeVisible({ timeout: 30_000 })
    await win.evaluate(async () => {
      const t = (window as unknown as { tessera: ApiCuentas }).tessera
      const profileId = (await t.getProfiles())[0]?.id ?? ''
      await t.agentAccounts.create({ nombre: 'Trabajo', agente: 'claude-code', profileId })
      await t.agentAccounts.create({ nombre: 'Personal', agente: 'claude-code', profileId })
    })
    await win.locator('.agent-pane:not(.hidden) .cuenta-btn').first().click()
    const pop = win.locator('.cuenta-pop')
    const tarjeta = (nombre: string): ReturnType<typeof pop.locator> => pop.locator('.cuenta-tarjeta', { hasText: nombre })
    await expect(tarjeta('Trabajo')).toHaveCount(1)

    // Renombrar: un nombre repetido se rechaza con el motivo y la tarjeta sigue en edición.
    await tarjeta('Trabajo').hover()
    await pop.getByRole('button', { name: 'Renombrar "Trabajo"' }).click()
    const campo = pop.locator('.cuenta-tarjeta-campo')
    await campo.fill('personal')
    await campo.press('Enter')
    await expect(pop.locator('.cuenta-tarjeta-error'), 'el motivo, a la vista').toContainText('personal')
    await expect(campo, 'sigue editándose').toBeVisible()
    await campo.fill('Oficina')
    await campo.press('Enter')
    await expect(tarjeta('Oficina')).toHaveCount(1)
    await expect(tarjeta('Trabajo')).toHaveCount(0)

    // Escape en el campo solo cancela la edición: el selector no se cierra.
    await tarjeta('Oficina').hover()
    await pop.getByRole('button', { name: 'Renombrar "Oficina"' }).click()
    await campo.press('Escape')
    await expect(campo).toHaveCount(0)
    await expect(pop).toBeVisible()

    // Eliminar: el diálogo va encima y, al terminar, el selector sigue abierto y ya sin ella.
    await tarjeta('Oficina').hover()
    await pop.getByRole('button', { name: 'Eliminar "Oficina"…' }).click()
    await win.locator('.modal-card button.danger').click()
    await expect(win.locator('.modal-card')).toHaveCount(0)
    await expect(tarjeta('Oficina')).toHaveCount(0)
    await expect(pop, 'el selector sigue abierto tras eliminar').toBeVisible()
    await expect(tarjeta('Personal')).toHaveCount(1)
  } finally {
    await cerrarHumo(s, m)
  }
})
