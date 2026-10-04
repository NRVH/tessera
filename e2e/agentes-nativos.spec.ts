// =============================================================================
// «Actualizar los agentes de tu equipo» sobre la app empaquetada, con el mundo falso de
// `agenteFalso.ts` y conversaciones sembradas en `CLAUDE_CONFIG_DIR` / `CODEX_HOME`: la
// cadena que cruza cuatro procesos. En Windows npm entra sin ningún `codex.exe` vivo (parar
// → esperar → instalar); cada sesión parada vuelve UNA vez a SU conversación (también la de
// otro perfil); las sesiones al día no reciben ni un byte y nadie recibe `exit`; el punto
// del botón llega solo desde la comprobación diferida. En macOS Codex se actualiza con
// `codex update` y las sesiones vivas. En serie, en el orden de una mañana cualquiera.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SesionNativa } from '../src/shared/agentes-nativos-ipc.ts'
import { nombresSistema } from '../src/shared/nombresSistema.ts'
import {
  abrirRegistroFalso,
  entradaPorPid,
  montarAgenteFalso,
  pidsConExit,
  rutaEjecutable,
  vivo,
  type AgenteCli,
  type AgenteFalso,
  type EventoFalso,
  type RegistroFalso
} from './agenteFalso'
import { abrirTessera, borrarTemporal, carpetasAgentes, PLATAFORMA, type SesionTessera } from './tessera'

/** Tres proyectos NATIVOS: dos en «Personal» y uno en «Trabajo» (el otro perfil). */
const PROYECTOS = [
  { perfil: 'personal', nombre: 'alfa' },
  { perfil: 'personal', nombre: 'beta' },
  { perfil: 'trabajo', nombre: 'gamma' }
] as const
type Proyecto = (typeof PROYECTOS)[number]['nombre']

const AGENTES: readonly AgenteCli[] = ['claude', 'codex']
const ETIQUETA: Readonly<Record<AgenteCli, string>> = { claude: 'Claude Code', codex: 'Codex' }
const TIPO: Readonly<Record<AgenteCli, SesionNativa['agente']>> = { claude: 'claude-code', codex: 'codex' }
const PERFIL: Readonly<Record<string, string>> = { personal: 'Personal', trabajo: 'Trabajo' }

/**
 * Id de la conversación sembrada de cada (proyecto, agente). Hexadecimal con forma de
 * UUID: es lo que acepta la línea de arranque (`ID_CONVERSACION`) y lo que Codex pone en
 * el nombre de su rollout.
 */
function idConversacion(proyecto: Proyecto, agente: AgenteCli): string {
  const i = PROYECTOS.findIndex((p) => p.nombre === proyecto) + 1
  return `${agente === 'claude' ? 'c1a0de00' : 'c0de0000'}-0000-4000-8000-00000000000${i}`
}

/** Lo que cada CLI recibe al reanudar esa conversación (`buildHostAgentLaunchCommand`). */
function argvReanudar(proyecto: Proyecto, agente: AgenteCli): string[] {
  const id = idConversacion(proyecto, agente)
  return agente === 'codex' ? ['resume', id] : ['--resume', id]
}

interface Montaje {
  agente: AgenteFalso
  rutas: Record<Proyecto, string>
}

function montar(): Montaje {
  const agente = montarAgenteFalso({ versiones: { claude: '2.1.281', codex: '0.156.0' } })
  const rutas = {} as Record<Proyecto, string>
  for (const p of PROYECTOS) {
    rutas[p.nombre] = join(agente.raiz, p.nombre)
    mkdirSync(rutas[p.nombre])
    writeFileSync(join(rutas[p.nombre], 'LEEME.txt'), `proyecto ${p.nombre}\n`)
  }
  return { agente, rutas }
}

/**
 * Perfiles, espacio de trabajo (todo NATIVO) y una conversación de cada agente en cada
 * proyecto, con el formato que lee `ConversationsReader`: Claude Code en
 * `projects/<ruta codificada>/<id>.jsonl`, Codex en `sessions/AAAA/MM/DD/rollout-…-<id>.jsonl`.
 */
function sembrar(datos: string, m: Montaje): void {
  const perfil = (id: string, color: string): object => ({
    id,
    nombre: PERFIL[id],
    color,
    agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
    sandbox: { habilitado: false }
  })
  writeFileSync(join(datos, 'profiles.json'), JSON.stringify([perfil('personal', '#9814c8'), perfil('trabajo', '#1f9e7a')]))
  const abiertos = (id: string): object[] =>
    PROYECTOS.filter((p) => p.perfil === id).map((p) => ({
      projectHostPath: m.rutas[p.nombre],
      name: p.nombre,
      estado: 'active'
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

  const cuentas = carpetasAgentes(datos)
  const hace = '2026-09-20T10:00:00.000Z'
  PROYECTOS.forEach((p, i) => {
    const ruta = m.rutas[p.nombre]
    const idCc = idConversacion(p.nombre, 'claude')
    const carpetaCc = join(cuentas.claude, 'projects', ruta.replace(/[^A-Za-z0-9]/g, '-'))
    mkdirSync(carpetaCc, { recursive: true })
    const lineaCc = (type: string, content: unknown): string =>
      JSON.stringify({ type, sessionId: idCc, cwd: ruta, timestamp: hace, message: { role: type, content } })
    writeFileSync(
      join(carpetaCc, `${idCc}.jsonl`),
      `${lineaCc('user', `hola desde ${p.nombre}`)}\n${lineaCc('assistant', [{ type: 'text', text: 'hola' }])}\n`
    )

    const idCx = idConversacion(p.nombre, 'codex')
    const dia = join(cuentas.codex, 'sessions', '2026', '09', '20')
    mkdirSync(dia, { recursive: true })
    writeFileSync(
      join(dia, `rollout-2026-09-20T10-00-0${i}-${idCx}.jsonl`),
      `${JSON.stringify({ timestamp: hace, type: 'session_meta', payload: { id: idCx, session_id: idCx, cwd: ruta } })}\n` +
        `${JSON.stringify({ timestamp: hace, type: 'event_msg', payload: { type: 'user_message', message: `hola desde ${p.nombre}` } })}\n`
    )
  })
}

// -----------------------------------------------------------------------------
// Ayudantes de la interfaz
// -----------------------------------------------------------------------------

/** Deja que React confirme el render provocado por el gesto (ver `atajos.spec.ts`). */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Pone a la vista un proyecto (cambiando de perfil si hace falta). */
async function irA(win: Page, proyecto: Proyecto): Promise<void> {
  const p = PROYECTOS.find((x) => x.nombre === proyecto)!
  await win.locator('.profile-tab', { hasText: PERFIL[p.perfil] }).first().click()
  await win.locator('.tabs-projects .project-tab', { hasText: proyecto }).first().click()
  await asentar(win)
}

/** Elige ese agente en el pane a la vista (si ya lo está, no hace nada). */
async function elegirAgente(win: Page, agente: AgenteCli): Promise<void> {
  await win.locator(`.agent-pane:not(.hidden) .agent-switch-btn[aria-label="${ETIQUETA[agente]}"]`).first().click()
}

/** Escribe una línea en el agente a la vista y la ENVÍA. */
async function enviarAlAgente(win: Page, texto: string): Promise<void> {
  await win.locator('.agent-pane:not(.hidden) .xterm-screen').first().click()
  await win.keyboard.type(texto)
  await win.keyboard.press('Enter')
}

function mismaRuta(a: string, b: string): boolean {
  const n = (r: string): string => r.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  return n(a) === n(b)
}

/** La sesión nativa de (proyecto, agente) según el main, o undefined. */
async function sesionNativa(win: Page, m: Montaje, proyecto: Proyecto, agente: AgenteCli): Promise<SesionNativa | undefined> {
  const estado = await win.evaluate(() => window.tessera.agentesNativos.estado())
  return estado.sesiones.find((x) => x.agente === TIPO[agente] && mismaRuta(x.projectHostPath, m.rutas[proyecto]))
}

const BOTON = '.agentes-nativos-boton'
const POPOVER = '.agentes-nativos-pop'

/**
 * Abre el popover y espera a que termine la comprobación FRESCA que dispara al abrirse:
 * sin esto, lo que se lea sería la foto de antes.
 */
async function abrirPopover(win: Page): Promise<Locator> {
  if ((await win.locator(POPOVER).count()) === 0) await win.locator(BOTON).click()
  const pop = win.locator(POPOVER)
  await expect(pop).toBeVisible()
  await expect(pop.locator('.actualizacion-pop-pie')).not.toContainText('Comprobando', { timeout: 60_000 })
  return pop
}

async function cerrarPopover(win: Page): Promise<void> {
  await win.keyboard.press('Escape')
  await expect(win.locator(POPOVER)).toHaveCount(0)
}

/** La acción principal del popover (la de «Actualizar…» / «Reiniciar…»). */
function accion(pop: Locator): Locator {
  return pop.locator('.agentes-nativos-acciones .btn').first()
}

/**
 * Espera a que la ejecución TERMINE y devuelve el título del resumen. Espera a cualquier
 * final (bien, con problemas o sin hacer nada) y no sólo al esperado: así un fallo se
 * lee en el mensaje con el texto entero del popover, en vez de en un timeout mudo.
 */
async function esperarResumen(pop: Locator): Promise<string> {
  const titulo = pop.locator('.actualizacion-pop-titulo').first()
  await expect(titulo).toHaveText(/Agentes actualizados|Sesiones reiniciadas|tuvo problemas|No se hizo nada/, {
    timeout: 150_000
  })
  return (await titulo.textContent()) ?? ''
}

// -----------------------------------------------------------------------------
// Ayudantes del registro del mundo falso
// -----------------------------------------------------------------------------

/** Último arranque de ese agente en cada proyecto. */
function vigentes(m: Montaje, agente: AgenteCli): Map<Proyecto, EventoFalso> {
  const out = new Map<Proyecto, EventoFalso>()
  for (const e of m.agente.arranques(agente)) {
    const p = PROYECTOS.find((x) => mismaRuta(m.rutas[x.nombre], e.cwd))
    if (p) out.set(p.nombre, e)
  }
  return out
}

/** Margen para que un relanzamiento DE MÁS, o un byte que no tocaba, llegue a verse. */
const MARGEN_MS = 2_000

/**
 * Espera a que las `n` sesiones relanzadas de `agente` hayan ARRANCADO y devuelve los
 * eventos desde `desde`. Hace falta esperar: el «reiniciada» del resumen llega cuando el
 * pty nuevo existe, no cuando el CLI ya corre (la shell tarda en lanzarlo). Y después se
 * deja un margen, para que un relanzamiento DE MÁS también se vea y no pase por bueno.
 */
async function esperarVueltas(m: Montaje, desde: number, agente: AgenteCli, n: number): Promise<EventoFalso[]> {
  const vueltas = (): number =>
    m.agente
      .eventos()
      .slice(desde)
      .filter((e) => e.tipo === 'arranque' && e.agente === agente).length
  await expect
    .poll(vueltas, { timeout: 30_000, message: `vuelven las ${n} sesiones de ${ETIQUETA[agente]}` })
    .toBeGreaterThanOrEqual(n)
  await new Promise((r) => setTimeout(r, MARGEN_MS))
  return m.agente.eventos().slice(desde)
}

/** Sin relanzamientos que esperar: sólo el margen, y los eventos desde `desde`. */
async function eventosTrasMargen(m: Montaje, desde: number): Promise<EventoFalso[]> {
  await new Promise((r) => setTimeout(r, MARGEN_MS))
  return m.agente.eventos().slice(desde)
}

/**
 * Cada sesión de `antes` volvió UNA vez, DESPUÉS de `desdeIndice` (la instalación), con
 * la MISMA reanudación y otro proceso; y el viejo ya no existe.
 */
function comprobarVuelta(
  m: Montaje,
  nuevos: readonly EventoFalso[],
  agente: AgenteCli,
  antes: ReadonlyMap<Proyecto, EventoFalso>,
  desdeIndice: number
): void {
  expect(antes.size, `había ${PROYECTOS.length} sesiones de ${ETIQUETA[agente]}`).toBe(PROYECTOS.length)
  for (const [proyecto, viejo] of antes) {
    const vueltas = nuevos.filter(
      (e) => e.tipo === 'arranque' && e.agente === agente && mismaRuta(e.cwd, m.rutas[proyecto])
    )
    expect(vueltas.length, `${ETIQUETA[agente]} de ${proyecto} vuelve UNA vez`).toBe(1)
    expect(nuevos.indexOf(vueltas[0]), `${ETIQUETA[agente]} de ${proyecto} vuelve DESPUÉS de instalar`).toBeGreaterThan(
      desdeIndice
    )
    expect(vueltas[0].argv, `${ETIQUETA[agente]} de ${proyecto} vuelve a SU conversación`).toEqual(viejo.argv)
    expect(vueltas[0].pid, 'es otro proceso').not.toBe(viejo.pid)
    expect(vivo(viejo.pid), `el proceso viejo de ${ETIQUETA[agente]} de ${proyecto} ya no está`).toBe(false)
  }
}

/** Las sesiones de `antes` siguen con su proceso y no recibieron NADA en `nuevos`. */
function comprobarIntactas(
  nuevos: readonly EventoFalso[],
  agente: AgenteCli,
  antes: ReadonlyMap<Proyecto, EventoFalso>
): void {
  expect(
    nuevos.filter((e) => e.tipo === 'arranque' && e.agente === agente).length,
    `no se relanzó ninguna sesión de ${ETIQUETA[agente]}`
  ).toBe(0)
  const recibido = entradaPorPid(nuevos)
  for (const [proyecto, a] of antes) {
    expect(vivo(a.pid), `${ETIQUETA[agente]} de ${proyecto} conserva su proceso`).toBe(true)
    expect(recibido.get(a.pid) ?? '', `${ETIQUETA[agente]} de ${proyecto} no recibió nada`).toBe('')
  }
}

/**
 * Las líneas `[detener]` del `db.log` de la app: cómo acabó cada parada. El agente falso
 * sale al segundo `^C`, como los CLIs reales con el prompt vacío, así que una parada
 * «forzada» aquí querría decir que el gesto no le llegó y hubo que matarlo.
 */
function paradas(s: SesionTessera): string[] {
  try {
    return readFileSync(join(s.datos, 'logs', 'db.log'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('[detener]'))
  } catch {
    return []
  }
}

function comprobarParadasElegantes(nuevas: readonly string[], n: number): void {
  expect(nuevas.length, `se pararon ${n} sesiones:\n${nuevas.join('\n')}`).toBe(n)
  for (const l of nuevas) expect(l, 'la parada fue con ^C, sin matar a nadie').toContain('cierre elegante')
}

/** NINGÚN agente recibió nunca `exit` + Enter (el cierre elegante del «Reiniciar» por pane). */
function sinExit(m: Montaje): void {
  expect(pidsConExit(m.agente.eventos()), 'ningún agente recibió `exit`').toEqual([])
}

// -----------------------------------------------------------------------------

test.describe('actualizar los agentes nativos', () => {
  test.describe.configure({ mode: 'serial' })

  let s: SesionTessera
  let m: Montaje
  let registro: RegistroFalso
  /** Salida de la app (consola del main): se adjunta si una prueba falla. */
  const salidaApp: string[] = []

  test.beforeAll(async () => {
    // Codex 0.156.1 publicado (con sus binarios) y 0.156.0 instalado; Claude al día.
    registro = await abrirRegistroFalso({ codex: '0.156.1', claude: '2.1.281' })
    m = montar()
    s = await abrirTessera({ ...m.agente.env, ...registro.env }, { sembrar: (datos) => sembrar(datos, m) })
    const proc = s.app.process()
    const guardar = (b: Buffer): void => {
      salidaApp.push(...b.toString('utf8').split(/\r?\n/).filter(Boolean))
      if (salidaApp.length > 2000) salidaApp.splice(0, salidaApp.length - 2000)
    }
    proc.stdout?.on('data', guardar)
    proc.stderr?.on('data', guardar)
    // Si la app muere a mitad, que el porqué quede escrito y no sólo «page closed».
    proc.on('exit', (codigo, senal) =>
      salidaApp.push(
        `[e2e] la app salió: código=${codigo}${codigo !== null ? ` (0x${(codigo >>> 0).toString(16)})` : ''} señal=${senal}`
      )
    )
    s.win.on('crash', () => salidaApp.push('[e2e] el renderer se cayó'))
    s.win.on('close', () => salidaApp.push('[e2e] la ventana se cerró'))
    s.win.on('console', (msg) => salidaApp.push(`[renderer:${msg.type()}] ${msg.text()}`))
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })

    // Las SEIS sesiones, como las abriría el usuario: mirando cada proyecto y cada agente
    // (son perezosas). Se acaba mirando Trabajo · gamma · Codex, así que alfa es un proyecto
    // que no se ve y todo Personal es otro perfil.
    for (const p of PROYECTOS) {
      await irA(s.win, p.nombre)
      for (const agente of AGENTES) {
        await elegirAgente(s.win, agente)
        await expect
          .poll(() => m.agente.arranques(agente).filter((e) => mismaRuta(e.cwd, m.rutas[p.nombre])).length, {
            timeout: 60_000,
            message: `arranca ${ETIQUETA[agente]} en ${p.nombre}`
          })
          .toBe(1)
      }
    }
    // Y cada una REANUDANDO su conversación sembrada: es lo que hace medible que vuelva
    // a la misma.
    for (const agente of AGENTES) {
      for (const [proyecto, e] of vigentes(m, agente)) {
        expect(e.argv, `${ETIQUETA[agente]} de ${proyecto} arrancó reanudando`).toEqual(argvReanudar(proyecto, agente))
      }
    }
  })

  // Si una prueba falla, lo que hace falta para saber POR QUÉ va a su carpeta de
  // resultados: qué vio cada agente, qué dijo el main por consola, qué pidió al registro
  // y el `db.log` de la app (paradas elegantes o forzadas, instalaciones).
  test.afterEach(async () => {
    const info = test.info()
    if (info.status === info.expectedStatus) return
    // Si la app murió, su `exit` (con el código: 0xC0000005 no es lo mismo que 0) puede
    // llegar un instante después del fallo: se le da ese instante.
    const proc = s.app.process()
    if (proc.exitCode === null && proc.signalCode === null) {
      await new Promise<void>((r) => {
        const t = setTimeout(r, 3_000)
        proc.once('exit', () => {
          clearTimeout(t)
          r()
        })
      })
    }
    const adjuntar = async (nombre: string, contenido: string): Promise<void> => {
      const ruta = info.outputPath(nombre)
      writeFileSync(ruta, contenido)
      await info.attach(nombre, { path: ruta, contentType: 'text/plain' })
    }
    await adjuntar('eventos-agentes.log', readFileSync(m.agente.log, 'utf8'))
    await adjuntar('salida-app.log', salidaApp.join('\n'))
    await adjuntar('registro-peticiones.txt', registro.peticiones.join('\n'))
    // `cierre.log` también: se abre al ARRANCAR, así que ya dice si un cierre anterior
    // de esta sesión se quedó a medias (y en qué etapa; ver `util/registroCierre.ts`).
    for (const log of ['db.log', 'crash.log', 'cierre.log']) {
      try {
        await adjuntar(log, readFileSync(join(s.datos, 'logs', log), 'utf8'))
      } catch {
        // Sin ese registro en disco: no hubo nada que apuntar.
      }
    }
    // Un volcado de Crashpad dice qué proceso cayó (main, renderer) si la app murió.
    try {
      const volcados = readdirSync(join(s.datos, 'Crashpad'), { recursive: true }).map(String)
      await adjuntar('crashpad.txt', volcados.join('\n'))
      for (const v of volcados.filter((x) => x.endsWith('.dmp'))) {
        copyFileSync(join(s.datos, 'Crashpad', v), info.outputPath(v.replace(/[\\/]/g, '_')))
      }
    } catch {
      // Sin Crashpad: no hubo caída que registrar.
    }
  })

  test.afterAll(async () => {
    await s?.cerrar()
    await registro?.cerrar()
    if (m) await borrarTemporal(m.agente.raiz)
  })

  // EL AVISO LLEGA SOLO. La primera comprobación del main es diferida (~20 s tras
  // arrancar) y nadie ha abierto el popover: si el punto aparece, la cadena entera
  // —sonda por la shell, registro, método por la raíz del paquete, empuje al renderer—
  // funcionó sin que el usuario hiciera nada.
  test('sale Codex nuevo: el botón enseña el punto sin abrir nada', async () => {
    const boton = s.win.locator(BOTON)
    await expect(boton).toBeVisible()
    await expect(boton.locator('.boton-actualizacion-punto')).toBeVisible({ timeout: 90_000 })
    await expect(boton).toHaveClass(/tono-acento/)
    const titulo = (await boton.getAttribute('title')) ?? ''
    expect(titulo).toContain('Codex')
    expect(titulo).toContain('0.156.1')
    expect(titulo, 'Claude está al día: no se anuncia').not.toContain('Claude')
    // El sistema lo nombra el vocabulario compartido, nunca el texto a mano.
    expect(titulo).toContain(nombresSistema(PLATAFORMA).tuEquipo)
    expect(registro.peticiones, 'la versión salió del registro de la prueba').toContain(
      '/npm/-/package/@openai/codex/dist-tags'
    )
  })

  // LA ÚLTIMA FILA DEL AGENTE CABE ENTERA. Claude Code y Codex dibujan ahí su línea de
  // estado y sus agentes en marcha, y se veía cortada o pegada al pie: `FitAddon` medía
  // el hueco CON su relleno (el `border-box` global) y pedía una fila de más. Se
  // comprueba el lienzo de xterm contra la caja ÚTIL del hueco (sin relleno), que es lo
  // único que prueba que ninguna fila cae bajo el borde, sea cual sea el alto de celda.
  test('la última fila del agente cabe entera dentro de su hueco, sin tocar el pie', async () => {
    const medida = await s.win.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.agent-pane:not(.hidden) .terminal-host')
      const lienzo = host?.querySelector<HTMLElement>('.xterm-screen')
      if (!host || !lienzo) return null
      const h = host.getBoundingClientRect()
      const l = lienzo.getBoundingClientRect()
      const cs = getComputedStyle(host)
      return {
        fondoUtil: h.bottom - parseFloat(cs.paddingBottom),
        bordeUtil: h.right - parseFloat(cs.paddingRight),
        fondoLienzo: l.bottom,
        bordeLienzo: l.right,
        alto: l.height
      }
    })
    expect(medida, 'hay un pane de agente visible con su lienzo').not.toBeNull()
    const m2 = medida as NonNullable<typeof medida>
    expect(m2.alto, 'xterm ya pintó').toBeGreaterThan(0)
    expect(m2.fondoLienzo, 'la última fila no cae bajo el relleno inferior').toBeLessThanOrEqual(m2.fondoUtil + 0.5)
    expect(m2.bordeLienzo, 'la última columna no cae bajo el relleno derecho').toBeLessThanOrEqual(m2.bordeUtil + 0.5)
  })

  // LA COMPUERTA, DE PUNTA A PUNTA. «Trabajando» nace de TU Enter en el main
  // (agentActivity), viaja por IPC hasta el estado del botón, y la campana del agente
  // (BEL) lo apaga. El popover se abre igual —nunca se deshabilita el botón—; lo que
  // espera es la acción, y dice por qué y quién.
  test('con una sesión TRABAJANDO la acción espera y lo dice; al terminar el turno se habilita', async () => {
    const win = s.win
    const desde = m.agente.eventos().length
    await enviarAlAgente(win, 'trabaja')
    await expect
      .poll(async () => (await sesionNativa(win, m, 'gamma', 'codex'))?.trabajando, { message: 'gamma · Codex trabaja' })
      .toBe(true)

    let pop = await abrirPopover(win)
    await expect(accion(pop)).toHaveText('Actualizar Codex y reiniciar 3 sesiones')
    await expect(accion(pop)).toBeDisabled()
    await expect(pop.locator('.agentes-nativos-motivo')).toHaveText('Espera: 1 agente trabajando')
    // Las tres de Codex, en el orden del mosaico (perfil, proyecto); las de Claude no se
    // tocan y no se listan.
    await expect(pop.locator('.agentes-nativos-sesion-nombre')).toHaveText([
      'Personal · alfa · Codex',
      'Personal · beta · Codex',
      'Trabajo · gamma · Codex'
    ])
    const fila = pop.locator('.agentes-nativos-sesion', { hasText: 'Trabajo · gamma · Codex' })
    await expect(fila.locator('.agentes-nativos-nota.bloquea')).toHaveText('trabajando')
    await expect(pop.locator('.agentes-nativos-nota.bloquea'), 'sólo esa trabaja').toHaveCount(1)
    await cerrarPopover(win)

    // El turno termina: el agente toca la campana.
    await enviarAlAgente(win, 'fin')
    await expect
      .poll(async () => (await sesionNativa(win, m, 'gamma', 'codex'))?.trabajando, { message: 'gamma · Codex terminó' })
      .toBe(false)
    pop = await abrirPopover(win)
    await expect(accion(pop)).toBeEnabled()
    await expect(pop.locator('.agentes-nativos-motivo')).toHaveCount(0)
    await expect(pop.locator('.agentes-nativos-nota.bloquea')).toHaveCount(0)
    await cerrarPopover(win)

    // Mirar no hace nada: ni se instaló ni se paró ni se relanzó.
    const nuevos = await eventosTrasMargen(m, desde)
    expect(nuevos.filter((e) => e.tipo === 'npm' || e.tipo === 'update' || e.tipo === 'arranque')).toEqual([])
    sinExit(m)
  })

  // CONFIGURACIÓN › ACTUALIZACIONES › AGENTES. El botón de la barra sólo se ve con
  // proyectos nativos abiertos; la configuración es donde se BUSCA «actualizar». Cuenta
  // lo mismo (comparten el estado del hook) y su «Actualizar…» no duplica la lista de
  // sesiones: cierra el modal y abre el panel del botón, donde se confirma.
  test('Configuración › Actualizaciones enseña los agentes y su «Actualizar…» abre el panel del botón', async () => {
    const win = s.win
    const mod = PLATAFORMA === 'mac' ? 'Meta' : 'Control'
    await win.keyboard.press(`${mod}+,`)
    await expect(win.locator('.ajustes-modal')).toHaveCount(1)
    await win.locator('.ajustes-riel-item[data-cat="actualizaciones"]').click()

    const bloque = win.locator('.ajustes-modal .settings-update', { hasText: 'Codex:' })
    await expect(bloque).toContainText('Codex: 0.156.0 → 0.156.1 disponible')
    await expect(bloque, 'Claude está al día').toContainText('Claude Code:')
    await expect(bloque).toContainText(nombresSistema(PLATAFORMA).tuEquipo)

    await bloque.getByRole('button', { name: 'Actualizar…' }).click()
    await expect(win.locator('.ajustes-modal'), 'el modal se cierra').toHaveCount(0)
    const pop = win.locator(POPOVER)
    await expect(pop, 'y se abre el panel del botón de la barra').toBeVisible()
    await expect(accion(pop)).toHaveText('Actualizar Codex y reiniciar 3 sesiones')
    await cerrarPopover(win)
  })

  // WINDOWS: EL CAMINO DE LA PARADA. `npm i -g` con un `codex.exe` vivo falla
  // (EBUSY/EPERM), así que antes de instalar se paran sus sesiones y se espera a que
  // muera todo lo que cuelga de la carpeta del paquete. El npm falso apunta QUÉ pids de
  // Codex seguían vivos al entrar y, como el de verdad, intenta sustituir su `codex.exe`.
  test('Windows: Codex se instala con npm con sus sesiones PARADAS y cada una vuelve UNA vez a su chat', async () => {
    test.skip(PLATAFORMA !== 'windows', 'en macOS Codex se actualiza con `codex update` sin parar nada (prueba siguiente)')
    test.setTimeout(240_000)
    const win = s.win
    const desde = m.agente.eventos().length
    const codexAntes = vigentes(m, 'codex')
    const claudeAntes = vigentes(m, 'claude')
    const paradasAntes = paradas(s).length
    // LA PREMISA: los Codex de la prueba corren desde la carpeta del paquete, como el
    // `codex.exe` de verdad. Si no, npm no tendría nada que bloquear y lo de abajo no
    // demostraría nada.
    const raizCodex = `${m.agente.raizCodex}\\`.toLowerCase()
    for (const [proyecto, e] of codexAntes) {
      const ruta = rutaEjecutable(e.pid) ?? '(sin ruta)'
      expect(ruta.toLowerCase().startsWith(raizCodex), `Codex de ${proyecto} corre desde ${ruta}`).toBe(true)
    }

    const pop = await abrirPopover(win)
    await expect(pop.locator('.agentes-nativos-cli', { hasText: 'Codex' })).toContainText('Se detendrán sus sesiones')
    await expect(accion(pop)).toHaveText('Actualizar Codex y reiniciar 3 sesiones')
    await accion(pop).click()
    const titulo = await esperarResumen(pop)
    expect(titulo, await pop.innerText()).toBe('Agentes actualizados')

    const nuevos = await esperarVueltas(m, desde, 'codex', PROYECTOS.length)
    const npm = nuevos.filter((e) => e.tipo === 'npm')
    expect(npm.length, 'npm install se ejecutó UNA vez').toBe(1)
    expect(npm[0].argv).toEqual(['install', '-g', '@openai/codex@0.156.1'])
    expect(npm[0].codexVivos, 'ningún Codex vivo al entrar npm').toEqual([])
    expect(npm[0].bloqueo, 'codex.exe no estaba en uso: npm pudo sustituirlo').toBeNull()
    comprobarVuelta(m, nuevos, 'codex', codexAntes, nuevos.indexOf(npm[0]))
    comprobarIntactas(nuevos, 'claude', claudeAntes)
    expect(nuevos.filter((e) => e.tipo === 'update'), 'nada de `codex update` en Windows').toEqual([])
    expect(m.agente.version('codex')).toBe('0.156.1')
    comprobarParadasElegantes(paradas(s).slice(paradasAntes), PROYECTOS.length)
    sinExit(m)

    // Visto el resumen, el punto se va: ya no hay nada nuevo.
    await cerrarPopover(win)
    await expect(win.locator(`${BOTON} .boton-actualizacion-punto`)).toHaveCount(0)
  })

  // MACOS: SIN PARADA. POSIX no bloquea un ejecutable en uso, así que `codex update`
  // corre con las sesiones vivas y después se reinician las que corren la versión vieja.
  test('macOS: Codex se actualiza con `codex update` y cada sesión vuelve UNA vez a su chat', async () => {
    test.skip(PLATAFORMA !== 'mac', 'en Windows Codex se instala con npm parando antes sus sesiones (prueba anterior)')
    test.setTimeout(240_000)
    const win = s.win
    m.agente.destinoUpdate('codex', '0.156.1')
    const desde = m.agente.eventos().length
    const codexAntes = vigentes(m, 'codex')
    const claudeAntes = vigentes(m, 'claude')
    const paradasAntes = paradas(s).length

    const pop = await abrirPopover(win)
    await expect(pop.locator('.agentes-nativos-cli', { hasText: 'Codex' })).toContainText('con sus sesiones abiertas')
    await expect(accion(pop)).toHaveText('Actualizar Codex y reiniciar 3 sesiones')
    await accion(pop).click()
    const titulo = await esperarResumen(pop)
    expect(titulo, await pop.innerText()).toBe('Agentes actualizados')

    const nuevos = await esperarVueltas(m, desde, 'codex', PROYECTOS.length)
    const update = nuevos.filter((e) => e.tipo === 'update')
    expect(update.length, '`codex update` se ejecutó UNA vez').toBe(1)
    expect(update[0].agente).toBe('codex')
    expect(update[0].ok).toBe(true)
    expect(nuevos.filter((e) => e.tipo === 'npm'), 'en macOS no se llama a npm').toEqual([])
    comprobarVuelta(m, nuevos, 'codex', codexAntes, nuevos.indexOf(update[0]))
    comprobarIntactas(nuevos, 'claude', claudeAntes)
    expect(m.agente.version('codex')).toBe('0.156.1')
    // Sin parada antes de instalar, pero sí para relanzar las atrasadas (fase C).
    comprobarParadasElegantes(paradas(s).slice(paradasAntes), PROYECTOS.length)
    sinExit(m)

    await cerrarPopover(win)
    await expect(win.locator(`${BOTON} .boton-actualizacion-punto`)).toHaveCount(0)
  })

  // CLAUDE SE AUTO-ACTUALIZA EN DISCO (medido: el instalador nativo lo hace solo) y las
  // sesiones abiertas siguen con el binario viejo. No hay nada que instalar: lo que
  // importa es «arrancó con ≠ instalada», y sólo esas se reinician.
  test('Claude subido en disco: sólo se reinician las de Claude, sin `update` ni npm', async () => {
    test.setTimeout(240_000)
    const win = s.win
    m.agente.fijarVersion('claude', '2.1.282')
    registro.publicado.claude = '2.1.282'
    const desde = m.agente.eventos().length
    const claudeAntes = vigentes(m, 'claude')
    const codexAntes = vigentes(m, 'codex')
    const paradasAntes = paradas(s).length

    const pop = await abrirPopover(win)
    await expect(pop.locator('.agentes-nativos-cli', { hasText: 'Claude Code' })).toContainText(
      'hay 3 sesiones con una versión anterior'
    )
    await expect(accion(pop)).toHaveText('Reiniciar 3 sesiones')
    await expect(pop.locator('.agentes-nativos-sesion-nombre')).toHaveText([
      'Personal · alfa · Claude Code',
      'Personal · beta · Claude Code',
      'Trabajo · gamma · Claude Code'
    ])
    await accion(pop).click()
    const titulo = await esperarResumen(pop)
    expect(titulo, await pop.innerText()).toBe('Agentes actualizados')

    const nuevos = await esperarVueltas(m, desde, 'claude', PROYECTOS.length)
    expect(nuevos.filter((e) => e.tipo === 'update'), 'nada de `claude update`: ya estaba en disco').toEqual([])
    expect(nuevos.filter((e) => e.tipo === 'npm'), 'ni npm').toEqual([])
    comprobarVuelta(m, nuevos, 'claude', claudeAntes, -1)
    comprobarIntactas(nuevos, 'codex', codexAntes)
    comprobarParadasElegantes(paradas(s).slice(paradasAntes), PROYECTOS.length)
    sinExit(m)

    await cerrarPopover(win)
    await expect(win.locator(`${BOTON} .boton-actualizacion-punto`)).toHaveCount(0)
  })

  // LA INSTALACIÓN FALLA. Lo que se promete: ninguna sesión se queda muerta por culpa de
  // la actualización, y el fallo se ve (en el resumen y en el punto ROJO, que no se va
  // al mirarlo). En Windows las paradas vuelven con la versión vieja; en macOS no se
  // llegó a parar nada, y como el re-sondeo no las da por atrasadas, no se tocan.
  test('si la instalación de Codex falla, ninguna sesión se queda muerta y el error se ve', async () => {
    test.setTimeout(240_000)
    const win = s.win
    registro.publicado.codex = '0.156.2'
    const windows = PLATAFORMA === 'windows'
    m.agente.fallar(windows ? 'npm' : 'update-codex', true)
    const desde = m.agente.eventos().length
    const codexAntes = vigentes(m, 'codex')
    const claudeAntes = vigentes(m, 'claude')
    const paradasAntes = paradas(s).length

    const pop = await abrirPopover(win)
    await expect(accion(pop)).toHaveText('Actualizar Codex y reiniciar 3 sesiones')
    await accion(pop).click()
    const titulo = await esperarResumen(pop)
    expect(titulo, await pop.innerText()).toBe('La actualización tuvo problemas')
    await expect(pop).toContainText('no se pudo actualizar')
    await expect(pop).toContainText('La instalación de Codex falló')

    const nuevos = windows
      ? await esperarVueltas(m, desde, 'codex', PROYECTOS.length)
      : await eventosTrasMargen(m, desde)
    if (windows) {
      const npm = nuevos.filter((e) => e.tipo === 'npm')
      expect(npm.length, 'npm install se intentó UNA vez').toBe(1)
      expect(npm[0].argv).toEqual(['install', '-g', '@openai/codex@0.156.2'])
      expect(npm[0].ok).toBe(false)
      expect(npm[0].codexVivos, 'ningún Codex vivo al entrar npm').toEqual([])
      // Las paradas vuelven igual, a su chat, con lo que haya (la versión vieja).
      comprobarVuelta(m, nuevos, 'codex', codexAntes, nuevos.indexOf(npm[0]))
    } else {
      const update = nuevos.filter((e) => e.tipo === 'update')
      expect(update.length, '`codex update` se intentó UNA vez').toBe(1)
      expect(update[0].ok).toBe(false)
      comprobarIntactas(nuevos, 'codex', codexAntes)
    }
    comprobarIntactas(nuevos, 'claude', claudeAntes)
    comprobarParadasElegantes(paradas(s).slice(paradasAntes), windows ? PROYECTOS.length : 0)
    expect(m.agente.version('codex'), 'sigue la versión vieja').toBe('0.156.1')
    if (windows) {
      // Y vuelven CON ella: la versión con la que arrancaron es la instalada.
      for (const p of PROYECTOS) {
        await expect
          .poll(async () => (await sesionNativa(win, m, p.nombre, 'codex'))?.versionLanzada)
          .toBe('0.156.1')
      }
    }
    sinExit(m)

    await cerrarPopover(win)
    await expect(win.locator(BOTON)).toHaveClass(/tono-rojo/)
    await expect(win.locator(`${BOTON} .boton-actualizacion-punto`)).toBeVisible()
  })
})
