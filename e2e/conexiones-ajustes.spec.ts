// =============================================================================
// Los ajustes del explorador de BD en Configuración, sobre la app empaquetada y con una
// SQLite en la carpeta del proyecto (sin Docker; igual en Windows y Mac). Lo que el modal
// elige llega a quien lo usa: «filas por página» en 100 hace que una tabla de 250 abra con
// «100+ filas»; «Tx al abrir» en Manual hace que la SESIÓN del main nazca en Manual (un
// UPDATE deja «Tx pendiente (1)»); y los dos valores quedan guardados (`loadSettings`).
// Las decisiones las fijan `test-ajustes-bd.mts` y `test-gestor-sesiones.mts` (32).
// En serie y compartiendo app; acordes por `MOD`.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import {
  CONSOLA,
  PESTANAS,
  aLaVista,
  crearProyecto,
  desplegar,
  ejecutarTodoSeleccionado,
  esperarFinEjecucion,
  fila,
  filaTras,
  abrirConsolaNueva
} from './consolaAyudas'
import { esperarConsolaLista } from './monaco'
import { textoPildora } from './rejillaAyudas'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const PERFIL = 'personal'
const ALIAS = 'ajustes'
const ARCHIVO = 'ajustes.db'
const FILAS = 250

const SIEMBRA = [
  'create table numeros(n integer primary key)',
  `insert into numeros(n) with recursive c(x) as (select 1 union all select x + 1 from c where x < ${FILAS}) select x from c`
].join(';\n')

test.describe.configure({ mode: 'serial' })

/** Abre Configuración en la categoría «Bases de datos». */
async function abrirAjustesBd(win: Page): Promise<void> {
  await win.keyboard.press(`${MOD}+,`)
  await expect(win.locator('.ajustes-modal')).toHaveCount(1)
  await win.locator('.ajustes-riel-item[data-cat="bases-de-datos"]').click()
  await expect(win.locator('.ajustes-modal-panel')).toContainText('Filas por página')
}

async function cerrarAjustes(win: Page): Promise<void> {
  await win.keyboard.press('Escape')
  await expect(win.locator('.ajustes-modal')).toHaveCount(0)
}

test.describe('explorador de BD: ajustes de Configuración', () => {
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
                openProjects: [{ projectHostPath: proyecto, name: 'proyecto-ajustes', estado: 'active' }],
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

  // (0) Una SQLite nueva con 250 filas, sembradas desde una consola que nace en Auto: con
  // los ajustes de fábrica nada cambia respecto a lo de siempre.
  test('(0) alta de la base y siembra con los valores de siempre', async () => {
    const win = s!.win
    await aLaVista(win)
    const ruta = join(proyecto, ARCHIVO)
    await s!.app.evaluate(({ dialog }, r) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: r })) as typeof dialog.showSaveDialog
    }, ruta)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    await win.locator('.db-arbol .sidebar-actions button[aria-label="Nueva conexión"]').click()
    const modal = win.locator('.db-conexion-modal')
    await expect(modal).toBeVisible()
    await modal.locator('.dbc-motor select').selectOption('sqlite')
    await modal.getByRole('button', { name: 'Crear nueva…' }).click()
    await expect(modal.locator('[data-campo="alias"]')).toHaveValue(ALIAS)
    await modal.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(modal).toHaveCount(0)
    await fila(win, 'conexion', ALIAS).click()
    await abrirConsolaNueva(win, `${MOD}+KeyN`)
    await expect(win.locator(`${CONSOLA} .db-consola-barra`), 'de fábrica, la consola nace en Auto').toContainText('Tx: Auto')
    await ejecutarTodoSeleccionado(win, SIEMBRA.split(';\n')[0])
    await esperarFinEjecucion(win)
    await ejecutarTodoSeleccionado(win, SIEMBRA.split(';\n')[1])
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-glifo-error`), 'la siembra no falla').toHaveCount(0)
    await expect(win.locator(`${CONSOLA} .db-consola-tx`), 'en Auto no queda nada pendiente').toHaveCount(0)
  })

  // (1) En Configuración › «Bases de datos»: 100 filas por página y Tx Manual. Los dos
  // quedan guardados en el main.
  test('(1) cambiar filas por página y la Tx al abrir', async () => {
    const win = s!.win
    await abrirAjustesBd(win)
    const panel = win.locator('.ajustes-modal-panel')
    await panel.locator('select[aria-label="Filas por página"]').selectOption('100')
    await panel.locator('.ajustes-radio', { hasText: 'Manual' }).click()
    await expect(panel.locator('.ajustes-radio.checked', { hasText: 'Manual' })).toHaveCount(1)
    await cerrarAjustes(win)
    await expect
      .poll(async () => {
        const a = await win.evaluate(() => window.tessera.workspace.loadSettings())
        return `${a.dbFilasPorPagina}|${a.dbTxInicial}`
      }, { message: 'los dos ajustes quedan guardados' })
      .toBe('100|manual')
  })

  // (2) Una tabla abre con la página nueva: «100+ filas» y no «250 filas».
  test('(2) la tabla abre con 100 filas por página', async () => {
    const win = s!.win
    const conexion = fila(win, 'conexion', ALIAS)
    await conexion.click()
    await win.locator('.db-arbol .sidebar-actions button[aria-label="Refrescar"]').click()
    await desplegar(conexion)
    const esquema = await filaTras(win, conexion, 'esquema', 'lite-esq', 'main')
    await desplegar(esquema)
    const tablas = await filaTras(win, esquema, 'carpeta', 'lite-tablas', 'tablas')
    await desplegar(tablas)
    const numeros = await filaTras(win, tablas, 'objeto', 'lite-numeros', 'numeros')
    await numeros.dblclick()
    await expect(win.locator(PESTANAS).filter({ hasText: 'numeros' })).toHaveClass(/\bactive\b/)
    // Múltiplos de 100 y no de 250: la rejilla pide sola la página siguiente cuando queda a
    // menos de dos pantallas del final, así que «100+» dura un instante y lo estable es «200+».
    await expect(textoPildora(win), 'las páginas son de 100').toHaveText(/^[12]00\+ filas$/, { timeout: 30_000 })
  })

  // (3) Una consola NUEVA nace en Manual: la barra lo dice y la sesión lo es (el UPDATE
  // queda pendiente). Se revierte para no dejar nada.
  test('(3) una consola nueva nace en Manual', async () => {
    const win = s!.win
    await fila(win, 'conexion', ALIAS).click()
    await abrirConsolaNueva(win, `${MOD}+KeyN`)
    await esperarConsolaLista(win)
    await expect(win.locator(`${CONSOLA} .db-consola-barra`), 'la barra, antes de tener sesión').toContainText('Tx: Manual')
    await ejecutarTodoSeleccionado(win, 'update numeros set n = n where n = 1')
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-consola-tx`), 'la sesión nació en Manual').toHaveText('Tx pendiente (1)')
    await win.locator(`${CONSOLA} button.db-consola-rollback`).click()
    await expect(win.locator(`${CONSOLA} .db-consola-tx`)).toHaveCount(0)
    await expect(win.locator(`${CONSOLA} .db-consola-barra`), 'y sigue en Manual').toContainText('Tx: Manual')
  })
})
