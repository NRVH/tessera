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
  contrasena: string
  /** SQL por el cliente DENTRO del contenedor, como root: otra sesión, ajena a Tessera. */
  sql: (texto: string) => { ok: boolean; out: string; err: string }
  parar: () => void
}

type Arranque = { ok: true; mysql: MysqlEfimero } | { ok: false; motivo: string; fallo: boolean }

function docker(args: string[], entrada?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', input: entrada, windowsHide: true, timeout: 120_000 })
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || String(r.error ?? '')).trim() }
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Dos bases con una tabla y un procedimiento de dos conjuntos; el usuario `tessera`, dueño de las dos. */
function siembra(contrasena: string): string {
  return [
    'CREATE DATABASE pruebas; CREATE DATABASE ventas;',
    "CREATE TABLE pruebas.t (id INT PRIMARY KEY, nombre VARCHAR(50) NOT NULL); INSERT INTO pruebas.t VALUES (1, 'Ana'), (2, 'Luis'), (3, 'Eva');",
    'CREATE TABLE ventas.pedidos (id INT PRIMARY KEY, importe DECIMAL(10,2)); INSERT INTO ventas.pedidos VALUES (10, 99.90);',
    // El cliente `mysql` corta en cada `;`: el cuerpo compuesto necesita otro delimitador.
    'DELIMITER //',
    'CREATE PROCEDURE pruebas.dos() BEGIN SELECT 1 AS a; SELECT 2 AS b; END //',
    'DELIMITER ;',
    `CREATE USER 'tessera'@'%' IDENTIFIED BY '${contrasena}';`,
    "GRANT ALL PRIVILEGES ON pruebas.* TO 'tessera'@'%'; GRANT ALL PRIVILEGES ON ventas.* TO 'tessera'@'%';",
    ''
  ].join('\n')
}

async function arrancarMysql(): Promise<Arranque> {
  if (!docker(['version', '--format', '{{.Server.Version}}']).ok) {
    return { ok: false, fallo: false, motivo: 'Docker no responde (¿Docker Desktop apagado?)' }
  }
  if (!docker(['image', 'inspect', IMAGEN]).ok) return { ok: false, fallo: false, motivo: `falta la imagen ${IMAGEN} (docker pull ${IMAGEN})` }
  const contrasena = `Aa1${randomBytes(10).toString('hex')}`
  const contenedor = `pruebas-mysql-e2e-${randomBytes(4).toString('hex')}`
  const ejecucion = docker(['run', '-d', '--rm', '--name', contenedor, '-e', `MYSQL_ROOT_PASSWORD=${contrasena}`, '-p', '127.0.0.1::3306', IMAGEN])
  if (!ejecucion.ok) return { ok: false, fallo: false, motivo: `no se pudo arrancar el contenedor: ${ejecucion.err}` }
  let borrado = false
  const parar = (): void => {
    if (borrado) return
    borrado = true
    docker(['rm', '-f', '-v', contenedor])
  }
  process.once('exit', parar)
  const puertoTexto = docker(['port', contenedor, '3306/tcp']).out.split('\n')[0] || ''
  const puerto = Number(puertoTexto.slice(puertoTexto.lastIndexOf(':') + 1))
  if (!Number.isInteger(puerto) || puerto <= 0) {
    parar()
    return { ok: false, fallo: false, motivo: `Docker no publicó el puerto (${puertoTexto || 'vacío'})` }
  }
  // La clave viaja por el ENTORNO de `docker exec` (MYSQL_PWD); el SQL, por stdin.
  const sql = (texto: string): { ok: boolean; out: string; err: string } =>
    docker(['exec', '-i', '-e', `MYSQL_PWD=${contrasena}`, contenedor, 'mysql', '-uroot', '-N', '-B'], texto)
  let listo = false
  for (let i = 0; i < 120 && !listo; i++) {
    listo = sql('SELECT 1;').ok
    if (!listo) await dormir(1_000)
  }
  if (!listo) {
    parar()
    return { ok: false, fallo: false, motivo: 'MySQL no aceptó conexiones en 120 s' }
  }
  const s = sql(siembra(contrasena))
  if (!s.ok) {
    parar()
    return { ok: false, fallo: true, motivo: `la siembra falló: ${s.err || s.out}` }
  }
  return { ok: true, mysql: { host: '127.0.0.1', port: puerto, contrasena, sql, parar } }
}

test.describe.configure({ mode: 'serial' })

async function conexionPorAlias(ventana: Page, alias: string): Promise<{ id: string; tls?: { cifrar: boolean; confiarCertificado: boolean }; database?: string } | null> {
  return ventana.evaluate(
    async (a) => {
      const c = (await window.tessera.db.listar(a.perfil)).find((x) => x.alias === a.alias)
      return c ? { id: c.id, tls: c.tls, database: c.database } : null
    },
    { perfil: PERFIL, alias }
  )
}

test.describe('explorador de BD: MySQL', () => {
  let s: SesionTessera | null = null
  let mysql: MysqlEfimero | null = null
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
    mysql = r.mysql
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
    await expect(s.ventana.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
  })

  test.beforeEach(() => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
  })

  test.afterAll(async () => {
    await s?.cerrar()
    mysql?.parar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  // (0) EL ALTA POR EL DIÁLOGO: el puerto de MySQL, la base opcional, «Pegar URI», la ayuda de
  // solo lectura (el servidor abre sus transacciones en solo lectura) y el certificado autofirmado.
  test('(0) alta por el diálogo, con la URI y «Confiar en el certificado y probar»', async () => {
    const ventana = s!.ventana
    const p = mysql!
    await aLaVista(ventana)
    await ventana.locator('.activity-item[title="Bases de datos"]').click()
    await expect(ventana.locator('.db-area:not(.hidden)')).toBeVisible()
    await ventana.locator('.db-arbol button[aria-label="Nueva conexión"]').first().click()
    const d = ventana.locator('.db-conexion-modal')
    await expect(d).toBeVisible()
    await d.locator('.dbc-motor-control select').selectOption('mysql')
    await expect(d.locator('[data-campo="port"]'), 'el puerto de MySQL').toHaveValue('3306')
    await expect(d.locator('[data-campo="database"]')).toHaveAttribute('placeholder', /opcional/)
    await expect(d.locator('[data-campo="instancia"]')).toHaveCount(0)
    await expect(d.getByRole('switch', { name: 'Cifrar la conexión (TLS)' })).toHaveAttribute('aria-checked', 'false')
    await expect(d).toContainText('el servidor abre sus transacciones en solo lectura')
    await expect(d).toContainText('Usted no tiene esa limitación')

    await d.locator('[data-campo="alias"]').fill(ALIAS)
    await d.locator('[data-campo="host"]').fill(p.host)
    await d.locator('[data-campo="port"]').fill(String(p.port))
    await d.locator('[data-campo="user"]').fill('tessera')
    await d.locator('.dbc-pass input').fill(p.contrasena)
    await d.getByRole('switch', { name: 'Solo lectura para los agentes (recomendado)' }).click()
    // Cifrar y verificar: el certificado del contenedor es autofirmado → falla y lo dice.
    await d.getByRole('switch', { name: 'Cifrar la conexión (TLS)' }).click()
    await d.getByRole('button', { name: 'Guardar y probar' }).click()
    const prueba = d.locator('.dbc-prueba')
    await expect(prueba).toHaveClass(/\bfalla\b/, { timeout: 60_000 })
    await expect(prueba).toContainText('"Confiar en el certificado del servidor"')
    await d.getByRole('button', { name: 'Confiar en el certificado y probar' }).click()
    await expect(prueba).toHaveClass(/\bok\b/, { timeout: 60_000 })
    const c = await conexionPorAlias(ventana, ALIAS)
    expect(c?.tls, 'la casilla se guardó').toEqual({ cifrar: true, confiarCertificado: true })
    expect(c?.database ?? '', 'sin base').toBe('')
    await d.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(d).toHaveCount(0)
    await expect(fila(ventana, 'conexion', ALIAS)).toHaveCount(1)
  })

  // (1) EL ÁRBOL: las bases son los esquemas, con su «N de M»; de partida, la primera que no es
  // del sistema. Bajo una base, las carpetas de MySQL (con «eventos»).
  test('(1) árbol: las bases como esquemas, con sus carpetas', async () => {
    const ventana = s!.ventana
    const conexion = fila(ventana, 'conexion', ALIAS)
    await desplegar(conexion)
    const insignia = conexion.locator('.db-insignia-esquemas')
    // M depende de las bases del sistema que el usuario ve (information_schema siempre).
    await expect(insignia).toHaveText(/^1 de \d+$/, { timeout: 60_000 })
    const m = ((await insignia.textContent()) ?? '').split(' de ')[1]
    await expect(fila(ventana, 'esquema', 'pruebas')).toHaveCount(1)
    await expect(fila(ventana, 'esquema', 'ventas')).toHaveCount(0)
    await insignia.click()
    const emergente = ventana.locator('.db-esquemas-pop')
    await expect(emergente).toBeVisible()
    await emergente.locator('.db-pop-fila').filter({ has: ventana.locator('.db-pop-nombre', { hasText: /^ventas$/ }) }).click()
    await expect(emergente.locator('.db-pop-cuenta')).toHaveText(`2 de ${m}`)
    await ventana.keyboard.press('Enter')
    await expect(emergente).toHaveCount(0)
    await expect(fila(ventana, 'esquema', 'ventas')).toHaveCount(1)
    const base = fila(ventana, 'esquema', 'pruebas')
    await desplegar(base)
    const tablas = await filaTras(ventana, base, 'carpeta', 'mysql-tablas', 'tablas')
    await filaTras(ventana, base, 'carpeta', 'mysql-rutinas', 'rutinas')
    await desplegar(tablas)
    await filaTras(ventana, tablas, 'objeto', 'mysql-t', 't')
  })

  // (2) ABRIR UNA TABLA: la pestaña y sus filas.
  test('(2) abrir una tabla', async () => {
    const ventana = s!.ventana
    await ventana.locator('[data-e2e="mysql-t"]').dblclick()
    await expect(ventana.locator(PESTANAS).filter({ hasText: 't' }).filter({ hasText: `[${ALIAS}]` })).toHaveClass(/\bactive\b/)
    await expect(celda(ventana, 0, 1)).toHaveText('Ana', { timeout: 60_000 })
    await expect(celda(ventana, 2, 1)).toHaveText('Eva')
    await expect(ventana.locator(`${PANE} .db-rejilla-cuerpo .db-rejilla-fila`), 'las tres filas').toHaveCount(3)
  })

  // (3) LA CONSOLA: un CALL con dos conjuntos («Resultado 1» y «Resultado 1.2») y `USE` cambia la
  // base que dice la barra.
  test('(3) consola: CALL con dos conjuntos; USE cambia la base', async () => {
    const ventana = s!.ventana
    await fila(ventana, 'conexion', ALIAS).click()
    await abrirConsolaNueva(ventana, `${MOD}+KeyN`)
    await expect(ventana.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Auto')
    await ejecutarTodoSeleccionado(ventana, 'CALL pruebas.dos()')
    await esperarFinEjecucion(ventana)
    await expect(ventana.locator(`${CONSOLA} .db-glifo-error`), 'sin errores').toHaveCount(0)
    const pestanas = ventana.locator(`${CONSOLA} .db-resultados-tabs [role="tab"]`)
    await expect(pestanas).toHaveCount(3, { timeout: 30_000 })
    await expect(pestanas.nth(2)).toContainText('Resultado 1.2')
    const dato = ventana.locator(`${CONSOLA} .db-consola-esquema`)
    await expect(dato).toHaveText('pruebas', { timeout: 15_000 })
    await ejecutarTodoSeleccionado(ventana, 'USE ventas')
    await esperarFinEjecucion(ventana)
    await expect(dato).toHaveText('ventas', { timeout: 15_000 })
    await ejecutarTodoSeleccionado(ventana, 'SELECT importe FROM pedidos')
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0)).toHaveText('99.90')
    await ejecutarTodoSeleccionado(ventana, 'USE pruebas')
    await esperarFinEjecucion(ventana)
    await expect(dato).toHaveText('pruebas', { timeout: 15_000 })
  })

  // (4) Tx MANUAL: el UPDATE queda pendiente (se ve en la MISMA consola) y Rollback lo deshace.
  test('(4) Tx Manual: UPDATE pendiente y Rollback', async () => {
    const ventana = s!.ventana
    const modo = ventana.locator(`${CONSOLA} .db-consola-tx-modo`)
    const barraTx = ventana.locator(`${CONSOLA} .db-consola-tx`)
    await modo.click()
    await expect(ventana.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Manual')
    await ejecutarTodoSeleccionado(ventana, "UPDATE t SET nombre = 'Cambiada' WHERE id = 1")
    await esperarFinEjecucion(ventana)
    await expect(barraTx).toContainText('Tx pendiente', { timeout: 15_000 })
    await ejecutarTodoSeleccionado(ventana, 'SELECT nombre FROM t WHERE id = 1')
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0)).toHaveText('Cambiada')
    await ventana.locator(`${CONSOLA} button.db-consola-rollback`).click()
    await expect(barraTx).toHaveCount(0, { timeout: 15_000 })
    await ejecutarTodoSeleccionado(ventana, 'SELECT nombre FROM t WHERE id = 1')
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0), 'tras Rollback, como estaba').toHaveText('Ana')
    expect(mysql!.sql('SELECT nombre FROM pruebas.t WHERE id = 1;').out, 'el servidor no vio el cambio').toContain('Ana')
  })

  // (5) «SOLO LECTURA PARA LOS AGENTES»: la casilla limita a `tdb`, no al usuario.
  test('(5) con «Solo lectura para los agentes», el INSERT del usuario entra', async () => {
    const ventana = s!.ventana
    const p = mysql!
    const creada = await ventana.evaluate(
      (c) =>
        window.tessera.db.crearConexion({
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
      { alias: ALIAS_FIJA, host: p.host, port: p.port, password: p.contrasena }
    )
    expect(creada.tieneSecreto).toBe(true)
    await expect(fila(ventana, 'conexion', ALIAS_FIJA)).toHaveCount(1)
    await fila(ventana, 'conexion', ALIAS_FIJA).click()
    await abrirConsolaNueva(ventana, `${MOD}+KeyN`)
    await expect(ventana.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Solo lectura (agentes)')
    await ejecutarTodoSeleccionado(ventana, "INSERT INTO t VALUES (4, 'Del usuario')")
    await esperarFinEjecucion(ventana)
    await expect(ventana.locator(`${CONSOLA} .db-glifo-error`), 'la escritura NO se rechaza').toHaveCount(0)
    expect(p.sql('SELECT COUNT(*) FROM pruebas.t;').out.trim(), 'el servidor la ve').toBe('4')
    await ejecutarTodoSeleccionado(ventana, 'DELETE FROM t WHERE id = 4')
    await esperarFinEjecucion(ventana)
    expect(p.sql('SELECT COUNT(*) FROM pruebas.t;').out.trim()).toBe('3')
  })
})
