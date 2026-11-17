// =============================================================================
// La pila de diálogos del historial de conversaciones sobre la app empaquetada: con el historial
// abierto, renombrar monta un diálogo ENCIMA, y un clic en su velo lo cierra y deja el historial
// abierto (su `onMouseDown` ya no burbujea al velo del padre). Una conversación de Claude Code
// sembrada en `CLAUDE_CONFIG_DIR`, proyecto nativo, agente falso (`agenteFalso.ts`). Esto es lo
// que solo se ve en el renderer de verdad.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, carpetasAgentes, type SesionTessera } from './tessera'

const ID = 'c1a0de00-0000-4000-8000-000000000001'

/** Perfil sin sandbox, un proyecto nativo y una conversación de Claude Code en él. */
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
  const carpeta = join(carpetasAgentes(datos).claude, 'projects', proyecto.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(carpeta, { recursive: true })
  const linea = (tipo: string, contenido: unknown): string =>
    JSON.stringify({
      type: tipo,
      sessionId: ID,
      cwd: proyecto,
      timestamp: '2026-09-20T10:00:00.000Z',
      message: { role: tipo, content: contenido }
    })
  writeFileSync(
    join(carpeta, `${ID}.jsonl`),
    `${linea('user', 'conversación de la prueba')}\n${linea('assistant', [{ type: 'text', text: 'hola' }])}\n`
  )
}

const HISTORIAL = '.conv-modal'

/** Abre el historial del agente a la vista. */
async function abrirHistorial(ventana: Page): Promise<void> {
  await ventana.locator('.agent-pane:not(.hidden) button[aria-label="Historial de conversaciones"]').first().click()
  await expect(ventana.locator(HISTORIAL)).toBeVisible()
  await expect(ventana.locator('.conv-item')).toHaveCount(1, { timeout: 15_000 })
}

test.describe('pila de diálogos del historial de conversaciones', () => {
  let s: SesionTessera
  let falso: AgenteFalso
  let proyecto = ''

  test.beforeAll(async () => {
    falso = montarAgenteFalso()
    proyecto = join(falso.raiz, 'alfa')
    mkdirSync(proyecto)
    writeFileSync(join(proyecto, 'LEEME.txt'), 'proyecto alfa\n')
    s = await abrirTessera(falso.env, { sembrar: (datos) => sembrar(datos, proyecto) })
    await expect(s.ventana.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  test('el clic en el velo del diálogo de encima no cierra también el historial', async () => {
    const ventana = s.ventana
    await abrirHistorial(ventana)
    await ventana.locator('.conv-item-rename').first().click()
    const prompt = ventana.getByRole('dialog', { name: 'Renombrar conversación', exact: true })
    await expect(prompt).toBeVisible()
    // Esquina del velo del diálogo de encima, lejos de su tarjeta.
    await ventana.locator('.modal-overlay').last().click({ position: { x: 4, y: 4 } })
    await expect(prompt).toHaveCount(0)
    await expect(ventana.locator(HISTORIAL), 'el historial sigue abierto').toBeVisible()
    await ventana.keyboard.press('Escape')
    await expect(ventana.locator(HISTORIAL)).toHaveCount(0)
  })
})
