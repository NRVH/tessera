// =============================================================================
// El mosaico de agentes sobre la app empaquetada: entrar y salir NO corta a ningún agente
// (basta un envoltorio condicional en React para desmontar un pane y cerrar su sesión), y
// xterm no se come Ctrl+3 ni Ctrl+Shift+↩ antes que el mosaico. El agente es falso
// (`agenteFalso.ts`) y apunta cada arranque, pid y byte recibido: «ninguna sesión nueva» =
// el log no suma arranques, «ninguna cerrada» = los pid viven, «el atajo no llegó» = ningún
// ESC ni CR. También la señal de actividad main → renderer → selección y que mandar una
// casilla a otro proyecto arranca su sesión. Solo el modificador (`MOD`) depende del sistema.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, vivo, type EventoFalso } from './agenteFalso'
import {
  abrirTessera,
  borrarTemporal,
  MOD,
  pantallaCompleta,
  PLATAFORMA,
  type SesionTessera
} from './tessera'

/**
 * Proyectos de la prueba: dos en «Personal» y tres en «Trabajo», uno de ellos DORMIDO.
 * Cuatro despiertos porque el mosaico enseña UNA casilla por proyecto: con tres no
 * habría forma de llegar a la rejilla de 2 × 2, que es la que fija que la distribución
 * reparte bien. El quinto, hibernado, es el que prueba que se puede traer al mosaico
 * un proyecto dormido.
 */
const PROYECTOS = [
  { perfil: 'personal', nombre: 'alfa' },
  { perfil: 'personal', nombre: 'beta' },
  { perfil: 'trabajo', nombre: 'gamma' },
  { perfil: 'trabajo', nombre: 'delta' },
  // HIBERNADO desde el arranque: es el caso que no se podía traer al mosaico sin
  // salir de él. Se siembra dormido en vez de hibernarlo con el menú del perfil
  // porque eso llamaría al backend de hibernación (Docker), que en la prueba no hay.
  { perfil: 'trabajo', nombre: 'epsilon', hibernado: true }
]

interface Montaje {
  raiz: string
  log: string
  rutas: Record<string, string>
  env: Record<string, string>
}

/**
 * Crea el agente falso (con su PATH y, en Mac, su shell), los proyectos y el entorno
 * de la app. La carpeta del ayudante ya viene resuelta (`/private/var` en Mac), y los
 * proyectos cuelgan de ella: el agente apunta el `getcwd()` resuelto y sus eventos
 * tienen que casar con estas rutas.
 */
function montar(): Montaje {
  const { raiz, log, env } = montarAgenteFalso()
  const rutas: Record<string, string> = {}
  for (const p of PROYECTOS) {
    rutas[p.nombre] = join(raiz, p.nombre)
    mkdirSync(rutas[p.nombre])
    writeFileSync(join(rutas[p.nombre], 'LEEME.txt'), `proyecto ${p.nombre}\n`)
  }
  return { raiz, log, rutas, env }
}

/** `profiles.json` + `workspace-state.json`: dos perfiles, los `PROYECTOS`, todo NATIVO. */
function sembrar(datos: string, m: Montaje): void {
  const perfil = (id: string, nombre: string, color: string): object => ({
    id,
    nombre,
    color,
    agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
    sandbox: { habilitado: false }
  })
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify([perfil('personal', 'Personal', '#9814c8'), perfil('trabajo', 'Trabajo', '#1f9e7a')])
  )
  const abiertos = (id: string): object[] =>
    PROYECTOS.filter((p) => p.perfil === id).map((p) => ({
      projectHostPath: m.rutas[p.nombre],
      name: p.nombre,
      estado: p.hibernado === true ? 'hibernated' : 'active'
    }))
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: {
        personal: { openProjects: abiertos('personal'), activePath: m.rutas.alfa },
        trabajo: { openProjects: abiertos('trabajo'), activePath: m.rutas.gamma }
      },
      settings: {
        defaultProjectMode: 'windows',
        windowsModeProjects: PROYECTOS.map((p) => `${p.perfil}|${m.rutas[p.nombre]}`)
      }
    })
  )
}

function eventos(log: string): EventoFalso[] {
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EventoFalso)
}
const arranques = (log: string): EventoFalso[] => eventos(log).filter((e) => e.tipo === 'arranque')

/** Deja que React confirme el render provocado por el gesto (ver `atajos.spec.ts`). */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Casillas PINTADAS del mosaico, con su nombre accesible y su caja. */
async function casillas(win: Page): Promise<{ nombre: string; x: number; y: number; w: number; h: number }[]> {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('.right-panel.cc-mosaico > .agent-pane:not(.hidden)')).map((el) => {
      const r = el.getBoundingClientRect()
      return { nombre: el.getAttribute('aria-label') ?? '', x: r.x, y: r.y, w: r.width, h: r.height }
    })
  )
}

/**
 * Pulsa la pestaña de agente (Claude Code / Codex) de la casilla que está a la vista.
 *
 * COMPRUEBA A MANO Y PULSA CON `force`, y no es un atajo para tapar un fallo: en macOS,
 * pulsarla justo al cambiar de proyecto dejaba la comprobación de accionabilidad de
 * Playwright atascada en «element is not visible» durante TODO el timeout, tumbando el
 * `beforeAll` y con él las diez pruebas del archivo. Esperar a `toBeVisible()` delante
 * NO basta: esa comprobación dice que sí y el clic se atasca igual (visto).
 *
 * Lo que se midió, porque el síntoma acusa a la app y la app no tiene la culpa: el nodo
 * del botón no cambia ni se desconecta (0 remontajes en 37 muestras de 400 ms), la
 * página sigue pintando a 60 fps durante toda la espera, su caja es 90×20 con opacidad
 * 1, `elementFromPoint` sobre su centro devuelve su propio rótulo (no lo tapa nadie), un
 * clic con `force` entra al instante y —lo que lo cierra— `isVisible()` devuelve `true`
 * NADA MÁS fallar el clic diciendo que no lo es. Con esta espera delante, o con
 * cualquier otra llamada que meta medio segundo, pulsa a la primera.
 */
async function pulsarAgente(win: Page, agente: 'Claude Code' | 'Codex'): Promise<void> {
  const boton = win.locator(`.agent-pane:not(.hidden) .agent-switch-btn[aria-label="${agente}"]`)
  await expect(boton).toBeVisible()
  // Lo que `force` se salta, comprobado aquí a mano: que en el centro del botón esté el
  // botón (o algo suyo) y no otra cosa encima. Así la prueba verifica MÁS que un clic
  // normal, no menos: un velo que lo tapara seguiría siendo un fallo.
  await expect
    .poll(
      async () =>
        boton.evaluate((b) => {
          const r = b.getBoundingClientRect()
          const enElPunto = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return enElPunto !== null && (enElPunto === b || b.contains(enElPunto))
        }),
      { message: `algo tapa la pestaña «${agente}»` }
    )
    .toBe(true)
  // `dispatchEvent` y no `click({ force: true })`: el forzado SIGUE desplazando el
  // elemento a la vista antes de pulsar, y es ahí donde vuelve a decir «Element is not
  // visible» (visto tras creerlo arreglado con `force`). Esto manda el clic al
  // elemento que las dos comprobaciones de arriba acaban de dar por bueno, sin pasar
  // por la accionabilidad de Playwright, que es justo la que aquí se atasca. Lo que
  // se pierde —el recorrido del ratón— no es lo que prueba este spec.
  await boton.dispatchEvent('click')
  // Y SE ESPERA A QUE LA PESTAÑA QUEDE ELEGIDA. El clic normal traía esta espera de
  // regalo (su comprobación de accionabilidad sincroniza), y al cambiarlo por el
  // sintético se perdió: la prueba seguía antes de que la casilla hubiera cambiado de
  // agente, y lo que se tecleaba después no llegaba a ninguna terminal. Se vio en la
  // batería completa, no en este spec a solas.
  await expect(boton).toHaveAttribute('aria-selected', 'true')
  // Y A QUE HAYA DÓNDE TECLEAR. El atributo solo no basta: si el agente pedido YA era
  // el elegido, el clic no hace nada y `aria-selected` ya valía «true», así que la
  // espera se cumplía sin haber esperado a nada. Lo que viene detrás teclea en la
  // terminal, de modo que lo que hay que exigir es que la terminal de la casilla a la
  // vista esté montada.
  await expect(win.locator('.agent-pane:not(.hidden) .xterm-screen')).toBeVisible()
}

/**
 * Centro horizontal del botón del mosaico y del primer icono del riel, en px CSS (`-1`
 * si no está). Lo comparten la prueba del eje en Windows y su pareja de la pantalla
 * completa de Mac: los selectores viven en UN sitio, y si cambian, las dos miden lo
 * mismo en vez de que una se quede midiendo `-1`.
 */
async function ejesDelMosaico(win: Page): Promise<{ boton: number; riel: number }> {
  return win.evaluate(() => {
    const centro = (el: Element | null): number => {
      const r = el?.getBoundingClientRect()
      return r ? r.left + r.width / 2 : -1
    }
    return {
      boton: centro(document.querySelector('.titlebar-inicio button[aria-label="Mosaico de agentes"]')),
      riel: centro(document.querySelector('.activity-bar .activity-item'))
    }
  })
}

/**
 * Mete una sesión en el mosaico desde el selector «N de M» de la barra. Sólo pulsa
 * las que NO están ya marcadas: alternar una que ya es casilla la QUITARÍA.
 */
async function ponerCasilla(win: Page, texto: string): Promise<void> {
  await win.locator('.barra-mosaico-selector').click()
  const item = win.locator('.ctx-menu-item[aria-checked="false"]', { hasText: texto })
  if ((await item.count()) > 0) await item.first().click()
  else await win.keyboard.press('Escape')
}

/** Saca una sesión del mosaico desde el selector (sólo si está marcada). */
async function quitarCasilla(win: Page, texto: string): Promise<void> {
  await win.locator('.barra-mosaico-selector').click()
  const item = win.locator('.ctx-menu-item[aria-checked="true"]', { hasText: texto })
  if ((await item.count()) > 0) await item.first().click()
  else await win.keyboard.press('Escape')
}

/** Perfil y proyecto de una casilla, a partir de su nombre accesible. */
function proyectoDeCasilla(nombre: string): string {
  return nombre.split(' · ').slice(0, 2).join(' · ')
}

/** Las cuatro casillas con las que se miden las distribuciones. */
const CUATRO = ['Personal · alfa', 'Personal · beta', 'Trabajo · gamma', 'Trabajo · delta']

/**
 * Entra al mosaico y deja EXACTAMENTE esas cuatro como casillas. Desde que el mosaico
 * abre sólo con lo que está trabajando, la rejilla llena es algo que monta el usuario:
 * se monta aquí igual, por el selector.
 *
 * NORMALIZA, no sólo añade: quita lo que no pidamos. Si sólo añadiera, una prueba que
 * deja otra casilla puesta —la de despertar un hibernado, por ejemplo— haría fallar el
 * `toBe(4)` y las medidas de la rejilla 2 × 2 de OTRA prueba, dos tests más allá y sin
 * pista de por qué.
 */
async function mosaicoConTodas(win: Page): Promise<void> {
  await win.keyboard.press(`${MOD}+Shift+KeyM`)
  await expect(win.locator('.shell.modo-mosaico')).toHaveCount(1)
  for (const nombre of (await casillas(win)).map((c) => proyectoDeCasilla(c.nombre))) {
    if (!CUATRO.includes(nombre)) await quitarCasilla(win, nombre)
  }
  for (const t of CUATRO) await ponerCasilla(win, t)
  await expect.poll(async () => (await casillas(win)).length).toBe(4)
}

/** Nombre de la casilla que tiene el foco del teclado, o null. */
async function casillaEnfocada(win: Page): Promise<string | null> {
  return win.evaluate(
    () => document.activeElement?.closest('.agent-pane')?.getAttribute('aria-label') ?? null
  )
}

test.describe('mosaico de agentes', () => {
  let s: SesionTessera
  let m: Montaje

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.env, { sembrar: (datos) => sembrar(datos, m) })
    // Ventana de tamaño conocido: la distribución depende de él.
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
    const win = s.win
    // Arranca CUATRO sesiones como lo haría el usuario: mirando cada proyecto. Las
    // sesiones son perezosas (sólo abre la que se ve), así que hay que pasar por ellas.
    await expect.poll(() => arranques(m.log).length, { timeout: 60_000 }).toBe(1) // alfa · CC
    await win.locator('.tabs-projects .project-tab', { hasText: 'beta' }).first().click()
    await expect.poll(() => arranques(m.log).length, { timeout: 60_000 }).toBe(2) // beta · CC
    await win.locator('.profile-tab', { hasText: 'Trabajo' }).first().click()
    await expect.poll(() => arranques(m.log).length, { timeout: 60_000 }).toBe(3) // gamma · CC
    await win.locator('.tabs-projects .project-tab', { hasText: 'delta' }).first().click()
    await expect.poll(() => arranques(m.log).length, { timeout: 60_000 }).toBe(4) // delta · CC
    // Y el SEGUNDO agente de gamma, que es lo que hace medible "una casilla por
    // proyecto": gamma tiene las dos sesiones vivas y aun así ocupa UNA fila y UNA
    // casilla.
    await win.locator('.tabs-projects .project-tab', { hasText: 'gamma' }).first().click()
    await pulsarAgente(win, 'Codex')
    await expect.poll(() => arranques(m.log).length, { timeout: 60_000 }).toBe(5) // gamma · Codex
    // El botón del mosaico se habilita en cuanto hay algo en marcha.
    await expect(win.locator('.titlebar-inicio button[aria-label="Mosaico de agentes"]')).toBeEnabled({
      timeout: 30_000
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) await borrarTemporal(m.raiz)
  })

  test('el botón del mosaico encabeza el riel: mismo eje que sus iconos, a la izquierda', async () => {
    // En Mac esa esquina es del semáforo y el botón va detrás de él (ver
    // `.titlebar-inicio`): ahí no hay eje del riel que compartir.
    test.skip(PLATAFORMA === 'mac', 'en macOS el botón va tras el semáforo, no sobre el riel')
    const ejes = await ejesDelMosaico(s.win)
    expect(ejes.boton, 'el botón existe y está a la izquierda').toBeGreaterThan(0)
    expect(Math.abs(ejes.boton - ejes.riel), `botón ${ejes.boton} vs riel ${ejes.riel}`).toBeLessThan(1.5)
  })

  // LA PAREJA DE LA DE ARRIBA EN MAC. En pantalla completa macOS esconde el semáforo, y
  // hasta la v0.59.1 la barra conservaba sus ~80 px de hueco con el botón flotando en
  // medio de la nada. Sin semáforo, el botón tiene que ir donde en Windows: al eje del
  // riel. Y al salir, volver detrás del semáforo. Es de e2e y no de un test puro porque
  // la señal es un `geometrychange` que sólo emite Chromium con la ventana de verdad.
  test('en la PANTALLA COMPLETA de macOS, sin semáforo, el botón vuelve al eje del riel', async () => {
    test.skip(
      PLATAFORMA !== 'mac',
      'el arreglo es sólo de macOS; qué hace el overlay de Windows con F11 está sin medir'
    )
    const medir = async (): Promise<{ boton: number; riel: number; relleno: string }> => ({
      ...(await ejesDelMosaico(s.win)),
      relleno: await s.win.evaluate(() => getComputedStyle(document.querySelector('.titlebar')!).paddingLeft)
    })

    const enVentana = await medir()
    expect(parseFloat(enVentana.relleno), 'en ventana hay hueco para el semáforo').toBeGreaterThan(60)
    expect(enVentana.boton - enVentana.riel, 'y el botón va detrás de él, no sobre el riel').toBeGreaterThan(40)

    try {
      expect(await pantallaCompleta(s.app, true)).toBe(true)
      await expect.poll(async () => (await medir()).relleno, { message: 'sin semáforo, sin hueco' }).toBe('0px')
      const sinSemaforo = await medir()
      expect(
        Math.abs(sinSemaforo.boton - sinSemaforo.riel),
        `botón ${sinSemaforo.boton} vs riel ${sinSemaforo.riel}`
      ).toBeLessThan(1.5)
    } finally {
      // Siempre se sale: las demás pruebas de este `describe` comparten la ventana.
      // `pantallaCompleta` lleva tiempo límite para que este `finally` llegue a correr.
      await pantallaCompleta(s.app, false)
    }

    // Al salir se compara con el ANCHO DEL SEMÁFORO y no con los píxeles de `enVentana`,
    // porque aquí `enVentana` NO es el valor normal. Medido con una sonda en la app
    // empaquetada: el `titlebar-area-x` vale 86 al arrancar y tras una recarga, pero el
    // `unmaximize()` + `setSize(1500, 950)` del `beforeAll` lo deja en 82; al salir de
    // pantalla completa Electron recoloca el semáforo y vuelve a 86. O sea que el botón
    // no queda desplazado: vuelve a su sitio normal, y exigir el 82 sería exigir el
    // efecto de ese `setSize`, que no es de esta prueba.
    await expect
      .poll(async () => parseFloat((await medir()).relleno), { message: 'al salir vuelve el hueco del semáforo' })
      .toBeGreaterThan(60)
    const deVuelta = await medir()
    expect(deVuelta.boton - deVuelta.riel, 'y el botón vuelve detrás del semáforo').toBeGreaterThan(40)
  })

  // LA REGLA DE ENTRADA, DE PUNTA A PUNTA. Qué entra lo fija `test-mosaico-teselas.mts`,
  // pero que la señal de "trabajando" llegue de verdad desde el main (agentActivity ->
  // IPC -> renderer) hasta la selección no lo puede ver ningún test puro: es la cadena
  // que hacía abrir seis casillas con tres agentes en marcha.
  test('al entrar sólo se abre lo que está TRABAJANDO, no lo que mirabas', async () => {
    const win = s.win
    // Se pone a trabajar a gamma·Claude Code y se deja ACTIVO a gamma·Codex: así la
    // casilla que salga distingue "entra lo que trabaja" de "entra lo que mirabas".
    await pulsarAgente(win, 'Claude Code')
    await win.locator('.agent-pane:not(.hidden) .xterm-screen').click()
    await win.keyboard.type('trabaja')
    await win.keyboard.press('Enter')
    // El turno se abre en el main al detectar el envío y vuelve por IPC: el dot late.
    await expect.poll(() => win.locator('.profile-tab-dot.working').count(), { timeout: 20_000 }).toBeGreaterThan(0)
    await pulsarAgente(win, 'Codex')
    await asentar(win)

    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(1)
    const abiertas = await casillas(win)
    expect(abiertas.length, 'una casilla: sólo hay un agente trabajando').toBe(1)
    expect(abiertas[0].nombre).toMatch(/Trabajo · gamma · Claude Code/)
    await expect(win.locator('.barra-mosaico-resumen')).toContainText('1 trabajando')
    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
  })

  // UNA CASILLA POR PROYECTO. El selector listaba (proyecto × agente), así que se
  // podían marcar Claude Code y Codex del mismo árbol de trabajo y salían dos
  // casillas con el mismo título y un chip de tres letras de diferencia.
  test('el selector lista PROYECTOS: nunca dos casillas del mismo proyecto', async () => {
    const win = s.win
    await mosaicoConTodas(win)
    await win.locator('.barra-mosaico-selector').click()
    const filas = win.locator('.ctx-menu-item')
    // Una fila por proyecto, aunque gamma tenga vivos sus DOS agentes (lo deja así el
    // `beforeAll`).
    // Cinco proyectos abiertos: cuatro despiertos y `epsilon` hibernado, que TAMBIÉN
    // se lista (dormido no es cerrado).
    await expect(filas).toHaveCount(5)
    // Y se dice que está DORMIDO: marcarlo levanta su contenedor, que es el único
    // clic de esta lista con ese coste.
    await expect(win.locator('.ctx-menu-item', { hasText: 'Trabajo · epsilon' })).toHaveCount(1)
    await expect(win.locator('.ctx-menu-item', { hasText: 'Trabajo · epsilon' })).toContainText('dormido')
    await expect(win.locator('.ctx-menu-item', { hasText: 'Trabajo · gamma' })).toHaveCount(1)
    await expect(filas.filter({ hasText: 'Claude Code' })).toHaveCount(0)
    await expect(filas.filter({ hasText: 'Codex' })).toHaveCount(0)
    await win.keyboard.press('Escape')
    await expect(win.locator('.ctx-menu')).toHaveCount(0)

    const proyectos = new Set(
      (await casillas(win)).map((c) => c.nombre.split(' · ').slice(0, 2).join(' · '))
    )
    expect(proyectos.size, 'las cuatro casillas son de proyectos distintos').toBe(4)

    // Y desde la cabecera tampoco: lo que ya tiene terminal sale EN GRIS y lo dice.
    const casillaGamma = win.locator('.right-panel.cc-mosaico > .agent-pane[aria-label*="Trabajo · gamma"]')
    await casillaGamma.locator('.casilla-nombre-btn').click()
    const ocupado = win.locator('.ctx-menu-item', { hasText: 'delta' })
    await expect(ocupado).toContainText('terminal abierta')
    await expect(ocupado).toBeDisabled()
    await win.keyboard.press('Escape')
    await expect(win.locator('.ctx-menu')).toHaveCount(0)

    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
  })

  // UN PROYECTO DORMIDO SE PUEDE TRAER AL MOSAICO. Estaba filtrado porque la
  // reconciliación saca del mosaico lo que no existe —y un hibernado no existe para
  // ella—, así que para abrir uno había que salir del mosaico, abrirlo en la banda y
  // volver a entrar. Ahora se lista y al elegirlo se despierta, igual que entrar a su
  // pestaña: es de e2e porque la cadena entera (despertar → modelo → reconciliación →
  // pane que arranca su sesión) sólo existe con la app corriendo.
  test('un proyecto hibernado se lista en la casilla y al elegirlo despierta ahí', async () => {
    const win = s.win
    await mosaicoConTodas(win)
    const antes = arranques(m.log).length
    const casillaTrabajo = win.locator('.right-panel.cc-mosaico > .agent-pane[aria-label*="Trabajo · gamma"]')
    await casillaTrabajo.locator('.casilla-nombre-btn').click()
    const dormido = win.locator('.ctx-menu-item', { hasText: 'epsilon' })
    await expect(dormido, 'el hibernado se lista en el menú de su perfil').toHaveCount(1)
    await dormido.click()

    // Despierta, la casilla pasa a enseñarlo y su agente arranca de verdad.
    await expect
      .poll(async () => (await casillas(win)).map((c) => c.nombre).join(' | '))
      .toContain('Trabajo · epsilon')
    await expect.poll(() => arranques(m.log).length, { timeout: 60_000 }).toBe(antes + 1)
    expect(arranques(m.log).at(-1)?.cwd, 'y arrancó EN epsilon').toBe(m.rutas.epsilon)
    expect((await casillas(win)).length, 'sigue habiendo cuatro casillas').toBe(4)

    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
  })

  test('entrar y salir NO abre ni cierra ninguna sesión: son las mismas terminales', async () => {
    const win = s.win
    const antes = arranques(m.log)
    // Se marca cada nodo de terminal ANTES de entrar. Si React desmontara un pane, el
    // nodo nuevo no llevaría la marca: es la prueba de que no se remontó nada.
    const marcados = await win.evaluate(() => {
      const panes = Array.from(document.querySelectorAll('.agent-pane'))
      panes.forEach((el, i) => el.setAttribute('data-e2e-marca', String(i)))
      return panes.length
    })

    await mosaicoConTodas(win)
    // Orden canónico EN PANTALLA (filas de arriba abajo, cada una de izquierda a
    // derecha), no el del DOM: el del DOM no cambia con el mosaico y esto pasaría
    // aunque la rejilla colocara a Trabajo a la izquierda de Personal.
    const cajas = await casillas(win)
    const nombres = [...cajas]
      .sort((a, b) => Math.round(a.y) - Math.round(b.y) || Math.round(a.x) - Math.round(b.x))
      .map((c) => c.nombre)
    expect(nombres[0]).toContain('Personal · alfa')
    expect(nombres[1]).toContain('Personal · beta')
    expect(nombres[2]).toContain('Trabajo · gamma')
    expect(nombres[3]).toContain('Trabajo · delta')
    // Cuatro en una ventana apaisada: 2 arriba y 2 abajo.
    const filas = new Set(cajas.map((c) => Math.round(c.y)))
    const columnas = new Set(cajas.map((c) => Math.round(c.x)))
    expect(filas.size, 'dos filas').toBe(2)
    expect(columnas.size, 'dos columnas').toBe(2)
    // Las bandas de perfiles y de proyectos se esconden; la barra de título se queda.
    await expect(win.locator('.tabs-bar.mosaico .profile-tab').first()).toBeHidden()
    await expect(win.locator('.barra-mosaico')).toBeVisible()

    // Salir con el MISMO botón (pulsado) y volver a entrar por teclado.
    await win.locator('.titlebar-inicio button[aria-label="Mosaico de agentes"]').click()
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    // Al VOLVER a entrar manda otra vez la regla: sólo lo que trabaja (gamma·CC). Lo
    // que pusiste a mano no se recuerda, y por eso el mosaico no "arrastra" una
    // rejilla vieja a la siguiente vez que lo abres.
    await expect.poll(async () => (await casillas(win)).length).toBe(1)
    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
    await asentar(win)
    // Se deja pasar MÁS que el cierre elegante del main (Ctrl-C, `exit` y 3 s de
    // cortesía) antes de mirar: cerrar un pty y lanzar otro agente son asíncronos, y
    // comprobarlo al instante daría verde aunque hubiera pasado justo lo que se vigila.
    await win.waitForTimeout(4_000)
    const pids = new Set(antes.map((a) => a.pid))
    const cierres = eventos(m.log).filter(
      // Alineado a BYTES (pares hex desde el principio): un `03` a caballo entre dos
      // bytes no es un Ctrl-C.
      (e) => e.tipo === 'entrada' && pids.has(e.pid) && /^(..)*?(03|657869740a)/.test(e.hex ?? '')
    )
    expect(cierres, 'el main no mandó Ctrl-C ni `exit` a ningún agente').toEqual([])

    const siguenMarcados = await win.evaluate(
      () => document.querySelectorAll('.agent-pane[data-e2e-marca]').length
    )
    expect(siguenMarcados, 'ningún pane se remontó').toBe(marcados)
    expect(arranques(m.log).length, 'no se lanzó ningún agente nuevo').toBe(antes.length)
    for (const a of antes) expect(vivo(a.pid), `el agente ${a.agente} de ${a.cwd} sigue vivo`).toBe(true)
  })

  test('los atajos del mosaico NO llegan al agente (Ctrl+3 sería un ESC; Ctrl+Shift+↩, un CR)', async () => {
    const win = s.win
    await mosaicoConTodas(win)
    const desde = eventos(m.log).length

    // Saltar de casilla con Mod+1…4: el foco va a la casilla N.
    await win.keyboard.press(`${MOD}+Digit1`)
    await expect.poll(() => casillaEnfocada(win)).toContain('Personal · alfa')
    await win.keyboard.press(`${MOD}+Digit3`)
    await expect.poll(() => casillaEnfocada(win)).toContain('Trabajo · gamma')
    // Qué AGENTE enseña la casilla de gamma lo decide la regla de entrada (sus dos
    // sesiones están vivas), así que se lee del propio título en vez de darlo por
    // supuesto: lo que esta prueba mide es a dónde van las teclas, no cuál entró.
    const agenteGamma = /Codex/.test((await casillaEnfocada(win)) ?? '') ? 'codex' : 'claude'

    // Ampliar la enfocada MANTENIENDO el acorde: la primera pulsación amplía y las
    // repeticiones (Playwright manda `repeat: true` al repetir `down` de una tecla ya
    // pulsada) se tragan. Si alguna se escapara, xterm la convertiría en un CR y
    // mandaría el prompt: lo vigila la comprobación de «ningún CR» de más abajo.
    await win.keyboard.down(MOD)
    await win.keyboard.down('Shift')
    for (let i = 0; i < 4; i++) await win.keyboard.down('Enter')
    await win.keyboard.up('Enter')
    await win.keyboard.up('Shift')
    await win.keyboard.up(MOD)
    await expect.poll(async () => (await casillas(win)).length).toBe(1)
    expect((await casillas(win))[0].nombre).toContain('Trabajo · gamma')
    // Y restaurar con una pulsación normal.
    await win.keyboard.press(`${MOD}+Shift+Enter`)
    await expect.poll(async () => (await casillas(win)).length).toBe(4)

    // Escribir en la casilla enfocada llega a SU agente (y sólo al suyo).
    await win.keyboard.type('hola')
    await expect
      .poll(() =>
        eventos(m.log)
          .slice(desde)
          .filter((e) => e.tipo === 'entrada' && e.cwd === m.rutas.gamma && e.agente === agenteGamma)
          .map((e) => e.hex)
          .join('')
      )
      .toContain(Buffer.from('hola').toString('hex'))

    // Y SÓLO al suyo: ningún otro agente recibió nada.
    const ajenas = eventos(m.log)
      .slice(desde)
      .filter((e) => e.tipo === 'entrada' && !(e.cwd === m.rutas.gamma && e.agente === agenteGamma))
      .map((e) => e.hex ?? '')
      .join('')
    expect(ajenas, 'lo escrito sólo llega al agente de la casilla enfocada').toBe('')

    const entradas = eventos(m.log)
      .slice(desde)
      .filter((e) => e.tipo === 'entrada')
      .map((e) => e.hex ?? '')
      .join('')
    expect(entradas, 'ningún ESC llegó a un agente (Mod+3)').not.toContain('1b')
    expect(entradas, 'ningún CR llegó a un agente (Mod+Shift+Enter)').not.toContain('0d')

    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
  })

  test('en una ventana pequeña no se rompe: una casilla a la vista y fichas para cambiar', async () => {
    const win = s.win
    await mosaicoConTodas(win)

    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620))
    // Cuatro terminales de 50×12 no caben en 900×620: pasa a UNA casilla más fichas.
    await expect.poll(async () => (await casillas(win)).length, { timeout: 10_000 }).toBe(1)
    await expect(win.locator('.barra-mosaico-ficha')).toHaveCount(4)
    await win.locator('.barra-mosaico-ficha', { hasText: 'beta' }).click()
    await expect.poll(async () => (await casillas(win))[0]?.nombre ?? '').toContain('Personal · beta')

    // Y vuelve a la rejilla en cuanto hay sitio.
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950))
    await expect.poll(async () => (await casillas(win)).length, { timeout: 10_000 }).toBe(4)
    await expect(win.locator('.barra-mosaico-ficha')).toHaveCount(0)

    await win.keyboard.press(`${MOD}+Shift+KeyM`)
  })

  test('«Ir al proyecto» sale del mosaico y deja esa terminal a la vista', async () => {
    const win = s.win
    await mosaicoConTodas(win)
    // Se va a «Personal · alfa» a propósito: el proyecto activo de Personal es beta
    // desde el `beforeAll`, así que si «Ir al proyecto» no activara el proyecto la
    // prueba lo vería (con beta pasaría igual aunque no hiciera nada).
    // Las acciones de la cabecera se ESCONDEN en reposo y aparecen al pasar el ratón
    // por la casilla (la convención de todas las cabeceras de la app): se pasa primero,
    // como haría el usuario. Y se marca el nodo: tras salir tiene que ser ESE pane el
    // que se ve y tiene el teclado, no uno nuevo.
    const casilla = win.locator('.right-panel.cc-mosaico > .agent-pane[aria-label*="Personal · alfa"]')
    await casilla.evaluate((el) => el.setAttribute('data-e2e-destino', '1'))
    await casilla.hover()
    await casilla.locator('button[aria-label="Ir al proyecto"]').click()
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
    await expect(win.locator('.tabs-projects .project-tab.active', { hasText: 'alfa' })).toHaveCount(1, {
      timeout: 15_000
    })
    await expect(win.locator('.agent-pane[data-e2e-destino]')).not.toHaveClass(/\bhidden\b/)
    await expect
      .poll(() => win.evaluate(() => !!document.activeElement?.closest('.agent-pane[data-e2e-destino]')))
      .toBe(true)
  })

  // LOS TRES SELECTORES DE LA CABECERA. Lo que un test puro no puede ver: que elegir
  // otro proyecto cambie lo que se PINTA en ese hueco sin remontar nada, y sobre todo
  // que una sesión que NUNCA se había abierto arranque al ponerla en la casilla (el
  // latch `activated` del pane, que hasta ahora sólo lo movía `visible`). El agente
  // falso lo demuestra: aparece un arranque nuevo con su pid.
  test('la cabecera de una casilla elige proyecto, agente y modo', async () => {
    const win = s.win
    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(1)
    await expect.poll(async () => (await casillas(win)).length).toBe(1)
    // PUNTO DE PARTIDA CONOCIDO. Qué casilla abre depende de qué estaba trabajando y
    // de qué mirabas, o sea de las pruebas anteriores; se normaliza por el selector
    // (que usa la MISMA etiqueta que el `aria-label` de la casilla) para que lo que
    // mide esta prueba sean los selectores y no el orden de la suite.
    const inicial = proyectoDeCasilla((await casillas(win))[0].nombre)
    if (inicial !== 'Personal · alfa') {
      await ponerCasilla(win, 'Personal · alfa')
      await quitarCasilla(win, inicial)
      await expect.poll(async () => (await casillas(win))[0]?.nombre ?? '').toContain('Personal · alfa')
    }
    // Y con Claude Code delante, que es desde donde se mide el chip.
    if (!/Claude Code/.test((await casillas(win))[0].nombre)) {
      await win.locator('.right-panel.cc-mosaico > .agent-pane:not(.hidden) .casilla-agente-btn').click()
      await expect.poll(async () => (await casillas(win))[0]?.nombre ?? '').toContain('Claude Code')
    }
    const antes = arranques(m.log).length
    const panes = await win.evaluate(() => document.querySelectorAll('.agent-pane').length)
    const casilla = win.locator('.right-panel.cc-mosaico > .agent-pane:not(.hidden)')

    // 1) El NOMBRE es el menú de proyectos. El proyecto que ya se ve sale marcado y
    //    deshabilitado: es donde estás, no un sitio al que ir.
    await casilla.locator('.casilla-nombre-btn').click()
    await expect(win.locator('.ctx-menu-item[aria-checked="true"]')).toBeDisabled()
    // SÓLO los proyectos de SU perfil, y la salida para abrir otro: los de los demás
    // perfiles los ofrece el selector de la barra, y repetirlos aquí eran dos
    // controles para lo mismo.
    await expect(win.locator('.ctx-menu-item', { hasText: 'gamma' })).toHaveCount(0)
    await expect(win.locator('.ctx-menu-item', { hasText: 'delta' })).toHaveCount(0)
    await expect(win.locator('.ctx-menu-item', { hasText: 'Abrir otro proyecto en Personal' })).toHaveCount(1)
    await win.locator('.ctx-menu-item', { hasText: 'beta' }).first().click()
    await expect.poll(async () => (await casillas(win))[0]?.nombre ?? '').toContain('Personal · beta')
    expect((await casillas(win)).length, 'sigue habiendo UNA casilla, la misma').toBe(1)
    expect(arranques(m.log).length, 'beta ya estaba en marcha: no se lanzó nada').toBe(antes)

    // 2) El CHIP conmuta el agente de esa casilla. beta·Codex no se había abierto
    //    nunca (las sesiones son perezosas), así que aquí SÍ arranca uno.
    await casilla.locator('.casilla-agente-btn').click()
    await expect.poll(async () => (await casillas(win))[0]?.nombre ?? '').toMatch(/Personal · beta · Codex/)
    await expect
      .poll(() => arranques(m.log).length, { timeout: 60_000 })
      .toBe(antes + 1)
    expect(arranques(m.log).at(-1)?.agente, 'y el que arrancó es Codex').toBe('codex')

    // 3) El GLIFO del modo abre los dos modos del proyecto, con el actual marcado. No
    //    se pulsa el otro: cambiar a contenedor levantaría Docker, que en la prueba no
    //    existe, y además reinicia la sesión del proyecto. Lo que se fija aquí es que
    //    el selector está y sabe en qué modo estás.
    await casilla.locator('.casilla-modo-btn').click()
    await expect(win.locator('.ctx-menu-item')).toHaveCount(2)
    await expect(win.locator('.ctx-menu-item[aria-checked="true"]')).toContainText('nativo')
    await expect(win.locator('.ctx-menu-item[aria-checked="true"]')).toBeDisabled()
    await win.keyboard.press('Escape')
    await expect(win.locator('.ctx-menu')).toHaveCount(0)

    expect(
      await win.evaluate(() => document.querySelectorAll('.agent-pane').length),
      'cambiar de destino no monta ni desmonta panes: sólo cambia cuál se pinta'
    ).toBe(panes)

    // 4) UN MENÚ ABIERTO NO SOBREVIVE A LA SALIDA. El ContextMenu sólo se cierra solo
    //    con un mousedown fuera o con Escape, así que salir por el atajo lo desmonta
    //    sin avisarle; como el pane sigue vivo (keep-alive), el menú reaparecía solo al
    //    volver a entrar, en las coordenadas de la vez anterior.
    await casilla.locator('.casilla-nombre-btn').click()
    await expect(win.locator('.ctx-menu')).toHaveCount(1)
    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(1)
    // Hay que traer de vuelta a ESE pane —el que tenía el menú abierto—, si no la
    // prueba pasa sin comprobar nada: el menú sólo se pinta si su pane es casilla.
    await ponerCasilla(win, 'Personal · beta')
    const beta = win.locator('.right-panel.cc-mosaico > .agent-pane[aria-label*="Personal · beta"]')
    if (!/Codex/.test((await beta.getAttribute('aria-label')) ?? '')) {
      await beta.locator('.casilla-agente-btn').click()
      await expect.poll(async () => (await beta.getAttribute('aria-label')) ?? '').toContain('Codex')
    }
    await asentar(win)
    await expect(win.locator('.ctx-menu'), 'el menú no vuelve solo').toHaveCount(0)

    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
  })

  // «ABRIR OTRO PROYECTO» DESDE UNA CASILLA: la casilla adopta el proyecto recién abierto.
  // Es de e2e porque lo que se rompió no es ninguna decisión: si la apertura y el destino
  // pendiente llegan en commits distintos, el efecto del destino corre sin ver el
  // proyecto y lo DESCARTA en silencio (el proyecto se abre, la casilla no cambia).
  // Va la última: deja un proyecto más abierto en Personal.
  test('«Abrir otro proyecto» desde una casilla la deja enseñando ese proyecto', async () => {
    const win = s.win
    const zeta = join(m.raiz, 'zeta')
    mkdirSync(zeta)
    writeFileSync(join(zeta, 'LEEME.txt'), 'proyecto zeta\n')
    // El diálogo de carpeta es del sistema: se sustituye en el main (ver `atajos.spec.ts`).
    await s.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({
        canceled: false,
        filePaths: [dir]
      })
    }, zeta)
    await mosaicoConTodas(win)
    const antes = arranques(m.log).length
    const casillaAlfa = win.locator('.right-panel.cc-mosaico > .agent-pane[aria-label*="Personal · alfa"]')
    await casillaAlfa.locator('.casilla-nombre-btn').click()
    await win.locator('.ctx-menu-item', { hasText: 'Abrir otro proyecto en Personal' }).click()

    await expect
      .poll(async () => (await casillas(win)).map((c) => c.nombre).join(' | '), {
        message: 'la casilla pasa a enseñar el proyecto abierto'
      })
      .toContain('Personal · zeta')
    expect((await casillas(win)).map((c) => c.nombre).join(' | '), 'y deja de enseñar el de antes').not.toContain(
      'Personal · alfa'
    )
    expect((await casillas(win)).length, 'sigue habiendo cuatro casillas').toBe(4)
    await expect.poll(() => arranques(m.log).length, { timeout: 60_000 }).toBe(antes + 1)
    expect(arranques(m.log).at(-1)?.cwd, 'y su agente arrancó EN zeta').toBe(zeta)

    await win.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
  })
})
