// =============================================================================
// SQL Server en la interfaz, sobre la app empaquetada y contra un SQL Server de Docker
// propio (`pruebas-mssql-e2e-<azar>`, puerto elegido por Docker, contraseña al azar): el
// alta con «Confiar en el certificado» autofirmado, el árbol con y sin base fija (nivel
// «Bases» y `FIJAR_BASES`), abrir una tabla, un lote T-SQL con dos conjuntos y un PRINT,
// `USE`, Tx Manual, la casilla de solo lectura (limita a `tdb`, no al usuario) y un bloqueo
// con «Leer sin esperar». Sin Docker o sin la imagen se salta (2,3 GB; no se descarga).
// La imagen es x86-64: en Apple Silicon corre con Rosetta (`TESSERA_E2E_MSSQL_IMAGEN`
// fija otra etiqueta si hace falta). En serie y compartiendo app.
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
  verSalida,
  abrirConsolaNueva
} from './consolaAyudas'
import { esperarConsolaLista } from './monaco'
import { celda, PANE } from './rejillaAyudas'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const PERFIL = 'personal'
/** La conexión SIN base fija (nivel «Bases»), de escritura: la del diálogo. */
const ALIAS = 'MSSQL-E2E'
/** La conexión CON base fija, de solo lectura: por la API del preload. */
const ALIAS_FIJA = 'MSSQL-FIJA'

/** La imagen (la de `recrear-mssql.sh` de las pruebas del paso). */
const IMAGEN = process.env.TESSERA_E2E_MSSQL_IMAGEN || 'mcr.microsoft.com/mssql/server:2022-latest'
/** Donde la imagen de 2022 trae `sqlcmd` (mssql-tools18: `-C` confía en el certificado propio). */
const SQLCMD = '/opt/mssql-tools18/bin/sqlcmd'

interface SqlServerEfimero {
  host: string
  port: number
  /** La del login `tessera` (y la de `sa`, que solo usa la siembra). */
  password: string
  contenedor: string
  /** Un lote por `sqlcmd` DENTRO del contenedor, como `sa`: otra sesión, ajena a Tessera. */
  sql: (lote: string) => { ok: boolean; out: string; err: string }
  parar: () => void
}

type Arranque = { ok: true; ms: SqlServerEfimero } | { ok: false; motivo: string; fallo: boolean }

function docker(args: string[], input?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', input, windowsHide: true, timeout: 120_000 })
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || String(r.error ?? '')).trim() }
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Dos bases con una tabla cada una y un login `tessera` (dueño de las dos, con `pruebas`
 * como base por defecto: es la que el árbol enseña de partida). `master`, `model`, `msdb` y
 * `tempdb` completan las SEIS del «N de M».
 */
function siembra(password: string): string {
  return [
    'CREATE DATABASE pruebas;',
    'GO',
    'CREATE DATABASE ventas;',
    'GO',
    'USE pruebas;',
    'CREATE TABLE dbo.t (id int PRIMARY KEY, nombre nvarchar(50) NOT NULL);',
    "INSERT INTO dbo.t VALUES (1, N'Ana'), (2, N'Luis'), (3, N'Eva');",
    'GO',
    'USE ventas;',
    'CREATE TABLE dbo.pedidos (id int PRIMARY KEY, importe decimal(10,2));',
    'INSERT INTO dbo.pedidos VALUES (10, 99.90);',
    'GO',
    `CREATE LOGIN tessera WITH PASSWORD = '${password}', CHECK_POLICY = OFF, DEFAULT_DATABASE = pruebas;`,
    'GO',
    'USE pruebas; CREATE USER tessera FOR LOGIN tessera; ALTER ROLE db_owner ADD MEMBER tessera;',
    'GO',
    'USE ventas; CREATE USER tessera FOR LOGIN tessera; ALTER ROLE db_owner ADD MEMBER tessera;',
    'GO',
    ''
  ].join('\n')
}

async function arrancarSqlServer(): Promise<Arranque> {
  if (!docker(['version', '--format', '{{.Server.Version}}']).ok) {
    return { ok: false, fallo: false, motivo: 'Docker no responde (¿Docker Desktop apagado?)' }
  }
  if (!docker(['image', 'inspect', IMAGEN]).ok) {
    return { ok: false, fallo: false, motivo: `falta la imagen ${IMAGEN} (docker pull ${IMAGEN})` }
  }
  // Mayúscula, minúscula, dígito y símbolo: la política de `sa` del instalador.
  const password = `Aa1!${randomBytes(10).toString('hex')}`
  const contenedor = `pruebas-mssql-e2e-${randomBytes(4).toString('hex')}`
  const run = docker([
    'run',
    '-d',
    '--rm',
    '--name',
    contenedor,
    '--platform',
    'linux/amd64',
    '-e',
    'ACCEPT_EULA=Y',
    '-e',
    `MSSQL_SA_PASSWORD=${password}`,
    '-p',
    '127.0.0.1::1433',
    IMAGEN
  ])
  if (!run.ok) return { ok: false, fallo: false, motivo: `no se pudo arrancar el contenedor: ${run.err}` }
  let borrado = false
  const parar = (): void => {
    if (borrado) return
    borrado = true
    docker(['rm', '-f', '-v', contenedor])
  }
  // Red de seguridad: un worker de Playwright que muere a medias no llega al `afterAll`.
  process.once('exit', parar)

  const puertoTexto = docker(['port', contenedor, '1433/tcp']).out.split('\n')[0] || ''
  const port = Number(puertoTexto.slice(puertoTexto.lastIndexOf(':') + 1))
  if (!Number.isInteger(port) || port <= 0) {
    parar()
    return { ok: false, fallo: false, motivo: `Docker no publicó el puerto (${puertoTexto || 'vacío'})` }
  }
  // La clave viaja por el ENTORNO de `docker exec` (SQLCMDPASSWORD), no por la línea de
  // órdenes de sqlcmd; el lote, por stdin.
  const sql = (lote: string): { ok: boolean; out: string; err: string } =>
    docker(['exec', '-i', '-e', `SQLCMDPASSWORD=${password}`, contenedor, SQLCMD, '-C', '-S', 'localhost', '-U', 'sa', '-b', '-h', '-1', '-W'], lote)
  let listo = false
  for (let i = 0; i < 180 && !listo; i++) {
    listo = sql('SELECT 1;\nGO\n').ok
    if (!listo) await dormir(1_000)
  }
  if (!listo) {
    parar()
    return { ok: false, fallo: false, motivo: 'SQL Server no aceptó conexiones en 180 s' }
  }
  const s = sql(siembra(password))
  if (!s.ok) {
    parar()
    return { ok: false, fallo: true, motivo: `la siembra falló: ${s.err || s.out}` }
  }
  return { ok: true, ms: { host: '127.0.0.1', port, password, contenedor, sql, parar } }
}

test.describe.configure({ mode: 'serial' })

/** La conexión del perfil por su alias, leída del main. */
async function conexionPorAlias(
  win: Page,
  alias: string
): Promise<{ id: string; readonly: boolean; tls?: { cifrar: boolean; confiarCertificado: boolean }; database?: string } | null> {
  return win.evaluate(
    async (a) => {
      const c = (await window.tessera.db.list(a.perfil)).find((x) => x.alias === a.alias)
      return c ? { id: c.id, readonly: c.readonly, tls: c.tls, database: c.database } : null
    },
    { perfil: PERFIL, alias }
  )
}

test.describe('explorador de BD: SQL Server', () => {
  let s: SesionTessera | null = null
  let ms: SqlServerEfimero | null = null
  let falso: AgenteFalso | null = null
  let motivoSalto: string | null = null

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    const r = await arrancarSqlServer()
    if (!r.ok) {
      if (r.fallo) throw new Error(r.motivo)
      motivoSalto = `sin SQL Server de pruebas: ${r.motivo}`
      return
    }
    ms = r.ms
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
                openProjects: [{ projectHostPath: proyecto, name: 'proyecto-sqlserver', estado: 'active' }],
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
    ms?.parar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  // (0) EL ALTA POR EL DIÁLOGO. Los campos propios de SQL Server, el dominio que solo sale
  // con cuenta de dominio, la ayuda de solo lectura que no promete lo del servidor, y la
  // prueba contra el certificado autofirmado del contenedor.
  test('(0) alta por el diálogo y «Confiar en el certificado y probar»', async () => {
    const win = s!.win
    const p = ms!
    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    await win.locator('.db-arbol button[aria-label="Nueva conexión"]').first().click()
    const d = win.locator('.db-conexion-modal')
    await expect(d).toBeVisible()
    await d.locator('.dbc-motor-control select').selectOption('sqlserver')
    await expect(d.locator('[data-campo="port"]'), 'el puerto de SQL Server').toHaveValue('1433')
    await expect(d.locator('[data-campo="instancia"]')).toBeVisible()
    await expect(d.locator('[data-campo="database"]')).toHaveAttribute('placeholder', /opcional/)
    // El dominio solo con cuenta de dominio.
    await expect(d.locator('[data-campo="dominio"]')).toHaveCount(0)
    await d.locator('select[data-campo="autenticacion"]').selectOption('ntlm')
    await expect(d.locator('[data-campo="dominio"]')).toBeVisible()
    await d.locator('select[data-campo="autenticacion"]').selectOption('sql')
    await expect(d.locator('[data-campo="dominio"]')).toHaveCount(0)
    // El cifrado: cifrar y verificar por defecto.
    await expect(d.getByLabel('Cifrar la conexión')).toBeChecked()
    const confiar = d.getByLabel('Confiar en el certificado del servidor')
    await expect(confiar).not.toBeChecked()
    // Solo lectura PARA LOS AGENTES: aquí lo impone Tessera (tdb), no el servidor.
    await expect(d).toContainText('aquí el solo lectura lo impone Tessera; para garantía, un usuario con db_datareader')
    await expect(d).toContainText('tú no quedas limitado')

    await d.locator('[data-campo="alias"]').fill(ALIAS)
    await d.locator('[data-campo="host"]').fill(p.host)
    await d.locator('[data-campo="port"]').fill(String(p.port))
    await d.locator('[data-campo="user"]').fill('tessera')
    await d.locator('.dbc-pass input').fill(p.password)
    // Sin la casilla de los agentes; la que la lleva es la fija.
    await d.getByLabel('Solo lectura para los agentes (recomendado)').uncheck()

    // «Guardar y probar»: el certificado del contenedor es autofirmado → falla y lo dice.
    await d.getByRole('button', { name: 'Guardar y probar' }).click()
    const prueba = d.locator('.dbc-prueba')
    await expect(prueba).toHaveClass(/\bfalla\b/, { timeout: 60_000 })
    await expect(prueba).toContainText('«Confiar en el certificado del servidor»')
    await d.getByRole('button', { name: 'Confiar en el certificado y probar' }).click()
    await expect(prueba).toHaveClass(/\bok\b/, { timeout: 60_000 })
    await expect(confiar).toBeChecked()
    const c = await conexionPorAlias(win, ALIAS)
    expect(c?.tls, 'la casilla se guardó').toEqual({ cifrar: true, confiarCertificado: true })
    expect(c?.database ?? '', 'sin base fija').toBe('')
    await d.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(d).toHaveCount(0)
    await expect(fila(win, 'conexion', ALIAS)).toHaveCount(1)
  })

  // (1) EL ÁRBOL SIN BASE FIJA: el nivel «Bases». De partida se ve la base por defecto del
  // login (pruebas) de las seis del servidor; el popover hace visible `ventas`.
  test('(1) árbol sin base fija: nivel «Bases» con su «N de M»', async () => {
    const win = s!.win
    const conexion = fila(win, 'conexion', ALIAS)
    await desplegar(conexion)
    const insignia = conexion.locator('.db-insignia-esquemas')
    await expect(insignia).toHaveText('1 de 6', { timeout: 60_000 })
    await expect(insignia).toHaveAttribute('aria-label', /^Bases visibles/)
    await expect(fila(win, 'base', 'pruebas')).toHaveCount(1)
    await expect(fila(win, 'base', 'ventas')).toHaveCount(0)
    await insignia.click()
    const pop = win.locator('.db-esquemas-pop')
    await expect(pop).toBeVisible()
    await expect(pop.locator('.db-pop-cabecera')).toContainText('Bases de')
    await pop
      .locator('.db-pop-fila')
      .filter({ has: win.locator('.db-pop-nombre', { hasText: /^ventas$/ }) })
      .click()
    await expect(pop.locator('.db-pop-cuenta')).toHaveText('2 de 6')
    await win.keyboard.press('Enter')
    await expect(pop).toHaveCount(0)
    await expect(insignia).toHaveText('2 de 6')
    await expect(fila(win, 'base', 'ventas')).toHaveCount(1)
    // Base → esquema → carpeta → tabla.
    const base = fila(win, 'base', 'pruebas')
    await desplegar(base)
    const dbo = await filaTras(win, base, 'esquema', 'mssql-dbo', 'dbo')
    await desplegar(dbo)
    const tablas = await filaTras(win, dbo, 'carpeta', 'mssql-tablas', 'tablas')
    await desplegar(tablas)
    await filaTras(win, tablas, 'objeto', 'mssql-t', 't')
  })

  // (2) ABRIR UNA TABLA de la base: la pestaña (con la base dentro) y sus filas.
  test('(2) abrir una tabla de una base', async () => {
    const win = s!.win
    await win.locator('[data-e2e="mssql-t"]').dblclick()
    await expect(win.locator(PESTANAS).filter({ hasText: 't' }).filter({ hasText: `[${ALIAS}]` })).toHaveClass(/\bactive\b/)
    await expect(celda(win, 0, 1)).toHaveText('Ana', { timeout: 60_000 })
    await expect(celda(win, 2, 1)).toHaveText('Eva')
    await expect(win.locator(`${PANE} .db-rejilla-cuerpo .db-rejilla-fila`), 'las tres filas').toHaveCount(3)
  })

  // (3) EL ÁRBOL CON BASE FIJA: como el de PG (esquemas directamente, sin nivel «Bases»).
  test('(3) árbol con base fija: sin nivel «Bases»', async () => {
    const win = s!.win
    const p = ms!
    const creada = await win.evaluate(
      (c) =>
        window.tessera.db.create({
          profileId: 'personal',
          alias: c.alias,
          motor: 'sqlserver',
          host: c.host,
          port: c.port,
          database: 'pruebas',
          user: 'tessera',
          password: c.password,
          readonly: true,
          autenticacion: 'sql',
          tls: { cifrar: true, confiarCertificado: true }
        }),
      { alias: ALIAS_FIJA, host: p.host, port: p.port, password: p.password }
    )
    expect(creada.tieneSecreto).toBe(true)
    const conexion = fila(win, 'conexion', ALIAS_FIJA)
    await expect(conexion).toHaveCount(1)
    await desplegar(conexion)
    const dbo = await filaTras(win, conexion, 'esquema', 'fija-dbo', 'dbo')
    // Lo que cuelga de la fija es el esquema, sin una fila de base en medio.
    const tiposBajo = await conexion.evaluate((el) => {
      const filas = Array.from(document.querySelectorAll('.db-arbol .db-fila'))
      const out: string[] = []
      for (const f of filas.slice(filas.indexOf(el) + 1)) {
        const t = f.getAttribute('data-tipo') ?? ''
        if (t === 'conexion') break
        out.push(t)
      }
      return out
    })
    expect(tiposBajo, 'sin nivel «Bases» en la fija').not.toContain('base')
    expect(tiposBajo[0]).toBe('esquema')
    await desplegar(dbo)
    const tablas = await filaTras(win, dbo, 'carpeta', 'fija-tablas', 'tablas')
    await desplegar(tablas)
    await filaTras(win, tablas, 'objeto', 'fija-t', 't')
  })

  // (4) LA CONSOLA: un lote con alcance de lote (DECLARE) trae DOS conjuntos y un PRINT en
  // UNA sentencia: dos pestañas («Resultado 1» y «Resultado 1.2») y el PRINT en la Salida.
  // Y `USE` cambia la base que dice la barra.
  test('(4) consola: dos conjuntos y un PRINT; USE cambia la base', async () => {
    const win = s!.win
    await fila(win, 'conexion', ALIAS).click()
    await abrirConsolaNueva(win, `${MOD}+KeyN`)
    const barra = win.locator(`${CONSOLA} .db-consola-barra`)
    await expect(barra).toContainText('Tx: Auto')
    await ejecutarTodoSeleccionado(win, "DECLARE @x int = 1;\nSELECT @x AS a;\nSELECT @x + 1 AS b;\nPRINT 'hola desde T-SQL';")
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-glifo-error`), 'sin errores').toHaveCount(0)
    const tabs = win.locator(`${CONSOLA} .db-resultados-tabs [role="tab"]`)
    await expect(tabs).toHaveCount(3, { timeout: 30_000 })
    await expect(tabs.nth(1)).toContainText('Resultado 1')
    await expect(tabs.nth(2)).toContainText('Resultado 1.2')
    await expect(celdaResultado(win, 0, 0), 'la subpestaña activa es la del segundo conjunto').toHaveText('2')
    const salida = await verSalida(win)
    await expect(salida.locator('.db-salida-fila', { hasText: 'hola desde T-SQL' })).toHaveCount(1)
    // USE: la barra dice la base nueva, y lo siguiente corre en ella.
    const dato = win.locator(`${CONSOLA} .db-consola-esquema`)
    await expect(dato).toHaveText('pruebas', { timeout: 15_000 })
    await ejecutarTodoSeleccionado(win, 'USE ventas')
    await esperarFinEjecucion(win)
    await expect(dato).toHaveText('ventas', { timeout: 15_000 })
    await ejecutarTodoSeleccionado(win, 'SELECT importe FROM dbo.pedidos')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0)).toHaveText('99.90')
    await ejecutarTodoSeleccionado(win, 'USE pruebas')
    await esperarFinEjecucion(win)
    await expect(dato).toHaveText('pruebas', { timeout: 15_000 })
  })

  // (5) Tx MANUAL: el UPDATE queda pendiente (se ve en la MISMA consola) y Rollback lo
  // deshace.
  test('(5) Tx Manual: UPDATE pendiente y Rollback', async () => {
    const win = s!.win
    const modo = win.locator(`${CONSOLA} .db-consola-tx-modo`)
    const barraTx = win.locator(`${CONSOLA} .db-consola-tx`)
    await modo.click()
    await expect(modo).toHaveAttribute('aria-pressed', 'true')
    await expect(win.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Manual')
    await ejecutarTodoSeleccionado(win, "UPDATE dbo.t SET nombre = N'Cambiada' WHERE id = 1")
    await esperarFinEjecucion(win)
    await expect(barraTx).toContainText('Tx pendiente', { timeout: 15_000 })
    await ejecutarTodoSeleccionado(win, 'SELECT nombre FROM dbo.t WHERE id = 1')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0)).toHaveText('Cambiada')
    await win.locator(`${CONSOLA} button.db-consola-rollback`).click()
    await expect(barraTx).toHaveCount(0, { timeout: 15_000 })
    await ejecutarTodoSeleccionado(win, 'SELECT nombre FROM dbo.t WHERE id = 1')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0), 'tras Rollback, como estaba').toHaveText('Ana')
    expect(ms!.sql("SELECT nombre FROM pruebas.dbo.t WHERE id = 1;\nGO\n").out, 'el servidor no vio el cambio').toContain('Ana')
  })

  // (6) «SOLO LECTURA PARA LOS AGENTES» (la fija): la casilla limita a `tdb`,
  // no al usuario. La barra lo INFORMA («RO agentes») y un INSERT desde la consola entra; se
  // borra después para dejar la tabla con sus tres filas.
  test('(6) con «Solo lectura para los agentes», el INSERT del usuario entra', async () => {
    const win = s!.win
    await fila(win, 'conexion', ALIAS_FIJA).click()
    await abrirConsolaNueva(win, `${MOD}+KeyN`)
    await expect(win.locator(`${CONSOLA} .db-consola-barra`)).toContainText('RO agentes')
    await ejecutarTodoSeleccionado(win, "INSERT INTO dbo.t VALUES (4, N'Del usuario')")
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-glifo-error`), 'la escritura NO se rechaza').toHaveCount(0)
    expect(ms!.sql('SELECT COUNT(*) FROM pruebas.dbo.t;\nGO\n').out.trim(), 'el servidor la ve').toContain('4')
    await ejecutarTodoSeleccionado(win, 'DELETE FROM dbo.t WHERE id = 4')
    await esperarFinEjecucion(win)
    await ejecutarTodoSeleccionado(win, 'SELECT COUNT(*) FROM dbo.t')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 0), 'y vuelve a sus tres filas').toHaveText('3')
  })

  // (7) UN BLOQUEO NO CUELGA LA PESTAÑA. Con un UPDATE sin confirmar en la consola de la
  // conexión de escritura, refrescar la pestaña de `t` espera el tope (LOCK_TIMEOUT) y
  // enseña el aviso con «Reintentar» y «Leer sin esperar»; leer sin esperar enseña lo NO
  // confirmado, con su marca en la barra. Rollback al final.
  test('(7) bloqueo: «Leer sin esperar» enseña lo no confirmado', async () => {
    test.setTimeout(120_000)
    const win = s!.win
    // La consola de la conexión de escritura (sigue en Tx Manual).
    await win.locator(PESTANAS).filter({ hasText: 'consola' }).filter({ hasText: `[${ALIAS}]` }).first().click()
    await esperarConsolaLista(win)
    await ejecutarTodoSeleccionado(win, "UPDATE dbo.t SET nombre = N'Sin confirmar' WHERE id = 2")
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-consola-tx`)).toContainText('Tx pendiente', { timeout: 15_000 })
    // La pestaña de la tabla: refrescar la lee otra sesión, que choca con el bloqueo.
    await win.locator(PESTANAS).filter({ hasText: `[${ALIAS}]` }).filter({ hasNotText: 'consola' }).first().click()
    await win.locator(`${PANE} button[aria-label="Refrescar"]`).first().click()
    const aviso = win.locator(`${PANE} .db-datos-aviso`)
    await expect(aviso).toContainText('bloqueada', { timeout: 60_000 })
    await expect(aviso.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await aviso.getByRole('button', { name: 'Leer sin esperar' }).click()
    await expect(celda(win, 1, 1), 'se ve lo no confirmado').toHaveText('Sin confirmar', { timeout: 30_000 })
    await expect(win.locator(`${PANE} .db-barra`)).toContainText('leída sin esperar')
    // Deshacer en la consola.
    await win.locator(PESTANAS).filter({ hasText: 'consola' }).filter({ hasText: `[${ALIAS}]` }).first().click()
    await win.locator(`${CONSOLA} button.db-consola-rollback`).click()
    await expect(win.locator(`${CONSOLA} .db-consola-tx`)).toHaveCount(0, { timeout: 15_000 })
  })
})
