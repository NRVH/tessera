// =============================================================================
// El estado que el agente informa por su salida (OSC 7501) sobre la app empaquetada: el main
// contesta a su sonda, y desde entonces el punto del perfil dice lo que dice el agente
// (trabaja, te espera, terminó), sin que la campana ni el silencio lo cambien. Lo puro lo
// fijan `test-estado-programa.mts` y `test-agent-activity-tracker.mts`; aquí, la cadena entera:
// pty → main → IPC → renderer. Agente falso (`agenteFalso.ts`) con `informa`.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

/** Un perfil sin sandbox con un proyecto NATIVO abierto. */
function sembrar(datos: string, proyecto: string): void {
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify([
      {
        id: 'personal',
        nombre: 'Personal',
        color: '#9814c8',
        agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }],
        sandbox: { habilitado: false }
      }
    ])
  )
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: { personal: { openProjects: [{ projectHostPath: proyecto, name: 'alfa', estado: 'active' }], activePath: proyecto } },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`] }
    })
  )
}

/** Escribe una línea en el agente a la vista y la ENVÍA. */
async function enviarAlAgente(win: Page, texto: string): Promise<void> {
  await win.locator('.agent-pane:not(.hidden) .xterm-screen').first().click()
  await win.keyboard.type(texto)
  await win.keyboard.press('Enter')
}

test.describe.serial('El agente informa su estado', () => {
  let s: SesionTessera
  let agente: AgenteFalso

  test.beforeAll(async () => {
    agente = montarAgenteFalso()
    agente.informa(true)
    const proyecto = join(agente.raiz, 'alfa')
    mkdirSync(proyecto)
    writeFileSync(join(proyecto, 'LEEME.txt'), 'alfa\n')
    s = await abrirTessera(agente.env, { sembrar: (datos) => sembrar(datos, proyecto) })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agente) await borrarTemporal(agente.raiz)
  })

  test('el main contesta la sonda y el punto del perfil sigue al agente: trabaja, te espera, terminó', async () => {
    const win = s.win
    const punto = win.locator('.profile-tab-dot').first()
    await expect.poll(() => agente.eventos().some((e) => e.tipo === 'sonda'), { timeout: 60_000, message: 'el agente recibe la respuesta a su sonda' }).toBe(true)

    await enviarAlAgente(win, 'osc:state=idle:app=claude-code')
    await enviarAlAgente(win, 'osc:state=working:app=claude-code')
    await expect(punto, 'el agente dice que trabaja: el punto late').toHaveClass(/\bworking\b/)

    // Informado, una campana suelta ya no cierra el turno: lo dice el agente.
    await enviarAlAgente(win, 'fin')
    await expect.poll(() => agente.eventos().some((e) => e.tipo === 'campana')).toBe(true)
    await win.waitForTimeout(1500)
    await expect(punto, 'la campana no lo apaga').toHaveClass(/\bworking\b/)

    await enviarAlAgente(win, 'osc:state=blocked:app=claude-code:kind=question')
    await expect(punto, 'te espera: el anillo').toHaveClass(/\besperando\b/)
    await expect(punto).toHaveAttribute('title', 'Un agente te está esperando')
    await expect
      .poll(async () => (await win.evaluate(() => window.tessera.agentesNativos.estado())).sesiones.some((x) => x.esperandoRespuesta), {
        message: 'el main también lo sabe (veta la hibernación y el reinicio)'
      })
      .toBe(true)

    await enviarAlAgente(win, 'osc:state=working:app=claude-code')
    await expect(punto, 'contestada, vuelve a trabajar').toHaveClass(/\bworking\b/)
    await enviarAlAgente(win, 'osc:state=done:app=claude-code')
    await expect(punto, 'terminó delante de ti: ni late, ni espera, ni brilla').not.toHaveClass(/\b(working|esperando|attention)\b/)
  })
})
