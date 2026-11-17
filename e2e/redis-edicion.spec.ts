// =============================================================================
// Editar Redis desde el visor de clave, sobre la app empaquetada y contra el `pruebas-redis`
// compartido con el usuario `tessera` (que escribe): el valor de un string, la caducidad, añadir y
// borrar un campo de un hash, renombrar sin pisar una clave que ya existe y borrar la clave. Cada
// diálogo enseña el comando exacto antes de ejecutarlo. Las claves son propias de la prueba, en db2,
// y se borran al empezar. El destino sale de `TESSERA_TEST_REDIS` (`bash scripts/pruebas/redis.sh
// correr …`); sin la variable se salta. En serie y compartiendo app.
// =============================================================================

import { expect, test, type Locator } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { aLaVista, crearProyecto, desplegar, fila, filaTras, pestana } from './consolaAyudas'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const PERFIL = 'personal'
const ALIAS = 'REDIS-EDICION-E2E'
const BASE = 2
const VISOR = '.db-area:not(.hidden) .db-pane:not(.hidden) .db-clave'

/** El destino de la URI de pruebas, o el motivo por el que no hay. Nunca imprime la clave. */
function destino(): { ok: true; host: string; port: number; user: string; password: string } | { ok: false; motivo: string } {
  const uri = process.env.TESSERA_TEST_REDIS
  if (!uri) return { ok: false, motivo: 'sin TESSERA_TEST_REDIS (bash scripts/pruebas/redis.sh correr …)' }
  try {
    const u = new URL(uri)
    return { ok: true, host: u.hostname, port: Number(u.port || '6379'), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }
  } catch {
    return { ok: false, motivo: 'TESSERA_TEST_REDIS no es una URI válida' }
  }
}

test.describe.serial('explorador de BD: editar Redis desde el visor', () => {
  let s: SesionTessera | null = null
  let falso: AgenteFalso | null = null
  let motivoSalto: string | null = null

  /** Un comando en una consola de la prueba, fuera de la interfaz: para sembrar y para comprobar. */
  async function redis(texto: string): Promise<unknown> {
    return s!.ventana.evaluate(
      async ({ texto, alias, base, perfil }) => {
        const c = (await window.tessera.db.listar(perfil)).find((x) => x.alias === alias)
        if (!c) throw new Error('sin conexión')
        const r = await window.tessera.bdClaves.ejecutarConsola({ perfilId: perfil, consolaId: 'e2e-siembra', conexionId: c.id, base, texto, desplazamiento: 0 })
        if (!r.ok) throw new Error(r.error.mensaje)
        return r.valor.respuesta
      },
      { texto, alias: ALIAS, base: BASE, perfil: PERFIL }
    )
  }

  const visor = (): Locator => s!.ventana.locator(VISOR)
  const dialogo = (): Locator => s!.ventana.getByRole('dialog')

  async function abrirClave(nombre: string): Promise<void> {
    const ventana = s!.ventana
    const base = fila(ventana, 'kv-base', `db${BASE}`)
    const f = await filaTras(ventana, base, 'kv-clave', `e-${nombre}`, nombre)
    await f.dblclick()
    await expect(pestana(ventana, nombre)).toHaveCount(1)
    await expect(visor()).toBeVisible()
  }

  async function masAcciones(entrada: string): Promise<void> {
    await visor().locator('button[aria-label="Más acciones"]').click()
    await s!.ventana.getByRole('menuitem', { name: entrada }).click()
  }

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const r = destino()
    if (!r.ok) {
      motivoSalto = r.motivo
      return
    }
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
            byProfile: { [PERFIL]: { openProjects: [{ projectHostPath: proyecto, name: 'proyecto-redis', estado: 'active' }], activePath: proyecto } },
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
    const ventana = s.ventana
    await aLaVista(ventana)
    await ventana.locator('.activity-item[title="Bases de datos"]').click()
    await ventana.locator('.db-arbol button[aria-label="Nueva conexión"]').first().click()
    const dialogoConexion = ventana.locator('.db-conexion-modal')
    await dialogoConexion.locator('.dbc-motor-control select').selectOption('redis')
    await dialogoConexion.locator('[data-campo="alias"]').fill(ALIAS)
    await dialogoConexion.locator('[data-campo="host"]').fill(r.host)
    await dialogoConexion.locator('[data-campo="port"]').fill(String(r.port))
    await dialogoConexion.locator('[data-campo="user"]').fill(r.user)
    await dialogoConexion.locator('.dbc-pass input').fill(r.password)
    await dialogoConexion.getByRole('button', { name: 'Guardar y probar' }).click()
    await expect(dialogoConexion.locator('.dbc-prueba')).toHaveClass(/\bok\b/, { timeout: 60_000 })
    await dialogoConexion.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialogoConexion).toHaveCount(0)
    // Las claves de la prueba, desde cero (la sesión de siembra no es la de ninguna pestaña).
    await redis('DEL edicion_texto edicion_texto2 edicion_hash')
    await redis('SET edicion_texto hola')
    await redis('HSET edicion_hash nombre Ana')
    const conexion = fila(ventana, 'conexion', ALIAS)
    await desplegar(conexion)
    await desplegar(fila(ventana, 'kv-base', `db${BASE}`))
  })

  test.beforeEach(() => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
  })

  test.afterAll(async () => {
    if (s && motivoSalto === null) await redis('DEL edicion_texto edicion_texto2 edicion_hash').catch(() => undefined)
    await s?.cerrar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  test('(1) «Editar valor» de un string enseña el SET y lo guarda', async () => {
    await abrirClave('edicion_texto')
    await expect(visor().locator('.db-clave-texto')).toHaveText('hola', { timeout: 30_000 })
    await visor().locator('button[aria-label="Editar valor"]').click()
    const dialogoConexion = dialogo()
    await expect(dialogoConexion.locator('textarea')).toHaveValue('hola')
    await dialogoConexion.locator('textarea').fill('hola mundo')
    await expect(dialogoConexion.getByLabel('Comando que se ejecutará')).toHaveText('SET edicion_texto "hola mundo"')
    await dialogoConexion.getByRole('button', { name: 'Guardar' }).click()
    await expect(dialogoConexion).toHaveCount(0)
    await expect(visor().locator('.db-clave-texto')).toHaveText('hola mundo', { timeout: 30_000 })
  })

  test('(2) la caducidad: EXPIRE la pone y, vacía, PERSIST la quita', async () => {
    await masAcciones('Caducidad…')
    const dialogoConexion = dialogo()
    await dialogoConexion.locator('input').fill('300')
    await expect(dialogoConexion.getByLabel('Comando que se ejecutará')).toHaveText('EXPIRE edicion_texto 300')
    await dialogoConexion.getByRole('button', { name: 'Guardar' }).click()
    await expect(visor().locator('.db-clave-ttl')).toContainText('Caduca en', { timeout: 30_000 })
    await masAcciones('Caducidad…')
    await dialogo().locator('input').fill('')
    await expect(dialogo().getByLabel('Comando que se ejecutará')).toHaveText('PERSIST edicion_texto')
    await dialogo().getByRole('button', { name: 'Guardar' }).click()
    await expect(visor().locator('.db-clave-ttl')).toHaveText('Sin caducidad', { timeout: 30_000 })
  })

  test('(3) un hash: añadir un campo y borrarlo desde el menú de su fila', async () => {
    await abrirClave('edicion_hash')
    await expect(visor().locator('.db-docs-fila')).toHaveCount(1, { timeout: 30_000 })
    await visor().locator('button[aria-label="Añadir campo"]').click()
    const dialogoConexion = dialogo()
    await dialogoConexion.getByLabel('Campo').fill('edad')
    await dialogoConexion.getByLabel('Valor').fill('30')
    await expect(dialogoConexion.getByLabel('Comando que se ejecutará')).toHaveText('HSET edicion_hash edad 30')
    await dialogoConexion.getByRole('button', { name: 'Añadir' }).click()
    await expect(visor().locator('.db-docs-fila')).toHaveCount(2, { timeout: 30_000 })
    await visor().locator('.db-docs-fila').filter({ hasText: 'edad' }).first().click({ button: 'right' })
    await s!.ventana.getByRole('menuitem', { name: 'Eliminar campo…' }).click()
    await expect(dialogo().getByLabel('Comando que se ejecutará')).toHaveText('HDEL edicion_hash edad')
    await dialogo().getByRole('button', { name: 'Eliminar campo' }).click()
    await expect(visor().locator('.db-docs-fila')).toHaveCount(1, { timeout: 30_000 })
  })

  test('(4) renombrar no pisa una clave que ya existe, y a un nombre libre sí renombra', async () => {
    await masAcciones('Renombrar…')
    const dialogoConexion = dialogo()
    await dialogoConexion.locator('input').fill('edicion_texto')
    await expect(dialogoConexion.getByLabel('Comando que se ejecutará')).toHaveText('RENAMENX edicion_hash edicion_texto')
    await dialogoConexion.getByRole('button', { name: 'Renombrar' }).click()
    await expect(dialogoConexion.getByRole('alert')).toContainText('Ya existe una clave con ese nombre')
    expect(await redis('TYPE edicion_texto'), 'la clave que ya existía sigue siendo el string').toEqual({ tipo: 'simple', texto: 'string' })
    await dialogoConexion.locator('input').fill('edicion_texto2')
    await dialogoConexion.getByRole('button', { name: 'Renombrar' }).click()
    await expect(dialogoConexion).toHaveCount(0)
    expect(await redis('HGET edicion_texto2 nombre')).toEqual({ tipo: 'bytes', valor: { texto: 'Ana', base64: 'QW5h' } })
    // La pestaña pasa a la clave nueva (y no se queda en la vieja diciendo que no existe), y el árbol la lista.
    const ventana = s!.ventana
    await expect(pestana(ventana, 'edicion_texto2')).toHaveCount(1)
    await expect(pestana(ventana, 'edicion_hash')).toHaveCount(0)
    await expect(visor().locator('.db-clave-nombre')).toHaveText('edicion_texto2')
    await expect(visor().locator('.db-docs-fila')).toHaveCount(1, { timeout: 30_000 })
    await expect(fila(ventana, 'kv-clave', 'edicion_texto2')).toHaveCount(1, { timeout: 30_000 })
    await expect(fila(ventana, 'kv-clave', 'edicion_hash')).toHaveCount(0)
  })

  test('(5) «Eliminar clave» enseña el DEL y la borra', async () => {
    await abrirClave('edicion_texto')
    await masAcciones('Eliminar clave…')
    const dialogoConexion = dialogo()
    await expect(dialogoConexion.getByLabel('Comando que se ejecutará')).toHaveText('DEL edicion_texto')
    await dialogoConexion.getByRole('button', { name: 'Eliminar clave' }).click()
    await expect(dialogoConexion).toHaveCount(0)
    await expect(visor()).toContainText('La clave ya no existe', { timeout: 30_000 })
    expect(await redis('EXISTS edicion_texto')).toEqual({ tipo: 'entero', valor: '0' })
  })
})
