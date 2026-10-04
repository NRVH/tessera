// =============================================================================
// MongoDB en la interfaz, sobre la app empaquetada y contra el `pruebas-mongo` compartido
// (sembrado por `scripts/pruebas/mongo-siembra.js`): el alta por el formulario con el
// usuario `lector`, el árbol con las colecciones bajo la conexión, la pestaña de colección
// (tabla, panel JSON, filtro de texto y barra GUIADA con sus condiciones), el orden por la
// cabecera contra el servidor y la casilla de solo lectura (limita a `tdb`, no al usuario).
// El destino sale de `TESSERA_TEST_MONGO_LECTOR` (`bash scripts/pruebas/mongo.sh correr
// …`); sin la variable se salta. No levanta ni para el contenedor. En serie, comparte app.
// =============================================================================

import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { PESTANAS, aLaVista, crearProyecto, desplegar, fila } from './consolaAyudas'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const PERFIL = 'personal'
const ALIAS = 'MONGO-E2E'

interface DestinoMongo {
  host: string
  port: number
  user: string
  password: string
  database: string
}

/** El destino de la URI de pruebas, o el motivo por el que no hay. Nunca imprime la clave. */
function destino(): { ok: true; d: DestinoMongo } | { ok: false; motivo: string } {
  const uri = process.env.TESSERA_TEST_MONGO_LECTOR
  if (!uri) return { ok: false, motivo: 'sin TESSERA_TEST_MONGO_LECTOR (bash scripts/pruebas/mongo.sh correr …)' }
  try {
    const u = new URL(uri)
    return {
      ok: true,
      d: {
        host: u.hostname,
        port: Number(u.port || '27017'),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, '') || 'pruebas'
      }
    }
  } catch {
    return { ok: false, motivo: 'TESSERA_TEST_MONGO_LECTOR no es una URI válida' }
  }
}

const PANE = '.db-area:not(.hidden) .db-pane:not(.hidden) .db-coleccion'

test.describe('explorador de BD: MongoDB', () => {
  let s: SesionTessera | null = null
  let falso: AgenteFalso | null = null
  let motivoSalto: string | null = null
  let d: DestinoMongo | null = null

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const r = destino()
    if (!r.ok) {
      motivoSalto = r.motivo
      return
    }
    d = r.d
    const agente = montarAgenteFalso()
    falso = agente
    const proyecto = crearProyecto(agente.raiz)
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
                openProjects: [{ projectHostPath: proyecto, name: 'proyecto-mongo', estado: 'active' }],
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

  test.beforeEach(() => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  test('(0) alta de una conexión MongoDB por el formulario', async () => {
    const win = s!.win
    const m = d!
    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    await win.locator('.db-arbol button[aria-label="Nueva conexión"]').first().click()
    const dlg = win.locator('.db-conexion-modal')
    await expect(dlg).toBeVisible()
    await dlg.locator('.dbc-motor-control select').selectOption('mongodb')
    await expect(dlg.locator('[data-campo="port"]'), 'el puerto de MongoDB').toHaveValue('27017')
    await dlg.locator('[data-campo="alias"]').fill(ALIAS)
    await dlg.locator('[data-campo="host"]').fill(m.host)
    await dlg.locator('[data-campo="port"]').fill(String(m.port))
    await dlg.locator('[data-campo="user"]').fill(m.user)
    await dlg.locator('.dbc-pass input').fill(m.password)
    await dlg.locator('[data-campo="database"]').fill(m.database)
    // `lector` tiene rol `read`: la casilla de los agentes se deja marcada (lo recomendado).
    await expect(dlg.getByLabel('Solo lectura para los agentes (recomendado)')).toBeChecked()
    await dlg.getByRole('button', { name: 'Guardar y probar' }).click()
    await expect(dlg.locator('.dbc-prueba')).toHaveClass(/\bok\b/, { timeout: 60_000 })
    await dlg.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    await expect(fila(win, 'conexion', ALIAS)).toHaveCount(1)
  })

  test('(1) doble clic en una colección abre su pestaña con los documentos', async () => {
    const win = s!.win
    await desplegar(fila(win, 'conexion', ALIAS))
    const col = fila(win, 'coleccion', 'clientes')
    await expect(col, 'base fija: las colecciones cuelgan de la conexión').toHaveCount(1, { timeout: 60_000 })
    await col.dblclick()
    await expect(win.locator(PESTANAS).filter({ hasText: 'clientes' })).toHaveCount(1)
    const pane = win.locator(PANE)
    await expect(pane).toBeVisible()
    // La siembra: 4 clientes (tres con ObjectId y uno con `_id` de texto).
    await expect(pane.locator('.db-docs-fila')).toHaveCount(4, { timeout: 60_000 })
    await expect(pane.locator('.db-docs-th').filter({ hasText: /^_id$/ })).toHaveCount(1)
    await expect(pane.locator('.db-docs-th').filter({ hasText: /^nombre$/ })).toHaveCount(1)
    // El tipo va por CELDA: el `_id` de texto es una cadena y los demás no.
    await expect(pane.locator('.db-docs-celda[data-campo="_id"].tipo-string')).toHaveCount(1)
  })

  // (G1) la barra guiada es la de por defecto. La siembra: Ana (34), Luis (51),
  // Marta (sin edad) y «Sin ObjectId» (sin edad).
  test('(G1) filtro guiado por defecto: contiene sin mayúsculas, entre, y el valor inválido en su fila', async () => {
    const win = s!.win
    const pane = win.locator(PANE)
    await expect(pane.locator('.db-docs-filtro'), 'la barra JSON no se ve por defecto').toHaveCount(0)
    await expect(pane.getByRole('button', { name: 'JSON', exact: true })).toHaveCount(1)
    // nombre contiene «LU» → Luis (sin distinguir mayúsculas).
    await pane.getByRole('button', { name: '+ Condición', exact: true }).click()
    await pane.getByLabel('Columna').first().selectOption('nombre')
    await pane.getByLabel('Operador').first().selectOption({ label: 'contiene' })
    const valor1 = pane.getByLabel('Valor').first()
    await valor1.fill('LU')
    await valor1.press('Enter')
    await expect(pane.locator('.db-docs-fila')).toHaveCount(1, { timeout: 30_000 })
    await expect(pane.locator('.db-docs-fila').first()).toContainText('Luis')
    // nombre contiene «a» Y edad entre 30 y 40 → solo Ana (Marta no tiene edad).
    await valor1.fill('a')
    await pane.getByRole('button', { name: '+ Condición', exact: true }).click()
    await pane.getByLabel('Columna').nth(1).selectOption('edad')
    await pane.getByLabel('Operador').nth(1).selectOption({ label: 'entre' })
    // Los valores de la fila 2 son el 2.º y el 3.º cuadro de texto de la barra.
    const valores = pane.getByRole('textbox')
    await valores.nth(1).fill('30')
    await valores.nth(2).fill('40')
    await valores.nth(2).press('Enter')
    await expect(pane.locator('.db-docs-fila')).toHaveCount(1, { timeout: 30_000 })
    await expect(pane.locator('.db-docs-fila').first()).toContainText('Ana')
    // Un valor que no es un número: se señala sin pedir nada y la tabla sigue como estaba.
    await valores.nth(2).fill('cuarenta')
    await valores.nth(2).press('Enter')
    await expect(pane.getByRole('alert')).toContainText('No es un número')
    await expect(pane.locator('.db-docs-fila')).toHaveCount(1)
    // Esc restaura lo aplicado; quitando las dos condiciones y aplicando, todos otra vez.
    await valores.nth(2).press('Escape')
    await expect(valores.nth(2)).toHaveValue('40')
    await pane.getByRole('button', { name: /quitar la condición/i }).nth(1).click()
    await pane.getByRole('button', { name: /quitar la condición/i }).first().click()
    await pane.getByRole('button', { name: 'Aplicar', exact: true }).click()
    await expect(pane.locator('.db-docs-fila')).toHaveCount(4, { timeout: 30_000 })
  })

  // (G2) el orden es del SERVIDOR y lo da la cabecera. MongoDB pone los que no tienen
  // el campo delante en ascendente.
  test('(G2) orden por la cabecera: asc → desc, Mayús+clic añade con prioridad, clic solo la deja sola', async () => {
    const win = s!.win
    const pane = win.locator(PANE)
    const thEdad = pane.locator('.db-docs-th[data-campo="edad"]')
    const thNombre = pane.locator('.db-docs-th[data-campo="nombre"]')
    const filas = pane.locator('.db-docs-fila')
    await thEdad.click()
    await expect(thEdad).toHaveAttribute('aria-sort', 'ascending', { timeout: 30_000 })
    await expect(filas.nth(3)).toContainText('Luis')
    await thEdad.click()
    await expect(thEdad).toHaveAttribute('aria-sort', 'descending', { timeout: 30_000 })
    await expect(filas.first()).toContainText('Luis')
    await expect(filas.nth(1)).toContainText('Ana')
    // Mayús+clic: nombre como SEGUNDA clave; los dos sin edad, por nombre (Marta < Sin ObjectId).
    await thNombre.click({ modifiers: ['Shift'] })
    await expect(thNombre).toHaveAttribute('aria-sort', 'ascending', { timeout: 30_000 })
    await expect(thEdad.locator('.db-docs-orden-prioridad')).toHaveText('1')
    await expect(thNombre.locator('.db-docs-orden-prioridad')).toHaveText('2')
    await expect(filas.first()).toContainText('Luis')
    await expect(filas.nth(2)).toContainText('Marta')
    await expect(filas.nth(3)).toContainText('Sin ObjectId')
    // Clic SIN Mayús en nombre: queda sola (y sigue su ciclo: asc → desc).
    await thNombre.click()
    await expect(thNombre).toHaveAttribute('aria-sort', 'descending', { timeout: 30_000 })
    await expect(thEdad).not.toHaveAttribute('aria-sort', /.+/)
    await expect(pane.locator('.db-docs-orden-prioridad')).toHaveCount(0)
    await expect(filas.first()).toContainText('Sin ObjectId')
    // Tercer clic: sin orden.
    await thNombre.click()
    await expect(thNombre).not.toHaveAttribute('aria-sort', /.+/, { timeout: 30_000 })
  })

  // (G3) el modo JSON. El orden de texto y el de la cabecera son excluyentes.
  test('(G3) «JSON» pasa a la barra de texto; ordenar por la cabecera vacía el orden de texto', async () => {
    const win = s!.win
    const pane = win.locator(PANE)
    await pane.getByRole('button', { name: 'JSON', exact: true }).click()
    await expect(pane.locator('.db-docs-filtro')).toBeVisible()
    const orden = pane.locator('.db-docs-filtro input').nth(2)
    await orden.fill('{ nombre: -1 }')
    await orden.press('Enter')
    await expect(pane.locator('.db-docs-fila').first()).toContainText('Sin ObjectId', { timeout: 30_000 })
    const thEdad = pane.locator('.db-docs-th[data-campo="edad"]')
    await thEdad.click()
    await expect(thEdad).toHaveAttribute('aria-sort', 'ascending', { timeout: 30_000 })
    await expect(orden, 'el orden de texto se vacía').toHaveValue('')
    await expect(pane.locator('.db-docs-fila').nth(3)).toContainText('Luis')
    // Dos clics más: desc y sin orden, para dejar la tabla como la espera la prueba (2).
    await thEdad.click()
    await expect(thEdad).toHaveAttribute('aria-sort', 'descending', { timeout: 30_000 })
    await thEdad.click()
    await expect(thEdad).not.toHaveAttribute('aria-sort', /.+/, { timeout: 30_000 })
    // «Guiado» vuelve a la barra guiada y «JSON» otra vez a esta, que conserva lo escrito.
    await pane.getByRole('button', { name: 'Guiado', exact: true }).click()
    await expect(pane.locator('.db-docs-filtro')).toHaveCount(0)
    await pane.getByRole('button', { name: 'JSON', exact: true }).click()
    await expect(pane.locator('.db-docs-filtro')).toBeVisible()
  })

  test('(2) el filtro de la barra JSON, y su error en su campo', async () => {
    const win = s!.win
    const pane = win.locator(PANE)
    // La barra de texto es el modo JSON; (G3) la deja abierta.
    await expect(pane.locator('.db-docs-filtro'), 'la barra JSON').toBeVisible()
    const filtro = pane.locator('.db-docs-filtro input').first()
    await filtro.fill('{ edad: { $gt: 40 } }')
    await filtro.press('Enter')
    await expect(pane.locator('.db-docs-fila')).toHaveCount(1, { timeout: 30_000 })
    await expect(pane.locator('.db-docs-fila').first()).toContainText('Luis')
    // Sintaxis rota: se marca ESE campo y la tabla anterior sigue.
    await filtro.fill('{ edad: { $gt: }')
    await filtro.press('Enter')
    await expect(filtro).toHaveAttribute('aria-invalid', 'true', { timeout: 30_000 })
    await expect(pane.locator('.db-filtro-error.campo-filtro')).toBeVisible()
    // Vacío = todos otra vez.
    await filtro.fill('')
    await filtro.press('Enter')
    await expect(pane.locator('.db-docs-fila')).toHaveCount(4, { timeout: 30_000 })
    await expect(filtro).not.toHaveAttribute('aria-invalid', 'true')
  })

  test('(3) el panel JSON enseña el documento elegido', async () => {
    const win = s!.win
    const pane = win.locator(PANE)
    await pane.locator('.db-docs-fila').filter({ hasText: 'Ana' }).first().click()
    const json = pane.locator('.db-docs-panel .db-docs-json')
    await expect(json).toBeVisible()
    await expect(json).toContainText('Ana')
    await expect(json).toContainText('650000000000000000000001')
    // Sangrado: una clave por línea.
    expect(((await json.textContent()) ?? '').split('\n').length).toBeGreaterThan(3)
  })

  // (4) «Solo lectura para los agentes» limita a `tdb`, NO al usuario. La
  // pestaña ofrece editar aunque la casilla esté marcada (lo que el usuario `lector` no
  // pueda hacer lo dirá el servidor al enviar). Aquí no se envía nada: se abre el editor
  // de una celda y se cancela.
  test('(4) con «Solo lectura para los agentes», la pestaña ofrece editar', async () => {
    const win = s!.win
    const pane = win.locator(PANE)
    await expect(pane.locator('.db-barra-no-editable'), 'ya no dice «Solo lectura»').toHaveCount(0)
    await expect(pane.locator('button[aria-label="Enviar cambios"]'), 'el grupo de edición está').toHaveCount(1)
    await expect(pane.locator('button[aria-label="Añadir documento"]')).toHaveCount(1)
    await pane.locator('.db-docs-celda[data-campo="nombre"]').first().dblclick()
    await expect(pane.locator('.db-docs-editor'), 'el doble clic abre el editor').toHaveCount(1)
    await win.keyboard.press('Escape')
    await expect(pane.locator('.db-docs-editor')).toHaveCount(0)
    await expect(pane.locator('.db-barra-pendientes'), 'cancelar no deja nada pendiente').toHaveCount(0)
  })
})
