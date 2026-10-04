// =============================================================================
// Lo que cuesta CAMBIAR DE PERFIL, medido sobre la app empaquetada con agentes falsos:
// cuántos componentes se vuelven a pintar por cambio con 4 y con 12 proyectos abiertos.
// Los presupuestos son de RECUENTO (deterministas); los tiempos solo se informan.
// Usa `window.__tesseraRendimiento` (util/diagnosticoRendimiento.ts del renderer).
// Decisiones: docs/decisiones/calidad/presupuesto-del-cambio-de-perfil.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirDesdeArbol, asentar, git } from './humoAyudas'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

/** Con `TESSERA_E2E_SOLO_MEDIR=1` se imprime la tabla y no se exige ningún presupuesto. */
const SOLO_MEDIR = process.env.TESSERA_E2E_SOLO_MEDIR === '1'

/**
 * Presupuestos POR CAMBIO de perfil, ya en caliente. No dependen de cuántos proyectos
 * hay abiertos: ese es el contrato (ver el ADR, con la línea base de la que salen). Los
 * renders de la ventana no se presupuestan: varían según cuándo lleguen las tandas de git.
 */
const PRESUPUESTO = {
  /** Panes del agente distintos que se vuelven a pintar: el que sale y el que entra. */
  panesDistintos: 2,
  /** Renders de pane en total: medido 3, con uno de margen. */
  rendersDePane: 4,
  /** La PRIMERA visita a un perfil despierta su proyecto: entra también su otro agente. */
  panesDistintosPrimeraVisita: 3,
  /**
   * Cambios (de los doce de una tanda) en los que el pty se redimensiona. Cambiar de perfil
   * no redimensiona; se tolera uno suelto, de un pane que aún se estaba asentando. Si el
   * cambio redimensionara, serían todos.
   */
  cambiosConResize: 1
}

const FECHA = '2026-01-15T10:00:00Z'
const IDAS_Y_VUELTAS = 6

/** Perfiles y cuántos proyectos abre cada uno. */
type Reparto = readonly (readonly [id: string, proyectos: number])[]
const PEQUENO: Reparto = [
  ['uno', 2],
  ['dos', 2]
]
const GRANDE: Reparto = [
  ['uno', 5],
  ['dos', 4],
  ['tres', 3]
]

interface Proyecto {
  perfil: string
  nombre: string
  ruta: string
}

interface Montaje {
  agente: AgenteFalso
  reparto: Reparto
  proyectos: Proyecto[]
}

const nombrePerfil = (id: string): string => id.toUpperCase()

/**
 * El agente falso y los proyectos. El primero de cada perfil (su activo) es un repo git
 * con un cambio pendiente, para que el ciclo de estado de git entre en la medida.
 */
function montar(reparto: Reparto): Montaje {
  const agente = montarAgenteFalso()
  const proyectos: Proyecto[] = []
  for (const [perfil, cuantos] of reparto) {
    for (let i = 1; i <= cuantos; i++) {
      const nombre = `${perfil}-p${i}`
      const ruta = join(agente.raiz, nombre)
      mkdirSync(ruta)
      writeFileSync(join(ruta, 'nota.txt'), `proyecto ${nombre}\n`)
      if (i === 1) {
        git(ruta, FECHA, 'init', '-q', '-b', 'main')
        git(ruta, FECHA, 'add', '-A')
        git(ruta, FECHA, 'commit', '-q', '-m', 'inicio')
        writeFileSync(join(ruta, 'nota.txt'), `proyecto ${nombre}, cambiado\n`)
      }
      proyectos.push({ perfil, nombre, ruta })
    }
  }
  return { agente, reparto, proyectos }
}

/** Todo NATIVO y sin sandbox; la franja inferior, como diga `franja` ('' = cerrada). */
function sembrar(datos: string, m: Montaje, franja: '' | 'terminal'): void {
  const colores = ['#9814c8', '#1f9e7a', '#c8641e']
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify(
      m.reparto.map(([id], i) => ({
        id,
        nombre: nombrePerfil(id),
        color: colores[i % colores.length],
        agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
        sandbox: { habilitado: false }
      }))
    )
  )
  const byProfile: Record<string, object> = {}
  for (const [id] of m.reparto) {
    const suyos = m.proyectos.filter((p) => p.perfil === id)
    byProfile[id] = {
      openProjects: suyos.map((p) => ({ projectHostPath: p.ruta, name: p.nombre, estado: 'active' })),
      activePath: suyos[0].ruta
    }
  }
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: m.reparto[0][0],
      byProfile,
      settings: {
        defaultProjectMode: 'windows',
        windowsModeProjects: m.proyectos.map((p) => `${p.perfil}|${p.ruta}`),
        panelInferiorPorPerfil: Object.fromEntries(m.reparto.map(([id]) => [id, franja])),
        menuWindowsAvisado: true
      }
    })
  )
}

/** Lo que devuelve `window.__tesseraRendimiento.foto()`. */
interface Foto {
  renders: Record<string, { total: number; porClave: Record<string, number> }>
  eventos: Record<string, number>
  duraciones: Record<string, { n: number; mediana: number; max: number }>
  tareasLargas: { inicio: number; duracion: number }[]
}
interface Diagnostico {
  activar: () => void
  reiniciar: () => void
  foto: () => Foto
}
type VentanaConDiagnostico = Window & { __tesseraRendimiento: Diagnostico }

/** Recuentos de UN cambio de perfil. */
interface Medida {
  app: number
  ccPanel: number
  areaEditor: number
  barraTitulo: number
  rendersDePane: number
  panesDistintos: number
  resizes: number
  tareasLargas: number
  tareaMasLarga: number
  /** Del clic a la confirmación del backend, en ms (solo informe). */
  hastaConfirmar: number
}

/**
 * Espera a que la ventana deje de pintar (medio segundo sin renders nuevos) y devuelve
 * lo contado: los renders de un cambio llegan en varias tandas asíncronas (git, IPC).
 */
async function fotoEnReposo(win: Page): Promise<Foto> {
  const { foto, asentada } = await win.evaluate(
    () =>
      new Promise<{ foto: Foto; asentada: boolean }>((resolver) => {
        const d = (window as unknown as VentanaConDiagnostico).__tesseraRendimiento
        const firma = (): string => JSON.stringify(d.foto().renders)
        let ultima = firma()
        let iguales = 0
        let vueltas = 0
        const reloj = setInterval(() => {
          const ahora = firma()
          iguales = ahora === ultima ? iguales + 1 : 0
          ultima = ahora
          if (iguales >= 5 || ++vueltas > 100) {
            clearInterval(reloj)
            resolver({ foto: d.foto(), asentada: iguales >= 5 })
          }
        }, 100)
      })
  )
  expect(asentada, 'la ventana no dejó de pintar en 10 s: no hay un cambio que medir').toBe(true)
  return foto
}

function medidaDe(foto: Foto): Medida {
  const panes = foto.renders.AgentTerminalPane
  const largas = foto.tareasLargas.map((t) => t.duracion)
  return {
    app: foto.renders.App?.total ?? 0,
    ccPanel: foto.renders.CCPanel?.total ?? 0,
    areaEditor: foto.renders.AreaEditor?.total ?? 0,
    barraTitulo: foto.renders.BarraTitulo?.total ?? 0,
    rendersDePane: panes?.total ?? 0,
    panesDistintos: Object.keys(panes?.porClave ?? {}).length,
    resizes: foto.eventos['pty:resize'] ?? 0,
    tareasLargas: largas.length,
    tareaMasLarga: Math.round(Math.max(0, ...largas)),
    hastaConfirmar: Math.round(foto.duraciones['perfil:cambio']?.mediana ?? 0)
  }
}

/** Cambia al perfil con un clic y devuelve lo que costó. */
async function cambiarPerfil(win: Page, id: string): Promise<Medida> {
  await win.evaluate(() => (window as unknown as VentanaConDiagnostico).__tesseraRendimiento.reiniciar())
  await win.locator('.profile-tab', { hasText: nombrePerfil(id) }).first().click()
  await expect(win.locator('.profile-tab.active', { hasText: nombrePerfil(id) })).toHaveCount(1)
  return medidaDe(await fotoEnReposo(win))
}

/**
 * El peor caso de cada recuento en una tanda de cambios. `resizes` es la excepción: cuenta
 * EN CUÁNTOS cambios hubo algún redimensionado, porque el pane de una sesión recién abierta
 * puede ajustar su alto un instante después y eso no es culpa del cambio de perfil.
 */
function peor(medidas: readonly Medida[]): Medida {
  const fuera = { ...medidas[0] }
  for (const m of medidas) {
    for (const k of Object.keys(fuera) as (keyof Medida)[]) fuera[k] = Math.max(fuera[k], m[k])
  }
  fuera.resizes = medidas.filter((m) => m.resizes > 0).length
  return fuera
}

/**
 * Las medidas de tiempo y de tareas largas no valen con la ventana tapada o minimizada
 * (Chromium frena temporizadores y fotogramas): se corta con un mensaje claro.
 */
async function exigirVentanaVisible(win: Page): Promise<void> {
  const estado = await win.evaluate(() => document.visibilityState)
  expect(estado, 'la ventana de la prueba tiene que estar a la vista mientras se mide').toBe('visible')
}

/** Sin puntos «despertando» pegados, ni en los proyectos ni en los perfiles. */
async function exigirSinDespertando(win: Page): Promise<void> {
  await expect(win.locator('.project-dot.spinner, .profile-tab-dot.spinner')).toHaveCount(0, { timeout: 30_000 })
}

/** `IDAS_Y_VUELTAS` entre los dos primeros perfiles; devuelve el peor caso. */
async function idasYVueltas(win: Page, m: Montaje): Promise<Medida> {
  await exigirVentanaVisible(win)
  const [a, b] = [m.reparto[0][0], m.reparto[1][0]]
  const medidas: Medida[] = []
  for (let i = 0; i < IDAS_Y_VUELTAS; i++) {
    medidas.push(await cambiarPerfil(win, b))
    medidas.push(await cambiarPerfil(win, a))
  }
  return peor(medidas)
}

interface Resultado {
  proyectos: number
  /** Primera visita a un perfil (despierta su proyecto activo). */
  primeraVisita: Medida
  /** En caliente, con un solo proyecto visitado por perfil. */
  soloActivos: Medida
  /** En caliente, con todos los proyectos visitados (todas las sesiones vivas). */
  todosVisitados: Medida
}

async function abrir(m: Montaje, franja: '' | 'terminal'): Promise<SesionTessera> {
  const s = await abrirTessera(m.agente.env, { sembrar: (datos) => sembrar(datos, m, franja) })
  await s.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.unmaximize()
    w.setSize(1500, 950)
  })
  return s
}

/** Visita un proyecto del perfil activo y espera a que arranque su agente. */
async function visitarProyecto(win: Page, m: Montaje, nombre: string, arranquesEsperados: number): Promise<void> {
  await win.locator('.tabs-projects .project-tab', { hasText: nombre }).first().click()
  await expect.poll(() => m.agente.arranques().length, { timeout: 60_000 }).toBe(arranquesEsperados)
}

/**
 * Recorre el guion entero sobre un reparto: primera visita, cambios con un proyecto por
 * perfil y cambios con todos visitados (y una pestaña de editor en cada proyecto del
 * primer perfil, para que el salto «con pestañas / sin pestañas» entre en la medida).
 */
async function medir(reparto: Reparto): Promise<Resultado> {
  const m = montar(reparto)
  let s: SesionTessera | null = null
  try {
    s = await abrir(m, '')
    const win = s.win
    await expect.poll(() => m.agente.arranques().length, { timeout: 60_000 }).toBe(1)
    await win.evaluate(() => (window as unknown as VentanaConDiagnostico).__tesseraRendimiento.activar())

    // Primera visita a cada uno de los demás perfiles: arranca el agente de su activo.
    let primeraVisita: Medida | null = null
    let arranques = 1
    for (const [id] of reparto.slice(1)) {
      const medida = await cambiarPerfil(win, id)
      primeraVisita ??= medida
      await expect.poll(() => m.agente.arranques().length, { timeout: 60_000 }).toBe(++arranques)
    }
    await cambiarPerfil(win, reparto[0][0])
    await exigirSinDespertando(win)
    const soloActivos = await idasYVueltas(win, m)

    // Todos los proyectos visitados, y vuelta al activo original de cada perfil.
    for (const [id] of reparto) {
      await cambiarPerfil(win, id)
      const suyos = m.proyectos.filter((p) => p.perfil === id)
      for (const p of suyos.slice(1)) await visitarProyecto(win, m, p.nombre, ++arranques)
      if (id === reparto[0][0]) {
        for (const p of [...suyos].reverse()) {
          await win.locator('.tabs-projects .project-tab', { hasText: p.nombre }).first().click()
          await abrirDesdeArbol(win, 'nota.txt')
        }
      } else {
        await win.locator('.tabs-projects .project-tab', { hasText: suyos[0].nombre }).first().click()
      }
      await asentar(win)
    }
    expect(arranques, 'cada proyecto arrancó su agente una vez').toBe(m.proyectos.length)
    await cambiarPerfil(win, reparto[0][0])
    await exigirSinDespertando(win)
    const todosVisitados = await idasYVueltas(win, m)

    await exigirSinDespertando(win)
    expect(m.agente.arranques().length, 'cambiar de perfil no lanza ningún agente').toBe(m.proyectos.length)
    return { proyectos: m.proyectos.length, primeraVisita: primeraVisita!, soloActivos, todosVisitados }
  } finally {
    await s?.cerrar()
    await borrarTemporal(m.agente.raiz)
  }
}

function informar(r: Resultado): void {
  console.log(`\n[rendimiento] ${r.proyectos} proyectos abiertos — peor caso por cambio de perfil`)
  console.table({ 'primera visita': r.primeraVisita, 'solo activos': r.soloActivos, 'todos visitados': r.todosVisitados })
}

function exigirPresupuesto(r: Resultado): void {
  if (SOLO_MEDIR) return
  const caso = `con ${r.proyectos} proyectos`
  expect(r.primeraVisita.panesDistintos, `panes repintados en la primera visita ${caso}`).toBeLessThanOrEqual(
    PRESUPUESTO.panesDistintosPrimeraVisita
  )
  for (const [nombre, medida] of [['solo activos', r.soloActivos], ['todos visitados', r.todosVisitados]] as const) {
    expect(medida.panesDistintos, `panes repintados por cambio (${nombre}) ${caso}`).toBeLessThanOrEqual(
      PRESUPUESTO.panesDistintos
    )
    expect(medida.rendersDePane, `renders de pane por cambio (${nombre}) ${caso}`).toBeLessThanOrEqual(
      PRESUPUESTO.rendersDePane
    )
    expect(medida.resizes, `cambios con redimensionado del pty (${nombre}) ${caso}`).toBeLessThanOrEqual(
      PRESUPUESTO.cambiosConResize
    )
  }
}

test.describe('cambiar de perfil cuesta lo mismo con 4 proyectos que con 12', () => {
  test.describe.configure({ timeout: 600_000 })

  for (const [nombre, reparto] of [['4', PEQUENO], ['12', GRANDE]] as const) {
    test(`con ${nombre} proyectos abiertos`, async () => {
      const r = await medir(reparto)
      informar(r)
      exigirPresupuesto(r)
    })
  }
})

test('la terminal de shell devuelve su contexto WebGL al ocultarse', async () => {
  const m = montar(PEQUENO)
  let s: SesionTessera | null = null
  try {
    s = await abrir(m, 'terminal')
    const win = s.win
    await expect(win.locator('.terminal-pane:not(.hidden) .xterm-screen')).toHaveCount(1, { timeout: 60_000 })
    await asentar(win)
    // Se guardan los lienzos WebGL de la terminal a la vista: `getContext` devuelve el
    // contexto que el lienzo ya tiene aunque después salga del DOM.
    const guardados = await win.evaluate(() => {
      const lienzos = Array.from(document.querySelectorAll<HTMLCanvasElement>('.terminal-pane:not(.hidden) canvas'))
      const webgl = lienzos.filter((c) => c.getContext('webgl2') !== null)
      ;(window as unknown as { e2eLienzos: HTMLCanvasElement[] }).e2eLienzos = webgl
      return webgl.length
    })
    test.skip(guardados === 0, 'este equipo no da WebGL a la terminal: no hay contexto que devolver')

    await win.locator('.profile-tab', { hasText: nombrePerfil(m.reparto[1][0]) }).first().click()
    await expect(win.locator('.profile-tab.active', { hasText: nombrePerfil(m.reparto[1][0]) })).toHaveCount(1)
    await asentar(win)
    const perdidos = await win.evaluate(
      () =>
        (window as unknown as { e2eLienzos: HTMLCanvasElement[] }).e2eLienzos.filter(
          (c) => c.getContext('webgl2')?.isContextLost() === true
        ).length
    )
    expect(perdidos, 'los contextos WebGL de la terminal que se ocultó quedaron devueltos').toBe(guardados)
  } finally {
    await s?.cerrar()
    await borrarTemporal(m.agente.raiz)
  }
})
