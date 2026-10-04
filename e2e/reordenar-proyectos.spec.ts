// =============================================================================
// Reordenar las pestañas de proyecto ARRASTRÁNDOLAS, sobre la app empaquetada: el orden
// cambia, la raya dice de qué lado caerá, arrastrar no activa ni toca ninguna sesión, y
// el orden se guarda y vuelve al reabrir. Vive aquí porque el arrastre del navegador
// (dragstart, dragover, drop) solo existe en el renderer de verdad.
// Decisiones: docs/decisiones/renderer/reordenar-proyectos-arrastrando.md
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, pidsConExit, vivo, type AgenteFalso } from './agenteFalso'
import { asentar } from './humoAyudas'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

/** Tres proyectos en «Personal» (los que se reordenan) y uno en «Trabajo». */
const PROYECTOS = [
  { perfil: 'personal', nombre: 'alfa' },
  { perfil: 'personal', nombre: 'beta' },
  { perfil: 'personal', nombre: 'gamma' },
  { perfil: 'trabajo', nombre: 'delta' }
] as const

interface Montaje {
  agente: AgenteFalso
  rutas: Record<string, string>
}

function montar(): Montaje {
  const agente = montarAgenteFalso()
  const rutas: Record<string, string> = {}
  for (const p of PROYECTOS) {
    rutas[p.nombre] = join(agente.raiz, p.nombre)
    mkdirSync(rutas[p.nombre])
    writeFileSync(join(rutas[p.nombre], 'LEEME.txt'), `proyecto ${p.nombre}\n`)
  }
  return { agente, rutas }
}

const PERFILES = JSON.stringify(
  [
    ['personal', 'Personal', '#9814c8'],
    ['trabajo', 'Trabajo', '#1f9e7a']
  ].map(([id, nombre, color]) => ({
    id,
    nombre,
    color,
    agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
    sandbox: { habilitado: false }
  }))
)

/** Dos perfiles, todo NATIVO y `alfa` activo; `workspace` sustituye al estado de partida. */
function sembrar(datos: string, m: Montaje, workspace?: string): void {
  writeFileSync(join(datos, 'profiles.json'), PERFILES)
  const abiertos = (id: string): object[] =>
    PROYECTOS.filter((p) => p.perfil === id).map((p) => ({ projectHostPath: m.rutas[p.nombre], name: p.nombre, estado: 'active' }))
  const deSiembra = JSON.stringify({
    version: 1,
    activeProfileId: 'personal',
    byProfile: {
      personal: { openProjects: abiertos('personal'), activePath: m.rutas.alfa },
      trabajo: { openProjects: abiertos('trabajo'), activePath: m.rutas.delta }
    },
    settings: {
      defaultProjectMode: 'windows',
      windowsModeProjects: PROYECTOS.map((p) => `${p.perfil}|${m.rutas[p.nombre]}`),
      menuWindowsAvisado: true
    }
  })
  writeFileSync(join(datos, 'workspace-state.json'), workspace ?? deSiembra)
}

interface Persistido {
  texto: string
  personal: string[]
  trabajo: string[]
  activo: string | null
}

/** Lo que dice `workspace-state.json`, o null si está a medio escribir. */
function persistido(datos: string, m: Montaje): Persistido | null {
  const ruta = join(datos, 'workspace-state.json')
  if (!existsSync(ruta)) return null
  try {
    const texto = readFileSync(ruta, 'utf8')
    const doc = JSON.parse(texto) as {
      byProfile?: Record<string, { openProjects?: Array<{ projectHostPath?: string }>; activePath?: string }>
    }
    const nombre = (r: string | undefined): string => Object.keys(m.rutas).find((n) => m.rutas[n] === r) ?? `¿${r}?`
    const de = (id: string): string[] => (doc.byProfile?.[id]?.openProjects ?? []).map((p) => nombre(p.projectHostPath))
    const activa = doc.byProfile?.personal?.activePath
    return { texto, personal: de('personal'), trabajo: de('trabajo'), activo: activa === undefined ? null : nombre(activa) }
  } catch {
    return null
  }
}

const pestana = (win: Page, nombre: string): Locator => win.locator('.tabs-projects .project-tab', { hasText: nombre }).first()
const ordenEnPantalla = (win: Page): Promise<string[]> =>
  win.locator('.tabs-projects .project-tab .project-tab-name-inner').allTextContents()

/**
 * Arrastra con el ratón de verdad del centro de `origen` al de `destino`. `enMedio` corre
 * con el botón aún pulsado sobre el destino, para mirar la raya antes de soltar.
 */
async function arrastrar(win: Page, origen: Locator, destino: Locator, enMedio?: () => Promise<void>): Promise<void> {
  const a = await origen.boundingBox()
  const b = await destino.boundingBox()
  if (a === null || b === null) throw new Error('no se pudo medir la pestaña que se arrastra o su destino')
  await win.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await win.mouse.down()
  // Varios pasos: el navegador solo arranca el arrastre tras mover unos píxeles.
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await enMedio?.()
  await win.mouse.up()
  await asentar(win)
}

test.describe.serial('reordenar proyectos arrastrando', () => {
  let s: SesionTessera | null = null
  let m: Montaje
  /** El `workspace-state.json` que dejó la app tras reordenar, para reabrir con él. */
  let guardado = ''

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.agente.env, { sembrar: (datos) => sembrar(datos, m) })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
    // Dos sesiones vivas, como las abriría el usuario: la de alfa y la de beta.
    await expect.poll(() => m.agente.arranques().length, { timeout: 60_000 }).toBe(1)
    await pestana(s.win, 'beta').click()
    await expect.poll(() => m.agente.arranques().length, { timeout: 60_000 }).toBe(2)
    await pestana(s.win, 'alfa').click()
    await expect(s.win.locator('.tabs-projects .project-tab.active', { hasText: 'alfa' })).toHaveCount(1)
    await asentar(s.win)
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) await borrarTemporal(m.agente.raiz)
  })

  test('arrastrar recoloca la pestaña, no la activa y no toca ninguna sesión', async () => {
    const { win, datos } = s!
    const antes = m.agente.arranques()
    // Si React remontara un pane al mover su pestaña, el nodo nuevo no llevaría la marca.
    const marcados = await win.evaluate(() => {
      const panes = Array.from(document.querySelectorAll('.agent-pane'))
      panes.forEach((el, i) => el.setAttribute('data-e2e-marca', String(i)))
      return panes.length
    })
    const ordenEnElDom = (): Promise<string> =>
      win.evaluate(() =>
        Array.from(document.querySelectorAll('.agent-pane'))
          .map((el) => el.getAttribute('data-e2e-marca'))
          .join(',')
      )
    const domAntes = await ordenEnElDom()

    // Hacia la IZQUIERDA: gamma sobre alfa ocupa su sitio, y la raya va ANTES de alfa.
    await arrastrar(win, pestana(win, 'gamma'), pestana(win, 'alfa'), async () => {
      await expect(pestana(win, 'alfa')).toHaveClass(/\bsoltar-antes\b/)
      await expect(pestana(win, 'gamma')).toHaveClass(/\barrastrando\b/)
    })
    await expect.poll(() => ordenEnPantalla(win)).toEqual(['gamma', 'alfa', 'beta'])

    // Hacia la DERECHA: alfa sobre beta, y la raya va DESPUÉS de beta.
    await arrastrar(win, pestana(win, 'alfa'), pestana(win, 'beta'), async () => {
      await expect(pestana(win, 'beta')).toHaveClass(/\bsoltar-despues\b/)
    })
    await expect.poll(() => ordenEnPantalla(win)).toEqual(['gamma', 'beta', 'alfa'])

    // Un nodo que cambia de sitio en el DOM pierde su scroll, y cada pane lleva un xterm vivo:
    // los panes no pueden moverse aunque sus pestañas cambien de orden.
    expect(await ordenEnElDom(), 'los panes del agente siguen en el mismo orden en el DOM').toBe(domAntes)

    await expect(win.locator('.tabs-projects .project-tab.active', { hasText: 'alfa' }), 'la activa sigue siendo alfa').toHaveCount(1)
    await expect(win.locator('.project-tab.arrastrando, .project-tab.soltar-antes, .project-tab.soltar-despues')).toHaveCount(0)

    // El texto se guarda DENTRO del sondeo: una segunda lectura podría pillar el archivo a
    // medio reemplazar, o ya con otro contenido.
    await expect
      .poll(
        () => {
          const p = persistido(datos, m)
          if (p !== null) guardado = p.texto
          return p
        },
        { message: 'el orden nuevo no llegó a workspace-state.json', timeout: 30_000, intervals: [300] }
      )
      .toMatchObject({ personal: ['gamma', 'beta', 'alfa'], trabajo: ['delta'], activo: 'alfa' })

    // Más que el cierre elegante del main: cerrar un pty o lanzar un agente es asíncrono.
    await win.waitForTimeout(4_000)
    expect(m.agente.arranques().length, 'no arrancó ningún agente (gamma no se activó)').toBe(antes.length)
    const pids = antes.map((a) => a.pid)
    expect(pidsConExit(m.agente.eventos()).filter((p) => pids.includes(p)), 'nadie tecleó `exit` en un agente').toEqual([])
    for (const a of antes) expect(vivo(a.pid), `el agente de ${a.cwd} sigue vivo`).toBe(true)
    expect(await win.locator('.agent-pane[data-e2e-marca]').count(), 'ningún pane se remontó').toBe(marcados)
  })

  test('soltar fuera de la banda no mueve nada y no deja el arrastre a medias', async () => {
    const { win } = s!
    const ordenAntes = await ordenEnPantalla(win)
    await arrastrar(win, pestana(win, 'beta'), win.locator('.profile-tab', { hasText: 'Trabajo' }).first())
    expect(await ordenEnPantalla(win)).toEqual(ordenAntes)
    await expect(win.locator('.profile-tab.active', { hasText: 'Personal' }), 'el perfil activo no cambió').toHaveCount(1)
    await expect(win.locator('.project-tab.arrastrando, .project-tab.soltar-antes, .project-tab.soltar-despues')).toHaveCount(0)
  })

  test('el orden vuelve igual al reabrir', async () => {
    test.setTimeout(180_000)
    expect(guardado, 'la prueba anterior dejó guardado el orden nuevo').not.toBe('')
    await s!.cerrar()
    s = await abrirTessera(m.agente.env, { sembrar: (datos) => sembrar(datos, m, guardado) })
    await expect.poll(() => ordenEnPantalla(s!.win), { timeout: 30_000 }).toEqual(['gamma', 'beta', 'alfa'])
    await expect(s.win.locator('.tabs-projects .project-tab.active', { hasText: 'alfa' })).toHaveCount(1)
  })
})
