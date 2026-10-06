// =============================================================================
// La lista de un <select> dentro de un modal (la «select personalizable» de `comun/selectDesplegable.css`)
// sobre la app empaquetada, en los tres modales distintos que la usan: Configuración (que lleva `container-type`),
// el diálogo de conexión de BD (con el logo del motor sobre el control) y «Buscar en archivos» (con un grupo por
// proyecto). En cada uno la lista sale entera y por encima del modal, y Esc la cierra a ella sola. Sin Docker ni red.
// Decisiones: docs/decisiones/renderer/select-con-lista-propia.md
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const PERFIL = 'personal'

/** Despliega el select con un clic y comprueba que la lista sale entera y por encima de todo (la capa superior). */
async function abrirYMirar(select: Locator): Promise<void> {
  await select.click()
  await expect.poll(() => select.evaluate((el) => el.matches(':open')), { message: 'el clic abre la lista' }).toBe(true)
  const encima = await select.evaluate((el) => {
    const opciones = Array.from(el.querySelectorAll('option'))
    const primera = opciones[0]
    const elegida = opciones.find((o) => o.selected) ?? primera
    // Solo la primera y la elegida: en una lista larga el resto puede estar bajo el scroll de la propia lista.
    return [primera, elegida].map((o) => {
      const r = o.getBoundingClientRect()
      const dentro = r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight
      return dentro && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === o
    })
  })
  expect(encima, 'la primera opción y la elegida, enteras y encima del modal').toEqual([true, true])
}

/** Esc cierra la lista y solo la lista: el modal sigue abierto. */
async function escCierraSoloLaLista(win: Page, select: Locator, modal: Locator): Promise<void> {
  await win.keyboard.press('Escape')
  await expect.poll(() => select.evaluate((el) => el.matches(':open')), { message: 'Esc cierra la lista' }).toBe(false)
  await expect(modal, 'y solo la lista: el modal sigue abierto').toBeVisible()
}

test.describe.serial('La lista de un select dentro de un modal', () => {
  let s: SesionTessera
  let agente: AgenteFalso

  test.beforeAll(async () => {
    agente = montarAgenteFalso()
    const proyecto = join(agente.raiz, 'alfa')
    mkdirSync(join(proyecto, 'src'), { recursive: true })
    writeFileSync(join(proyecto, 'alfa.txt'), 'alfa\n')
    s = await abrirTessera(agente.env, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: PERFIL,
            byProfile: { [PERFIL]: { openProjects: [{ projectHostPath: proyecto, name: 'alfa', estado: 'active' }], activePath: proyecto } },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`${PERFIL}|${proyecto}`] }
          })
        )
      }
    })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agente) await borrarTemporal(agente.raiz)
  })

  test('Configuración: el modal con `container-type` no recorta ni descoloca la lista', async () => {
    const win = s.win
    await win.keyboard.press(`${MOD}+,`)
    const modal = win.locator('.ajustes-modal')
    await expect(modal).toHaveCount(1)
    // Alguna categoría trae un selector: se recorren hasta dar con una.
    const categorias = win.locator('.ajustes-riel-item')
    for (let i = 0; i < (await categorias.count()); i++) {
      await categorias.nth(i).click()
      if ((await modal.locator('.ajustes-select:visible').count()) > 0) break
    }
    const select = modal.locator('.ajustes-select:visible').first()
    await expect(select, 'hay un selector de Configuración a la vista').toBeVisible()
    await abrirYMirar(select)
    await escCierraSoloLaLista(win, select, modal)
    await win.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  })

  test('diálogo de conexión de BD: el logo del motor sigue sobre el control y la lista sale por encima del formulario', async () => {
    const win = s.win
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    await win.locator('.db-arbol .sidebar-actions button[aria-label="Nueva conexión"]').click()
    const modal = win.locator('.db-conexion-modal')
    await expect(modal).toBeVisible()
    const motor = modal.locator('.dbc-motor-control select')
    // El control es un contexto de apilado y, al ir después en el DOM, taparía al logo si este no llevara `z-index`.
    const logo = await modal.locator('.dbc-motor-logo').evaluate((el) => getComputedStyle(el).zIndex)
    expect(logo, 'el logo tiene su propio z-index').not.toBe('auto')
    await abrirYMirar(motor)
    await escCierraSoloLaLista(win, motor, modal)
    await win.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  })

  test('«Buscar en archivos»: la lista con un grupo por proyecto sale entera y Esc la cierra sola', async () => {
    const win = s.win
    await win.keyboard.press(`${MOD}+Shift+F`)
    const modal = win.locator('.buscar-modal')
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: /carpeta/i }).first().click()
    const select = modal.locator('.buscar-ambito-select')
    await expect(select, 'carga las carpetas de los proyectos abiertos').toBeEnabled({ timeout: 20_000 })
    expect(await select.locator('optgroup').count(), 'un grupo por proyecto').toBeGreaterThan(0)
    await abrirYMirar(select)
    await escCierraSoloLaLista(win, select, modal)
    // La lista es del DOM y sus teclas burbujean hasta la tarjeta, que usa ↑/↓/Intro para los
    // resultados: con la lista abierta tienen que ser de la lista (elegir otra carpeta), no de la tarjeta.
    const antes = await select.inputValue()
    await select.click()
    await expect.poll(() => select.evaluate((el) => el.matches(':open'))).toBe(true)
    await win.keyboard.press('ArrowDown')
    await win.keyboard.press('Enter')
    await expect.poll(() => select.evaluate((el) => el.matches(':open')), { message: 'Intro cierra la lista' }).toBe(false)
    expect(await select.inputValue(), '↓ + Intro eligen otra carpeta').not.toBe(antes)
    await expect(modal, 'y el modal sigue abierto').toBeVisible()
    await win.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  })
})
