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
function botonVista(ventana: Page, titulo: 'Archivos' | 'Bases de datos'): ReturnType<Page['locator']> {
  return ventana.locator(`.activity-item[title="${titulo}"]`)
}

/** Una fila del explorador de ARCHIVOS por su nombre. */
function filaArchivo(ventana: Page, nombre: string): ReturnType<Page['locator']> {
  return ventana.locator('.sidebar .tree-row:visible', { hasText: nombre }).first()
}

/** Carga el texto en la consola y pulsa «Ejecutar todo». */
async function ejecutarTodo(ventana: Page, sql: string): Promise<void> {
  await monacoConsola(ventana, { op: 'fijar', texto: sql })
  await ventana.locator(`${CONSOLA} .db-consola-run-todo`).click()
}

/** La conexión del perfil por su alias, leída del main (el renderer no ve la ruta). */
async function conexionPorAlias(ventana: Page, alias: string): Promise<{ id: string; readonly: boolean; verificada: boolean; archivoVisible?: string } | null> {
  return ventana.evaluate(
    async (a) => {
      const c = (await window.tessera.db.listar(a.perfil)).find((x) => x.alias === a.alias)
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
    await expect(s.ventana.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  // (0) ALTA con «Crear nueva…»: el diálogo de guardar del main contesta una ruta del
  // proyecto; el formulario queda sin usuario ni contraseña, con el nombre del archivo y
  // de ESCRITURA (la base la creó Tessera).
  test('(0) alta de una SQLite nueva por el diálogo', async () => {
    const ventana = s!.ventana
    await aLaVista(ventana)
    const ruta = join(proyecto, ARCHIVO)
    await s!.app.evaluate(({ dialog }, r) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: r })) as typeof dialog.showSaveDialog
    }, ruta)
    await botonVista(ventana, 'Bases de datos').click()
    await expect(ventana.locator('.db-area:not(.hidden)')).toBeVisible()
    await ventana.locator('.db-arbol .sidebar-actions button[aria-label="Nueva conexión"]').click()
    const modal = ventana.locator('.db-conexion-modal')
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
    await expect(modal.getByRole('switch', { name: /^Solo lectura para los agentes/ }), 'creada: con «Solo lectura para los agentes»').toHaveAttribute('aria-checked', 'true')
    await modal.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(modal).toHaveCount(0)
    const conexion = fila(ventana, 'conexion', ALIAS)
    await expect(conexion).toHaveCount(1)
    await expect(conexion.locator('.db-motor-icono svg.db-motor-sqlite')).toHaveCount(1)
    const c = await conexionPorAlias(ventana, ALIAS)
    expect(c?.archivoVisible, 'el renderer ve el NOMBRE, no la ruta').toBe(ARCHIVO)
    expect(c?.readonly, 'con la casilla de los agentes (la recomendada)').toBe(true)
  })

  // (1) Una consola sobre ella siembra una tabla, una vista y una tabla virtual (en Tx
  // Auto, que es la de una conexión de escritura sin entorno).
  test('(1) consola: sembrar tabla, vista y tabla virtual', async () => {
    const ventana = s!.ventana
    await fila(ventana, 'conexion', ALIAS).click()
    await ventana.keyboard.press(`${MOD}+KeyN`)
    await expect(ventana.locator(PESTANAS)).toHaveCount(1)
    await esperarConsolaLista(ventana)
    await expect(ventana.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Auto')
    await ejecutarTodo(ventana, SIEMBRA)
    await esperarFinEjecucion(ventana)
    await expect(ventana.locator(`${CONSOLA} .db-glifo-error`), 'la siembra no falla').toHaveCount(0)
    await ejecutarTodoSeleccionado(ventana, 'select count(*) as n from clientes')
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0)).toHaveText('3', { timeout: 15_000 })
    // El texto empieza junto a los números de línea, sin la columna de plegado delante.
    const hueco = await ventana.locator(`${CONSOLA} .monaco-editor`).first().evaluate((editor) => {
      const numeros = editor.querySelector('.margin-view-overlays .line-numbers')?.getBoundingClientRect()
      const texto = editor.querySelector('.view-lines')?.getBoundingClientRect()
      return numeros && texto ? texto.left - numeros.right : -1
    })
    expect(hueco, 'el hueco entre los números y el texto').toBeGreaterThanOrEqual(0)
    expect(hueco, 'el hueco entre los números y el texto').toBeLessThan(12)
  })

  // (2) EL ÁRBOL: `main` con sus tres carpetas (las vacías no se pintan: por eso se sembró
  // una de cada), y la tabla abre en una pestaña con sus filas (paginado keyset).
  test('(2) árbol con sus carpetas y abrir una tabla', async () => {
    const ventana = s!.ventana
    const conexion = fila(ventana, 'conexion', ALIAS)
    await conexion.click()
    await ventana.locator('.db-arbol .sidebar-actions button[aria-label="Refrescar"]').click()
    await desplegar(conexion)
    const esquema = await filaTras(ventana, conexion, 'esquema', 'lite-esq', 'main')
    await desplegar(esquema)
    await filaTras(ventana, esquema, 'carpeta', 'lite-vistas', 'vistas')
    await filaTras(ventana, esquema, 'carpeta', 'lite-virtuales', 'tablas virtuales')
    const tablas = await filaTras(ventana, esquema, 'carpeta', 'lite-tablas', 'tablas')
    await desplegar(tablas)
    const clientes = await filaTras(ventana, tablas, 'objeto', 'lite-clientes', 'clientes')
    await clientes.dblclick()
    await expect(ventana.locator(PESTANAS).filter({ hasText: 'clientes' }).filter({ hasText: `[${ALIAS}]` })).toHaveClass(/\bactive\b/)
    await expect(celda(ventana, 0, 1)).toHaveText('Ana', { timeout: 30_000 })
    await expect(celda(ventana, 2, 1)).toHaveText('Eva')
    // La cabecera NO es una `.db-rejilla-fila` (es la fila 1 de aria; los datos empiezan
    // en la 2, como en `celda()`): las del cuerpo son exactamente las tres de la tabla.
    await expect(ventana.locator(`${PANE} .db-rejilla-cuerpo .db-rejilla-fila`), 'las tres filas de la tabla').toHaveCount(3)
  })

  // (3) Tx MANUAL: el UPDATE queda pendiente y se ve en la MISMA consola; Rollback lo
  // deshace. (Una conexión de SQLite es un archivo: lo que dice la consola es la verdad.)
  test('(3) Tx Manual: UPDATE pendiente y Rollback', async () => {
    const ventana = s!.ventana
    await ventana.locator(PESTANAS).filter({ hasText: 'consola' }).first().click()
    await esperarConsolaLista(ventana)
    const modo = ventana.locator(`${CONSOLA} .db-consola-tx-modo`)
    const barraTx = ventana.locator(`${CONSOLA} .db-consola-tx`)
    const rollback = ventana.locator(`${CONSOLA} button.db-consola-rollback`)
    await modo.click()
    await expect(modo).toHaveAttribute('aria-pressed', 'true')
    await expect(ventana.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Manual')
    await ejecutarTodoSeleccionado(ventana, "update clientes set nombre = 'Cambiada' where id = 1")
    await esperarFinEjecucion(ventana)
    await expect(barraTx).toHaveText('Tx pendiente (1)')
    await ejecutarTodoSeleccionado(ventana, 'select nombre from clientes where id = 1')
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0)).toHaveText('Cambiada')
    await rollback.click()
    await expect(barraTx).toHaveCount(0)
    await ejecutarTodoSeleccionado(ventana, 'select nombre from clientes where id = 1')
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0), 'tras Rollback, como estaba').toHaveText('Ana')
    // De vuelta a Auto para lo que sigue.
    await modo.click()
    await expect(ventana.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Auto')
  })

  // (4) DETENER: una consulta que no acaba (CTE recursiva sin fin). En SQLite, Detener
  // MATA el proceso de esa consola (no hay interrupción desde Node): se corta en segundos
  // y la siguiente sentencia corre en un proceso nuevo.
  test('(4) Detener mata la consulta y la consola sigue sirviendo', async () => {
    const ventana = s!.ventana
    const detener = ventana.locator(`${CONSOLA} .db-consola-detener`)
    await ejecutarTodoSeleccionado(ventana, 'with recursive c(x) as (select 1 union all select x + 1 from c) select count(*) from c')
    await expect(detener).toBeEnabled()
    await expect(ventana.locator(`${CONSOLA} .db-glifo-corriendo`)).toHaveCount(1)
    const t0 = Date.now()
    await detener.click()
    await expect(ventana.locator(`${CONSOLA} .db-glifo-cancelada`)).toHaveCount(1, { timeout: 5_000 })
    expect(Date.now() - t0, 'cortada en menos de 5 s').toBeLessThan(5_000)
    await expect(detener).toBeDisabled()
    await ejecutarTodoSeleccionado(ventana, 'select 42 as respuesta')
    await expect(ventana.locator(`${CONSOLA} .db-glifo-ok`).last()).toBeVisible({ timeout: 15_000 })
    await expect(celdaResultado(ventana, 0, 0)).toHaveText('42')
  })

  // (5) «MONTAR COMO BASE DE DATOS» desde el explorador de archivos, sobre una COPIA del
  // archivo (otra base: la misma daría la conexión que ya existe, `reutilizada`). Crea una
  // conexión visible, de solo lectura y verificada; el menú pasa a «Desmontar».
  test('(5) Montar como base de datos desde el explorador de archivos', async () => {
    const ventana = s!.ventana
    copyFileSync(join(proyecto, ARCHIVO), join(proyecto, COPIA))
    await botonVista(ventana, 'Archivos').click()
    await expect(filaArchivo(ventana, COPIA)).toBeVisible({ timeout: 30_000 })
    await filaArchivo(ventana, COPIA).click({ button: 'right' })
    await elegirDelMenu(ventana, 'Montar como base de datos')
    await expect(ventana.locator('.toast .toast-title', { hasText: `"${COPIA}" montada en el proyecto` })).toBeVisible({ timeout: 15_000 })
    const c = await conexionPorAlias(ventana, COPIA)
    expect(c, 'la conexión existe en Conexiones').not.toBeNull()
    expect(c?.readonly, 'de solo lectura por defecto').toBe(true)
    expect(c?.verificada, 'verificada (se puede montar)').toBe(true)
    // Ahora el menú ofrece desmontarla, y desmontar la deja en Conexiones.
    await filaArchivo(ventana, COPIA).click({ button: 'right' })
    await expect(ventana.locator('.ctx-menu .ctx-menu-item', { hasText: 'Desmontar la base de datos' })).toHaveCount(1)
    await expect(ventana.locator('.ctx-menu .ctx-menu-item', { hasText: 'Montar como base de datos' })).toHaveCount(0)
    await elegirDelMenu(ventana, 'Desmontar la base de datos')
    await filaArchivo(ventana, COPIA).click({ button: 'right' })
    await expect(ventana.locator('.ctx-menu .ctx-menu-item', { hasText: 'Montar como base de datos' })).toHaveCount(1)
    await ventana.keyboard.press('Escape')
    expect(await conexionPorAlias(ventana, COPIA), 'desmontar no la borra').not.toBeNull()
    // Un archivo que no es de base de datos no ofrece nada.
    await filaArchivo(ventana, 'LEEME.md').click({ button: 'right' })
    await expect(ventana.locator('.ctx-menu .ctx-menu-item', { hasText: 'Montar como base de datos' })).toHaveCount(0)
    await ventana.keyboard.press('Escape')
  })

  // (6) La montada nace con «Solo lectura para los agentes» (para `tdb`), y desde el
  // Esa casilla NO limita al usuario: la barra lo INFORMA («Solo lectura (agentes)», con su
  // título) y una escritura desde la consola entra (SQLite abierto en lectura-escritura).
  test('(6) la montada es de solo lectura para los agentes, no para el usuario', async () => {
    const ventana = s!.ventana
    await botonVista(ventana, 'Bases de datos').click()
    const montada = fila(ventana, 'conexion', COPIA)
    await expect(montada).toHaveCount(1)
    await expect(montada.locator('.db-chip-ro'), 'la marca RO se conserva, como información').toHaveAttribute('title', /agentes/)
    await montada.click()
    await abrirConsolaNueva(ventana, `${MOD}+KeyN`)
    const marca = ventana.locator(`${CONSOLA} .db-consola-barra .db-consola-dato`, { hasText: 'Solo lectura (agentes)' })
    await expect(marca).toHaveAttribute('title', /tdb no escribe/)
    await expect(ventana.locator(`${CONSOLA} .db-consola-barra`), 'ya no dice «Solo lectura» a secas').not.toContainText(/Solo lectura(?! \(agentes\))/)
    await ejecutarTodoSeleccionado(ventana, "delete from clientes where nombre = 'Eva'")
    await esperarFinEjecucion(ventana)
    await expect(ventana.locator(`${CONSOLA} .db-glifo-error`), 'la escritura NO se rechaza').toHaveCount(0)
    await ejecutarTodoSeleccionado(ventana, 'select count(*) from clientes')
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0), 'el DELETE se aplicó').toHaveText('2')
  })

  // (7) «DESCONECTAR» DE LA CABECERA: vivo con una conexión CONECTADA seleccionada, la desconecta, y se apaga
  // con su porqué. La otra conexión (la montada, con su consola) sigue conectada.
  test('(7) «Desconectar» de la cabecera desconecta la conexión elegida', async () => {
    const ventana = s!.ventana
    const boton = ventana.locator('.db-arbol .sidebar-actions button[aria-label="Desconectar"]')
    await expect(ventana.locator('.db-arbol .sidebar-actions button[aria-label="Agente"]'), 'el botón viejo ya no está').toHaveCount(0)
    await fila(ventana, 'conexion', ALIAS).click()
    await expect(boton).toBeEnabled()
    await expect(boton).toHaveAttribute('title', `Desconectar ${ALIAS}`)
    await boton.click()
    await expect(boton, 'desconectada: se apaga').toBeDisabled({ timeout: 15_000 })
    // Con el ratón encima, el tooltip de la app guarda el `title` aparte mientras lo enseña: se aparta.
    await ventana.mouse.move(0, 400)
    // `has:` se busca DENTRO del envoltorio: el botón va relativo, no con la ruta de la página.
    await expect(ventana.locator('.db-arbol .sidebar-actions .btn-envoltura', { has: ventana.locator('button[aria-label="Desconectar"]') })).toHaveAttribute(
      'title',
      `${ALIAS} no está conectada`
    )
    // La mitad negativa: la otra conexión no se tocó.
    await fila(ventana, 'conexion', COPIA).click()
    await expect(boton, 'la montada sigue conectada').toBeEnabled()
  })
})
