// =============================================================================
// El escenario del banco de rendimiento: 5 perfiles con 4 proyectos cada uno (repos git con dos
// archivos que se abren en el editor), una base SQLite por perfil con tablas y consolas abiertas, y
// sesiones SSH contra el ssh falso. Siembra el `userData` y da los gestos que el banco repite (abrir
// y cerrar una tabla, una consola, una sesión SSH o un proyecto). Agentes falsos (`agenteFalso.ts`).
// No es un spec: lo usa `banco-rendimiento.spec.ts`.
// =============================================================================

import { expect, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { filaTras } from './consolaAyudas'
import { git } from './humoAyudas'
import { esperarConsolaLista, monacoConsola } from './monaco'
import { montarSshFalso, sembrarHuellas, type SshFalso } from './sshFalso'
import { MOD, type SesionTessera } from './tessera'

export const PERFILES = ['uno', 'dos', 'tres', 'cuatro', 'cinco'] as const
export type IdPerfil = (typeof PERFILES)[number]
export const PROYECTOS_POR_PERFIL = 4
export const ARCHIVO_BD = 'datos.db'
/** Tablas que el escenario deja abiertas; `categorias` es la del ciclo de abrir y cerrar. */
export const TABLAS_ABIERTAS = ['clientes', 'pedidos', 'productos'] as const
export const TABLA_CICLO = 'categorias'
const FECHA = '2026-01-15T10:00:00Z'

export interface Proyecto {
  perfil: IdPerfil
  nombre: string
  ruta: string
}

export interface Escenario {
  agente: AgenteFalso
  ssh: SshFalso
  env: Record<string, string>
  proyectos: Proyecto[]
}

export const nombrePerfil = (id: IdPerfil): string => id.toUpperCase()

/** Un archivo de código de ~400 líneas y un JSON de ~200, para que el editor tenga algo que pintar. */
function archivosDelProyecto(ruta: string, nombre: string): void {
  const funciones = Array.from(
    { length: 80 },
    (_, i) => `export function paso${i}(entrada: number): number {\n  const doble = entrada * 2\n  return doble + ${i}\n}\n`
  )
  writeFileSync(join(ruta, 'servicio.ts'), `// ${nombre}\n${funciones.join('\n')}`)
  const config = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`clave${i}`, { valor: i, activo: i % 2 === 0, nombre: `opción ${i}` }]))
  writeFileSync(join(ruta, 'config.json'), JSON.stringify(config, null, 2))
}

/** La base del perfil: cuatro tablas con filas de sobra para llenar varias páginas de la rejilla. */
function crearBase(ruta: string): void {
  const db = new DatabaseSync(join(ruta, ARCHIVO_BD))
  db.exec(`
    create table categorias(id integer primary key, nombre text);
    create table productos(id integer primary key, nombre text, precio real, categoria integer);
    create table clientes(id integer primary key, nombre text, correo text, ciudad text, alta text);
    create table pedidos(id integer primary key, cliente integer, producto integer, cantidad integer, total real, fecha text, nota text);
    with recursive n(i) as (select 1 union all select i + 1 from n where i < 40) insert into categorias select i, 'categoría ' || i from n;
    with recursive n(i) as (select 1 union all select i + 1 from n where i < 300) insert into productos select i, 'producto ' || i, i * 1.5, i % 40 + 1 from n;
    with recursive n(i) as (select 1 union all select i + 1 from n where i < 2000) insert into clientes select i, 'cliente ' || i, 'c' || i || '@ejemplo.invalid', 'ciudad ' || (i % 50), '2025-01-01' from n;
    with recursive n(i) as (select 1 union all select i + 1 from n where i < 20000) insert into pedidos select i, i % 2000 + 1, i % 300 + 1, i % 7 + 1, i * 2.25, '2025-06-01', 'nota del pedido ' || i from n;
  `)
  db.close()
}

/** Agente y ssh falsos, y los 20 proyectos (repos git con un cambio pendiente; el primero de cada perfil, con la base). */
export function montarEscenario(): Escenario {
  const agente = montarAgenteFalso()
  const ssh = montarSshFalso()
  const proyectos: Proyecto[] = []
  for (const perfil of PERFILES) {
    for (let i = 1; i <= PROYECTOS_POR_PERFIL; i++) {
      const nombre = `${perfil}-p${i}`
      const ruta = join(agente.raiz, nombre)
      mkdirSync(ruta)
      archivosDelProyecto(ruta, nombre)
      git(ruta, FECHA, 'init', '-q', '-b', 'main')
      git(ruta, FECHA, 'add', '-A')
      git(ruta, FECHA, 'commit', '-q', '-m', 'inicio')
      writeFileSync(join(ruta, 'servicio.ts'), `// cambiado\n`, { flag: 'a' })
      if (i === 1) crearBase(ruta)
      proyectos.push({ perfil, nombre, ruta })
    }
  }
  const e = { agente, ssh, env: { ...agente.env, ...ssh.env }, proyectos }
  callarAgentes(e, true)
  return e
}

/**
 * El agente falso escribe una línea por segundo. Callado es un agente en espera (lo normal en el
 * reposo y en los ciclos); hablando, uno que trabaja.
 */
export function callarAgentes(e: Escenario, si: boolean): void {
  for (const p of e.proyectos) e.agente.callar(p.ruta, si)
}

/** Perfiles nativos sin sandbox, todos sus proyectos abiertos y la terminal abajo en cada uno. */
export function sembrarEscenario(datos: string, e: Escenario): void {
  const colores = ['#9814c8', '#1f9e7a', '#c8641e', '#1478c8', '#c81e5a']
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify(
      PERFILES.map((id, i) => ({
        id,
        nombre: nombrePerfil(id),
        color: colores[i],
        agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
        sandbox: { habilitado: false }
      }))
    )
  )
  const porPerfil = Object.fromEntries(
    PERFILES.map((id) => {
      const suyos = e.proyectos.filter((p) => p.perfil === id)
      return [id, { openProjects: suyos.map((p) => ({ projectHostPath: p.ruta, name: p.nombre, estado: 'active' })), activePath: suyos[0].ruta }]
    })
  )
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: PERFILES[0],
      byProfile: porPerfil,
      settings: {
        defaultProjectMode: 'windows',
        windowsModeProjects: e.proyectos.map((p) => `${p.perfil}|${p.ruta}`),
        panelInferiorPorPerfil: Object.fromEntries(PERFILES.map((id) => [id, 'terminal'])),
        menuWindowsAvisado: true
      }
    })
  )
}

/** Deja que React confirme el render provocado por el gesto. */
export async function asentar(ventana: Page): Promise<void> {
  await ventana.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

export function pestanaPerfil(ventana: Page, id: IdPerfil): Locator {
  return ventana.locator('.profile-tab', { hasText: nombrePerfil(id) }).first()
}

/** Cambia de perfil con un clic y espera a que quede activo. */
export async function irAPerfil(ventana: Page, id: IdPerfil): Promise<void> {
  await pestanaPerfil(ventana, id).click()
  await expect(ventana.locator('.profile-tab.active', { hasText: nombrePerfil(id) })).toHaveCount(1)
}

/** Cambia la vista del lateral (por su etiqueta: el `title` se guarda aparte mientras el ratón está encima). */
export async function vista(ventana: Page, etiqueta: 'Archivos' | 'Bases de datos'): Promise<void> {
  await ventana.locator(`.activity-item[aria-label="${etiqueta}"]`).click()
  await asentar(ventana)
}

/** Visita un proyecto: arranca su agente y su terminal, y abre sus dos archivos en el editor. */
export async function cargarProyecto(ventana: Page, e: Escenario, p: Proyecto, arranques: number): Promise<void> {
  await ventana.locator('.tabs-projects .project-tab', { hasText: p.nombre }).first().click()
  await expect.poll(() => e.agente.arranques().length, { timeout: 60_000 }).toBeGreaterThanOrEqual(arranques)
  for (const archivo of ['servicio.ts', 'config.json']) {
    await ventana.locator('.sidebar .tree-row:visible', { hasText: archivo }).first().click()
    await expect(ventana.locator('.editor-tab.active', { hasText: archivo })).toHaveCount(1)
  }
  await expect(ventana.locator('section.terminal-panel:visible .terminal-pane[aria-hidden="false"] .xterm-screen')).toHaveCount(1, {
    timeout: 30_000
  })
}

/** La fila de la conexión de la base del perfil en el árbol que se ve. */
function filaConexion(ventana: Page): Locator {
  return ventana.locator('.db-arbol:visible .db-fila-conexion', { hasText: ARCHIVO_BD }).first()
}

/** Despliega una fila por su chevron, solo si está plegada. */
async function desplegar(f: Locator): Promise<void> {
  const abierta = await f.locator('.db-chevron svg').first().evaluate((s) => s.classList.contains('open')).catch(() => false)
  if (!abierta) await f.locator('.db-chevron').click()
}

/**
 * `filaTras` con la marca limpia antes: la lista del árbol es virtual y recicla sus nodos, así que una
 * marca de una vuelta anterior puede haber quedado en otra fila.
 */
async function marcarTras(ventana: Page, ancla: Locator, tipo: string, marca: string, nombre: string): Promise<Locator> {
  await ventana.evaluate((m) => {
    document.querySelectorAll(`[data-e2e="${m}"]`).forEach((el) => el.removeAttribute('data-e2e'))
  }, marca)
  return filaTras(ventana, ancla, tipo, marca, nombre)
}

/** La carpeta de tablas de la base del perfil, desplegada. */
async function carpetaTablas(ventana: Page, perfil: IdPerfil): Promise<Locator> {
  const conexion = filaConexion(ventana)
  await expect(conexion).toHaveCount(1, { timeout: 30_000 })
  await desplegar(conexion)
  const esquema = await marcarTras(ventana, conexion, 'esquema', `${perfil}-esq`, 'main')
  await desplegar(esquema)
  const tablas = await marcarTras(ventana, esquema, 'carpeta', `${perfil}-tablas`, 'tablas')
  await desplegar(tablas)
  return tablas
}

const PESTANAS = '.db-area:not(.hidden) .db-tabs [role="tab"]'
const CONSOLA = 'section.db-consola:not(.hidden)'
const PANE = '.db-area:not(.hidden) .db-pane:not(.hidden)'

/** Abre una tabla con doble clic y espera a que su rejilla tenga filas. */
export async function abrirTabla(ventana: Page, perfil: IdPerfil, tabla: string): Promise<void> {
  const tablas = await carpetaTablas(ventana, perfil)
  await (await marcarTras(ventana, tablas, 'objeto', `${perfil}-${tabla}`, tabla)).dblclick()
  await expect(ventana.locator(`${PANE} .db-rejilla-cuerpo .db-rejilla-fila`).first()).toBeVisible({ timeout: 30_000 })
}

/** Cierra la pestaña de la vista de BD que contiene `nombre`, o la activa si no se da. */
export async function cerrarPestanaBd(ventana: Page, nombre?: string): Promise<void> {
  const antes = await ventana.locator(PESTANAS).count()
  const p = nombre === undefined ? ventana.locator(`${PESTANAS}[aria-selected="true"]`) : ventana.locator(PESTANAS).filter({ hasText: nombre }).first()
  await p.hover()
  await p.getByRole('button', { name: /^Cerrar/ }).click()
  await expect(ventana.locator(PESTANAS)).toHaveCount(antes - 1)
}

/** Abre una consola nueva sobre la base del perfil, ejecuta `sql` y espera a que acabe. */
export async function abrirConsola(ventana: Page, sql: string): Promise<void> {
  await filaConexion(ventana).click()
  const antes = await ventana.locator(PESTANAS).count()
  await ventana.keyboard.press(`${MOD}+KeyN`)
  await expect(ventana.locator(PESTANAS)).toHaveCount(antes + 1)
  await esperarConsolaLista(ventana)
  await monacoConsola(ventana, { op: 'fijar', texto: sql })
  await ventana.locator(`${CONSOLA} .db-consola-run-todo`).click()
  await expect(ventana.locator(`${CONSOLA} .db-consola-detener`)).toBeDisabled({ timeout: 60_000 })
}

/** Monta la base del primer proyecto del perfil, abre sus tablas y dos consolas con resultados. */
export async function cargarBase(s: SesionTessera, perfil: IdPerfil, proyecto: Proyecto): Promise<void> {
  const ventana = s.ventana
  await ventana.evaluate((r) => window.tessera.db.montarArchivo(r), { profileId: perfil, projectHostPath: proyecto.ruta, relPath: ARCHIVO_BD })
  await vista(ventana, 'Bases de datos')
  for (const t of TABLAS_ABIERTAS) await abrirTabla(ventana, perfil, t)
  await abrirConsola(ventana, 'select * from pedidos limit 1000')
  await abrirConsola(ventana, 'select c.ciudad, count(*) as n, sum(p.total) as total from pedidos p join clientes c on c.id = p.cliente group by c.ciudad')
}

/** La terminal de abajo del perfil que se ve. */
function panelTerminal(ventana: Page): Locator {
  return ventana.locator('section.terminal-panel:visible')
}

/** Abre una sesión SSH por el lanzador de la cabecera de la terminal y espera su pestaña. */
export async function abrirSsh(ventana: Page, alias: string): Promise<void> {
  const panel = panelTerminal(ventana)
  await panel.locator('.panel-header').first().hover()
  await panel.getByRole('button', { name: 'Conexiones SSH', exact: true }).click()
  const lanzador = ventana.getByRole('dialog', { name: 'Conexiones SSH' })
  await expect(lanzador).toBeVisible()
  await lanzador.getByRole('combobox', { name: 'Buscar conexión' }).fill(alias)
  await ventana.keyboard.press('Enter')
  await expect(lanzador).toHaveCount(0)
  await expect(panel.getByRole('tab', { name: `${alias}, SSH` })).toBeVisible({ timeout: 30_000 })
}

/** Cierra la pestaña SSH `alias` del perfil que se ve. */
export async function cerrarSsh(ventana: Page, alias: string): Promise<void> {
  const panel = panelTerminal(ventana)
  const pestana = panel.getByRole('tab', { name: `${alias}, SSH` })
  await pestana.hover()
  await pestana.getByRole('button', { name: /^Cerrar/ }).click()
  await expect(pestana).toHaveCount(0, { timeout: 15_000 })
}

/** Crea las conexiones SSH del perfil (por la API del preload), con su huella ya confirmada, y abre las dos primeras. */
export async function cargarSsh(s: SesionTessera, perfil: IdPerfil): Promise<void> {
  const ventana = s.ventana
  await ventana.evaluate(async (perfilId) => {
    for (const [alias, host] of [
      ['Alfa', '192.0.2.10'],
      ['Beta', '192.0.2.11'],
      ['Ciclo', '192.0.2.12']
    ]) {
      await window.tessera.ssh.crear({ profileId: perfilId, alias, grupoId: null, host, puerto: 22, usuario: 'pruebas', metodo: 'sistema', disponibleAgentes: false })
    }
  }, perfil)
  await sembrarHuellas(ventana, s.datos)
  // La vista de BD ocupa el centro entero: la terminal de abajo es la de la vista de archivos.
  await vista(ventana, 'Archivos')
  await abrirSsh(ventana, 'Alfa')
  await abrirSsh(ventana, 'Beta')
}

/** Cierra un proyecto con su «x» y la confirmación. */
export async function cerrarProyecto(ventana: Page, p: Proyecto): Promise<void> {
  const pestana = ventana.locator('.tabs-projects .project-tab', { hasText: p.nombre }).first()
  await pestana.hover()
  await pestana.getByRole('button', { name: `Cerrar ${p.nombre}` }).click()
  await ventana.getByRole('dialog', { name: /Cerrar el proyecto/ }).getByRole('button', { name: `Cerrar "${p.nombre}"`, exact: true }).click()
  await expect(ventana.locator('.tabs-projects .project-tab', { hasText: p.nombre })).toHaveCount(0)
}

/** Vuelve a abrir un proyecto por el «+» (el diálogo de carpeta se sustituye en el main) y espera su agente. */
export async function reabrirProyecto(s: SesionTessera, e: Escenario, p: Proyecto, arranques: number): Promise<void> {
  await s.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [dir] })
  }, p.ruta)
  await s.ventana.locator('.project-tab-add').click()
  await expect(s.ventana.locator('.tabs-projects .project-tab', { hasText: p.nombre })).toHaveCount(1, { timeout: 30_000 })
  await cargarProyecto(s.ventana, e, p, arranques)
}
