// =============================================================================
// El tooltip de la app (`comun/TooltipPropio.tsx`) sobre la app empaquetada: sale con el texto del
// `title` (también el de un botón desactivado, que va en su envoltorio), mientras está a la vista el
// `title` se guarda aparte para que el sistema no pinte el suyo, y vuelve al salir o al pulsar.
// La posición la fija `comun/test-posicion-tooltip.mts`. Agente falso (`agenteFalso.ts`).
// =============================================================================

import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, PLATAFORMA, type SesionTessera } from './tessera'

/** El `title` del botón: el acorde se escribe como en cada sistema. */
const TITULO = `Nueva consola (${PLATAFORMA === 'mac' ? '⌘N' : 'Ctrl+N'})`

test.describe.serial('El tooltip de la app', () => {
  let s: SesionTessera
  let agente: AgenteFalso

  test.beforeAll(async () => {
    agente = montarAgenteFalso()
    const proyecto = join(agente.raiz, 'p')
    mkdirSync(proyecto)
    const perfil = (JSON.parse(PERFILES_SIN_SANDBOX) as { id: string }[])[0].id
    s = await abrirTessera(agente.env, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: perfil,
            byProfile: { [perfil]: { openProjects: [{ projectHostPath: proyecto, name: 'p', estado: 'active' }], activePath: proyecto } },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`${perfil}|${proyecto}`] }
          })
        )
      }
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agente) await borrarTemporal(agente.raiz)
  })

  test('sale con el texto del title, el del sistema no (el title se guarda aparte), y al salir o pulsar vuelve', async () => {
    const win = s.win
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    const tip = win.locator('.tooltip-propio')
    const boton = win.locator('button[aria-label="Nueva consola"]').first()

    await boton.hover()
    await expect(tip, 'el texto del title').toHaveText(TITULO)
    await expect(boton, 'mientras se ve, sin title: el sistema no pinta el suyo').not.toHaveAttribute('title', /./)
    const caja = await tip.boundingBox()
    const ancla = await boton.boundingBox()
    expect(caja && ancla && caja.y >= ancla.y + ancla.height, 'debajo del botón').toBe(true)

    await win.mouse.move(5, 500)
    await expect(tip, 'al salir se va').toHaveCount(0)
    await expect(boton, 'y el title vuelve').toHaveAttribute('title', TITULO)

    // Un botón desactivado lleva su motivo en el envoltorio.
    await win.locator('button[aria-label="Refrescar"]').first().hover({ force: true })
    await expect(tip, 'el motivo del desactivado').toHaveText('Todavía no hay conexiones')

    // Teclear con el ratón encima quita la caja, pero el title sigue guardado: si volviera, el sistema
    // pintaría el suyo. Al salir, vuelve.
    await boton.hover()
    await expect(tip).toHaveText(TITULO)
    await win.keyboard.press('Shift')
    await expect(tip, 'al teclear se va').toHaveCount(0)
    await expect(boton, 'y el title sigue guardado').not.toHaveAttribute('title', /./)
    await win.mouse.move(5, 500)
    await expect(boton, 'hasta salir').toHaveAttribute('title', TITULO)

    // Barrer la barra sin pararse: el siguiente no sale de golpe (solo sale sin esperar tras uno que se vio).
    await win.waitForTimeout(500)
    await win.locator('button[aria-label="Nueva conexión"]').first().hover()
    await boton.hover()
    await win.waitForTimeout(250)
    await expect(tip, 'aún no: espera como el primero').toHaveCount(0)
    await expect(tip).toHaveText(TITULO)
    await win.mouse.move(5, 500)

    // Pulsar lo quita y deja el title en su sitio en el acto.
    await boton.hover()
    await expect(tip).toHaveText(TITULO)
    await win.mouse.down()
    await expect(tip, 'al pulsar se va').toHaveCount(0)
    await expect(boton, 'y el title ya está').toHaveAttribute('title', TITULO)
    await win.mouse.up()
    await win.keyboard.press('Escape')
  })
})
