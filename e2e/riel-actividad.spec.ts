// =============================================================================
// El color del perfil en el riel de actividad, sobre la app empaquetada: marca la vista donde trabajas, y
// con el foco en el agente sigue en la que lo acompaña («Archivos»); «Cambios» no, porque allí no hay
// agente. La regla entera la fija `test-resaltado-riel.mts`.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

let s: SesionTessera
let agentes: AgenteFalso

/** El icono de una vista o panel del riel. */
const icono = (ventana: Page, nombre: string) => ventana.locator(`.activity-item[aria-label="${nombre}"]`)
/** El xterm del agente del proyecto a la vista. */
const agente = (ventana: Page) => ventana.locator('.agent-pane:not(.hidden) .xterm').first()

test.describe.serial('El color del perfil en el riel de actividad', () => {
  test.beforeAll(async () => {
    agentes = montarAgenteFalso()
    const repo = join(agentes.raiz, 'repo')
    mkdirSync(repo)
    writeFileSync(join(repo, 'LEEME.txt'), 'hola\n')
    s = await abrirTessera(agentes.env, {
      sembrar: (datos) => {
        writeFileSync(
          join(datos, 'profiles.json'),
          JSON.stringify([{ id: 'personal', nombre: 'Personal', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }], sandbox: { habilitado: false } }])
        )
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: 'personal',
            byProfile: { personal: { openProjects: [{ projectHostPath: repo, name: 'repo', estado: 'active' }], activePath: repo } },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${repo}`] }
          })
        )
      }
    })
    await expect.poll(() => agentes.arranques().length, { timeout: 60_000 }).toBe(1)
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agentes) await borrarTemporal(agentes.raiz)
  })

  test('«Archivos» sigue con el color mientras escribes en el agente del proyecto', async () => {
    const ventana = s.ventana
    // En el propio explorador: abrir un archivo pasaría el foco al editor.
    await ventana.locator('.sidebar .sidebar-header').first().click()
    await expect(icono(ventana, 'Archivos'), 'en el explorador').toHaveClass(/\benfocada\b/)
    await agente(ventana).click()
    await expect(icono(ventana, 'Archivos'), 'y en su agente').toHaveClass(/\benfocada\b/)
  })

  test('«Git · Cambios» no: allí no hay agente', async () => {
    const ventana = s.ventana
    const cambios = icono(ventana, 'Git · Cambios')
    await cambios.click()
    await agente(ventana).click()
    await expect(cambios).toHaveClass(/\bactive\b/)
    await expect(cambios).not.toHaveClass(/\benfocada\b/)
    await icono(ventana, 'Archivos').click()
  })
})
