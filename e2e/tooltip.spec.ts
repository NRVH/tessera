// =============================================================================
// El tooltip de la app (`comun/TooltipPropio.tsx`) sobre la app empaquetada: sale con el texto del
// `title` (también el de un botón desactivado, que va en su envoltorio), mientras está a la vista el
// `title` se guarda aparte para que el sistema no pinte el suyo, y vuelve al salir o al pulsar. Cada uno
// espera a que el ratón se detenga y no sale si repite lo que ya se lee. La posición la fija `comun/test-posicion-tooltip.mts`. Agente falso (`agenteFalso.ts`).
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
    const ventana = s.ventana
    await ventana.locator('.activity-item[title="Bases de datos"]').click()
    const avisoEmergente = ventana.locator('.tooltip-propio')
    const boton = ventana.locator('button[aria-label="Nueva consola"]').first()

    await boton.hover()
    await expect(avisoEmergente, 'el texto del title').toHaveText(TITULO)
    await expect(boton, 'mientras se ve, sin title: el sistema no pinta el suyo').not.toHaveAttribute('title', /./)
    const caja = await avisoEmergente.boundingBox()
    const ancla = await boton.boundingBox()
    expect(caja && ancla && caja.y >= ancla.y + ancla.height, 'debajo del botón').toBe(true)

    await ventana.mouse.move(5, 500)
    await expect(avisoEmergente, 'al salir se va').toHaveCount(0)
    await expect(boton, 'y el title vuelve').toHaveAttribute('title', TITULO)

    // Un botón desactivado lleva su motivo en el envoltorio.
    // El de BD: el explorador, visto antes, sigue montado y oculto con su propio «Refrescar».
    await ventana.locator('.db-arbol button[aria-label="Refrescar"]:visible').first().hover({ force: true })
    await expect(avisoEmergente, 'el motivo del desactivado').toHaveText('Todavía no hay conexiones')

    // Teclear con el ratón encima quita la caja, pero el title sigue guardado: si volviera, el sistema
    // pintaría el suyo. Al salir, vuelve.
    await boton.hover()
    await expect(avisoEmergente).toHaveText(TITULO)
    await ventana.keyboard.press('Shift')
    await expect(avisoEmergente, 'al teclear se va').toHaveCount(0)
    await expect(boton, 'y el title sigue guardado').not.toHaveAttribute('title', /./)
    await ventana.mouse.move(5, 500)
    await expect(boton, 'hasta salir').toHaveAttribute('title', TITULO)

    // Pasar de uno que se ve al de al lado: tampoco se encadena, el siguiente espera como el primero.
    await boton.hover()
    await expect(avisoEmergente).toHaveText(TITULO)
    await ventana.locator('button[aria-label="Nueva conexión"]').first().hover()
    await ventana.waitForTimeout(250)
    await expect(avisoEmergente, 'aún no: espera como el primero').toHaveCount(0)
    await expect(avisoEmergente).not.toHaveCount(0)
    await ventana.mouse.move(5, 500)
    await expect(avisoEmergente).toHaveCount(0)

    // Un título que solo repite el texto que ya se lee no sale.
    await ventana.locator('.profile-tab-name').first().hover()
    await ventana.waitForTimeout(900)
    await expect(avisoEmergente, 'el nombre del perfil ya se lee').toHaveCount(0)
    await ventana.mouse.move(5, 500)

    // Pulsar lo quita y deja el title en su sitio en el acto.
    await boton.hover()
    await expect(avisoEmergente).toHaveText(TITULO)
    await ventana.mouse.down()
    await expect(avisoEmergente, 'al pulsar se va').toHaveCount(0)
    await expect(boton, 'y el title ya está').toHaveAttribute('title', TITULO)
    await ventana.mouse.up()
    await ventana.keyboard.press('Escape')
  })
})
