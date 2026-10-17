// =============================================================================
// Cambiar de perfil A → B → A, fotograma a fotograma, sobre la app empaquetada: ningún fotograma
// enseña cosas de dos perfiles (pestaña de perfil, laterales, pestaña del editor) ni «Cargando…»
// al volver. Al volver, el explorador está tal cual (carpeta y desplazamiento), también tras pasar
// por otra vista lateral; y el lateral de BD, con su conexión desplegada y un alta a medias, vuelve
// tal cual de un perfil que enseña Archivos, sin que su diálogo oculto se quede con Esc ni con los
// atajos de ese perfil. Agente falso; la base es un SQLite del proyecto, sin Docker.
// Decisiones: docs/decisiones/renderer/vivos-y-ocultos.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { desplegar, fila as filaBd, filaTras } from './consolaAyudas'
import { abrirTessera, borrarTemporal, MOD, type SesionTessera } from './tessera'

/** Lo que se ve en un fotograma. */
interface Fotograma {
  perfil: string
  filas: string[]
  pestana: string
  cargando: boolean
}

/** Archivos de cada proyecto: los nombres dicen de qué perfil son. */
const ARCHIVOS_CARPETA = 150
/** La base SQLite del proyecto de Personal, con la que se monta su conexión de BD. */
const BASE_ALFA = 'notas.db'

function perfil(id: string, nombre: string, color: string): object {
  return { id, nombre, color, agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }], sandbox: { habilitado: false } }
}

/** «alfa» (de Personal) con una carpeta larga, y «delta» (de Trabajo). */
function montar(agente: AgenteFalso): { alfa: string; delta: string } {
  const alfa = join(agente.raiz, 'alfa')
  const delta = join(agente.raiz, 'delta')
  mkdirSync(join(alfa, 'carpeta-alfa'), { recursive: true })
  mkdirSync(delta)
  writeFileSync(join(alfa, 'alfa.txt'), 'alfa\n')
  for (let i = 0; i < ARCHIVOS_CARPETA; i++) {
    writeFileSync(join(alfa, 'carpeta-alfa', `alfa-${String(i).padStart(3, '0')}.txt`), `${i}\n`)
  }
  writeFileSync(join(delta, 'delta.txt'), 'delta\n')
  writeFileSync(join(alfa, BASE_ALFA), sqliteVacia())
  return { alfa, delta }
}

function sembrar(datos: string, rutas: { alfa: string; delta: string }): void {
  writeFileSync(join(datos, 'profiles.json'), JSON.stringify([perfil('personal', 'Personal', '#9814c8'), perfil('trabajo', 'Trabajo', '#1f8f4e')]))
  const abierto = (ruta: string, name: string): object => ({ projectHostPath: ruta, name, estado: 'active' })
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: {
        personal: { openProjects: [abierto(rutas.alfa, 'alfa')], activePath: rutas.alfa },
        trabajo: { openProjects: [abierto(rutas.delta, 'delta')], activePath: rutas.delta }
      },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${rutas.alfa}`, `trabajo|${rutas.delta}`] }
    })
  )
}

/** Deja que React confirme el render provocado por el gesto. */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** La fila VISIBLE del explorador con ese nombre. */
const fila = (win: Page, nombre: string) => win.locator('.sidebar .tree-row:visible', { hasText: nombre }).first()

/** El desplazamiento del árbol que se ve. */
async function desplazamiento(win: Page): Promise<number> {
  return win.evaluate(() => {
    const visibles = Array.from(document.querySelectorAll<HTMLElement>('.sidebar .tree-virtual')).filter((e) => e.checkVisibility())
    return visibles[0]?.scrollTop ?? -1
  })
}

/**
 * Hace el gesto y anota cada fotograma hasta `ms` después. El muestreo arranca ANTES del gesto,
 * en la página, para no perder los primeros. Las filas son las que se ven de cualquier lateral
 * (explorador o BD): los ocultos siguen en el DOM.
 */
async function muestreando(win: Page, gesto: () => Promise<void>, ms = 1500): Promise<Fotograma[]> {
  await win.evaluate((duracion) => {
    const w = window as unknown as { __fotogramas: unknown[] }
    w.__fotogramas = []
    const fin = performance.now() + duracion
    const seVe = (e: HTMLElement): boolean => e.checkVisibility({ visibilityProperty: true })
    const anotar = (): void => {
      w.__fotogramas.push({
        perfil: document.querySelector('.profile-tab.active')?.textContent?.trim() ?? '',
        filas: Array.from(document.querySelectorAll<HTMLElement>('.sidebar .tree-row'))
          .filter(seVe)
          .map((e) => e.textContent?.trim() ?? ''),
        pestana: document.querySelector('.editor-tab.active')?.textContent?.trim() ?? '',
        cargando: Array.from(document.querySelectorAll<HTMLElement>('.sidebar .tree-row.muted')).some(seVe)
      })
      if (performance.now() < fin) requestAnimationFrame(anotar)
    }
    requestAnimationFrame(anotar)
  }, ms)
  await gesto()
  await win.waitForTimeout(ms + 200)
  return win.evaluate(() => (window as unknown as { __fotogramas: Fotograma[] }).__fotogramas)
}

/** Pulsa la pestaña del perfil `nombre`, muestreando los fotogramas. */
function cambiarMuestreando(win: Page, nombre: string, ms = 1500): Promise<Fotograma[]> {
  return muestreando(win, () => win.locator('.tabs-profiles .profile-tab', { hasText: nombre }).first().click(), ms)
}

/** El botón de una vista lateral en el riel de actividad. */
function botonVista(win: Page, titulo: 'Archivos' | 'Git · Cambios' | 'Conexiones a bases de datos') {
  return win.locator(`.activity-item[title="${titulo}"]`)
}

/**
 * Una base SQLite vacía y válida: la cabecera de 100 bytes y la página 1 con la tabla del esquema
 * sin filas. El explorador de BD la abre sin que haga falta ningún binario en la máquina de prueba.
 */
function sqliteVacia(): Buffer {
  const pagina = 4096
  const b = Buffer.alloc(pagina)
  b.write('SQLite format 3\u0000', 0, 'latin1')
  b.writeUInt16BE(pagina, 16)
  b[18] = 1 // escritura: rollback
  b[19] = 1 // lectura: rollback
  b[21] = 64
  b[22] = 32
  b[23] = 32
  b.writeUInt32BE(1, 24) // contador de cambios
  b.writeUInt32BE(1, 28) // páginas
  b.writeUInt32BE(4, 44) // formato del esquema
  b.writeUInt32BE(1, 56) // UTF-8
  b.writeUInt32BE(1, 92) // versión válida para el contador
  b.writeUInt32BE(3045000, 96)
  b[100] = 0x0d // hoja de tabla, sin celdas
  b.writeUInt16BE(pagina, 105) // el contenido empieza al final de la página
  return b
}

/** Los fotogramas que enseñan algo del perfil contrario al de su pestaña activa. */
function mezclados(fotos: readonly Fotograma[]): Fotograma[] {
  const deDelta = (s: string): boolean => s.includes('delta')
  const deAlfa = (s: string): boolean => s.includes('alfa')
  return fotos.filter((f) => {
    const ajeno = f.perfil.includes('Personal') ? deDelta : f.perfil.includes('Trabajo') ? deAlfa : () => false
    return f.filas.some(ajeno) || ajeno(f.pestana)
  })
}

test.describe.serial('Cambiar de perfil A → B → A, fotograma a fotograma', () => {
  let s: SesionTessera
  let agente: AgenteFalso
  let rutas: { alfa: string; delta: string }

  test.beforeAll(async () => {
    agente = montarAgenteFalso()
    rutas = montar(agente)
    s = await abrirTessera(agente.env, { sembrar: (datos) => sembrar(datos, rutas) })
    await expect(fila(s.win, 'alfa.txt')).toBeVisible({ timeout: 30_000 })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agente) borrarTemporal(agente.raiz)
  })

  test('ningún fotograma mezcla dos perfiles, y Personal vuelve con su carpeta abierta y su desplazamiento', async () => {
    const win = s.win
    // Personal: un archivo abierto, la carpeta desplegada y el árbol desplazado.
    await fila(win, 'alfa.txt').click()
    await expect(win.locator('.editor-tab.active', { hasText: 'alfa.txt' })).toHaveCount(1)
    await fila(win, 'carpeta-alfa').click()
    await expect(fila(win, 'alfa-000.txt')).toBeVisible()
    await win.evaluate(() => {
      const arbol = Array.from(document.querySelectorAll<HTMLElement>('.sidebar .tree-virtual')).find((e) => e.checkVisibility())
      if (arbol) arbol.scrollTop = arbol.scrollHeight / 2
    })
    await asentar(win)
    const antes = await desplazamiento(win)
    expect(antes, 'el árbol se desplazó').toBeGreaterThan(200)

    // A Trabajo: ni un fotograma con algo de Personal bajo su pestaña.
    const ida = await cambiarMuestreando(win, 'Trabajo')
    await expect(fila(win, 'delta.txt')).toBeVisible()
    await fila(win, 'delta.txt').click()
    await expect(win.locator('.editor-tab.active', { hasText: 'delta.txt' })).toHaveCount(1)

    // Y de vuelta a Personal.
    const vuelta = await cambiarMuestreando(win, 'Personal')
    const todos = [...ida, ...vuelta]
    expect(todos.length, 'se muestrearon fotogramas').toBeGreaterThan(20)
    expect(mezclados(todos), 'fotogramas con cosas del otro perfil').toEqual([])
    const conPersonal = vuelta.filter((f) => f.perfil.includes('Personal'))
    expect(conPersonal.filter((f) => f.cargando), 'al volver no se ve «Cargando…»').toEqual([])
    expect(
      conPersonal.filter((f) => f.filas.length === 0),
      'al volver, el árbol de Personal está desde el primer fotograma'
    ).toEqual([])

    // Tal cual: la carpeta abierta, el mismo desplazamiento y su archivo en el editor.
    await expect(win.locator('.editor-tab.active', { hasText: 'alfa.txt' })).toHaveCount(1)
    await expect(win.locator('.sidebar .tree-row:visible', { hasText: /^alfa-\d+\.txt/ }).first()).toBeVisible()
    expect(await desplazamiento(win), 'el árbol vuelve con su desplazamiento').toBe(antes)
  })

  test('Archivos → Git → Archivos: el explorador vuelve con su carpeta y su desplazamiento, sin «Cargando…»', async () => {
    const win = s.win
    await expect(win.locator('.sidebar .tree-row:visible', { hasText: /^alfa-\d+\.txt/ }).first(), 'la carpeta sigue abierta').toBeVisible()
    await win.evaluate(() => {
      const arbol = Array.from(document.querySelectorAll<HTMLElement>('.sidebar .tree-virtual')).find((e) => e.checkVisibility())
      if (arbol) arbol.scrollTop = Math.round(arbol.scrollHeight / 3)
    })
    await asentar(win)
    const antes = await desplazamiento(win)
    expect(antes, 'el árbol se desplazó').toBeGreaterThan(200)

    await botonVista(win, 'Git · Cambios').click()
    await expect(win.locator('aside.sidebar.git-panel'), 'se ve el lateral de git').toBeVisible()
    const filaOculta = win.locator('.sidebar .tree-row', { hasText: /^alfa-\d+\.txt/ }).first()
    await expect(filaOculta, 'el explorador sigue montado').toBeAttached()
    await expect(filaOculta, 'pero no se ve').toBeHidden()

    const vuelta = await muestreando(win, () => botonVista(win, 'Archivos').click(), 1000)
    const conArbol = vuelta.filter((f) => f.filas.some((n) => n.startsWith('alfa-')))
    expect(conArbol.length, 'el explorador se ve en los fotogramas de la vuelta').toBeGreaterThan(0)
    expect(vuelta.filter((f) => f.cargando), 'al volver no se ve «Cargando…»').toEqual([])
    await expect(win.locator('aside.sidebar.git-panel'), 'el lateral de git no se conserva').toHaveCount(0)
    expect(await desplazamiento(win), 'el explorador vuelve con su desplazamiento').toBe(antes)
  })

  test('BD a medias en Personal, Archivos en Trabajo: al volver, el árbol y el diálogo están tal cual, y en Trabajo Esc y los atajos son suyos', async () => {
    const win = s.win
    // Personal en la vista de BD, con su conexión SQLite desplegada.
    await botonVista(win, 'Conexiones a bases de datos').click()
    await win.evaluate(
      (r) =>
        window.tessera.db.create({
          profileId: 'personal',
          alias: 'notas',
          motor: 'sqlite',
          host: '',
          port: 0,
          user: '',
          readonly: true,
          archivo: { tipo: 'proyecto', projectHostPath: r.alfa, relPath: r.base }
        } as never),
      { alfa: rutas.alfa, base: BASE_ALFA }
    )
    const conexion = filaBd(win, 'conexion', 'notas')
    await expect(conexion).toHaveCount(1, { timeout: 30_000 })
    await desplegar(conexion)
    const esquema = await filaTras(win, conexion, 'esquema', 'notas-main', 'main')
    await expect(esquema, 'la conexión desplegada enseña su esquema').toBeVisible({ timeout: 30_000 })

    // Y un alta a medias, con el foco en el nombre.
    await win.locator('.db-arbol:visible .sidebar-actions button[aria-label="Nueva conexión"]').click()
    const dialogo = win.locator('.db-conexion-modal')
    await expect(dialogo).toBeVisible()
    const alias = dialogo.locator('[data-campo="alias"]')
    await alias.fill('a-medias')
    await alias.focus()

    // Trabajo, en Archivos: el diálogo de Personal no se ve ni tapa nada. Su velo cubre las pestañas
    // de perfil, así que el cambio se pide sin el ratón, como cuando lo pide otra parte de la app.
    const pestanaTrabajo = win.locator('.tabs-profiles .profile-tab', { hasText: 'Trabajo' }).first()
    const ida = await muestreando(win, () => pestanaTrabajo.dispatchEvent('click'))
    expect(mezclados(ida), 'fotogramas con cosas del otro perfil').toEqual([])
    await expect(fila(win, 'delta.txt')).toBeVisible()
    await expect(dialogo, 'el diálogo de Personal no se ve en Trabajo').toBeHidden()
    await fila(win, 'delta.txt').click({ button: 'right' })
    const menu = win.locator('.ctx-menu')
    await expect(menu, 'el menú del explorador de Trabajo se abre').toBeVisible()
    await win.keyboard.press('Escape')
    await expect(menu, 'Esc cierra lo de Trabajo').toHaveCount(0)
    await win.keyboard.press(`${MOD}+n`)
    await expect(win.locator('.editor-tab.active', { hasText: 'Sin título' }), 'un atajo global sigue vivo: el diálogo oculto no cuenta como modal').toHaveCount(1)

    // De vuelta a Personal: el árbol desde el primer fotograma y el diálogo con lo escrito y su foco.
    const vuelta = await cambiarMuestreando(win, 'Personal')
    expect(mezclados(vuelta), 'fotogramas con cosas del otro perfil').toEqual([])
    const conPersonal = vuelta.filter((f) => f.perfil.includes('Personal'))
    expect(conPersonal.filter((f) => f.cargando), 'al volver no se ve «Cargando…»').toEqual([])
    expect(
      conPersonal.filter((f) => !f.filas.some((n) => n.startsWith('main'))),
      'el esquema desplegado está desde el primer fotograma'
    ).toEqual([])
    await expect(dialogo, 'el diálogo vuelve').toBeVisible()
    await expect(alias, 'con lo escrito').toHaveValue('a-medias')
    await expect(alias, 'y con el foco donde estaba').toBeFocused()
  })
})
