// =============================================================================
// Hibernación del agente por inactividad sobre la app empaquetada: el viaje entero que los
// tests puros no ven (qué está en pantalla, la E/S del pty hasta el reloj del main, la muerte
// del árbol sin teclear, la terminal de abajo intacta y la vuelta a SU conversación).
// Usa el agente falso de `agenteFalso.ts` con `callar` y `conNieto`, y un umbral de 3 s por
// `TESSERA_AGENTE_INACTIVIDAD_MS`; el ajuste sigue en sus 5 minutos de fábrica. Con poca memoria
// forzada, el aviso y su botón. Corre en las dos plataformas.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { entradaPorPid, montarAgenteFalso, pidsConSalida, vivo, type AgenteFalso, type EventoFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, carpetasAgentes, MOD, PLATAFORMA, type SesionTessera } from './tessera'

const PROYECTOS = ['alfa', 'beta', 'gamma'] as const
type Proyecto = (typeof PROYECTOS)[number]

/** La conversación con la que arranca «beta», y la que aparece después en su carpeta. */
const CHAT_ANCLADO = 'c1a0de00-0000-4000-8000-000000000001'
const CHAT_AJENO = 'c1a0de00-0000-4000-8000-000000000002'

interface Montaje {
  agente: AgenteFalso
  rutas: Record<Proyecto, string>
}

function montar(): Montaje {
  const agente = montarAgenteFalso()
  agente.conNieto(true)
  const rutas = {} as Record<Proyecto, string>
  for (const nombre of PROYECTOS) {
    rutas[nombre] = join(agente.raiz, nombre)
    mkdirSync(rutas[nombre])
    writeFileSync(join(rutas[nombre], 'LEEME.txt'), `proyecto ${nombre}\n`)
  }
  return { agente, rutas }
}

/** Escribe una conversación de Claude Code en la carpeta del proyecto, con el formato del lector. */
function escribirConversacion(datos: string, ruta: string, id: string, cuando: string): void {
  const carpeta = join(carpetasAgentes(datos).claude, 'projects', ruta.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(carpeta, { recursive: true })
  const linea = (tipo: string, contenido: unknown): string =>
    JSON.stringify({ type: tipo, sessionId: id, cwd: ruta, timestamp: cuando, message: { role: tipo, content: contenido } })
  writeFileSync(
    join(carpeta, `${id}.jsonl`),
    `${linea('user', 'hola')}\n${linea('assistant', [{ type: 'text', text: 'hola' }])}\n`
  )
}

/** Un perfil sin sandbox con los tres proyectos NATIVOS, y el ajuste en sus 5 minutos de fábrica. */
function sembrar(datos: string, m: Montaje): void {
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
      byProfile: {
        personal: {
          openProjects: PROYECTOS.map((n) => ({ projectHostPath: m.rutas[n], name: n, estado: 'active' })),
          activePath: m.rutas.alfa
        }
      },
      settings: {
        defaultProjectMode: 'windows',
        windowsModeProjects: PROYECTOS.map((n) => `personal|${m.rutas[n]}`)
      }
    })
  )
  escribirConversacion(datos, m.rutas.beta, CHAT_ANCLADO, '2026-09-20T10:00:00.000Z')
}

const pestana = (ventana: Page, nombre: Proyecto) => ventana.locator('.tabs-projects .project-tab', { hasText: nombre }).first()

/** Los arranques del agente en la carpeta de ese proyecto, en orden. */
function arranquesEn(m: Montaje, nombre: Proyecto): EventoFalso[] {
  return m.agente.arranques('claude').filter((e) => e.cwd === m.rutas[nombre])
}

/** El pid del proceso suelto que lanzó ese agente. */
function nietoDe(m: Montaje, pid: number): number {
  return m.agente.eventos().find((e) => e.tipo === 'nieto' && e.pid === pid)?.nieto ?? -1
}

/** Teclea en la terminal de abajo la orden que apunta el pid de su shell en `archivo`. */
async function apuntarPidDeShell(ventana: Page, archivo: string): Promise<number> {
  const pantalla = ventana.locator('section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm-screen')
  await pantalla.click()
  // La orden depende de la shell nativa: PowerShell en Windows, la de `$SHELL` en Mac.
  const orden = PLATAFORMA === 'windows' ? `$PID | Out-File -Encoding ascii "${archivo}"` : `echo $$ > "${archivo}"`
  await ventana.keyboard.type(orden)
  await ventana.keyboard.press('Enter')
  await expect.poll(() => (existsSync(archivo) ? readFileSync(archivo, 'utf8').trim() : ''), { timeout: 30_000 }).toMatch(/^\d+$/)
  return Number(readFileSync(archivo, 'utf8').trim())
}

test.describe('hibernación del agente por inactividad', () => {
  let s: SesionTessera
  let m: Montaje
  let pidShellBeta = -1
  const pidAgente = {} as Record<Proyecto, number>

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(
      { ...m.agente.env, TESSERA_AGENTE_INACTIVIDAD_MS: '3000' },
      { sembrar: (datos) => sembrar(datos, m) }
    )
    const ventana = s.ventana
    // Las sesiones son perezosas: cada agente arranca al mirar su proyecto.
    await expect.poll(() => arranquesEn(m, 'alfa').length, { timeout: 60_000 }).toBe(1)
    await pestana(ventana, 'beta').click()
    await expect.poll(() => arranquesEn(m, 'beta').length, { timeout: 60_000 }).toBe(1)
    // La terminal de abajo de «beta», con una shell cuyo pid se apunta para después.
    await ventana.getByRole('button', { name: 'Terminal' }).click()
    await expect(ventana.locator('section.terminal-panel')).toBeVisible()
    pidShellBeta = await apuntarPidDeShell(ventana, join(m.agente.raiz, 'shell-beta-1.txt'))
    await pestana(ventana, 'gamma').click()
    await expect.poll(() => arranquesEn(m, 'gamma').length, { timeout: 60_000 }).toBe(1)
    for (const n of PROYECTOS) pidAgente[n] = arranquesEn(m, n)[0].pid
    // Los tres agentes lanzaron su proceso suelto.
    await expect.poll(() => PROYECTOS.every((n) => nietoDe(m, pidAgente[n]) > 0), { timeout: 30_000 }).toBe(true)
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) {
      // Red de seguridad: ningún proceso suelto debe sobrevivir a la prueba.
      for (const e of m.agente.eventos()) {
        if (e.tipo !== 'nieto' || e.nieto === undefined || !vivo(e.nieto)) continue
        try {
          process.kill(e.nieto)
        } catch {
          // Ya murió.
        }
      }
      await borrarTemporal(m.agente.raiz)
    }
  })

  test('un agente oculto que sigue escribiendo no se hiberna', async () => {
    const ventana = s.ventana
    expect(arranquesEn(m, 'beta')[0].argv?.join(' '), '«beta» arrancó reanudando su conversación').toContain(`--resume ${CHAT_ANCLADO}`)
    // Tres umbrales de margen: «alfa» y «beta» están fuera de pantalla, pero laten.
    await ventana.waitForTimeout(10_000)
    await expect(ventana.locator('.tabs-projects .project-tab.hibernated'), 'ninguna pestaña hibernada').toHaveCount(0)
    expect(PROYECTOS.map((n) => vivo(pidAgente[n])), 'los tres agentes siguen vivos').toEqual([true, true, true])
    expect(m.agente.arranques('claude').length, 'y nadie se relanzó').toBe(3)
  })

  test('oculto y callado: muere con su árbol sin que nadie teclee, y solo él', async () => {
    const ventana = s.ventana
    // Otra conversación, más reciente, aparece en la carpeta de «beta» (otro cliente).
    escribirConversacion(s.datos, m.rutas.beta, CHAT_AJENO, new Date().toISOString())
    // «beta» (oculto) y «gamma» (EN PANTALLA) se callan; «alfa» (oculto) sigue latiendo.
    m.agente.callar(m.rutas.beta, true)
    m.agente.callar(m.rutas.gamma, true)

    await expect(pestana(ventana, 'beta'), 'la pestaña de «beta» pasa a hibernada').toHaveClass(/\bhibernated\b/, { timeout: 45_000 })
    await expect(pestana(ventana, 'beta')).toHaveAttribute('title', /agente hibernado para ahorrar memoria/)
    // Sin aviso: la pestaña atenuada y su título son toda la señal (pedido del usuario).
    await expect(ventana.locator('.toast', { hasText: /hibernad/ })).toHaveCount(0)
    // El ajuste sigue en Configuración › Proyectos, de fábrica en 5 minutos.
    await ventana.keyboard.press(`${MOD}+,`)
    const modal = ventana.locator('.ajustes-modal')
    await expect(modal).toHaveCount(1)
    await modal.locator('.ajustes-riel-item[data-cat="proyectos"]').click()
    const selector = modal.locator('select[aria-label="Hibernar el agente inactivo tras"]')
    await expect(selector).toBeVisible()
    await expect(selector, 'el ajuste viene de fábrica en 5 minutos').toHaveValue('5')
    await ventana.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)

    const nietoBeta = nietoDe(m, pidAgente.beta)
    await expect.poll(() => vivo(pidAgente.beta) || vivo(nietoBeta), { timeout: 15_000, message: 'el agente de "beta" y su proceso suelto mueren' }).toBe(false)

    const eventos = m.agente.eventos()
    const recibido = entradaPorPid(eventos).get(pidAgente.beta) ?? ''
    expect(pidsConSalida(eventos), 'nadie tecleó `exit` en ningún agente').toEqual([])
    const bytes: string[] = recibido.match(/../g) ?? []
    expect(bytes.includes('03'), 'ni un `^C` en el agente hibernado').toBe(false)

    expect(vivo(pidAgente.gamma), 'el que está en pantalla sigue vivo aunque calle').toBe(true)
    expect(vivo(pidAgente.alfa), 'el oculto que escribe sigue vivo').toBe(true)
    await expect(ventana.locator('.tabs-projects .project-tab.hibernated'), 'solo una pestaña hibernada').toHaveCount(1)
    expect(vivo(pidShellBeta), 'la shell de la terminal de «beta» NO murió con su agente').toBe(true)
  })

  test('al volver se reanuda SU conversación y la terminal de abajo es la misma', async () => {
    const ventana = s.ventana
    await pestana(ventana, 'beta').click()
    await expect.poll(() => arranquesEn(m, 'beta').length, { timeout: 60_000 }).toBe(2)
    const argv = arranquesEn(m, 'beta')[1].argv?.join(' ') ?? ''
    expect(argv, 'reanuda la conversación que tenía anclada').toContain(`--resume ${CHAT_ANCLADO}`)
    expect(argv, 'y no la más reciente de la carpeta').not.toContain(CHAT_AJENO)
    await expect(pestana(ventana, 'beta')).not.toHaveClass(/\bhibernated\b/)
    // La misma shell: no se soltó su sesión ni se abrió otra al volver.
    const pidAhora = await apuntarPidDeShell(ventana, join(m.agente.raiz, 'shell-beta-2.txt'))
    expect(pidAhora, 'el pid de la shell no cambió').toBe(pidShellBeta)
    await expect(ventana.locator('section.terminal-panel .terminal-tab')).toHaveCount(1)
  })
})

// Poca memoria forzada (`TESSERA_E2E_POCA_MEMORIA`), con el ajuste de fábrica: sale el aviso y su
// botón hiberna ya el proyecto oculto y callado, sin tocar el que está en pantalla. Que avise una sola
// vez por racha lo fija `test-auto-hibernacion.mts`.
test.describe('hibernación con poca memoria en el equipo', () => {
  let s: SesionTessera
  let m: Montaje

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) await borrarTemporal(m.agente.raiz)
  })

  test('avisa y «Hibernar inactivos ahora» hiberna el oculto, no el que se ve', async () => {
    m = montar()
    // Callados desde que arrancan: sin turno abierto que la política proteja.
    m.agente.callar(m.rutas.alfa, true)
    m.agente.callar(m.rutas.beta, true)
    // El arnés apaga la hibernación; aquí va con el plazo de fábrica, 5 minutos (2 con poca memoria).
    s = await abrirTessera(
      { ...m.agente.env, TESSERA_E2E_POCA_MEMORIA: '1', TESSERA_AGENTE_INACTIVIDAD_MS: '300000' },
      { sembrar: (datos) => sembrar(datos, m) }
    )
    const ventana = s.ventana
    await expect.poll(() => arranquesEn(m, 'alfa').length, { timeout: 60_000 }).toBe(1)
    // Antes de la primera ronda (a los 5 s): cuando salga el aviso, «alfa» ya está oculto.
    await pestana(ventana, 'beta').click()
    await expect.poll(() => arranquesEn(m, 'beta').length, { timeout: 60_000 }).toBe(1)
    const pidAlfa = arranquesEn(m, 'alfa')[0].pid
    const pidBeta = arranquesEn(m, 'beta')[0].pid

    const aviso = ventana.locator('.toast', { hasText: 'El equipo tiene poca memoria disponible' })
    await expect(aviso, 'el aviso de poca memoria').toHaveCount(1, { timeout: 30_000 })
    // Con el ajuste de fábrica (5 minutos, 2 con poca memoria), nada cae todavía solo.
    await expect(pestana(ventana, 'alfa')).not.toHaveClass(/\bhibernated\b/)
    await aviso.locator('.toast-accion', { hasText: 'Hibernar inactivos ahora' }).click()

    await expect(pestana(ventana, 'alfa'), 'el oculto se hiberna al momento').toHaveClass(/\bhibernated\b/, { timeout: 15_000 })
    await expect.poll(() => vivo(pidAlfa), { timeout: 15_000, message: 'y su agente muere' }).toBe(false)
    expect(vivo(pidBeta), 'el que está en pantalla sigue vivo').toBe(true)
    await expect(pestana(ventana, 'beta')).not.toHaveClass(/\bhibernated\b/)
  })
})
