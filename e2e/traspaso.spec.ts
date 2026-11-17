// =============================================================================
// «Continuar en…» en la app empaquetada, con el agente falso: de Claude Code a Codex, el botón de la cabecera
// abre Codex con su primer mensaje y `tctx traspaso` (con el puente y el token de esa sesión) da lo último de la
// conversación; con el mismo agente, la conversación se copia a la carpeta de otra cuenta donde la busca
// Claude Code en Docker (sin Docker: la copia por IPC, sin abrir el contenedor).
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { montarAgenteFalso, type AgenteFalso, type EventoFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, carpetasAgentes, type SesionTessera } from './tessera'

const ID = 'c1a0de00-0000-4000-8000-0000000000aa'
const PROMPT = 'Continúas un trabajo que empezó Claude Code. Lee el traspaso con `tctx traspaso`, resume en 5 líneas dónde quedó y espera instrucciones.'
/** El `tctx` del repositorio: habla el mismo protocolo que el del paquete. */
const TCTX = resolve(process.cwd(), 'src', 'tctx', 'tctx.cjs')

/** Un perfil sin sandbox con los dos agentes, el proyecto abierto y una conversación de Claude Code en él. */
function sembrar(datos: string, proyecto: string): void {
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify([
      {
        id: 'personal',
        nombre: 'Personal',
        color: '#9814c8',
        agentes: [
          { tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' },
          { tipo: 'codex', configDir: './.tessera/perfiles/personal/codex' }
        ],
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
      settings: { menuWindowsAvisado: true }
    })
  )
  const carpeta = join(carpetasAgentes(datos).claude, 'projects', proyecto.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(carpeta, { recursive: true })
  const linea = (tipo: string, contenido: unknown): string =>
    JSON.stringify({ type: tipo, sessionId: ID, cwd: proyecto, timestamp: '2026-10-01T10:00:00.000Z', message: { role: tipo, content: contenido } })
  writeFileSync(
    join(carpeta, `${ID}.jsonl`),
    [linea('user', 'Arregla el login del traspaso'), linea('assistant', [{ type: 'text', text: 'Hecho: cambié auth.ts.' }])].join('\n') + '\n'
  )
}

/** El último arranque de un agente falso, o undefined. */
function ultimo(agente: AgenteFalso, cli: 'claude' | 'codex'): EventoFalso | undefined {
  return agente.arranques(cli).at(-1)
}

/** Los archivos bajo una carpeta (recursivo), con su ruta completa. */
function archivosBajo(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivosBajo(join(dir, e.name)) : [join(dir, e.name)]))
}

test.describe('continuar el trabajo en otro agente o cuenta', () => {
  let agente: AgenteFalso
  let s: SesionTessera | null = null
  let proyecto = ''

  test.beforeEach(async () => {
    agente = montarAgenteFalso()
    proyecto = join(agente.raiz, 'proyecto')
    mkdirSync(proyecto)
    s = await abrirTessera(agente.env, { sembrar: (datos) => sembrar(datos, proyecto) })
    await expect(s.ventana.locator('.profile-tab[data-perfil-id="personal"]')).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => ultimo(agente, 'claude')?.argv ?? [], { message: 'Claude Code arranca reanudando la conversación sembrada', timeout: 30_000 }).toContain(ID)
  })

  test.afterEach(async () => {
    await s?.cerrar()
    await borrarTemporal(agente.raiz)
  })

  test('Claude Code -> Codex: primer mensaje y tctx traspaso en la sesión de destino', async () => {
    const ventana = s!.ventana
    await ventana.locator('.agent-pane:not(.hidden) button[aria-label="Continuar en otra cuenta o con Codex"]').click()
    const emergente = ventana.locator('.cuenta-pop')
    await expect(emergente).toBeVisible()
    // La primera tarjeta del grupo de Codex es la del equipo: Codex nativo.
    await emergente.getByRole('region', { name: 'Codex: Solo un resumen' }).locator('.cuenta-tarjeta').first().click()
    await expect.poll(() => ultimo(agente, 'codex')?.argv?.at(-1) ?? '', { message: 'Codex arranca con el primer mensaje como último argumento', timeout: 30_000 }).toBe(PROMPT)
    const codex = ultimo(agente, 'codex')!
    expect(codex.argv?.some((a) => a.includes('developer_instructions=') && a.includes('tctx traspaso')), 'y su aviso de arranque nombra tctx traspaso').toBe(true)
    expect(codex.argv?.includes('resume'), 'una conversación nueva, sin reanudar').toBe(false)
    expect(codex.pipe && codex.sesion, 'la sesión de Codex lleva el puente y su token').toBeTruthy()

    // `tctx traspaso` como lo correría Codex en su terminal: con su puente y su token.
    const env: NodeJS.ProcessEnv = { ...process.env, TESSERA_DB_PIPE: codex.pipe!, TESSERA_DB_SESSION: codex.sesion!, TESSERA_IDIOMA: 'es' }
    const r = spawnSync(process.execPath, [TCTX, 'traspaso'], { env, encoding: 'utf8', timeout: 30_000 })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('# Traspaso desde Claude Code')
    expect(r.stdout).toContain('Arregla el login del traspaso')
    expect(r.stdout).toContain('Hecho: cambié auth.ts.')
    expect(r.stdout).toContain('## Estado de git')

    // La sesión de Claude Code (el origen) no tiene traspaso: solo la que se abrió con él.
    const claude = ultimo(agente, 'claude')!
    const ajeno = spawnSync(process.execPath, [TCTX, 'traspaso'], { env: { ...env, TESSERA_DB_PIPE: claude.pipe!, TESSERA_DB_SESSION: claude.sesion! }, encoding: 'utf8', timeout: 30_000 })
    expect(ajeno.status, 'el origen no lee el traspaso del destino').toBe(4)
  })

  test('el botón reúne las otras cuentas y los otros agentes; el selector de cuenta ya no continúa', async () => {
    const ventana = s!.ventana
    await ventana.evaluate(async () => {
      await window.tessera.cuentasAgente.crear({ profileId: 'personal', agente: 'claude-code', nombre: 'Trabajo' })
      await window.tessera.cuentasAgente.crear({ profileId: 'personal', agente: 'codex', nombre: 'Otra de Codex' })
    })
    const emergente = ventana.locator('.cuenta-pop')
    const pasar = ventana.locator('.agent-pane:not(.hidden) .pasar-btn')

    await pasar.click()
    const mismo = emergente.getByRole('region', { name: 'Claude Code: Conversación completa' })
    await expect(mismo.locator('.cuenta-tarjeta-nombre'), 'corre nativo: la del equipo no es un destino').toHaveText(['Trabajo'])
    const otro = emergente.getByRole('region', { name: 'Codex: Solo un resumen' })
    await expect(otro.locator('.cuenta-tarjeta', { hasText: 'Otra de Codex' })).toHaveCount(1)
    await expect(emergente.locator('.cuenta-tarjeta.actual'), 'ninguna en uso: solo hay destinos').toHaveCount(0)
    await ventana.keyboard.press('Escape')
    await expect(emergente).toHaveCount(0)

    await ventana.locator('.agent-pane:not(.hidden) .cuenta-btn').first().click()
    const trabajo = emergente.locator('.cuenta-tarjeta', { hasText: 'Trabajo' })
    await trabajo.hover()
    await emergente.getByRole('button', { name: 'Más acciones de «Trabajo»' }).click()
    const menu = ventana.locator('.ctx-menu')
    await expect(menu.getByRole('menuitem', { name: 'Renombrar' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /Continuar/ }), 'continuar solo se ofrece desde su botón').toHaveCount(0)
  })

  test('mismo agente, nativo -> cuenta de Docker: la conversación se copia donde la busca Claude Code en el contenedor', async () => {
    const ventana = s!.ventana
    const datos = s!.datos
    const resultado = await ventana.evaluate(
      async ({ proyecto }) => {
        const cuenta = await window.tessera.cuentasAgente.crear({ profileId: 'personal', agente: 'claude-code', nombre: 'Trabajo' })
        const sesion = (await window.tessera.terminalAgente.fotoActividad()).find((x) => x.agente === 'claude-code' && x.rutaHostProyecto === proyecto)
        if (!sesion) return { error: 'sin sesión de Claude Code' }
        return window.tessera.traspaso.continuarEn({
          origen: { profileId: 'personal', projectHostPath: proyecto, agente: 'claude-code', sessionId: sesion.sesionId },
          destino: { agente: 'claude-code', modo: 'docker', accountId: cuenta.id }
        })
      },
      { proyecto }
    )
    expect(resultado).toMatchObject({ reanudar: ID })
    const copia = archivosBajo(datos).find((f) => f.endsWith(join('projects', '-workspace-proyecto', `${ID}.jsonl`)))
    expect(copia, 'la copia en projects/-workspace-proyecto/ de la cuenta de Docker').toBeTruthy()
    expect(existsSync(join(carpetasAgentes(datos).claude, 'projects', proyecto.replace(/[^A-Za-z0-9]/g, '-'), `${ID}.jsonl`)), 'el origen sigue en su sitio').toBe(true)
  })
})

const TEXTOS_DIVERGENCIA = {
  // El nombre del equipo lo pone el sistema («su equipo Windows», «su Mac»): solo se fija el principio.
  es: { region: 'Claude Code: Conversación completa', titulo: 'ya existe en la cuenta «Trabajo»', reciente: 'Más reciente', principal: /^Continuar con la de su /, cancelar: 'Cancelar' },
  en: { region: 'Claude Code: Full conversation', titulo: 'already exists in the “Trabajo” account', reciente: 'Most recent', principal: /^Continue with the one from your /, cancelar: 'Cancel' }
}

for (const idioma of ['es', 'en'] as const) {
  test(`si las dos copias divergieron, pregunta con cuál seguir y la que pierde se aparta (${idioma})`, async () => {
    const t = TEXTOS_DIVERGENCIA[idioma]
    const agente = montarAgenteFalso()
    const proyecto = join(agente.raiz, 'proyecto')
    mkdirSync(proyecto)
    let s: SesionTessera | null = null
    try {
      s = await abrirTessera({ ...agente.env, TESSERA_FORZAR_IDIOMA: idioma }, { sembrar: (datos) => sembrar(datos, proyecto) })
      const ventana = s.ventana
      await expect.poll(() => ultimo(agente, 'claude')?.argv ?? [], { timeout: 30_000 }).toContain(ID)
      const cuentaId = await ventana.evaluate(async () => (await window.tessera.cuentasAgente.crear({ profileId: 'personal', agente: 'claude-code', nombre: 'Trabajo' })).id)
      // En la cuenta de destino, la misma conversación siguió por otro lado: otra historia con el mismo id, más antigua.
      const carpeta = join(s.datos, '.tessera', 'perfiles', 'personal', 'claude-cuentas', cuentaId, 'projects', '-workspace-proyecto')
      mkdirSync(carpeta, { recursive: true })
      const ajena = join(carpeta, `${ID}.jsonl`)
      writeFileSync(ajena, JSON.stringify({ type: 'user', sessionId: ID, message: { role: 'user', content: 'Otra historia en Docker' } }) + '\n')
      const ayer = new Date(Date.now() - 86_400_000)
      utimesSync(ajena, ayer, ayer)

      await ventana.locator('.agent-pane:not(.hidden) .pasar-btn').click()
      await ventana.locator('.cuenta-pop').getByRole('region', { name: t.region }).locator('.cuenta-tarjeta', { hasText: 'Trabajo' }).click()
      const modal = ventana.locator('.modal-card.divergencia')
      await expect(modal.locator('.modal-title')).toContainText(t.titulo)
      await expect(modal.locator('[data-lado="origen"] .divergencia-reciente'), 'la de origen es la más reciente').toHaveText(t.reciente)
      await expect(modal.locator('[data-lado="destino"] .divergencia-reciente')).toHaveCount(0)
      await expect(modal.locator('.modal-pie .btn.primary'), 'el principal es el de la más reciente').toHaveText(t.principal)
      for (const [ancho, alto] of [[900, 620], [1600, 1000]] as const) {
        await s.app.evaluate(({ BrowserWindow }, [a, h]) => BrowserWindow.getAllWindows()[0].setSize(a, h), [ancho, alto])
        await ventana.waitForTimeout(300)
        const desbordes = await modal.evaluate((el) =>
          [el, ...Array.from(el.querySelectorAll<HTMLElement>('.modal-cuerpo, .divergencia-copia, .modal-pie'))].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.className)
        )
        expect(desbordes, `nada desborda a ${ancho}x${alto}`).toEqual([])
      }
      await modal.getByRole('button', { name: t.cancelar }).click()
      await expect(modal).toHaveCount(0)
      expect(readFileSync(ajena, 'utf8'), 'cancelar no toca nada').toContain('Otra historia en Docker')

      // Elegir la de origen (lo que hace su botón): la de destino se aparta intacta y la conversación pasa entera.
      const resultado = await ventana.evaluate(async ({ proyecto, cuentaId }) => {
        const sesion = (await window.tessera.terminalAgente.fotoActividad()).find((x) => x.agente === 'claude-code' && x.rutaHostProyecto === proyecto)
        if (!sesion) return null
        return window.tessera.traspaso.continuarEn({
          origen: { profileId: 'personal', projectHostPath: proyecto, agente: 'claude-code', sessionId: sesion.sesionId },
          destino: { agente: 'claude-code', modo: 'docker', accountId: cuentaId },
          divergencia: 'origen'
        })
      }, { proyecto, cuentaId })
      expect(resultado).toMatchObject({ reanudar: ID })
      const apartada = readdirSync(carpeta).find((n) => n.startsWith(`${ID}.jsonl.aparte-`))
      expect(apartada, 'la que estaba se guarda aparte').toBeTruthy()
      expect(readFileSync(join(carpeta, apartada!), 'utf8')).toContain('Otra historia en Docker')
      expect(readFileSync(ajena, 'utf8'), 'y en su lugar queda la del origen').toContain('Arregla el login del traspaso')
    } finally {
      await s?.cerrar()
      await borrarTemporal(agente.raiz)
    }
  })
}
