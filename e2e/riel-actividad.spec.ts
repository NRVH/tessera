// =============================================================================
// El color del perfil en el riel de actividad, sobre la app empaquetada: marca la vista donde trabajas, y
// con el foco en el agente sigue en la que lo acompaña («Archivos», o «Terminal» a pantalla completa);
// «Cambios» no, porque allí no hay agente. La regla entera la fija `test-resaltado-riel.mts`.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

let s: SesionTessera
let agentes: AgenteFalso

/** El icono de una vista o panel del riel. */
const icono = (win: Page, nombre: string) => win.locator(`.activity-item[aria-label="${nombre}"]`)
/** El xterm del agente del proyecto a la vista. */
const agente = (win: Page) => win.locator('.agent-pane:not(.hidden) .xterm').first()

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
    const win = s.win
    // En el propio explorador: abrir un archivo pasaría el foco al editor.
    await win.locator('.sidebar .sidebar-header').first().click()
    await expect(icono(win, 'Archivos'), 'en el explorador').toHaveClass(/\benfocada\b/)
    await agente(win).click()
    await expect(icono(win, 'Archivos'), 'y en su agente').toHaveClass(/\benfocada\b/)
  })

  test('«Git · Cambios» no: allí no hay agente', async () => {
    const win = s.win
    const cambios = icono(win, 'Git · Cambios')
    await cambios.click()
    await agente(win).click()
    await expect(cambios).toHaveClass(/\bactive\b/)
    await expect(cambios).not.toHaveClass(/\benfocada\b/)
    await icono(win, 'Archivos').click()
  })

  test('con la terminal a pantalla completa, «Terminal» sigue con el color en el agente de la terminal', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    const panel = win.locator('section.terminal-panel')
    await expect(panel).toBeVisible()
    await panel.locator('.panel-header').first().hover()
    await panel.getByRole('button', { name: 'Maximizar el panel de terminal' }).click()
    // A pantalla completa el agente de esa vista es el de la terminal, que se enseña con su botón.
    await win.getByRole('button', { name: /^Mostrar el agente de la terminal/ }).click()
    await agente(win).click()
    await expect(icono(win, 'Terminal')).toHaveClass(/\benfocada\b/)
    await expect(icono(win, 'Archivos'), 'y la vista lateral, que no se ve, no').not.toHaveClass(/\benfocada\b/)
  })
})
