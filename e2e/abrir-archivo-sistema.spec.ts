// =============================================================================
// «Abrir con Tessera» sobre un ARCHIVO, contra la app empaquetada: por `argv` en frío,
// por una segunda instancia con la app abierta y, en macOS, por `open-file`. Fija dos
// cosas que solo existen con un renderer y un sistema de verdad: la carrera del arranque
// en frío (ajustes, pestañas, cola del main) y el agente DIFERIDO del proyecto que nace
// para ver un archivo. Usa el agente falso (agenteFalso.ts) y el arnés de tessera.ts.
// Decisiones: docs/decisiones/renderer/abrir-con-tessera.md
// Decisiones: docs/decisiones/agentes/agente-diferido.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { asentar } from './humoAyudas'
import { abrirTessera, borrarTemporal, PLATAFORMA, rutaAppEmpaquetada, type SesionTessera } from './tessera'

interface Montaje {
  agente: AgenteFalso
  /** Un proyecto restaurado, con un repo git ANIDADO y un archivo dentro de él. */
  contenedora: string
  archivoDeContenedora: string
  /** Un proyecto corriente, con un archivo. */
  proyecto: string
  archivoDeProyecto: string
  /** Una carpeta que no está abierta en ningún perfil, con un archivo suelto. */
  suelto: string
  archivoSuelto: string
}

function montar(): Montaje {
  const agente = montarAgenteFalso()
  const en = (...tramos: string[]): string => join(agente.raiz, ...tramos)
  // Basta la carpeta `.git`: la raíz del repo se busca por su existencia.
  mkdirSync(en('contenedora', 'repo', '.git'), { recursive: true })
  writeFileSync(en('contenedora', 'repo', 'nota.txt'), 'una nota\n')
  mkdirSync(en('proyecto'))
  writeFileSync(en('proyecto', 'leeme.txt'), 'léeme\n')
  mkdirSync(en('suelto'))
  writeFileSync(en('suelto', 'nota.txt'), 'una nota suelta\n')
  return {
    agente,
    contenedora: en('contenedora'),
    archivoDeContenedora: en('contenedora', 'repo', 'nota.txt'),
    proyecto: en('proyecto'),
    archivoDeProyecto: en('proyecto', 'leeme.txt'),
    suelto: en('suelto'),
    archivoSuelto: en('suelto', 'nota.txt')
  }
}

interface ProyectoSembrado {
  ruta: string
  nombre: string
  /** ¿En modo nativo? Lo normal aquí: sin Docker. */
  nativo?: boolean
  agenteDiferido?: boolean
}

/** Dos perfiles sin sandbox («Personal», activo, y «Otro») con los proyectos que se digan. */
function sembrar(datos: string, porPerfil: { personal?: ProyectoSembrado[]; otro?: ProyectoSembrado[] }): void {
  const perfil = (id: string, nombre: string, color: string): object => ({
    id,
    nombre,
    color,
    agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
    sandbox: { habilitado: false }
  })
  writeFileSync(join(datos, 'profiles.json'), JSON.stringify([perfil('personal', 'Personal', '#9814c8'), perfil('otro', 'Otro', '#1f9e7a')]))
  const byProfile: Record<string, object> = {}
  const nativos: string[] = []
  for (const [id, lista] of Object.entries(porPerfil)) {
    if (!lista || lista.length === 0) continue
    byProfile[id] = {
      openProjects: lista.map((p) => ({
        projectHostPath: p.ruta,
        name: p.nombre,
        estado: 'active',
        ...(p.agenteDiferido ? { agenteDiferido: true } : {})
      })),
      activePath: lista[0].ruta
    }
    for (const p of lista) if (p.nativo !== false) nativos.push(`${id}|${p.ruta}`)
  }
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile,
      settings: { defaultProjectMode: 'windows', windowsModeProjects: nativos, menuWindowsAvisado: true }
    })
  )
}

interface Persistido {
  /** `perfil|ruta` de cada proyecto abierto. */
  proyectos: string[]
  /** `perfil|ruta` de los que llevan la marca de agente diferido. */
  diferidos: string[]
  nativos: string[]
}

/** Lo que dice `workspace-state.json`; null si no está o está a medio escribir. */
function persistido(datos: string): Persistido | null {
  const ruta = join(datos, 'workspace-state.json')
  if (!existsSync(ruta)) return null
  try {
    const doc = JSON.parse(readFileSync(ruta, 'utf8')) as {
      byProfile?: Record<string, { openProjects?: Array<{ projectHostPath?: string; agenteDiferido?: boolean }> }>
      settings?: { windowsModeProjects?: string[] }
    }
    const todos = Object.entries(doc.byProfile ?? {}).flatMap(([id, t]) =>
      (t.openProjects ?? []).map((p) => ({ clave: `${id}|${p.projectHostPath ?? ''}`, diferido: p.agenteDiferido === true }))
    )
    return {
      proyectos: todos.map((p) => p.clave),
      diferidos: todos.filter((p) => p.diferido).map((p) => p.clave),
      nativos: doc.settings?.windowsModeProjects ?? []
    }
  } catch {
    return null
  }
}

const COLUMNA = '.right-panel.cc-panel'
const CONMUTADOR = 'footer.status-bar .status-bar-right > button[aria-pressed]'
/** El cierre elegante de un pty y el arranque de un agente son asíncronos: se les da margen. */
const MARGEN_ARRANQUE_MS = 4_000

const pestanaEditor = (win: Page, nombre: string) => win.locator('.editor-tab.active', { hasText: nombre })
const proyectoActivo = (win: Page, nombre: string) => win.locator('.tabs-projects .project-tab.active', { hasText: nombre })

async function conApp(
  m: Montaje,
  args: string[],
  siembra: Parameters<typeof sembrar>[1],
  cuerpo: (s: SesionTessera) => Promise<void>
): Promise<void> {
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera(m.agente.env, { args, sembrar: (datos) => sembrar(datos, siembra) })
    await cuerpo(s)
  } finally {
    await s?.cerrar()
    await borrarTemporal(m.agente.raiz)
  }
}

test.describe('abrir un archivo desde el sistema con Tessera cerrada', () => {
  /** Arranca con el archivo en `argv`: tiene que caer en el proyecto restaurado que lo contiene. */
  async function comprobarArranqueEnFrio(nativo: boolean): Promise<void> {
    const m = montar()
    const restaurado: ProyectoSembrado = { ruta: m.contenedora, nombre: 'contenedora', nativo }
    await conApp(m, [m.archivoDeContenedora], { personal: [restaurado] }, async ({ win, datos }) => {
      // Que el archivo se abra prueba que la apertura ya se procesó entera.
      await expect(pestanaEditor(win, 'nota.txt')).toHaveCount(1, { timeout: 30_000 })
      await expect(win.locator('.tabs-projects .project-tab')).toHaveCount(1)
      await expect(proyectoActivo(win, 'contenedora')).toHaveCount(1)
      await expect(win.locator(COLUMNA), 'un proyecto que ya estaba abierto no se pliega').not.toHaveClass(/\bcc-hidden\b/)
      // El modo nativo se guarda al instante y las pestañas a los 150 ms: margen para que
      // un proyecto o una clave de más lleguen al disco antes de mirarlo.
      await win.waitForTimeout(1_500)
      const p = persistido(datos)
      expect(p?.proyectos, 'no se abrió un segundo proyecto sobre el restaurado').toEqual([`personal|${m.contenedora}`])
      expect(p?.nativos, 'ningún proyecto ganó el modo nativo por abrir el archivo').toEqual(
        nativo ? [`personal|${m.contenedora}`] : []
      )
      expect(p?.diferidos, 'ni la marca de agente diferido').toEqual([])
    })
  }

  test('cae en el proyecto restaurado que lo contiene, sin duplicarlo', async () => {
    await comprobarArranqueEnFrio(true)
  })

  // La mitad de SEGURIDAD: el restaurado corría en contenedor y no puede pasar a nativo.
  test('no pasa a modo nativo un proyecto restaurado que estaba en contenedor', async () => {
    await comprobarArranqueEnFrio(false)
  })
})

test.describe('el agente diferido de un proyecto abierto para ver un archivo', () => {
  test('un archivo suelto se ve a todo el editor y su agente no arranca hasta desplegar la columna', async () => {
    const m = montar()
    await conApp(m, [m.archivoSuelto], {}, async ({ win, datos }) => {
      await expect(pestanaEditor(win, 'nota.txt')).toHaveCount(1, { timeout: 30_000 })
      await expect(proyectoActivo(win, 'suelto')).toHaveCount(1)
      await expect(win.locator(COLUMNA), 'la columna del agente va plegada').toHaveClass(/\bcc-hidden\b/)
      await expect.poll(() => persistido(datos)?.diferidos, { timeout: 15_000 }).toEqual([`personal|${m.suelto}`])
      await win.waitForTimeout(MARGEN_ARRANQUE_MS)
      expect(m.agente.arranques().length, 'ningún agente arrancó').toBe(0)

      const conmutador = win.locator(CONMUTADOR)
      await expect(conmutador).toHaveAttribute('title', 'Mostrar la columna del agente e iniciar Claude Code')
      await conmutador.click()
      await expect(win.locator(COLUMNA), 'la columna se despliega').not.toHaveClass(/\bcc-hidden\b/)
      await expect.poll(() => m.agente.arranques().length, { timeout: 60_000 }).toBe(1)
      expect(resolve(m.agente.arranques()[0].cwd).toLowerCase(), 'el agente arranca en ese proyecto').toBe(
        resolve(m.suelto).toLowerCase()
      )
      await expect.poll(() => persistido(datos)?.diferidos, { message: 'la marca sale del disco', timeout: 15_000 }).toEqual([])
      await win.waitForTimeout(MARGEN_ARRANQUE_MS)
      expect(m.agente.arranques().length, 'y arranca una sola vez').toBe(1)
    })
  })

  test('restaurado sin pestañas, la columna dice por qué no hay agente y «Iniciar» lo arranca', async () => {
    const m = montar()
    const diferido: ProyectoSembrado = { ruta: m.suelto, nombre: 'suelto', agenteDiferido: true }
    await conApp(m, [], { personal: [diferido] }, async ({ win, datos }) => {
      await expect(proyectoActivo(win, 'suelto')).toHaveCount(1, { timeout: 30_000 })
      const vacio = win.locator(`${COLUMNA} .cc-empty`)
      const gestor = PLATAFORMA === 'mac' ? 'el Finder' : PLATAFORMA === 'windows' ? 'el Explorador' : 'el gestor de archivos'
      await expect(vacio.locator('.pane-empty-hint')).toContainText(`desde ${gestor} para ver un archivo`)
      await win.waitForTimeout(MARGEN_ARRANQUE_MS)
      expect(m.agente.arranques().length, 'restaurar no arranca el agente diferido').toBe(0)

      await vacio.getByRole('button', { name: 'Iniciar Claude Code' }).click()
      await expect.poll(() => m.agente.arranques().length, { timeout: 60_000 }).toBe(1)
      await expect(vacio, 'el vacío se va: ya hay una terminal').toHaveCount(0)
      await expect.poll(() => persistido(datos)?.diferidos, { timeout: 15_000 }).toEqual([])
    })
  })

  test('abrir como CARPETA un proyecto que estaba diferido arranca su agente', async () => {
    const m = montar()
    const diferido: ProyectoSembrado = { ruta: m.suelto, nombre: 'suelto', agenteDiferido: true }
    await conApp(m, [m.suelto], { personal: [diferido] }, async ({ win, datos }) => {
      await expect(proyectoActivo(win, 'suelto')).toHaveCount(1, { timeout: 30_000 })
      await expect.poll(() => m.agente.arranques().length, { timeout: 60_000 }).toBe(1)
      await expect.poll(() => persistido(datos)?.diferidos, { message: 'la marca sale del disco', timeout: 15_000 }).toEqual([])
      expect(persistido(datos)?.proyectos, 'y no se duplica').toEqual([`personal|${m.suelto}`])
    })
  })

  test('una CARPETA abierta desde el sistema arranca su agente como siempre', async () => {
    const m = montar()
    await conApp(m, [m.suelto], {}, async ({ win, datos }) => {
      await expect(proyectoActivo(win, 'suelto')).toHaveCount(1, { timeout: 30_000 })
      await expect.poll(() => m.agente.arranques().length, { timeout: 60_000 }).toBe(1)
      await expect.poll(() => persistido(datos)?.proyectos, { timeout: 15_000 }).toEqual([`personal|${m.suelto}`])
      expect(persistido(datos)?.diferidos, 'sin marca').toEqual([])
    })
  })

  test('un archivo de un proyecto abierto en OTRO perfil se abre allí, sin duplicar ni diferir', async () => {
    const m = montar()
    const siembra = {
      personal: [{ ruta: m.contenedora, nombre: 'contenedora' }],
      otro: [{ ruta: m.proyecto, nombre: 'proyecto' }]
    }
    await conApp(m, [m.archivoDeProyecto], siembra, async ({ win, datos }) => {
      await expect(pestanaEditor(win, 'leeme.txt')).toHaveCount(1, { timeout: 30_000 })
      await expect(win.locator('.profile-tab.active', { hasText: 'Otro' }), 'cambia al perfil que lo tiene abierto').toHaveCount(1)
      await expect(proyectoActivo(win, 'proyecto')).toHaveCount(1)
      await expect(win.locator(COLUMNA)).not.toHaveClass(/\bcc-hidden\b/)
      await win.waitForTimeout(1_500)
      const p = persistido(datos)
      expect(p?.proyectos.sort(), 'no se duplica en el perfil activo').toEqual(
        [`otro|${m.proyecto}`, `personal|${m.contenedora}`].sort()
      )
      expect(p?.diferidos, 'un proyecto ya abierto nunca se difiere').toEqual([])
    })
  })

  // El camino habitual: Tessera ya abierta y el sistema lanza una SEGUNDA instancia con el
  // archivo. Trae al frente la ventana de la prueba (no la del usuario: va por su userData).
  test('con Tessera abierta, la segunda instancia abre el archivo plegado y sin arrancar su agente', async () => {
    const m = montar()
    await conApp(m, [], { personal: [{ ruta: m.proyecto, nombre: 'proyecto' }] }, async ({ win, datos }) => {
      await expect.poll(() => m.agente.arranques().length, { timeout: 60_000 }).toBe(1)
      await asentar(win)
      // Muestreo por fotograma: ¿se llega a pintar el vacío «Iniciar…» con la columna abierta
      // en el hueco entre que el proyecto se confirma y que aparece la pestaña del archivo?
      await win.evaluate(() => {
        const w = window as unknown as { e2eDestellos: number }
        w.e2eDestellos = 0
        const mirar = (): void => {
          if (document.querySelector('.right-panel.cc-panel:not(.cc-hidden) .cc-empty .pane-empty-accion')) w.e2eDestellos++
          requestAnimationFrame(mirar)
        }
        requestAnimationFrame(mirar)
      })
      await lanzarSegundaInstancia(datos, m.archivoSuelto, m.agente.env)

      await expect(pestanaEditor(win, 'nota.txt')).toHaveCount(1, { timeout: 30_000 })
      await expect(proyectoActivo(win, 'suelto')).toHaveCount(1)
      await expect(win.locator(COLUMNA)).toHaveClass(/\bcc-hidden\b/)
      await win.waitForTimeout(MARGEN_ARRANQUE_MS)
      expect(m.agente.arranques().length, 'solo sigue vivo el agente del proyecto que ya estaba').toBe(1)
      const destellos = await win.evaluate(() => (window as unknown as { e2eDestellos: number }).e2eDestellos)
      expect(destellos, 'la columna con «Iniciar…» no llega a pintarse antes de plegarse').toBe(0)
      const focoEnEditor = await win.evaluate(() => Boolean(document.activeElement?.closest('.monaco-editor')))
      expect(focoEnEditor, 'el teclado queda en el editor').toBe(true)
    })
  })

  test('macOS: `open-file` restaura la ventana minimizada y abre el archivo', async () => {
    test.skip(PLATAFORMA !== 'mac', '`open-file` es un evento de Apple: en Windows la ruta llega por la segunda instancia')
    const m = montar()
    await conApp(m, [], { personal: [{ ruta: m.proyecto, nombre: 'proyecto' }] }, async ({ app, win }) => {
      await expect(proyectoActivo(win, 'proyecto')).toHaveCount(1, { timeout: 30_000 })
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
      // Minimizar es animado: sin esperar, el evento llegaría con la ventana aún a la vista
      // y no habría nada que restaurar.
      const minimizada = (): Promise<boolean> => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())
      await expect.poll(minimizada, { timeout: 15_000 }).toBe(true)
      await app.evaluate(({ app: a }, ruta) => a.emit('open-file', { preventDefault: () => {} }, ruta), m.archivoSuelto)
      await expect.poll(minimizada, { timeout: 15_000 }).toBe(false)
      await expect(pestanaEditor(win, 'nota.txt')).toHaveCount(1, { timeout: 30_000 })
      await expect(win.locator(COLUMNA)).toHaveClass(/\bcc-hidden\b/)
    })
  })
})

/**
 * Lanza el paquete como SEGUNDA instancia con un archivo, igual que el sistema, y espera a
 * que salga. El cerrojo de instancia única va atado al userData: se comprueba que es el
 * temporal de la prueba, porque con otro la ruta llegaría a la Tessera de quien la corre.
 */
async function lanzarSegundaInstancia(datos: string, archivo: string, envAgente: Record<string, string>): Promise<void> {
  const exe = rutaAppEmpaquetada()
  if (exe === null) throw new Error('Tessera no se empaqueta para esta plataforma.')
  expect(resolve(datos).toLowerCase().startsWith(resolve(tmpdir()).toLowerCase()), 'el userData es un temporal').toBe(true)
  const env = { ...process.env, ...envAgente } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  await new Promise<void>((resolver, rechazar) => {
    const hijo = spawn(exe, [`--user-data-dir=${datos}`, archivo], { env, stdio: 'ignore' })
    const tope = setTimeout(() => {
      hijo.kill()
      rechazar(new Error('la segunda instancia no salió en 30 s'))
    }, 30_000)
    hijo.on('error', rechazar)
    hijo.on('exit', () => {
      clearTimeout(tope)
      resolver()
    })
  })
}
