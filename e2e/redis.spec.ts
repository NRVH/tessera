// =============================================================================
// Redis en la interfaz sobre la app empaquetada y contra el `pruebas-redis` compartido
// (sembrado por `scripts/pruebas/redis-siembra.txt`): el alta con el usuario `lector`
// (ACL de solo lectura), el árbol con las bases numeradas y las claves agrupadas por `:`,
// el visor de cada tipo (string, hash, list, set, zset, stream, JSON; binario en hex) y la
// consola, donde un SET con la casilla de solo lectura para los agentes llega al servidor y
// lo rechaza el ACL (NOPERM). El destino sale de `TESSERA_TEST_REDIS_LECTOR` (`bash
// scripts/pruebas/redis.sh correr …`); sin la variable se salta. No toca el contenedor.
// En serie y compartiendo app; solo el acorde de ejecutar (`MOD`) depende del sistema.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { CONSOLA, PESTANAS, aLaVista, crearProyecto, desplegar, elegirDelMenu, fila, filaTras, pestana } from './consolaAyudas'
import { esperarConsolaLista, monacoConsola } from './monaco'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const PERFIL = 'personal'
const ALIAS = 'REDIS-E2E'

interface DestinoRedis {
  host: string
  port: number
  user: string
  password: string
}

/** El destino de la URI de pruebas, o el motivo por el que no hay. Nunca imprime la clave. */
function destino(): { ok: true; d: DestinoRedis } | { ok: false; motivo: string } {
  const uri = process.env.TESSERA_TEST_REDIS_LECTOR
  if (!uri) return { ok: false, motivo: 'sin TESSERA_TEST_REDIS_LECTOR (bash scripts/pruebas/redis.sh correr …)' }
  try {
    const u = new URL(uri)
    return {
      ok: true,
      d: {
        host: u.hostname,
        port: Number(u.port || '6379'),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password)
      }
    }
  } catch {
    return { ok: false, motivo: 'TESSERA_TEST_REDIS_LECTOR no es una URI válida' }
  }
}

/** El visor de clave visible. */
const VISOR = '.db-area:not(.hidden) .db-pane:not(.hidden) .db-clave'

/**
 * Recorre la base desplegada hasta el final con «Cargar más claves». El Redis de pruebas NO es
 * solo la siembra: una medida anterior dejó 5 000 claves `grande:*` en db0, y una primera
 * página de 500 puede no traer ninguna de las sembradas (SCAN no promete orden). Recorrerla
 * entera es además lo que prueba la paginación de verdad; las 5 000 caen en UNA carpeta.
 */
async function cargarTodasLasClaves(win: Page): Promise<void> {
  // La fila es la misma mientras carga (dice «Cargando más claves…» y no tiene botón): se
  // mira por su CLASE, no por su texto, o una carga en curso parecería el final del recorrido.
  const mas = (): Locator => win.locator('.db-arbol .db-fila-kv-mas')
  const boton = (): Locator => mas().locator('button', { hasText: /Cargar más claves|Seguir buscando/ })
  // Primero, que haya llegado la PRIMERA página.
  await expect(win.locator('.db-arbol .db-fila-kv-carpeta, .db-arbol .db-fila-kv-clave').first()).toBeVisible({ timeout: 60_000 })
  for (let i = 0; i < 60; i++) {
    // Terminado (sin fila) o listo para otra vuelta (con botón); nunca a mitad de una carga.
    await expect.poll(async () => (await mas().count()) === 0 || (await boton().count()) > 0, { timeout: 30_000 }).toBe(true)
    if ((await mas().count()) === 0) return
    const antes = await mas().first().innerText()
    await boton().first().click()
    await expect.poll(async () => (await mas().count()) === 0 || (await mas().first().innerText()) !== antes, { timeout: 30_000 }).toBe(true)
  }
  throw new Error('el recorrido de SCAN no acabó en 60 vueltas')
}

test.describe('explorador de BD: Redis', () => {
  let s: SesionTessera | null = null
  let falso: AgenteFalso | null = null
  let motivoSalto: string | null = null
  let d: DestinoRedis | null = null

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
                openProjects: [{ projectHostPath: proyecto, name: 'proyecto-redis', estado: 'active' }],
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

  test('(0) alta de una conexión Redis por el formulario', async () => {
    const win = s!.win
    const m = d!
    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    await win.locator('.db-arbol button[aria-label="Nueva conexión"]').first().click()
    const dlg = win.locator('.db-conexion-modal')
    await expect(dlg).toBeVisible()
    await dlg.locator('.dbc-motor-control select').selectOption('redis')
    await expect(dlg.locator('[data-campo="port"]'), 'el puerto de Redis').toHaveValue('6379')
    await dlg.locator('[data-campo="alias"]').fill(ALIAS)
    await dlg.locator('[data-campo="host"]').fill(m.host)
    await dlg.locator('[data-campo="port"]').fill(String(m.port))
    await dlg.locator('[data-campo="user"]').fill(m.user)
    await dlg.locator('.dbc-pass input').fill(m.password)
    // `lector` es de lectura: la casilla de los agentes se deja marcada (lo recomendado).
    await expect(dlg.getByLabel('Solo lectura para los agentes (recomendado)')).toBeChecked()
    await dlg.getByRole('button', { name: 'Guardar y probar' }).click()
    await expect(dlg.locator('.dbc-prueba')).toHaveClass(/\bok\b/, { timeout: 60_000 })
    await dlg.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    await expect(fila(win, 'conexion', ALIAS)).toHaveCount(1)
  })

  test('(1) el árbol: bases numeradas y claves agrupadas por «:»', async () => {
    const win = s!.win
    const conexion = fila(win, 'conexion', ALIAS)
    await desplegar(conexion)
    // Las bases: db0 y db1 (con claves) al menos; el lector no puede `CONFIG GET databases`
    // y cae a las del descriptor (16).
    const db0 = fila(win, 'kv-base', 'db0')
    await expect(db0, 'db0').toHaveCount(1, { timeout: 60_000 })
    await expect(fila(win, 'kv-base', 'db1')).toHaveCount(1)
    await desplegar(db0)
    await cargarTodasLasClaves(win)
    // Carpetas por el primer trozo del nombre, y claves sueltas (sin `:`) a su lado.
    const usuario = await filaTras(win, db0, 'kv-carpeta', 'carpeta-usuario', 'usuario')
    await expect(usuario).toBeVisible({ timeout: 60_000 })
    await filaTras(win, db0, 'kv-carpeta', 'carpeta-app', 'app')
    await filaTras(win, db0, 'kv-clave', 'clave-contador', 'contador')
    // La carpeta dice cuántas claves cargadas tiene: usuario:1, usuario:2 y usuario:3:perfil.
    await expect(usuario.locator('.db-fila-cuenta')).toHaveText('3')
    await desplegar(usuario)
    // Ancla db0 y no `usuario`: `filaTras` para en la primera fila del MISMO tipo que el
    // ancla, y la subcarpeta «3» es otra kv-carpeta (la única «3» de db0).
    const tres = await filaTras(win, db0, 'kv-carpeta', 'carpeta-3', '3')
    await desplegar(tres)
    // La clave se pinta con su NOMBRE ENTERO (lo de la carpeta, apagado) y el chip de su tipo.
    const perfil = await filaTras(win, tres, 'kv-clave', 'clave-perfil', 'usuario:3:perfil')
    await expect(perfil.locator('.db-kv-prefijo')).toHaveText('usuario:3:')
    await expect(perfil.locator('.db-kv-tipo')).toHaveText('HASH')
    // «Sin claves» NO aparece en una base que tiene: el recorrido acabó.
    await expect(win.locator('.db-arbol .db-fila-placeholder', { hasText: 'Sin claves' })).toHaveCount(0)
  })

  test('(2) el visor: una clave de cada tipo principal', async () => {
    const win = s!.win
    const db0 = fila(win, 'kv-base', 'db0')
    const abrir = async (nombre: string, marca: string): Promise<void> => {
      const f = await filaTras(win, db0, 'kv-clave', marca, nombre)
      await f.dblclick()
      await expect(pestana(win, nombre)).toHaveCount(1)
      await expect(win.locator(VISOR)).toBeVisible()
    }
    const visor = win.locator(VISOR)

    // string: texto.
    await abrir('contador', 'v-contador')
    await expect(visor.locator('.db-kv-tipo')).toHaveText('STRING')
    await expect(visor.locator('.db-clave-texto')).toHaveText('42', { timeout: 30_000 })

    // string con TTL: la cuenta atrás (dentro de su carpeta).
    await desplegar(await filaTras(win, db0, 'kv-carpeta', 'v-carpeta-sesion', 'sesion'))
    await abrir('sesion:temporal', 'v-sesion')
    await expect(visor.locator('.db-clave-ttl')).toContainText('Caduca en', { timeout: 30_000 })

    // string binario: abre en HEX.
    await abrir('binario', 'v-binario')
    await expect(visor.locator('.db-clave-modos .btn-active')).toHaveText('Hex', { timeout: 30_000 })
    await expect(visor.locator('.db-clave-texto.modo-hex')).toContainText('00 01 ff fe')

    // hash (dentro de su carpeta): tabla Campo / Valor y el detalle de la fila.
    await desplegar(await filaTras(win, db0, 'kv-carpeta', 'v-carpeta-usuario', 'usuario'))
    await abrir('usuario:1', 'v-usuario1')
    await expect(visor.locator('.db-kv-tipo')).toHaveText('HASH')
    await expect(visor.locator('.db-docs-th')).toHaveText(['Campo', 'Valor'], { timeout: 30_000 })
    await expect(visor.locator('.db-docs-fila')).toHaveCount(3)
    await visor.locator('.db-docs-fila').filter({ hasText: 'nombre' }).first().click()
    await expect(visor.locator('.db-clave-detalle')).toContainText('Ana')

    // list: en su orden, con el índice.
    await desplegar(await filaTras(win, db0, 'kv-carpeta', 'v-carpeta-cola', 'cola'))
    await abrir('cola:tareas', 'v-cola')
    await expect(visor.locator('.db-kv-tipo')).toHaveText('LIST')
    await expect(visor.locator('.db-docs-fila')).toHaveCount(5, { timeout: 30_000 })
    await expect(visor.locator('.db-docs-fila').first()).toContainText('uno')

    // set.
    await desplegar(await filaTras(win, db0, 'kv-carpeta', 'v-carpeta-conjunto', 'conjunto'))
    await abrir('conjunto:etiquetas', 'v-set')
    await expect(visor.locator('.db-kv-tipo')).toHaveText('SET')
    await expect(visor.locator('.db-docs-fila')).toHaveCount(3, { timeout: 30_000 })

    // zset: miembro y puntuación.
    await abrir('ranking', 'v-zset')
    await expect(visor.locator('.db-kv-tipo')).toHaveText('ZSET')
    await expect(visor.locator('.db-docs-th')).toHaveText(['Miembro', 'Puntuación'], { timeout: 30_000 })
    await expect(visor.locator('.db-docs-fila').filter({ hasText: 'luis' })).toContainText('85.5')

    // stream: ID y los campos como columnas.
    await abrir('eventos', 'v-stream')
    await expect(visor.locator('.db-kv-tipo')).toHaveText('STREAM')
    await expect(visor.locator('.db-docs-fila')).toHaveCount(2, { timeout: 30_000 })
    await expect(visor.locator('.db-docs-th').first()).toHaveText('ID')

    // JSON (RedisJSON): sangrado.
    await desplegar(await filaTras(win, db0, 'kv-carpeta', 'v-carpeta-doc', 'doc'))
    await desplegar(await filaTras(win, db0, 'kv-carpeta', 'v-carpeta-pedido', 'pedido'))
    await abrir('doc:pedido:1', 'v-json')
    await expect(visor.locator('.db-kv-tipo')).toHaveText('JSON')
    await expect(visor.locator('.db-clave-texto')).toContainText('"cliente": "Ana"', { timeout: 30_000 })
  })

  // (3) «Solo lectura para los agentes» limita a `tdb`, NO al usuario. El SET
  // de la consola ya no lo para Tessera: llega al servidor, y quien lo rechaza es el ACL del
  // usuario `lector` (NOPERM). La clave no cambia.
  test('(3) la consola: un comando de lectura, y un SET que rechaza el SERVIDOR (no Tessera)', async () => {
    const win = s!.win
    const antes = await win.locator(PESTANAS).count()
    await fila(win, 'kv-base', 'db0').click({ button: 'right' })
    await elegirDelMenu(win, 'Nueva consola')
    await expect(win.locator(PESTANAS)).toHaveCount(antes + 1)
    await expect(win.locator(CONSOLA)).toBeVisible()
    await esperarConsolaLista(win)
    const consola = win.locator(CONSOLA)

    await monacoConsola(win, { op: 'fijar', texto: 'HGET usuario:1 nombre' })
    await monacoConsola(win, { op: 'foco' })
    await win.keyboard.press(`${MOD}+Enter`)
    await expect(consola, 'la respuesta como redis-cli').toContainText('"Ana"', { timeout: 30_000 })

    await monacoConsola(win, { op: 'fijar', texto: 'SET contador 99' })
    await monacoConsola(win, { op: 'foco' })
    await win.keyboard.press(`${MOD}+Enter`)
    await expect(consola, 'el SET llega al servidor y el ACL del lector lo rechaza').toContainText(/NOPERM/, { timeout: 30_000 })
    await expect(consola, 'NEGATIVO: no lo para la casilla de los agentes').not.toContainText(/solo lectura/i)

    // Y la clave no cambió.
    await monacoConsola(win, { op: 'fijar', texto: 'GET contador' })
    await monacoConsola(win, { op: 'foco' })
    await win.keyboard.press(`${MOD}+Enter`)
    await expect(consola).toContainText('"42"', { timeout: 30_000 })
  })
})
