// =============================================================================
// MySQL en la interfaz, sobre la app empaquetada y contra un MySQL de Docker propio
// (`pruebas-mysql-e2e-<azar>`, puerto elegido por Docker, contraseña al azar): el alta con «Confiar en
// el certificado» autofirmado, el árbol con las bases como esquemas («N de M») y sus carpetas, abrir una
// tabla, un CALL con dos conjuntos, `USE`, Tx Manual y la casilla de solo lectura (limita a `tdb`, no al
// usuario). Sin Docker o sin la imagen se salta (no se descarga). En serie y compartiendo app.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
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
  esperarFinEjecucion,
  fila,
  filaTras,
  abrirConsolaNueva
} from './consolaAyudas'
import { celda, PANE } from './rejillaAyudas'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const PERFIL = 'personal'
/** La conexión SIN base, de escritura: la del diálogo. */
const ALIAS = 'MYSQL-E2E'
/** La conexión CON base, de solo lectura para los agentes: por la API del preload. */
const ALIAS_FIJA = 'MYSQL-FIJA'
const IMAGEN = process.env.TESSERA_E2E_MYSQL_IMAGEN || 'mysql:8.4'

interface MysqlEfimero {
  host: string
  port: number
  /** La del usuario `tessera` (y la de root, que solo usa la siembra). */
  password: string
  /** SQL por el cliente DENTRO del contenedor, como root: otra sesión, ajena a Tessera. */
  sql: (texto: string) => { ok: boolean; out: string; err: string }
  parar: () => void
}

type Arranque = { ok: true; my: MysqlEfimero } | { ok: false; motivo: string; fallo: boolean }

function docker(args: string[], input?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', input, windowsHide: true, timeout: 120_000 })
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || String(r.error ?? '')).trim() }
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Dos bases con una tabla y un procedimiento de dos conjuntos; el usuario `tessera`, dueño de las dos. */
function siembra(password: string): string {
  return [
    'CREATE DATABASE pruebas; CREATE DATABASE ventas;',
    "CREATE TABLE pruebas.t (id INT PRIMARY KEY, nombre VARCHAR(50) NOT NULL); INSERT INTO pruebas.t VALUES (1, 'Ana'), (2, 'Luis'), (3, 'Eva');",
    'CREATE TABLE ventas.pedidos (id INT PRIMARY KEY, importe DECIMAL(10,2)); INSERT INTO ventas.pedidos VALUES (10, 99.90);',
    // El cliente `mysql` corta en cada `;`: el cuerpo compuesto necesita otro delimitador.
    'DELIMITER //',
    'CREATE PROCEDURE pruebas.dos() BEGIN SELECT 1 AS a; SELECT 2 AS b; END //',
    'DELIMITER ;',
    `CREATE USER 'tessera'@'%' IDENTIFIED BY '${password}';`,
    "GRANT ALL PRIVILEGES ON pruebas.* TO 'tessera'@'%'; GRANT ALL PRIVILEGES ON ventas.* TO 'tessera'@'%';",
    ''
  ].join('\n')
}

async function arrancarMysql(): Promise<Arranque> {
  if (!docker(['version', '--format', '{{.Server.Version}}']).ok) {
    return { ok: false, fallo: false, motivo: 'Docker no responde (¿Docker Desktop apagado?)' }
  }
  if (!docker(['image', 'inspect', IMAGEN]).ok) return { ok: false, fallo: false, motivo: `falta la imagen ${IMAGEN} (docker pull ${IMAGEN})` }
  const password = `Aa1${randomBytes(10).toString('hex')}`
  const contenedor = `pruebas-mysql-e2e-${randomBytes(4).toString('hex')}`
  const run = docker(['run', '-d', '--rm', '--name', contenedor, '-e', `MYSQL_ROOT_PASSWORD=${password}`, '-p', '127.0.0.1::3306', IMAGEN])
  if (!run.ok) return { ok: false, fallo: false, motivo: `no se pudo arrancar el contenedor: ${run.err}` }
  let borrado = false
  const parar = (): void => {
    if (borrado) return
    borrado = true
    docker(['rm', '-f', '-v', contenedor])
  }
  process.once('exit', parar)
  const puertoTexto = docker(['port', contenedor, '3306/tcp']).out.split('\n')[0] || ''
  const port = Number(puertoTexto.slice(puertoTexto.lastIndexOf(':') + 1))
  if (!Number.isInteger(port) || port <= 0) {
    parar()
    return { ok: false, fallo: false, motivo: `Docker no publicó el puerto (${puertoTexto || 'vacío'})` }
  }
  // La clave viaja por el ENTORNO de `docker exec` (MYSQL_PWD); el SQL, por stdin.
  const sql = (texto: string): { ok: boolean; out: string; err: string } =>
    docker(['exec', '-i', '-e', `MYSQL_PWD=${password}`, contenedor, 'mysql', '-uroot', '-N', '-B'], texto)
  let listo = false
  for (let i = 0; i < 120 && !listo; i++) {
    listo = sql('SELECT 1;').ok
    if (!listo) await dormir(1_000)
  }
  if (!listo) {
    parar()
    return { ok: false, fallo: false, motivo: 'MySQL no aceptó conexiones en 120 s' }
  }
  const s = sql(siembra(password))
  if (!s.ok) {
    parar()
    return { ok: false, fallo: true, motivo: `la siembra falló: ${s.err || s.out}` }
  }
  return { ok: true, my: { host: '127.0.0.1', port, password, sql, parar } }
}

test.describe.configure({ mode: 'serial' })

async function conexionPorAlias(win: Page, alias: string): Promise<{ id: string; tls?: { cifrar: boolean; confiarCertificado: boolean }; database?: string } | null> {
  return win.evaluate(
    async (a) => {
      const c = (await window.tessera.db.list(a.perfil)).find((x) => x.alias === a.alias)
      return c ? { id: c.id, tls: c.tls, database: c.database } : null
    },
    { perfil: PERFIL, alias }
  )
}

test.describe('explorador de BD: MySQL', () => {
  let s: SesionTessera | null = null
  let my: MysqlEfimero | null = null
  let falso: AgenteFalso | null = null
  let motivoSalto: string | null = null

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    const r = await arrancarMysql()
    if (!r.ok) {
      if (r.fallo) throw new Error(r.motivo)
      motivoSalto = `sin MySQL de pruebas: ${r.motivo}`
      return
    }
    my = r.my
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
            byProfile: { [PERFIL]: { openProjects: [{ projectHostPath: proyecto, name: 'proyecto-mysql', estado: 'active' }], activePath: proyecto } },
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
    my?.parar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  // (0) EL ALTA POR EL DIÁLOGO: el puerto de MySQL, la base opcional, «Pegar URI», la ayuda de
  // solo lectura (el servidor abre sus transacciones en solo lectura) y el certificado autofirmado.
  test('(0) alta por el diálogo, con la URI y «Confiar en el certificado y probar»', async () => {
    const win = s!.win
    const p = my!
    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    await win.locator('.db-arbol button[aria-label="Nueva conexión"]').first().click()
    const d = win.locator('.db-conexion-modal')
    await expect(d).toBeVisible()
    await d.locator('.dbc-motor-control select').selectOption('mysql')
    await expect(d.locator('[data-campo="port"]'), 'el puerto de MySQL').toHaveValue('3306')
    await expect(d.locator('[data-campo="database"]')).toHaveAttribute('placeholder', /opcional/)
    await expect(d.locator('[data-campo="instancia"]')).toHaveCount(0)
    await expect(d.getByLabel('Cifrar la conexión (TLS)')).not.toBeChecked()
    await expect(d).toContainText('el servidor abre sus transacciones en solo lectura')
    await expect(d).toContainText('tú no quedas limitado')

    await d.locator('[data-campo="alias"]').fill(ALIAS)
    await d.locator('[data-campo="host"]').fill(p.host)
    await d.locator('[data-campo="port"]').fill(String(p.port))
    await d.locator('[data-campo="user"]').fill('tessera')
    await d.locator('.dbc-pass input').fill(p.password)
    await d.getByLabel('Solo lectura para los agentes (recomendado)').uncheck()
    // Cifrar y verificar: el certificado del contenedor es autofirmado → falla y lo dice.
    await d.getByLabel('Cifrar la conexión (TLS)').check()
    await d.getByRole('button', { name: 'Guardar y probar' }).click()
    const prueba = d.locator('.dbc-prueba')
    await expect(prueba).toHaveClass(/\bfalla\b/, { timeout: 60_000 })
    await expect(prueba).toContainText('«Confiar en el certificado del servidor»')
    await d.getByRole('button', { name: 'Confiar en el certificado y probar' }).click()
    await expect(prueba).toHaveClass(/\bok\b/, { timeout: 60_000 })
    const c = await conexionPorAlias(win, ALIAS)
    expect(c?.tls, 'la casilla se guardó').toEqual({ cifrar: true, confiarCertificado: true })
    expect(c?.database ?? '', 'sin base').toBe('')
    await d.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(d).toHaveCount(0)
    await expect(fila(win, 'conexion', ALIAS)).toHaveCount(1)
  })

  // (1) EL ÁRBOL: las bases son los esquemas, con su «N de M»; de partida, la primera que no es
  // del sistema. Bajo una base, las carpetas de MySQL (con «eventos»).
  test('(1) árbol: las bases como esquemas, con sus carpetas', async () => {
    const win = s!.win
    const conexion = fila(win, 'conexion', ALIAS)
    await desplegar(conexion)
    const insignia = conexion.locator('.db-insignia-esquemas')
    // M depende de las bases del sistema que el usuario ve (information_schema siempre).
    await expect(insignia).toHaveText(/^1 de \d+$/, { timeout: 60_000 })
    const m = ((await insignia.textContent()) ?? '').split(' de ')[1]
    await expect(fila(win, 'esquema', 'pruebas')).toHaveCount(1)
    await expect(fila(win, 'esquema', 'ventas')).toHaveCount(0)
    await insignia.click()
    const pop = win.locator('.db-esquemas-pop')
    await expect(pop).toBeVisible()
    await pop.locator('.db-pop-fila').filter({ has: win.locator('.db-pop-nombre', { hasText: /^ventas$/ }) }).click()
    await expect(pop.locator('.db-pop-cuenta')).toHaveText(`2 de ${m}`)
    await win.keyboard.press('Enter')
    await expect(pop).toHaveCount(0)
    await expect(fila(win, 'esquema', 'ventas')).toHaveCount(1)
    const base = fila(win, 'esquema', 'pruebas')
    await desplegar(base)
    const tablas = await filaTras(win, base, 'carpeta', 'mysql-tablas', 'tablas')
    await filaTras(win, base, 'carpeta', 'mysql-rutinas', 'rutinas')
    await desplegar(tablas)
    await filaTras(win, tablas, 'objeto', 'mysql-t', 't')
  })

  // (2) ABRIR UNA TABLA: la pestaña y sus filas.
  test('(2) abrir una tabla', async () => {
    const win = s!.win
    await win.locator('[data-e2e="mysql-t"]').dblclick()
    await expect(win.locator(PESTANAS).filter({ hasText: 't' }).filter({ hasText: `[${ALIAS}]` })).toHaveClass(/\bactive\b/)
    await expect(celda(win, 0, 1)).toHaveText('Ana', { timeout: 60_000 })
    await expect(celda(win, 2, 1)).toHaveText('Eva')
    await expect(win.locator(`${PANE} .db-rejilla-cuerpo .db-rejilla-fila`), 'las tres filas').toHaveCount(3)
  })

  // (3) LA CONSOLA: un CALL con dos conjuntos («Resultado 1» y «Resultado 1.2») y `USE` cambia la
  // base que dice la barra.
  test('(3) consola: CALL con dos conjuntos; USE cambia la base', async () => {
    const win = s!.win
    await fila(win, 'conexion', ALIAS).click()
    await abrirConsolaNueva(win, `${MOD}+KeyN`)
    await expect(win.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Auto')
    await ejecutarTodoSeleccionado(win, 'CALL pruebas.dos()')
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-glifo-error`), 'sin errores').toHaveCount(0)
    const tabs = win.locator(`${CONSOLA} .db-resultados-tabs [role="tab"]`)
    await expect(tabs).toHaveCount(3, { timeout: 30_000 })
    await expect(tabs.nth(2)).toContainText('Resultado 1.2')
    const dato = win.locator(`${CONSOLA} .db-consola-esquema`)
    await expect(dato).toHaveText('pruebas', { timeout: 15_000 })
    await ejecutarTodoSeleccionado(win, 'USE ventas')
    await esperarFinEjecucion(win)
    await expect(dato).toHaveText('ventas', { timeout: 15_000 })
    await ejecutarTodoSeleccionado(win, 'SELECT importe FROM pedidos')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0)).toHaveText('99.90')
    await ejecutarTodoSeleccionado(win, 'USE pruebas')
    await esperarFinEjecucion(win)
    await expect(dato).toHaveText('pruebas', { timeout: 15_000 })
  })

  // (4) Tx MANUAL: el UPDATE queda pendiente (se ve en la MISMA consola) y Rollback lo deshace.
  test('(4) Tx Manual: UPDATE pendiente y Rollback', async () => {
    const win = s!.win
    const modo = win.locator(`${CONSOLA} .db-consola-tx-modo`)
    const barraTx = win.locator(`${CONSOLA} .db-consola-tx`)
    await modo.click()
    await expect(win.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Manual')
    await ejecutarTodoSeleccionado(win, "UPDATE t SET nombre = 'Cambiada' WHERE id = 1")
    await esperarFinEjecucion(win)
    await expect(barraTx).toContainText('Tx pendiente', { timeout: 15_000 })
    await ejecutarTodoSeleccionado(win, 'SELECT nombre FROM t WHERE id = 1')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0)).toHaveText('Cambiada')
    await win.locator(`${CONSOLA} button.db-consola-rollback`).click()
    await expect(barraTx).toHaveCount(0, { timeout: 15_000 })
    await ejecutarTodoSeleccionado(win, 'SELECT nombre FROM t WHERE id = 1')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0), 'tras Rollback, como estaba').toHaveText('Ana')
    expect(my!.sql('SELECT nombre FROM pruebas.t WHERE id = 1;').out, 'el servidor no vio el cambio').toContain('Ana')
  })

  // (5) «SOLO LECTURA PARA LOS AGENTES»: la casilla limita a `tdb`, no al usuario.
  test('(5) con «Solo lectura para los agentes», el INSERT del usuario entra', async () => {
    const win = s!.win
    const p = my!
    const creada = await win.evaluate(
      (c) =>
        window.tessera.db.create({
          profileId: 'personal',
          alias: c.alias,
          motor: 'mysql',
          host: c.host,
          port: c.port,
          database: 'pruebas',
          user: 'tessera',
          password: c.password,
          readonly: true
        }),
      { alias: ALIAS_FIJA, host: p.host, port: p.port, password: p.password }
    )
    expect(creada.tieneSecreto).toBe(true)
    await expect(fila(win, 'conexion', ALIAS_FIJA)).toHaveCount(1)
    await fila(win, 'conexion', ALIAS_FIJA).click()
    await abrirConsolaNueva(win, `${MOD}+KeyN`)
    await expect(win.locator(`${CONSOLA} .db-consola-barra`)).toContainText('RO agentes')
    await ejecutarTodoSeleccionado(win, "INSERT INTO t VALUES (4, 'Del usuario')")
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-glifo-error`), 'la escritura NO se rechaza').toHaveCount(0)
    expect(p.sql('SELECT COUNT(*) FROM pruebas.t;').out.trim(), 'el servidor la ve').toBe('4')
    await ejecutarTodoSeleccionado(win, 'DELETE FROM t WHERE id = 4')
    await esperarFinEjecucion(win)
    expect(p.sql('SELECT COUNT(*) FROM pruebas.t;').out.trim()).toBe('3')
  })
})
