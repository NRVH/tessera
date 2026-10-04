// =============================================================================
// SQLite en la interfaz sobre la app empaquetada, sin Docker (la base es un archivo en la
// carpeta del proyecto; igual en Windows y Mac): el alta con «Crear nueva…» (el diálogo
// nativo de guardar se sustituye en el main y lo demás es el camino real), el árbol con sus
// carpetas bajo `main`, abrir una tabla (paginado keyset), Tx Manual, Detener = matar el
// proceso de esa consola y seguir con uno nuevo, «Montar como base de datos» desde el
// explorador de archivos (visible, solo lectura para los agentes, «Desmontar») y
// «Desconectar». Soltar un archivo y el caso TCC de macOS son a mano. En serie, comparte app.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import {
  CONSOLA,
  PESTANAS,
  aLaVista,
  celdaResultado,
  crearProyecto,
  desplegar,
  ejecutarTodoSeleccionado,
  elegirDelMenu,
  esperarFinEjecucion,
  fila,
  filaTras,
  abrirConsolaNueva
} from './consolaAyudas'
import { esperarConsolaLista, monacoConsola } from './monaco'
import { celda, PANE } from './rejillaAyudas'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const PERFIL = 'personal'
const ALIAS = 'tienda'
const ARCHIVO = 'tienda.db'
const COPIA = 'copia.db'

const SIEMBRA = [
  'create table clientes(id integer primary key, nombre text not null)',
  "insert into clientes(nombre) values ('Ana'), ('Luis'), ('Eva')",
  'create view v_clientes as select nombre from clientes',
  'create virtual table notas using fts5(texto)',
  "insert into notas(texto) values ('hola')"
].join(';\n')

test.describe.configure({ mode: 'serial' })

/** Cambia de vista en el riel. */
function botonVista(win: Page, titulo: 'Archivos' | 'Conexiones a bases de datos'): ReturnType<Page['locator']> {
  return win.locator(`.activity-item[title="${titulo}"]`)
}

/** Una fila del explorador de ARCHIVOS por su nombre. */
function filaArchivo(win: Page, nombre: string): ReturnType<Page['locator']> {
  return win.locator('.sidebar .tree-row', { hasText: nombre }).first()
}

/** Carga el texto en la consola y pulsa «Ejecutar todo». */
async function ejecutarTodo(win: Page, sql: string): Promise<void> {
  await monacoConsola(win, { op: 'fijar', texto: sql })
  await win.locator(`${CONSOLA} .db-consola-run-todo`).click()
}

/** La conexión del perfil por su alias, leída del main (el renderer no ve la ruta). */
async function conexionPorAlias(win: Page, alias: string): Promise<{ id: string; readonly: boolean; verificada: boolean; archivoVisible?: string } | null> {
  return win.evaluate(
    async (a) => {
      const c = (await window.tessera.db.list(a.perfil)).find((x) => x.alias === a.alias)
      return c ? { id: c.id, readonly: c.readonly, verificada: c.verificada === true, archivoVisible: c.archivoVisible } : null
    },
    { perfil: PERFIL, alias }
  )
}

test.describe('explorador de BD: SQLite', () => {
  let s: SesionTessera | null = null
  let falso: AgenteFalso | null = null
  let proyecto = ''

  test.beforeAll(async () => {
    const agente = montarAgenteFalso()
    falso = agente
    proyecto = crearProyecto(agente.raiz)
    s = await abrirTessera(agente.env, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: PERFIL,
            byProfile: {
              [PERFIL]: {
                openProjects: [{ projectHostPath: proyecto, name: 'proyecto-sqlite', estado: 'active' }],
                activePath: proyecto
              }
            },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`${PERFIL}|${proyecto}`] }
          })
        )
      }
    })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1600, 1000)
    })
    await expect(s.win.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  // (0) ALTA con «Crear nueva…»: el diálogo de guardar del main contesta una ruta del
  // proyecto; el formulario queda sin usuario ni contraseña, con el nombre del archivo y
  // de ESCRITURA (la base la creó Tessera).
  test('(0) alta de una SQLite nueva por el diálogo', async () => {
    const win = s!.win
    await aLaVista(win)
    const ruta = join(proyecto, ARCHIVO)
    await s!.app.evaluate(({ dialog }, r) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: r })) as typeof dialog.showSaveDialog
    }, ruta)
    await botonVista(win, 'Conexiones a bases de datos').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    await win.locator('.db-arbol .sidebar-actions button[aria-label="Nueva conexión"]').click()
    const modal = win.locator('.db-conexion-modal')
    await expect(modal).toBeVisible()
    await modal.locator('.dbc-motor select').selectOption('sqlite')
    await expect(modal.locator('[data-campo="user"]'), 'sin usuario').toHaveCount(0)
    await expect(modal.locator('input[type="password"]'), 'sin contraseña').toHaveCount(0)
    await expect(modal.locator('[data-campo="archivo"]')).toHaveValue('')
    await modal.getByRole('button', { name: 'Crear nueva…' }).click()
    await expect(modal.locator('[data-campo="archivo"]')).toHaveValue(ARCHIVO)
    await expect(modal.locator('[data-campo="alias"]'), 'el nombre sale del archivo').toHaveValue(ALIAS)
    // Ahora la casilla solo limita a los agentes: una base creada nace con la
    // recomendada, como cualquier otra (el usuario escribe igual desde el explorador).
    await expect(modal.locator('.dbc-check input[type="checkbox"]'), 'creada: con «Solo lectura para los agentes»').toBeChecked()
    await modal.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(modal).toHaveCount(0)
    const conexion = fila(win, 'conexion', ALIAS)
    await expect(conexion).toHaveCount(1)
    await expect(conexion.locator('.db-motor-icono svg.db-motor-sqlite')).toHaveCount(1)
    const c = await conexionPorAlias(win, ALIAS)
    expect(c?.archivoVisible, 'el renderer ve el NOMBRE, no la ruta').toBe(ARCHIVO)
    expect(c?.readonly, 'con la casilla de los agentes (la recomendada)').toBe(true)
  })

  // (1) Una consola sobre ella siembra una tabla, una vista y una tabla virtual (en Tx
  // Auto, que es la de una conexión de escritura sin entorno).
  test('(1) consola: sembrar tabla, vista y tabla virtual', async () => {
    const win = s!.win
    await fila(win, 'conexion', ALIAS).click()
    await win.keyboard.press(`${MOD}+KeyN`)
    await expect(win.locator(PESTANAS)).toHaveCount(1)
    await esperarConsolaLista(win)
    await expect(win.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Auto')
    await ejecutarTodo(win, SIEMBRA)
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-glifo-error`), 'la siembra no falla').toHaveCount(0)
    await ejecutarTodoSeleccionado(win, 'select count(*) as n from clientes')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0)).toHaveText('3', { timeout: 15_000 })
  })

  // (2) EL ÁRBOL: `main` con sus tres carpetas (las vacías no se pintan: por eso se sembró
  // una de cada), y la tabla abre en una pestaña con sus filas (paginado keyset).
  test('(2) árbol con sus carpetas y abrir una tabla', async () => {
    const win = s!.win
    const conexion = fila(win, 'conexion', ALIAS)
    await conexion.click()
    await win.locator('.db-arbol .sidebar-actions button[aria-label="Refrescar"]').click()
    await desplegar(conexion)
    const esquema = await filaTras(win, conexion, 'esquema', 'lite-esq', 'main')
    await desplegar(esquema)
    await filaTras(win, esquema, 'carpeta', 'lite-vistas', 'vistas')
    await filaTras(win, esquema, 'carpeta', 'lite-virtuales', 'tablas virtuales')
    const tablas = await filaTras(win, esquema, 'carpeta', 'lite-tablas', 'tablas')
    await desplegar(tablas)
    const clientes = await filaTras(win, tablas, 'objeto', 'lite-clientes', 'clientes')
    await clientes.dblclick()
    await expect(win.locator(PESTANAS).filter({ hasText: 'clientes' }).filter({ hasText: `[${ALIAS}]` })).toHaveClass(/\bactive\b/)
    await expect(celda(win, 0, 1)).toHaveText('Ana', { timeout: 30_000 })
    await expect(celda(win, 2, 1)).toHaveText('Eva')
    // La cabecera NO es una `.db-rejilla-fila` (es la fila 1 de aria; los datos empiezan
    // en la 2, como en `celda()`): las del cuerpo son exactamente las tres de la tabla.
    await expect(win.locator(`${PANE} .db-rejilla-cuerpo .db-rejilla-fila`), 'las tres filas de la tabla').toHaveCount(3)
  })

  // (3) Tx MANUAL: el UPDATE queda pendiente y se ve en la MISMA consola; Rollback lo
  // deshace. (Una conexión de SQLite es un archivo: lo que dice la consola es la verdad.)
  test('(3) Tx Manual: UPDATE pendiente y Rollback', async () => {
    const win = s!.win
    await win.locator(PESTANAS).filter({ hasText: 'consola' }).first().click()
    await esperarConsolaLista(win)
    const modo = win.locator(`${CONSOLA} .db-consola-tx-modo`)
    const barraTx = win.locator(`${CONSOLA} .db-consola-tx`)
    const rollback = win.locator(`${CONSOLA} button.db-consola-rollback`)
    await modo.click()
    await expect(modo).toHaveAttribute('aria-pressed', 'true')
    await expect(win.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Manual')
    await ejecutarTodoSeleccionado(win, "update clientes set nombre = 'Cambiada' where id = 1")
    await esperarFinEjecucion(win)
    await expect(barraTx).toHaveText('Tx pendiente (1)')
    await ejecutarTodoSeleccionado(win, 'select nombre from clientes where id = 1')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0)).toHaveText('Cambiada')
    await rollback.click()
    await expect(barraTx).toHaveCount(0)
    await ejecutarTodoSeleccionado(win, 'select nombre from clientes where id = 1')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0), 'tras Rollback, como estaba').toHaveText('Ana')
    // De vuelta a Auto para lo que sigue.
    await modo.click()
    await expect(win.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Auto')
  })

  // (4) DETENER: una consulta que no acaba (CTE recursiva sin fin). En SQLite, Detener
  // MATA el proceso de esa consola (no hay interrupción desde Node): se corta en segundos
  // y la siguiente sentencia corre en un proceso nuevo.
  test('(4) Detener mata la consulta y la consola sigue sirviendo', async () => {
    const win = s!.win
    const detener = win.locator(`${CONSOLA} .db-consola-detener`)
    await ejecutarTodoSeleccionado(win, 'with recursive c(x) as (select 1 union all select x + 1 from c) select count(*) from c')
    await expect(detener).toBeEnabled()
    await expect(win.locator(`${CONSOLA} .db-glifo-corriendo`)).toHaveCount(1)
    const t0 = Date.now()
    await detener.click()
    await expect(win.locator(`${CONSOLA} .db-glifo-cancelada`)).toHaveCount(1, { timeout: 5_000 })
    expect(Date.now() - t0, 'cortada en menos de 5 s').toBeLessThan(5_000)
    await expect(detener).toBeDisabled()
    await ejecutarTodoSeleccionado(win, 'select 42 as respuesta')
    await expect(win.locator(`${CONSOLA} .db-glifo-ok`).last()).toBeVisible({ timeout: 15_000 })
    await expect(celdaResultado(win, 0, 0)).toHaveText('42')
  })

  // (5) «MONTAR COMO BASE DE DATOS» desde el explorador de archivos, sobre una COPIA del
  // archivo (otra base: la misma daría la conexión que ya existe, `reutilizada`). Crea una
  // conexión visible, de solo lectura y verificada; el menú pasa a «Desmontar».
  test('(5) Montar como base de datos desde el explorador de archivos', async () => {
    const win = s!.win
    copyFileSync(join(proyecto, ARCHIVO), join(proyecto, COPIA))
    await botonVista(win, 'Archivos').click()
    await expect(filaArchivo(win, COPIA)).toBeVisible({ timeout: 30_000 })
    await filaArchivo(win, COPIA).click({ button: 'right' })
    await elegirDelMenu(win, 'Montar como base de datos')
    await expect(win.locator('.toast .toast-title', { hasText: `«${COPIA}» montada en el proyecto` })).toBeVisible({ timeout: 15_000 })
    const c = await conexionPorAlias(win, COPIA)
    expect(c, 'la conexión existe en Conexiones').not.toBeNull()
    expect(c?.readonly, 'de solo lectura por defecto').toBe(true)
    expect(c?.verificada, 'verificada (se puede montar)').toBe(true)
    // Ahora el menú ofrece desmontarla, y desmontar la deja en Conexiones.
    await filaArchivo(win, COPIA).click({ button: 'right' })
    await expect(win.locator('.ctx-menu .ctx-menu-item', { hasText: 'Desmontar la base de datos' })).toHaveCount(1)
    await expect(win.locator('.ctx-menu .ctx-menu-item', { hasText: 'Montar como base de datos' })).toHaveCount(0)
    await elegirDelMenu(win, 'Desmontar la base de datos')
    await filaArchivo(win, COPIA).click({ button: 'right' })
    await expect(win.locator('.ctx-menu .ctx-menu-item', { hasText: 'Montar como base de datos' })).toHaveCount(1)
    await win.keyboard.press('Escape')
    expect(await conexionPorAlias(win, COPIA), 'desmontar no la borra').not.toBeNull()
    // Un archivo que no es de base de datos no ofrece nada.
    await filaArchivo(win, 'LEEME.md').click({ button: 'right' })
    await expect(win.locator('.ctx-menu .ctx-menu-item', { hasText: 'Montar como base de datos' })).toHaveCount(0)
    await win.keyboard.press('Escape')
  })

  // (6) La montada nace con «Solo lectura para los agentes» (para `tdb`), y desde el
  // Esa casilla NO limita al usuario: la barra lo INFORMA («RO agentes», con su
  // título) y una escritura desde la consola entra (SQLite abierto en lectura-escritura).
  test('(6) la montada es de solo lectura para los agentes, no para el usuario', async () => {
    const win = s!.win
    await botonVista(win, 'Conexiones a bases de datos').click()
    const montada = fila(win, 'conexion', COPIA)
    await expect(montada).toHaveCount(1)
    await expect(montada.locator('.db-chip-ro'), 'la marca RO se conserva, como información').toHaveAttribute('title', /agentes/)
    await montada.click()
    await abrirConsolaNueva(win, `${MOD}+KeyN`)
    const marca = win.locator(`${CONSOLA} .db-consola-barra .db-consola-dato`, { hasText: 'RO agentes' })
    await expect(marca).toHaveAttribute('title', /tdb no escribe/)
    await expect(win.locator(`${CONSOLA} .db-consola-barra`), 'ya no dice «Solo lectura» a secas').not.toContainText(/Solo lectura(?! para)/)
    await ejecutarTodoSeleccionado(win, "delete from clientes where nombre = 'Eva'")
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-glifo-error`), 'la escritura NO se rechaza').toHaveCount(0)
    await ejecutarTodoSeleccionado(win, 'select count(*) from clientes')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0), 'el DELETE se aplicó').toHaveText('2')
  })

  // (7) «DESCONECTAR» DE LA CABECERA: vivo con una conexión CONECTADA seleccionada, la desconecta, y se apaga
  // con su porqué. La otra conexión (la montada, con su consola) sigue conectada.
  test('(7) «Desconectar» de la cabecera desconecta la conexión elegida', async () => {
    const win = s!.win
    const boton = win.locator('.db-arbol .sidebar-actions button[aria-label="Desconectar"]')
    await expect(win.locator('.db-arbol .sidebar-actions button[aria-label="Agente"]'), 'el botón viejo ya no está').toHaveCount(0)
    await fila(win, 'conexion', ALIAS).click()
    await expect(boton).toBeEnabled()
    await expect(boton).toHaveAttribute('title', `Desconectar ${ALIAS}`)
    await boton.click()
    await expect(boton, 'desconectada: se apaga').toBeDisabled({ timeout: 15_000 })
    // `has:` se busca DENTRO del envoltorio: el botón va relativo, no con la ruta de la página.
    await expect(win.locator('.db-arbol .sidebar-actions .btn-envoltura', { has: win.locator('button[aria-label="Desconectar"]') })).toHaveAttribute(
      'title',
      `${ALIAS} no está conectada`
    )
    // La mitad negativa: la otra conexión no se tocó.
    await fila(win, 'conexion', COPIA).click()
    await expect(boton, 'la montada sigue conectada').toBeEnabled()
  })
})
