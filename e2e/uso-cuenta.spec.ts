// =============================================================================
// El uso de la cuenta en el pie del agente, sobre la app empaquetada: la línea compacta
// enseña las ventanas que trae la cuenta (dos semanales si las tiene), cambia con ellas y
// no corta ninguna por la mitad al estrecharse el pie.
// El uso lo sirve un servidor local (`TESSERA_USO_CLAUDE`) y el agente es el falso de
// `agenteFalso.ts`. Corre en las dos plataformas; en Mac, sin verificar desde Windows.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, carpetasAgentes, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

/** Las formas reales de `limits[]` (medidas en una cuenta real), con los campos que se usan. */
const SESION = { kind: 'session', group: 'session', percent: 16, resets_at: null, scope: null }
const SEMANAL = { kind: 'weekly_all', group: 'weekly', percent: 96, resets_at: null, scope: null }
const deModelo = (nombre: string, percent: number): object => ({
  kind: 'weekly_scoped',
  group: 'weekly',
  percent,
  resets_at: null,
  scope: { model: { id: null, display_name: nombre }, surface: null }
})

/** Lo que el servidor de uso contesta AHORA; cada prueba lo cambia. */
let limites: object[] = [SESION, SEMANAL, deModelo('Fable', 17)]

/** Las etiquetas de las ventanas que se VEN en la línea compacta, en orden. */
async function ventanasVisibles(win: Page): Promise<string[]> {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.agent-pane:not(.hidden) .agent-usage-item'))
      .filter((el) => {
        const caja = el.getBoundingClientRect()
        const marco = el.parentElement!.getBoundingClientRect()
        return caja.width > 0 && caja.bottom <= marco.bottom + 0.5
      })
      .map((el) => `${el.querySelector('.agent-usage-label')?.textContent} ${el.querySelector('.agent-usage-pct')?.textContent}`)
  )
}

/**
 * Fija el ancho del pie y mide: qué ventanas se ven, si alguna queda cortada, si hay
 * micro-barras y si el grupo informativo se encima con el botón de reinicio.
 */
async function medirPie(win: Page, ancho: number): Promise<{ visibles: number; cortadas: number; barras: boolean; encimado: boolean }> {
  return win.evaluate(async (px) => {
    const pie = document.querySelector<HTMLElement>('.agent-pane:not(.hidden) .agent-pane-footer')!
    pie.style.width = `${px}px`
    pie.style.flex = '0 0 auto'
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const uso = pie.querySelector<HTMLElement>('.agent-usage')
    const marco = uso?.getBoundingClientRect()
    const items = uso && marco && marco.width > 0 ? Array.from(uso.querySelectorAll<HTMLElement>('.agent-usage-item')) : []
    let visibles = 0
    let cortadas = 0
    for (const el of items) {
      const c = el.getBoundingClientRect()
      if (c.width === 0 || c.top >= marco!.bottom) continue // oculta, o en la fila que no se ve
      visibles++
      if (c.right > marco!.right + 0.5 || c.bottom > marco!.bottom + 0.5) cortadas++
    }
    const barra = uso?.querySelector<HTMLElement>('.agent-usage-mini')
    const stats = pie.querySelector<HTMLElement>('.agent-footer-stats')!.getBoundingClientRect()
    const boton = pie.querySelector<HTMLElement>('.agent-reload-btn')!.getBoundingClientRect()
    return {
      visibles,
      cortadas,
      barras: !!barra && barra.getBoundingClientRect().width > 0,
      encimado: stats.width > 0 && stats.right > boton.left + 0.5
    }
  }, ancho)
}

test.describe('uso de la cuenta en el pie del agente', () => {
  let s: SesionTessera
  let agente: AgenteFalso
  let servidor: Server
  let peticiones = 0

  test.beforeAll(async () => {
    servidor = createServer((_req, res) => {
      peticiones++
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ limits: limites }))
    })
    await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo))
    const { port } = servidor.address() as AddressInfo

    agente = montarAgenteFalso()
    const proyecto = join(agente.raiz, 'proyecto')
    mkdirSync(proyecto)
    s = await abrirTessera(
      { ...agente.env, TESSERA_USO_CLAUDE: `http://127.0.0.1:${port}/uso` },
      {
        sembrar: (datos) => {
          writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
          writeFileSync(
            join(datos, 'workspace-state.json'),
            JSON.stringify({
              version: 1,
              activeProfileId: 'personal',
              byProfile: { personal: { openProjects: [{ projectHostPath: proyecto, name: 'proyecto', estado: 'active' }], activePath: proyecto } },
              settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`] }
            })
          )
          // La cuenta nativa «con sesión iniciada»: un token cualquiera, que solo ve el servidor local.
          writeFileSync(join(carpetasAgentes(datos).claude, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'token-de-prueba' } }))
        }
      }
    )
    await expect.poll(() => agente.arranques('claude').length, { timeout: 60_000 }).toBe(1)
  })

  test.afterAll(async () => {
    await s?.cerrar()
    await new Promise<void>((listo) => {
      servidor.closeAllConnections()
      servidor.close(() => listo())
    })
    if (agente) await borrarTemporal(agente.raiz)
  })

  test('con dos límites semanales, el pie enseña los dos', async () => {
    // La semanal del modelo va con su inicial; el nombre entero queda para lectores de pantalla.
    await expect.poll(() => ventanasVisibles(s.win), { timeout: 30_000 }).toEqual(['5h 16%', '7d 96%', 'F 17%'])
    await expect(s.win.locator('.agent-pane:not(.hidden) .agent-usage-label').nth(2)).toHaveAttribute('aria-label', 'Semanal Fable')
    // En el ancho por defecto de la columna caben las tres, y ninguna cortada.
    const pie = await s.win.evaluate(() => {
      const uso = document.querySelector<HTMLElement>('.agent-pane:not(.hidden) .agent-usage')!
      const marco = uso.getBoundingClientRect()
      return Array.from(uso.querySelectorAll<HTMLElement>('.agent-usage-item')).every((el) => el.getBoundingClientRect().right <= marco.right + 0.5)
    })
    expect(pie, 'ninguna ventana se sale del pie en el ancho por defecto').toBe(true)
  })

  test('el desplegable las nombra: sesión, semanal y semanal del modelo', async () => {
    const pop = s.win.locator('.agent-usage-pop')
    // Con `poll` y no con `toHaveText`: si falla, el mensaje trae los nombres que SÍ había.
    await expect
      .poll(
        async () => {
          await s.win.locator('.agent-pane:not(.hidden) .agent-usage').hover()
          const filas = await pop.locator('.agent-usage-row-head').allInnerTexts()
          return filas.map((t) => t.replace(/\s*<?\d+%\s*$/, '').trim())
        },
        { timeout: 15_000 }
      )
      .toEqual(['Sesión (5 h)', 'Semanal (7 días)', 'Semanal Fable'])
    await s.win.mouse.move(5, 5)
    await expect(pop).toHaveCount(0)
  })

  test('ninguna ventana se corta ni se encima con el botón, a ningún ancho', async () => {
    const fallos: string[] = []
    const visiblesEn = new Map<number, number>()
    const barrasEn = new Map<number, boolean>()
    for (let ancho = 620; ancho >= 120; ancho -= 10) {
      const m = await medirPie(s.win, ancho)
      visiblesEn.set(ancho, m.visibles)
      barrasEn.set(ancho, m.barras)
      if (m.cortadas > 0 || m.encimado) fallos.push(`${ancho}px: cortadas=${m.cortadas} encimado=${m.encimado}`)
    }
    const vistasEnEstrecho = visiblesEn.get(330)
    // La escalera, medida: con sitio de sobra van las tres CON barra; antes de perder una
    // ventana se pierden las barras; y por debajo del mínimo de la columna cae la última.
    expect([visiblesEn.get(500), barrasEn.get(500)], 'a 500 px: las tres con micro-barras').toEqual([3, true])
    expect([visiblesEn.get(400), barrasEn.get(400)], 'a 400 px: las tres, ya sin micro-barras').toEqual([3, false])
    expect(visiblesEn.get(300), 'a 300 px (una casilla estrecha del mosaico): sesión y semanal').toBe(2)
    await s.win.evaluate(() => {
      const pie = document.querySelector<HTMLElement>('.agent-pane:not(.hidden) .agent-pane-footer')!
      pie.style.width = ''
      pie.style.flex = ''
    })
    expect(fallos, 'anchos en los que algo se corta o se encima').toEqual([])
    expect(vistasEnEstrecho, 'en el ancho mínimo de la columna (330 px) se ven las tres').toBe(3)
  })

  test('si la cuenta deja de traer la semanal del modelo, el pie deja de enseñarla', async () => {
    limites = [SESION, SEMANAL]
    const antes = peticiones
    // Mirarlo de cerca fuerza una relectura; el suelo de red del main la retrasa unos segundos.
    await expect
      .poll(
        async () => {
          await s.win.mouse.move(5, 5)
          await s.win.locator('.agent-pane:not(.hidden) .agent-usage').hover()
          return ventanasVisibles(s.win)
        },
        { timeout: 60_000, intervals: [3000] }
      )
      .toEqual(['5h 16%', '7d 96%'])
    expect(peticiones, 'la relectura llegó al servidor').toBeGreaterThan(antes)
    await s.win.mouse.move(5, 5)
  })

  test('y si trae una más, también sale, con el nombre que la cuenta le da', async () => {
    limites = [SESION, SEMANAL, deModelo('Fable', 17), deModelo('Opus', 3)]
    await expect
      .poll(
        async () => {
          await s.win.mouse.move(5, 5)
          await s.win.locator('.agent-pane:not(.hidden) .agent-usage').hover()
          return s.win.locator('.agent-usage-pop .agent-usage-row-head').allInnerTexts()
        },
        { timeout: 60_000, intervals: [3000] }
      )
      .toHaveLength(4)
    await s.win.mouse.move(5, 5)
    // Con cuatro, el pie ancho las enseña todas y el estrecho suelta las últimas, enteras.
    const ancho = await medirPie(s.win, 620)
    const estrecho = await medirPie(s.win, 330)
    expect(ancho.visibles, 'a 620 px caben las cuatro').toBe(4)
    expect(estrecho.cortadas, 'a 330 px ninguna cortada').toBe(0)
    expect(estrecho.visibles, 'a 330 px quedan al menos sesión y semanal').toBeGreaterThanOrEqual(2)
    const fallos: string[] = []
    for (let px = 620; px >= 120; px -= 10) {
      const m = await medirPie(s.win, px)
      if (m.cortadas > 0 || m.encimado) fallos.push(`${px}px: cortadas=${m.cortadas} encimado=${m.encimado}`)
    }
    expect(fallos, 'anchos en los que algo se corta o se encima, con cuatro ventanas').toEqual([])
  })
})
