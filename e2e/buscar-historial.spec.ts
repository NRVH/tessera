// =============================================================================
// `tctx buscar` en la app empaquetada, sin Docker: un proyecto nativo con conversaciones sembradas de Claude Code
// y de Codex en las carpetas del agente falso. El agente arranca con el anuncio en su aviso, su token busca en las
// dos, y la terminal del proyecto (el atajo de `bin/s<N>` y el puente de verdad) imprime la coincidencia.
// Decisiones: docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, carpetasAgentes, MOD, type SesionTessera } from './tessera'

const ID_CLAUDE = 'c1a0de00-0000-4000-8000-0000000000b1'
const ID_CODEX = 'c0de0000-0000-4000-8000-0000000000b2'
const FRASE_CLAUDE = 'Decidimos usar la zarzamora como clave del caché'
const FRASE_CODEX = 'Repasé la ZARZAMORA desde Codex'
/** El `tctx` del repositorio: habla el mismo protocolo que el del paquete. */
const TCTX = resolve(process.cwd(), 'src', 'tctx', 'tctx.cjs')

/** Un perfil sin sandbox con el proyecto en modo nativo, y una conversación de cada agente en él. */
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
      byProfile: { personal: { openProjects: [{ projectHostPath: proyecto, name: 'proyecto', estado: 'active' }], activePath: proyecto } },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`], menuWindowsAvisado: true }
    })
  )
  const { claude, codex } = carpetasAgentes(datos)
  const carpeta = join(claude, 'projects', proyecto.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(carpeta, { recursive: true })
  const linea = (type: string, content: unknown): string =>
    JSON.stringify({ type, sessionId: ID_CLAUDE, cwd: proyecto, timestamp: '2026-10-01T10:00:00.000Z', message: { role: type, content } })
  writeFileSync(join(carpeta, `${ID_CLAUDE}.jsonl`), [linea('user', FRASE_CLAUDE), linea('assistant', [{ type: 'text', text: 'Anotado.' }])].join('\n') + '\n')
  const dia = join(codex, 'sessions', '2026', '10', '01')
  mkdirSync(dia, { recursive: true })
  writeFileSync(
    join(dia, `rollout-2026-10-01T09-00-00-${ID_CODEX}.jsonl`),
    [
      JSON.stringify({ type: 'session_meta', timestamp: '2026-10-01T09:00:00.000Z', payload: { session_id: ID_CODEX, cwd: proyecto } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-10-01T09:00:01.000Z', payload: { type: 'agent_message', message: FRASE_CODEX } })
    ].join('\n') + '\n'
  )
}

/** Deja que React confirme el render provocado por el gesto. */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Cuántas veces sale `texto` en el búfer de la terminal que se ve, con su buscador. */
async function contarEnTerminal(win: Page, texto: string): Promise<number> {
  const pane = win.locator('section.terminal-panel .terminal-pane[aria-hidden="false"]')
  await pane.locator('.xterm-screen').click()
  await win.keyboard.press(`${MOD}+f`)
  const buscador = pane.locator('.search-box')
  await expect(buscador).toBeVisible()
  const entrada = buscador.locator('.search-box-input')
  await entrada.fill(texto)
  await entrada.press('Enter')
  const etiqueta = await buscador.locator('.search-box-count').innerText()
  await buscador.getByRole('button', { name: 'Cerrar buscador' }).click()
  const m = /(\d+) coincidencias|\d+ \/ (\d+)/.exec(etiqueta)
  return m ? Number(m[1] ?? m[2]) : 0
}

test('tctx buscar: el aviso lo anuncia, el agente nativo y la terminal encuentran lo hablado con los dos agentes', async () => {
  const agente = montarAgenteFalso()
  const proyecto = join(agente.raiz, 'proyecto')
  mkdirSync(proyecto)
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera(agente.env, { sembrar: (datos) => sembrar(datos, proyecto) })
    const win = s.win
    await expect(win.locator('.profile-tab[data-perfil-id="personal"]')).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => agente.arranques('claude').at(-1)?.argv ?? [], { message: 'Claude Code arranca', timeout: 30_000 }).toContain(ID_CLAUDE)
    const claude = agente.arranques('claude').at(-1)!
    expect(claude.argv?.some((a) => a.includes('tctx buscar')), 'su aviso de arranque anuncia tctx buscar').toBe(true)

    // Como lo correría el agente: con su puente y su token. Nativo: las dos bases del sistema.
    const env: NodeJS.ProcessEnv = { ...process.env, TESSERA_DB_PIPE: claude.pipe!, TESSERA_DB_SESSION: claude.sesion!, TESSERA_IDIOMA: 'es' }
    const r = spawnSync(process.execPath, [TCTX, 'buscar', 'zarzamora'], { env, encoding: 'utf8', timeout: 30_000 })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('2 coincidencias')
    expect(r.stdout).toContain(FRASE_CLAUDE)
    expect(r.stdout).toContain(FRASE_CODEX)
    expect(r.stdout).toContain('Claude Code · Nativa')
    expect(r.stdout).toContain('Codex · Nativa')

    // La terminal del proyecto es el usuario: busca igual, con el atajo del PATH.
    await win.getByRole('button', { name: 'Terminal' }).click()
    await expect(win.locator('section.terminal-panel .terminal-tab')).toHaveCount(1)
    await win.locator('section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm-screen').click()
    await asentar(win)
    await win.keyboard.type('tctx buscar zarzamora clave')
    await win.keyboard.press('Enter')
    // La frase sale dos veces (en el título y en el trozo); la cabecera del resultado, una.
    await expect.poll(() => contarEnTerminal(win, '1 coincidencia en las conversaciones'), { message: 'la terminal imprime la coincidencia', timeout: 30_000 }).toBe(1)
    expect(await contarEnTerminal(win, 'Decidimos usar la')).toBeGreaterThan(0)
  } finally {
    await s?.cerrar()
    await borrarTemporal(agente.raiz)
  }
})
