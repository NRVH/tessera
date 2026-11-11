// =============================================================================
// Un perfil con Claude Code nativo en su panel, Codex nativo con límites y una cuenta de Codex en Docker sin sesión,
// para las pruebas de «Uso de las cuentas». Siembra credenciales inventadas y un rollout local; el uso de Claude Code
// viene de un servidor local. Comparte la preparación y la limpieza con la prueba de movimiento.
// =============================================================================
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, carpetasAgentes, PERFILES_SIN_SANDBOX } from './tessera'

/** No necesita contenedores: las dos sesiones de uso se leen en el equipo. */
export async function abrirUsoCuentas({ idioma = 'es', conMovimiento = false, nativaConDatos = true }: { idioma?: 'es' | 'en'; conMovimiento?: boolean; nativaConDatos?: boolean } = {}) {
  const servidor = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ limits: [
      { kind: 'session', group: 'session', percent: 16, resets_at: null, scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 42, resets_at: null, scope: null }
    ] }))
  })
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo))
  const agente = montarAgenteFalso()
  const proyecto = join(agente.raiz, 'proyecto')
  mkdirSync(proyecto)
  try {
    const s = await abrirTessera({ ...agente.env, TESSERA_FORZAR_IDIOMA: idioma, TESSERA_USO_CLAUDE: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/uso` }, {
      conMovimiento,
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(join(datos, 'workspace-state.json'), JSON.stringify({
          version: 1, activeProfileId: 'personal',
          byProfile: { personal: { openProjects: [{ projectHostPath: proyecto, name: 'proyecto', estado: 'active' }], activePath: proyecto } },
          settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`] }
        }))
        const carpetas = carpetasAgentes(datos)
        writeFileSync(join(carpetas.claude, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'token-inventado' } }))
        writeFileSync(join(carpetas.codex, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }))
        if (!nativaConDatos) return
        const sesiones = join(carpetas.codex, 'sessions', '2026', '11', '10')
        mkdirSync(sesiones, { recursive: true })
        const timestamp = new Date().toISOString()
        const reinicio = Math.floor(Date.now() / 1000) + 86400
        writeFileSync(join(sesiones, 'rollout-lince.jsonl'), [
          { timestamp, type: 'session_meta', payload: { session_id: 'lince' } },
          { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 1000 }, model_context_window: 258400 }, rate_limits: {
            limit_id: 'codex', primary: { used_percent: 6, window_minutes: 300, resets_at: reinicio }, secondary: { used_percent: 59, window_minutes: 10080, resets_at: reinicio }, plan_type: 'team'
          } } }
        ].map((fila) => JSON.stringify(fila)).join('\n') + '\n')
      }
    })
    await s.win.evaluate(async () => {
      await window.tessera.agentAccounts.create({ nombre: 'Nutria', agente: 'codex', profileId: 'personal' })
    })
    return { s, cerrar: async (): Promise<void> => {
      try { await s.cerrar() } finally {
        servidor.closeAllConnections()
        await new Promise<void>((listo) => servidor.close(() => listo()))
        await borrarTemporal(agente.raiz)
      }
    } }
  } catch (error) {
    servidor.closeAllConnections()
    await new Promise<void>((listo) => servidor.close(() => listo()))
    await borrarTemporal(agente.raiz)
    throw error
  }
}
