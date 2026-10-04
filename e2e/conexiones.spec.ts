// =============================================================================
// El explorador de bases de datos (vista «Conexiones») sobre la app empaquetada y contra
// un PostgreSQL de `postgresEfimero.ts`: el proceso de sesión por `fork` del paquete, el
// layout de la consola y el agente, el teclado, Monaco (glifos, subrayado, sugerencias),
// la pestaña de datos, el agente de datos (falso: `agenteFalso.ts`) y el cierre de la app
// con una transacción pendiente. En serie y compartiendo app: cada prueba parte de lo que
// dejó la anterior y recoge lo que abre (el árbol es virtual). Con `TESSERA_E2E_CAPTURAS`
// deja un PNG por estado. Acordes por `MOD` y `ACORDE_AGENTE`; en Mac, SIN VERIFICAR.
// Decisiones: docs/decisiones/pruebas/que-va-en-e2e-y-que-en-test-mts.md
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, vivo, type AgenteFalso } from './agenteFalso'
import { esperarConsolaLista, HOST_FUENTE, monacoConsola, monacoEn } from './monaco'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, PLATAFORMA, type SesionTessera } from './tessera'

const ALIAS = 'PG-E2E'
/** Mostrar/ocultar el agente de datos: Ctrl+Alt+B aquí, ⌥⌘B en Mac (`esAlternarAgente`). */
const ACORDE_AGENTE = PLATAFORMA === 'mac' ? 'Meta+Alt+KeyB' : 'Control+Alt+KeyB'
/** Carpeta de las capturas de revisión, o null para no capturar (ver la cabecera). */
const DIR_CAPTURAS = process.env.TESSERA_E2E_CAPTURAS ?? null

test.describe.configure({ mode: 'serial' })

/** Deja que React confirme el render provocado por el gesto (ver `atajos.spec.ts`). */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

async function capturar(win: Page, nombre: string): Promise<void> {
  if (DIR_CAPTURAS === null) return
  mkdirSync(DIR_CAPTURAS, { recursive: true })
  // Los avisos de la app (la novedad del menú contextual del sistema, por ejemplo)
  // no son del explorador y taparían la esquina de la captura: se descartan.
  for (const cerrar of await win.locator('.toast-close').all()) await cerrar.click().catch(() => {})
  // Las transiciones de la interfaz (el giro del chevron, el fundido de un aviso) duran
  // ~150 ms: sin esperarlas, la captura sale a medio giro y parece un glifo roto.
  await win.waitForTimeout(250)
  await asentar(win)
  await win.screenshot({ path: join(DIR_CAPTURAS, `${nombre}.png`) })
}

/**
 * El botón de una vista en el riel, por su `title`. No por `aria-label`: el de Git
 * lleva pegado el número de cambios («Git · Cambios, 1 cambios sin confirmar»).
 */
function botonVista(win: Page, titulo: 'Archivos' | 'Git · Cambios' | 'Conexiones a bases de datos'): Locator {
  return win.locator(`.activity-item[title="${titulo}"]`)
}

/** La ventana está a la vista: sin esto, `getBoundingClientRect` y los clics mienten. */
async function aLaVista(win: Page): Promise<void> {
  await expect.poll(() => win.evaluate(() => document.visibilityState)).toBe('visible')
}

/** Caja de un elemento en px CSS, o null si no está. */
async function caja(loc: Locator): Promise<{ x: number; y: number; w: number; h: number; right: number; bottom: number } | null> {
  if ((await loc.count()) === 0) return null
  return loc.first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }
  })
}

/**
 * ¿Lo que se PINTA en el centro de ese elemento es él (o algo suyo)? Es la diferencia
 * entre «existe y tiene caja» y «el usuario lo ve»: un hermano encima, un `z-index`
 * o un pane oculto que no lo está lo delatan aquí.
 */
async function seVeEnSuCentro(loc: Locator): Promise<boolean> {
  return loc.first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    const arriba = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return arriba !== null && (arriba === el || el.contains(arriba))
  })
}

/** Una fila del árbol por su tipo y su nombre EXACTO (el `textContent` lleva metadatos pegados). */
function fila(win: Page, tipo: string, nombre: string): Locator {
  return win
    .locator(`.db-arbol .db-fila-${tipo}`)
    .filter({ has: win.locator('.db-fila-nombre', { hasText: new RegExp(`^${nombre}$`) }) })
}

/**
 * La primera fila de ese tipo (y, si se da, de ese NOMBRE) que cuelga de `ancla` en el
 * árbol: p. ej. la carpeta «tablas» de un esquema, que se llama igual en todos. Se
 * marca con un `data-*` y se devuelve el localizador de la marca: la clave de React es
 * estable, así que el nodo (y la marca) sobreviven a los repintados de la lista
 * virtual. Espera a que exista: los hijos llegan cuando responde el catálogo.
 *
 * SÓLO DENTRO DEL SUBÁRBOL DEL ANCLA: la búsqueda se corta en la siguiente fila del
 * mismo tipo que el ancla (el esquema de al lado, la tabla siguiente). Sin ese corte,
 * pedir las «tablas» de un esquema recién desplegado, antes de que llegaran sus
 * hijos, devolvía las del esquema SIGUIENTE, y la prueba seguía por la rama ajena.
 */
async function filaTras(win: Page, ancla: Locator, tipo: string, marca: string, nombre?: string): Promise<Locator> {
  await expect
    .poll(
      () =>
        ancla.first().evaluate(
          (el, a) => {
            // En orden de DOCUMENTO y no por hermanos: la lista virtual envuelve cada
            // fila en su propia caja posicionada.
            const filas = Array.from(document.querySelectorAll('.db-arbol .db-fila'))
            const desde = filas.indexOf(el)
            if (desde < 0) return false
            const tipoAncla = el.getAttribute('data-tipo')
            for (const f of filas.slice(desde + 1)) {
              if (f.getAttribute('data-tipo') === tipoAncla) return false
              if (!f.classList.contains(`db-fila-${a.tipo}`)) continue
              if (a.nombre !== null && f.querySelector('.db-fila-nombre')?.textContent !== a.nombre) continue
              f.setAttribute('data-e2e', a.marca)
              return true
            }
            return false
          },
          { tipo, marca, nombre: nombre ?? null }
        ),
      { timeout: 15_000, message: `no aparece una fila ${tipo}${nombre ? ` «${nombre}»` : ''} bajo el ancla` }
    )
    .toBe(true)
  return win.locator(`[data-e2e="${marca}"]`)
}

/** ¿La fila está desplegada? Lo dice el giro de su chevron. */
async function desplegada(f: Locator): Promise<boolean> {
  return f.locator('.db-chevron svg').first().evaluate((s) => s.classList.contains('open')).catch(() => false)
}

/** Despliega una fila por su chevron, sólo si está plegada (el chevron es un toggle). */
async function desplegar(f: Locator): Promise<void> {
  await expect(f).toHaveCount(1)
  if (!(await desplegada(f))) await f.locator('.db-chevron').click()
}

/** Pliega una fila por su chevron, sólo si está desplegada. */
async function plegar(f: Locator): Promise<void> {
  await expect(f).toHaveCount(1)
  if (await desplegada(f)) await f.locator('.db-chevron').click()
}

/** Las pestañas de la vista (no las de proyecto ni las de resultados de una consola). */
const PESTANAS = '.db-area:not(.hidden) .db-tabs [role="tab"]'
/** El pane de la pestaña activa. */
const PANE = '.db-area:not(.hidden) .db-pane:not(.hidden)'

/** Una celda de la rejilla del pane activo, por fila y columna de DATOS (desde 0). */
function celda(win: Page, f: number, c: number): Locator {
  // `aria-rowindex` cuenta la cabecera (1) y `aria-colindex` el número de fila (1).
  return win.locator(`${PANE} .db-rejilla-fila[aria-rowindex="${f + 2}"] .db-celda[aria-colindex="${c + 2}"]`)
}

/**
 * Las entradas del menú contextual abierto, en orden y con '—' por separador. Espera
 * a que esté: el menú se monta en el mismo gesto, pero su posición se calcula después.
 */
async function entradasMenu(win: Page): Promise<string[]> {
  const menu = win.locator('.ctx-menu')
  await expect(menu).toBeVisible()
  return menu.evaluate((m) =>
    Array.from(m.children).map((c) => (c.classList.contains('ctx-menu-separator') ? '—' : (c.textContent ?? '').trim()))
  )
}

/**
 * Corre `cuerpo` y DEVUELVE el portapapeles del sistema como estaba: la prueba copia
 * de verdad (es lo que se comprueba) y el portapapeles es de quien corre la suite. Se
 * lee y se escribe por la API de la app (`window.tessera.clipboard`, que sirve el main):
 * es la misma que usa la rejilla para copiar.
 */
async function conPortapapeles(win: Page, cuerpo: () => Promise<void>): Promise<void> {
  const previo = await win.evaluate(() => window.tessera.clipboard.read())
  try {
    await cuerpo()
  } finally {
    await win.evaluate((t) => window.tessera.clipboard.write(t), previo)
  }
}

/** El portapapeles del sistema, con los finales de línea normalizados a `\n`. */
async function leerPortapapeles(win: Page): Promise<string> {
  return (await win.evaluate(() => window.tessera.clipboard.read())).replace(/\r\n/g, '\n')
}

/** La consola visible y sus piezas. */
const CONSOLA = 'section.db-consola:not(.hidden)'

/** Texto de la Salida de la consola visible. */
async function textoSalida(win: Page): Promise<string> {
  return (await win.locator(`${CONSOLA} .db-salida`).textContent()) ?? ''
}

/** Carga un texto en la consola, lo selecciona entero y pulsa ▷ (como el usuario con el ratón). */
async function ejecutarTodoSeleccionado(win: Page, sql: string): Promise<void> {
  await monacoConsola(win, { op: 'fijar', texto: sql })
  await monacoConsola(win, { op: 'seleccionarTodo' })
  await win.locator(`${CONSOLA} .db-consola-run`).click()
}

/** Espera a que la consola visible termine de ejecutar (el botón ■ vuelve a deshabilitarse). */
async function esperarFinEjecucion(win: Page): Promise<void> {
  await expect(win.locator(`${CONSOLA} .db-consola-detener`)).toBeDisabled({ timeout: 30_000 })
}

/**
 * Pids de los procesos de SESIÓN del explorador (el `fork` de `src/tdb/sesion.cjs`) que
 * DESCIENDEN de `raiz`, el proceso que lanzó Playwright. Descienden y no «son hijos»:
 * en Windows `app.process()` no es el main de la app sino el que lo arranca (medido:
 * el main es su hijo, y los trabajadores, nietos). Se reconocen por su línea de
 * órdenes: son el mismo ejecutable que la app (`execPath`), así que el nombre no los
 * distingue. La plataforma decide CÓMO se listan (CIM en Windows, `ps` en Mac); qué
 * se busca es lo mismo en las dos.
 */
function procesosDeSesion(raiz: number): number[] {
  const filas: Array<{ pid: number; ppid: number; orden: string }> = []
  if (PLATAFORMA === 'windows') {
    const consulta = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.CommandLine)" }'
    const r = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', consulta], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000
    })
    for (const l of (r.stdout || '').split(/\r?\n/)) {
      const [pid, ppid, ...resto] = l.split('|')
      if (pid && ppid) filas.push({ pid: Number(pid), ppid: Number(ppid), orden: resto.join('|') })
    }
  } else {
    const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 30_000 })
    for (const l of (r.stdout || '').split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)
      if (m) filas.push({ pid: Number(m[1]), ppid: Number(m[2]), orden: m[3] })
    }
  }
  const descendientes = new Set<number>([raiz])
  for (let crecio = true; crecio; ) {
    crecio = false
    for (const f of filas) {
      if (descendientes.has(f.ppid) && !descendientes.has(f.pid)) {
        descendientes.add(f.pid)
        crecio = true
      }
    }
  }
  return filas.filter((f) => f.pid !== raiz && descendientes.has(f.pid) && /sesion\.cjs/.test(f.orden)).map((f) => f.pid)
}

/** Proyecto de la prueba: un repo git mínimo, para que Archivos y Git tengan algo que enseñar. */
function crearProyecto(raiz: string): string {
  const dir = join(raiz, 'proyecto-bd')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'LEEME.md'), '# proyecto de la prueba del explorador de BD\n')
  writeFileSync(join(dir, 'consulta.sql'), 'select 1;\n')
  const git = (...args: string[]): void => {
    spawnSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@tessera.invalid', ...args], {
      cwd: dir,
      windowsHide: true
    })
  }
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '-m', 'inicio')
  // Un cambio sin commitear, para que la vista de Git no salga vacía.
  writeFileSync(join(dir, 'LEEME.md'), '# proyecto de la prueba del explorador de BD\n\nUn cambio.\n')
  return dir
}

test.describe('explorador de bases de datos', () => {
  let s: SesionTessera | null = null
  let pg: PostgresEfimero | null = null
  let falso: AgenteFalso | null = null
  let rutaProyecto = ''
  let motivoSalto: string | null = null

  test.beforeAll(async () => {
    const r = await arrancarPostgres()
    if (!r.ok) {
      if (r.fallo) throw new Error(r.motivo)
      motivoSalto = `sin PostgreSQL de pruebas: ${r.motivo}`
      return
    }
    pg = r.pg
    const agente = montarAgenteFalso()
    falso = agente
    const proyecto = crearProyecto(agente.raiz)
    rutaProyecto = proyecto
    s = await abrirTessera(agente.env, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: 'personal',
            byProfile: {
              personal: {
                openProjects: [{ projectHostPath: proyecto, name: 'proyecto-bd', estado: 'active' }],
                activePath: proyecto
              }
            },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`] }
          })
        )
      }
    })
    // Ventana de tamaño conocido: las medidas y las capturas dependen de él.
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
    pg?.parar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  test('las vistas de Archivos y Git, de referencia (no las toca el explorador)', async () => {
    const win = s!.win
    await aLaVista(win)
    await botonVista(win, 'Archivos').click()
    await expect(win.locator('.sidebar .tree-row').first()).toBeVisible({ timeout: 30_000 })
    await capturar(win, '00-vista-files')
    await botonVista(win, 'Git · Cambios').click()
    await asentar(win)
    await win.waitForTimeout(1_000)
    await capturar(win, '01-vista-git')
  })

  // (1) CENTRO VACÍO SIN AGENTE. La vista entra con el `EstadoVacio` estándar y SIN la
  // columna del agente: el agente de datos es a demanda. Antes de crear la
  // conexión dice «Sin conexiones»; después, «Ninguna tabla abierta», y el cambio llega
  // por `db.onChanged` sin tocar nada (la suscripción que el panel viejo no tenía).
  test('(1) al entrar, estado vacío en el centro y sin columna del agente', async () => {
    const win = s!.win
    await botonVista(win, 'Conexiones a bases de datos').click()
    const area = win.locator('.db-area:not(.hidden)')
    await expect(area).toBeVisible()
    await expect(area.locator('.pane-empty-title')).toHaveText('Sin conexiones')
    await expect(win.locator('.right-panel')).toBeHidden()
    await expect(win.locator('[role="separator"][aria-label="Redimensionar el agente"]')).toHaveCount(0)
    await expect(win.locator('.db-arbol .sidebar-title')).toHaveText('Bases de datos')
    await aLaVista(win)
    expect(await seVeEnSuCentro(area.locator('.pane-empty')), 'el estado vacío se pinta encima de todo').toBe(true)
    await capturar(win, '02-db-vacia-sin-conexiones')

    // La conexión, por la API del preload y CON contraseña: así la cifra el `Local
    // State` del `userData` temporal, igual que el diálogo.
    const p = pg!
    const creada = await win.evaluate(
      (c) =>
        window.tessera.db.create({
          profileId: 'personal',
          alias: c.alias,
          motor: 'postgres',
          host: c.host,
          port: c.port,
          database: 'postgres',
          user: 'postgres',
          password: c.password,
          readonly: false
        }),
      { alias: ALIAS, host: p.host, port: p.port, password: p.password }
    )
    expect(creada.tieneSecreto, 'la contraseña quedó guardada').toBe(true)
    await expect(fila(win, 'conexion', ALIAS)).toHaveCount(1)
    await expect(area.locator('.pane-empty-title')).toHaveText('Ninguna tabla abierta')
    await expect(win.locator('.right-panel')).toBeHidden()
    await capturar(win, '03-db-vacia-ninguna-tabla')
  })

  // (2) ESQUEMAS «N DE M». Por defecto se ve sólo el esquema actual (public), de los
  // cuatro que hay (public, ventas, information_schema, pg_catalog). Marcar `ventas` en
  // el popover y pulsar Enter aplica y la insignia pasa a «2 de 4».
  test('(2) la insignia dice «1 de 4» y el popover lleva a «2 de 4»', async () => {
    const win = s!.win
    const conexion = fila(win, 'conexion', ALIAS)
    await desplegar(conexion)
    const insignia = conexion.locator('.db-insignia-esquemas')
    await expect(insignia).toHaveText('1 de 4', { timeout: 30_000 })
    await expect(fila(win, 'esquema', 'public')).toHaveCount(1)
    await expect(fila(win, 'esquema', 'ventas')).toHaveCount(0)

    await insignia.click()
    const pop = win.locator('.db-esquemas-pop')
    await expect(pop).toBeVisible()
    await expect(pop.locator('.db-pop-lista .db-pop-fila')).toHaveCount(4, { timeout: 15_000 })
    await capturar(win, '04-popover-esquemas')
    await pop
      .locator('.db-pop-fila')
      .filter({ has: win.locator('.db-pop-nombre', { hasText: /^ventas$/ }) })
      .click()
    await expect(pop.locator('.db-pop-cuenta')).toHaveText('2 de 4')
    await win.keyboard.press('Enter')
    await expect(pop).toHaveCount(0)
    await expect(insignia).toHaveText('2 de 4')
    await expect(fila(win, 'esquema', 'ventas')).toHaveCount(1)
  })

  // (2c) ESC CANCELA, EL CLIC FUERA APLICA. Marcar `information_schema` y pulsar Esc
  // deja la insignia en «2 de 4» y el árbol sin él; marcarlo y pinchar fuera (en la
  // cabecera del árbol) lo aplica. Al final se deja como estaba, con Enter: el esquema
  // del sistema trae decenas de vistas que las pruebas siguientes no esperan.
  test('(2c) en el popover de esquemas Esc cancela y el clic fuera aplica', async () => {
    const win = s!.win
    const insignia = fila(win, 'conexion', ALIAS).locator('.db-insignia-esquemas')
    const pop = win.locator('.db-esquemas-pop')
    const cuenta = pop.locator('.db-pop-cuenta')
    const alternar = async (nombre: string): Promise<void> => {
      await pop
        .locator('.db-pop-fila')
        .filter({ has: win.locator('.db-pop-nombre', { hasText: new RegExp(`^${nombre}$`) }) })
        .click()
    }
    const abrir = async (partida: string): Promise<void> => {
      // El árbol ignora el clic que llega < 300 ms después de cerrarse el popover de
      // esa misma conexión (es el MISMO gesto que lo cerró, si fue sobre la insignia).
      // Una persona no reabre tan rápido; la prueba, sí.
      await win.waitForTimeout(350)
      await insignia.click()
      await expect(pop.locator('.db-pop-lista .db-pop-fila')).toHaveCount(4, { timeout: 15_000 })
      await expect(cuenta, 'el popover parte de lo aplicado').toHaveText(partida)
    }
    await expect(insignia).toHaveText('2 de 4')

    await abrir('2 de 4')
    await alternar('information_schema')
    await expect(cuenta).toHaveText('3 de 4')
    await win.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(insignia, 'Esc no aplicó nada').toHaveText('2 de 4')
    await expect(fila(win, 'esquema', 'information_schema')).toHaveCount(0)

    await abrir('2 de 4')
    await alternar('information_schema')
    await expect(cuenta).toHaveText('3 de 4')
    await win.locator('.db-arbol .sidebar-title').click()
    await expect(pop).toHaveCount(0)
    await expect(insignia, 'el clic fuera aplicó').toHaveText('3 de 4')
    await expect(fila(win, 'esquema', 'information_schema')).toHaveCount(1)

    await abrir('3 de 4')
    await alternar('information_schema')
    await expect(cuenta).toHaveText('2 de 4')
    await win.keyboard.press('Enter')
    await expect(pop).toHaveCount(0)
    await expect(insignia).toHaveText('2 de 4')
    await expect(fila(win, 'esquema', 'information_schema')).toHaveCount(0)
  })

  test('(2b) el diálogo de nueva conexión se abre desde la cabecera y se cierra con Esc', async () => {
    const win = s!.win
    await win.locator('.db-arbol .sidebar-header button[aria-label="Nueva conexión"]').click()
    const dialogo = win.locator('.db-conexion-modal')
    await expect(dialogo).toBeVisible()
    await capturar(win, '05-dialogo-nueva-conexion')
    await win.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
  })

  // (3) DOS TABLAS, DOS PESTAÑAS. Doble clic abre una pestaña FIJA por tabla (no hay
  // efímeras), con el alias de la conexión. La rejilla pinta NULL como `<null>` en
  // cursiva y apagado, y los números a la derecha.
  test('(3) abrir dos tablas da dos pestañas y la rejilla pinta <null> y números', async () => {
    const win = s!.win
    await desplegar(fila(win, 'esquema', 'ventas'))
    // La carpeta «tablas» de `ventas` es la primera que va DETRÁS de su fila.
    const tablas = await filaTras(win, fila(win, 'esquema', 'ventas'), 'carpeta', 'tablas-ventas')
    await expect(tablas.locator('.db-fila-nombre')).toHaveText('tablas')
    await expect(tablas.locator('.db-fila-cuenta')).toHaveText('3')
    await desplegar(tablas)
    await expect(fila(win, 'objeto', 'cliente')).toHaveCount(1, { timeout: 15_000 })
    await fila(win, 'objeto', 'cliente').dblclick()
    await fila(win, 'objeto', 'factura').dblclick()

    const pestanas = win.locator('.db-area:not(.hidden) .db-tabs [role="tab"]')
    await expect(pestanas).toHaveCount(2)
    for (const t of await pestanas.all()) await expect(t).toContainText(`[${ALIAS}]`)
    await expect(pestanas.nth(1)).toHaveClass(/\bactive\b/)

    const rejilla = win.locator('.db-area:not(.hidden) .db-pane:not(.hidden) .db-rejilla')
    const nulo = rejilla.locator('.db-celda-nulo').first()
    await expect(nulo).toHaveText('<null>', { timeout: 30_000 })
    const estilo = await nulo.evaluate((el) => {
      // El color esperado se RESUELVE en el mismo sitio, no se copia el hex del tema.
      const sonda = document.createElement('span')
      sonda.style.color = 'var(--fg-faint)'
      el.parentElement!.appendChild(sonda)
      const esperado = getComputedStyle(sonda).color
      sonda.remove()
      const cs = getComputedStyle(el)
      return { color: cs.color, esperado, cursiva: cs.fontStyle }
    })
    expect(estilo.color, '<null> va en el color apagado').toBe(estilo.esperado)
    expect(estilo.cursiva).toBe('italic')
    const numero = rejilla.locator('.db-celda-num').first()
    await expect(numero).toBeVisible()
    expect(await numero.evaluate((el) => getComputedStyle(el).textAlign)).toBe('right')
    // El ancho INICIAL de cada columna cabe sus valores cortos: «urgente» salía como
    // «urgen…» con media pantalla libre. NO sirve `scrollWidth > clientWidth`: los dos
    // son enteros y el desborde era de 0,7 px (el filete de 1 px que la medida no
    // contaba), así que daba «cabe» con el «…» a la vista. Se compara el ancho REAL
    // del texto (un Range, en px con decimales; el `…` es sólo pintura y no cambia la
    // caja) con el hueco de la celda: su ancho menos padding y bordes.
    const recortadas = await rejilla.evaluate((r) =>
      Array.from(r.querySelectorAll('.db-rejilla-cuerpo .db-celda')).flatMap((c) => {
        const rango = document.createRange()
        rango.selectNodeContents(c)
        const texto = rango.getBoundingClientRect().width
        const cs = getComputedStyle(c)
        const hueco =
          c.getBoundingClientRect().width -
          parseFloat(cs.paddingLeft) -
          parseFloat(cs.paddingRight) -
          parseFloat(cs.borderLeftWidth) -
          parseFloat(cs.borderRightWidth)
        return texto > hueco + 0.01 ? [`${c.textContent}: texto ${texto.toFixed(2)} px > hueco ${hueco.toFixed(2)} px`] : []
      })
    )
    expect(recortadas, 'ninguna celda corta sale recortada al abrir').toEqual([])

    // Para la captura del árbol: una tabla desplegada hasta sus columnas.
    await desplegar(fila(win, 'objeto', 'factura'))
    const columnas = await filaTras(win, fila(win, 'objeto', 'factura'), 'carpeta-detalle', 'columnas-factura')
    await expect(columnas.locator('.db-fila-nombre')).toHaveText('columnas')
    await desplegar(columnas)
    await expect(fila(win, 'columna', 'importe')).toHaveCount(1, { timeout: 15_000 })
    await capturar(win, '06-arbol-y-tabla-con-datos')
  })

  // (3b) CERRAR PESTAÑAS: Mod+W sólo con el foco DENTRO del área (en la terminal del
  // agente Ctrl+W es «borrar palabra») y el clic central, como en el editor.
  test('(3b) Mod+W con el foco en el área cierra la pestaña activa, y el clic central también', async () => {
    const win = s!.win
    const pestanas = win.locator('.db-area:not(.hidden) .db-tabs [role="tab"]')
    await fila(win, 'objeto', 'producto').dblclick()
    await expect(pestanas).toHaveCount(3)
    await expect(pestanas.nth(2)).toContainText('producto')
    // El foco, en la rejilla de esa pestaña (una celda): dentro del área.
    const celda = win.locator('.db-area:not(.hidden) .db-pane:not(.hidden) .db-rejilla .db-celda').first()
    await expect(celda).toBeVisible({ timeout: 30_000 })
    await celda.click()
    await win.keyboard.press(`${MOD}+KeyW`)
    await expect(pestanas).toHaveCount(2)
    await expect(win.locator('.tabs-projects .project-tab'), 'Mod+W no cerró el proyecto').toHaveCount(1)

    await fila(win, 'objeto', 'producto').dblclick()
    await expect(pestanas).toHaveCount(3)
    await pestanas.nth(2).click({ button: 'middle' })
    await expect(pestanas).toHaveCount(2)
    await expect(pestanas.nth(1)).toContainText('factura')
  })

  // (3c) MENÚ CONTEXTUAL DEL ÁRBOL Y SU FOCO. Sobre una tabla: abrir sus datos (con el
  // acorde de la plataforma en la etiqueta) y copiar su nombre, que deja en el
  // portapapeles justo eso. Sobre la conexión: lo que la configura y, AL FINAL y tras
  // un separador, lo que la destruye. Y con teclado, UN solo anillo de foco: el de la
  // fila activa, no otro alrededor de todo el lateral (la regla global
  // `:focus-visible` se inyecta después de `arbol.css` y le ganaba por orden).
  test('(3c) el menú contextual de una tabla y de la conexión, y el foco del árbol con teclado', async () => {
    const win = s!.win
    await fila(win, 'objeto', 'cliente').click({ button: 'right' })
    const deTabla = await entradasMenu(win)
    expect(
      deTabla.some((e) => /^Abrir datos\b/.test(e)),
      `el menú de la tabla abre sus datos: ${JSON.stringify(deTabla)}`
    ).toBe(true)
    expect(deTabla).toContain('Copiar nombre')
    await conPortapapeles(win, async () => {
      await win.evaluate(() => window.tessera.clipboard.write('centinela-e2e'))
      await win.locator('.ctx-menu .ctx-menu-item', { hasText: /^Copiar nombre$/ }).click()
      await expect(win.locator('.ctx-menu')).toHaveCount(0)
      await expect.poll(() => leerPortapapeles(win), { message: '«Copiar nombre» copia el nombre' }).toBe('cliente')
    })

    await fila(win, 'conexion', ALIAS).click({ button: 'right' })
    const deConexion = await entradasMenu(win)
    expect(deConexion).toContain('Esquemas visibles…')
    expect(deConexion).toContain('Editar conexión…')
    const n = deConexion.length
    expect(deConexion[n - 1], `lo destructivo va el último: ${JSON.stringify(deConexion)}`).toBe('Eliminar conexión…')
    expect(deConexion[n - 2], 'y separado de lo demás').toBe('—')
    await capturar(win, '14-menu-conexion')
    await win.keyboard.press('Escape')
    await expect(win.locator('.ctx-menu')).toHaveCount(0)

    // Foco con TECLADO: un clic en la fila y una flecha (Chromium pasa a
    // `:focus-visible` con la primera tecla que no es un modificador).
    const lista = win.locator('.db-arbol .db-arbol-lista')
    await fila(win, 'objeto', 'cliente').click()
    await win.keyboard.press('ArrowDown')
    await expect(fila(win, 'objeto', 'factura')).toHaveClass(/\bactive\b/)
    const foco = await lista.evaluate((l) => {
      const activa = l.querySelector('.tree-row.active')
      const csl = getComputedStyle(l)
      const csa = activa ? getComputedStyle(activa) : null
      return {
        visible: l.matches(':focus-visible'),
        lista: `${csl.outlineStyle} ${csl.outlineWidth}`,
        sombraLista: csl.boxShadow,
        fila: csa ? `${csa.outlineStyle} ${csa.outlineWidth}` : null
      }
    })
    expect(foco.visible, 'el foco del árbol es de teclado').toBe(true)
    expect(foco.lista, 'sin anillo alrededor de todo el lateral').toMatch(/^none /)
    expect(foco.sombraLista).toBe('none')
    expect(foco.fila, 'el anillo es el de la fila activa').toBe('solid 1px')
    await capturar(win, '13-arbol-foco')
  })

  // (3d) FILTROS DE LA PESTAÑA DE DATOS, MODO «SQL». El filtro por defecto es el GUIADO
  // (lo prueba el 3d2) y el WHERE libre está detrás del botón «SQL», ya
  // sin campo ORDER BY. Un WHERE que el SERVIDOR rechaza sale en rojo bajo SU campo, con
  // el foco en él y el token del error seleccionado (la posición viene del SQL generado y
  // se traduce al campo), y los datos de antes se quedan: son los del último filtro bueno.
  // Uno válido filtra. Y el clic en una cabecera cicla ASC → DESC → nada y vuelve a
  // consultar: la flecha y los datos lo dicen (ya no hay texto ORDER BY que leer).
  test('(3d) WHERE inválido: error en su campo y datos conservados; el válido filtra; la cabecera ordena', async () => {
    const win = s!.win
    await win.locator(PESTANAS, { hasText: 'factura' }).click()
    const pane = win.locator(PANE)
    const filas = pane.locator('.db-rejilla-cuerpo .db-rejilla-fila')
    await expect(filas).toHaveCount(3, { timeout: 30_000 })
    await expect(pane.locator('.filtro-guiado'), 'el filtro por defecto es el guiado').toBeVisible()
    await expect(pane.getByRole('textbox', { name: 'ORDER BY', exact: true }), 'la barra ya no tiene ORDER BY').toHaveCount(0)
    await pane.locator('.filtro-guiado').getByRole('button', { name: 'SQL', exact: true }).click()
    const where = pane.getByRole('textbox', { name: 'WHERE', exact: true })
    await expect(where, 'al pasar a SQL el foco va al WHERE').toBeFocused()
    await expect(pane.getByRole('textbox', { name: 'ORDER BY', exact: true }), 'tampoco en el modo SQL').toHaveCount(0)
    const error = pane.locator('.db-filtro-error')

    await where.fill('importe >>> 1')
    await where.press('Enter')
    await expect(error).toBeVisible({ timeout: 15_000 })
    await expect(error, 'el error es del campo WHERE').toHaveClass(/\bcampo-where\b/)
    await expect(where).toBeFocused()
    await expect(where).toHaveAttribute('aria-invalid', 'true')
    const seleccion = await where.evaluate((i: HTMLInputElement) => i.value.slice(i.selectionStart ?? 0, i.selectionEnd ?? 0))
    expect(seleccion, 'queda seleccionado el token en la posición del error').toBe('>>>')
    // El foco de un campo lo dice su BORDE: sin el anillo global de `:focus-visible`
    // encima (se inyecta después de `rejilla.css` y le ganaba por orden).
    const campo = await where.evaluate((i) => ({ visible: i.matches(':focus-visible'), contorno: getComputedStyle(i).outlineStyle }))
    expect(campo, 'un solo indicador de foco en el campo').toEqual({ visible: true, contorno: 'none' })
    await expect(filas, 'los datos del último filtro bueno se quedan').toHaveCount(3)
    await expect(pane.locator('.aviso'), 'la rejilla NO se sustituye por un aviso').toHaveCount(0)
    await capturar(win, '15-where-invalido')

    await where.fill('importe > 100')
    await where.press('Enter')
    await expect(filas).toHaveCount(1, { timeout: 15_000 })
    await expect(error).toHaveCount(0)
    await expect(where).toHaveAttribute('aria-invalid', 'false')
    await expect(celda(win, 0, 2)).toHaveText('1500.00')
    await where.fill('')
    await where.press('Enter')
    await expect(filas).toHaveCount(3, { timeout: 15_000 })

    const cabecera = pane
      .locator('.db-rejilla-th')
      .filter({ has: win.locator('.db-rejilla-th-nombre', { hasText: /^importe$/ }) })
    await cabecera.click()
    await expect(cabecera, 'la cabecera dice su orden').toHaveAttribute('aria-sort', 'ascending', { timeout: 15_000 })
    await expect(celda(win, 0, 2), 'ASC: el menor primero').toHaveText('99.90', { timeout: 15_000 })
    await expect(cabecera.locator('.db-rejilla-orden')).toHaveCount(1)
    await expect(cabecera.locator('.db-rejilla-orden-num'), 'con una sola columna, sin número').toHaveCount(0)
    await cabecera.click()
    await expect(cabecera).toHaveAttribute('aria-sort', 'descending', { timeout: 15_000 })
    // En PG, DESC pone los NULL delante (NULLS FIRST por defecto).
    await expect(celda(win, 0, 2), 'DESC: el NULL primero').toHaveText('<null>', { timeout: 15_000 })
    await expect(celda(win, 1, 2)).toHaveText('1500.00')
    await cabecera.click()
    await expect(celda(win, 0, 0), 'sin orden: por la clave primaria').toHaveText('10', { timeout: 15_000 })
    await expect(cabecera.locator('.db-rejilla-orden')).toHaveCount(0)
    await expect(cabecera).not.toHaveAttribute('aria-sort', /.+/)

    // Se deja la pestaña como estaba: en el guiado (el 3d2 parte de ahí).
    await pane.locator('.db-filtro').getByRole('button', { name: 'Guiado', exact: true }).click()
    await expect(pane.locator('.filtro-guiado')).toBeVisible()
  })

  // (3d2) EL FILTRO GUIADO Y EL ORDEN DE VARIAS COLUMNAS, contra el
  // servidor de verdad: el main compila la estructura a SQL con PARÁMETROS, así que lo que
  // se prueba aquí es la cadena entera —barra → IPC → `filtroSql` → PG → rejilla—. La
  // semántica que fija cada operador está en la cabecera de `shared/filtroGuiado.ts`:
  // «contiene» sin distinguir mayúsculas, «≠» que INCLUYE los NULL, «está vacío», y la
  // unión «todas / cualquiera». Lo que no vale se dice en SU fila SIN consultar (los datos
  // se quedan). Y la cabecera: Mayús+clic añade columnas con su número de prioridad, y un
  // clic sin Mayús deja esa columna sola.
  // `factura`: (10, cliente 1, 99.90, NULL) · (11, cliente 1, 1500.00, 'urgente') ·
  //            (12, cliente 2, NULL, NULL); columnas id · cliente_id · importe · nota.
  test('(3d2) filtro guiado (contiene, ≠ con NULL, vacío, todas/cualquiera, error en su fila) y orden de varias columnas', async () => {
    const win = s!.win
    await win.locator(PESTANAS, { hasText: 'factura' }).click()
    const pane = win.locator(PANE)
    const filas = pane.locator('.db-rejilla-cuerpo .db-rejilla-fila')
    await expect(filas).toHaveCount(3, { timeout: 30_000 })
    const barra = pane.locator('.filtro-guiado')
    const condicion = (n: number): Locator => barra.getByRole('group', { name: `Condición ${n}`, exact: true })
    const anadir = barra.getByRole('button', { name: '+ Condición', exact: true })
    await expect(barra.locator('.filtro-guiado-vacio'), 'sin condiciones lo dice').toHaveText('Sin filtro')

    // «contiene» sin distinguir mayúsculas: «URG» encuentra «urgente».
    await anadir.click()
    await expect(condicion(1).getByRole('combobox', { name: 'Columna' }), 'el foco va a la columna de la fila nueva').toBeFocused()
    await condicion(1).getByRole('combobox', { name: 'Columna' }).selectOption('nota')
    await expect(condicion(1).getByRole('combobox', { name: 'Operador' }), 'texto: nace en «contiene»').toHaveValue('contiene')
    await condicion(1).getByRole('textbox', { name: 'Valor' }).fill('URG')
    await condicion(1).getByRole('textbox', { name: 'Valor' }).press('Enter')
    await expect(filas).toHaveCount(1, { timeout: 15_000 })
    await expect(celda(win, 0, 0)).toHaveText('11')

    // «≠» INCLUYE los NULL (en SQL, `<>` a secas los descartaría en silencio).
    await condicion(1).getByRole('combobox', { name: 'Operador' }).selectOption({ label: '≠' })
    await condicion(1).getByRole('textbox', { name: 'Valor' }).fill('urgente')
    await barra.getByRole('button', { name: 'Aplicar', exact: true }).click()
    await expect(filas).toHaveCount(2, { timeout: 15_000 })
    await expect(celda(win, 0, 0)).toHaveText('10')
    await expect(celda(win, 1, 0)).toHaveText('12')

    // Dos condiciones: «nota está vacío» y «cliente_id = 1». Todas → la 10; cualquiera → las 3.
    await condicion(1).getByRole('combobox', { name: 'Operador' }).selectOption({ label: 'está vacío' })
    await expect(condicion(1).getByRole('textbox'), '«está vacío» no lleva valor').toHaveCount(0)
    await expect(barra.getByRole('group', { name: 'Cómo se unen las condiciones' }), 'con una condición no hay conmutador').toHaveCount(0)
    await anadir.click()
    await condicion(2).getByRole('combobox', { name: 'Columna' }).selectOption('cliente_id')
    await expect(condicion(2).getByRole('combobox', { name: 'Operador' }), 'número: nace en «=»').toHaveValue('igual')
    await condicion(2).getByRole('textbox', { name: 'Valor' }).fill('1')
    await expect(condicion(2).locator('.filtro-guiado-conector'), 'la segunda se lee «y …»').toHaveText('y')
    await condicion(2).getByRole('textbox', { name: 'Valor' }).press('Enter')
    await expect(filas).toHaveCount(1, { timeout: 15_000 })
    await expect(celda(win, 0, 0)).toHaveText('10')
    const union = barra.getByRole('group', { name: 'Cómo se unen las condiciones' })
    await union.getByRole('button', { name: 'cualquiera', exact: true }).click()
    await expect(union.getByRole('button', { name: 'cualquiera', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(condicion(2).locator('.filtro-guiado-conector'), 'y pasa a «o …»').toHaveText('o')
    await barra.getByRole('button', { name: 'Aplicar', exact: true }).click()
    await expect(filas).toHaveCount(3, { timeout: 15_000 })
    await capturar(win, '15b-filtro-guiado')

    // Lo que no vale se dice en SU fila, sin consultar: «12,5» no es un número.
    await anadir.click()
    await condicion(3).getByRole('combobox', { name: 'Columna' }).selectOption('importe')
    const valor3 = condicion(3).getByRole('textbox', { name: 'Valor' })
    await valor3.fill('12,5')
    await valor3.press('Enter')
    const errorFila = barra.locator('.filtro-guiado-error.en-fila')
    await expect(errorFila).toContainText('No es un número')
    await expect(valor3).toHaveAttribute('aria-invalid', 'true')
    await expect(valor3, 'el foco va al valor culpable').toBeFocused()
    await expect(filas, 'los datos del último filtro bueno se quedan').toHaveCount(3)
    await capturar(win, '15c-filtro-guiado-error')
    // Esc vuelve a lo APLICADO: la tercera fila (que nunca se aplicó) desaparece.
    await valor3.press('Escape')
    await expect(condicion(3)).toHaveCount(0)
    await expect(errorFila).toHaveCount(0)

    // Quitar una y aplicar (queda «nota está vacío»: la 10 y la 12); quitar la otra y
    // aplicar: la tabla entera. Cada paso cambia el número de filas, así que cada espera
    // es de SU consulta y no de la anterior.
    await condicion(2).getByRole('button', { name: 'Quitar la condición 2' }).click()
    await expect(condicion(1).getByRole('button', { name: 'Quitar la condición 1' }), 'el foco pasa al aspa de la que queda').toBeFocused()
    await barra.getByRole('button', { name: 'Aplicar', exact: true }).click()
    await expect(filas).toHaveCount(2, { timeout: 15_000 })
    await condicion(1).getByRole('button', { name: 'Quitar la condición 1' }).click()
    await expect(anadir, 'sin filas, el foco vuelve a «+ Condición»').toBeFocused()
    await barra.getByRole('button', { name: 'Aplicar', exact: true }).click()
    await expect(filas).toHaveCount(3, { timeout: 15_000 })

    // EL ORDEN DE VARIAS COLUMNAS. cliente_id ↑ y, con Mayús, importe ↑ → 10, 11, 12;
    // Mayús+clic otra vez en importe → ↓ en su sitio → 11, 10, 12.
    const th = (nombre: string): Locator =>
      pane.locator('.db-rejilla-th').filter({ has: win.locator('.db-rejilla-th-nombre', { hasText: new RegExp(`^${nombre}$`) }) })
    await th('cliente_id').click()
    await expect(th('cliente_id')).toHaveAttribute('aria-sort', 'ascending', { timeout: 15_000 })
    await th('importe').click({ modifiers: ['Shift'] })
    await expect(th('importe')).toHaveAttribute('aria-sort', 'ascending', { timeout: 15_000 })
    await expect(th('cliente_id').locator('.db-rejilla-orden-num'), 'con varias, cada flecha lleva su prioridad').toHaveText('1')
    await expect(th('importe').locator('.db-rejilla-orden-num')).toHaveText('2')
    await expect(th('importe'), 'el title explica el gesto').toHaveAttribute('title', /Mayús\+clic/)
    await expect(celda(win, 0, 0)).toHaveText('10', { timeout: 15_000 })
    await expect(celda(win, 1, 0)).toHaveText('11')
    await expect(celda(win, 2, 0)).toHaveText('12')
    await th('importe').click({ modifiers: ['Shift'] })
    await expect(th('importe')).toHaveAttribute('aria-sort', 'descending', { timeout: 15_000 })
    await expect(th('importe').locator('.db-rejilla-orden-num'), 'cicla en su sitio: sigue siendo la 2.ª').toHaveText('2')
    await expect(celda(win, 0, 0)).toHaveText('11', { timeout: 15_000 })
    await expect(celda(win, 1, 0)).toHaveText('10')
    await capturar(win, '15d-orden-varias-columnas')

    // Un clic SIN Mayús deja esa columna sola: cliente_id pasa a ↓ y importe pierde la flecha.
    await th('cliente_id').click()
    await expect(th('cliente_id')).toHaveAttribute('aria-sort', 'descending', { timeout: 15_000 })
    await expect(th('importe').locator('.db-rejilla-orden')).toHaveCount(0)
    await expect(pane.locator('.db-rejilla-orden-num'), 'con una sola, sin números').toHaveCount(0)
    await expect(celda(win, 0, 0), 'cliente 2 delante').toHaveText('12', { timeout: 15_000 })
    // Y el tercer clic la quita: la tabla queda como estaba para lo que sigue.
    await th('cliente_id').click()
    await expect(pane.locator('.db-rejilla-orden')).toHaveCount(0, { timeout: 15_000 })
    await expect(celda(win, 0, 0)).toHaveText('10', { timeout: 15_000 })
  })

  // (3e) PAGINADO Y CONTEO. `numeros` tiene 1234 filas y NINGUNA clave primaria: se
  // abre con la primera página («500+ filas», y el aviso de que sin orden el servidor
  // no garantiza cuáles vienen), desplazarse al final trae la siguiente sin pedirla y
  // «Contar» (la píldora es el botón) pone el total del servidor.
  test('(3e) una tabla de 1234 filas se pagina de 500 en 500 al desplazar y la píldora cuenta el total', async () => {
    const win = s!.win
    const publico = fila(win, 'esquema', 'public')
    await desplegar(publico)
    const tablas = await filaTras(win, publico, 'carpeta', 'tablas-public', 'tablas')
    await desplegar(tablas)
    await expect(fila(win, 'objeto', 'numeros')).toHaveCount(1, { timeout: 15_000 })
    await fila(win, 'objeto', 'numeros').dblclick()
    const pestana = win.locator(PESTANAS, { hasText: 'numeros' })
    await expect(pestana).toHaveClass(/\bactive\b/)

    const pane = win.locator(PANE)
    const pildora = pane.locator('.db-pildora')
    const textoPildora = pildora.locator(':scope > :first-child')
    await expect(textoPildora).toHaveText('500+ filas', { timeout: 30_000 })
    await expect(pildora).toContainText('sin orden estable')
    await expect(celda(win, 0, 0)).toHaveText('1')

    await pane.locator('.db-rejilla-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(textoPildora, 'al llegar al final se cargó la segunda página').toHaveText('1000+ filas', { timeout: 30_000 })

    await expect(textoPildora).toHaveJSProperty('tagName', 'BUTTON')
    await textoPildora.click()
    await expect(textoPildora, 'el total lo cuenta el servidor').toHaveText('1000 de 1234', { timeout: 30_000 })
    expect(pg!.psql('select count(*) from public.numeros;').out, 'y es el de verdad').toBe('1234')
    await capturar(win, '16-paginado-contado')

    // Se recoge: la pestaña y lo desplegado (ver la cabecera).
    await pestana.click({ button: 'middle' })
    await expect(win.locator(PESTANAS)).toHaveCount(2)
    await plegar(tablas)
    await plegar(publico)
  })

  // (3f) COPIAR UN RANGO. Clic en una celda, Mayús+clic en otra y Mod+C: el rango va al
  // portapapeles del SISTEMA como TSV (tabuladores y saltos de línea), que es lo que se
  // pega bien en una hoja de cálculo o de vuelta en una consola.
  test('(3f) Mod+C copia el rango seleccionado como TSV', async () => {
    const win = s!.win
    await win.locator(PESTANAS, { hasText: 'cliente' }).click()
    await expect(celda(win, 0, 0)).toHaveText('1', { timeout: 30_000 })
    await conPortapapeles(win, async () => {
      await win.evaluate(() => window.tessera.clipboard.write('centinela-e2e'))
      await celda(win, 0, 0).click()
      await celda(win, 1, 1).click({ modifiers: ['Shift'] })
      await expect(win.locator(`${PANE} .db-rejilla`)).toBeFocused()
      await expect(win.locator(`${PANE} .db-celda.sel`)).toHaveCount(4)
      await win.keyboard.press(`${MOD}+KeyC`)
      await expect.poll(() => leerPortapapeles(win), { message: 'el rango en TSV' }).toBe('1\tAna\n2\tBea')
    })

    // Con TECLADO, un solo anillo de foco, entero: el de dentro, sin el contorno global
    // de `:focus-visible` encima, y en una capa POR ENCIMA del contenido. Era una
    // sombra `inset` de la propia rejilla, que se pinta DEBAJO de sus hijos opacos: la
    // cabecera pegada y las filas lo tapaban, y sólo asomaban los lados bajo la última
    // fila (lo destapó la captura `19-rejilla-foco`). Se fija la estructura: la capa
    // existe, lleva el anillo y va por encima de la cabecera, la más alta de las capas
    // opacas de la rejilla.
    await win.keyboard.press('ArrowDown')
    await expect(celda(win, 2, 1)).toHaveClass(/\bfoco\b/)
    const anillo = await win.locator(`${PANE} .db-rejilla`).evaluate((r) => {
      const cs = getComputedStyle(r)
      const capa = getComputedStyle(r, '::after')
      const cab = r.querySelector('.db-rejilla-cab')
      return {
        visible: r.matches(':focus-visible'),
        contorno: cs.outlineStyle,
        sombraPropia: cs.boxShadow,
        capa: { contenido: capa.content, posicion: capa.position, sombra: capa.boxShadow, z: Number(capa.zIndex) },
        zCabecera: cab ? Number(getComputedStyle(cab).zIndex) : NaN
      }
    })
    expect(anillo.visible, 'el foco de la rejilla es de teclado').toBe(true)
    expect(anillo.contorno, 'sin el contorno global').toBe('none')
    expect(anillo.sombraPropia, 'el anillo no es una sombra que tapan los hijos').toBe('none')
    expect(anillo.capa.contenido, `la capa del anillo existe: ${JSON.stringify(anillo)}`).not.toBe('none')
    expect(anillo.capa.posicion).toBe('absolute')
    expect(anillo.capa.sombra, 'la capa lleva el anillo por dentro').toMatch(/inset/)
    expect(anillo.capa.z, 'y va por encima de la cabecera pegada').toBeGreaterThan(anillo.zCabecera)
    await capturar(win, '19-rejilla-foco')
  })

  // (3g) PESTAÑA DE FUENTE. «Ver definición» del menú de una vista y el doble clic en
  // una función abren su texto en un Monaco de SOLO LECTURA: se mira el modelo (el
  // texto entero y la opción) y lo PINTADO, porque un editor que existe con el texto
  // y no se ve (nacido a 0 px) es el fallo que ya costó la consola.
  test('(3g) la definición de una vista y una función se abren en un Monaco de solo lectura', async () => {
    const win = s!.win
    const ventas = fila(win, 'esquema', 'ventas')
    const fuente = win.locator('.db-area:not(.hidden) section.db-fuente:not(.hidden)')
    const textoFuente = (): Promise<string> => monacoEn(win, HOST_FUENTE, { op: 'texto' }).catch(() => '')

    const vistas = await filaTras(win, ventas, 'carpeta', 'vistas-ventas', 'vistas')
    await desplegar(vistas)
    await expect(fila(win, 'objeto', 'v_facturas')).toHaveCount(1, { timeout: 15_000 })
    await fila(win, 'objeto', 'v_facturas').click({ button: 'right' })
    await win.locator('.ctx-menu .ctx-menu-item', { hasText: /^Ver definición$/ }).click()
    await expect(fuente).toBeVisible()
    await expect.poll(textoFuente, { timeout: 30_000, message: 'la definición de la vista' }).toContain('CREATE OR REPLACE VIEW')
    expect(await monacoEn(win, HOST_FUENTE, { op: 'soloLectura' })).toBe('si')
    await expect(fuente.locator('.view-lines'), 'y se pinta').toContainText('CREATE')
    expect(await seVeEnSuCentro(fuente.locator('.db-fuente-host')), 'el editor se ve').toBe(true)
    await capturar(win, '17-fuente-vista')

    const rutinas = await filaTras(win, ventas, 'carpeta', 'rutinas-ventas', 'rutinas')
    await desplegar(rutinas)
    await expect(fila(win, 'objeto', 'total_cliente')).toHaveCount(1, { timeout: 15_000 })
    await fila(win, 'objeto', 'total_cliente').dblclick()
    await expect(win.locator(PESTANAS, { hasText: 'total_cliente' })).toHaveClass(/\bactive\b/)
    await expect.poll(textoFuente, { timeout: 30_000, message: 'la fuente de la función' }).toContain('CREATE OR REPLACE FUNCTION')
    expect(await monacoEn(win, HOST_FUENTE, { op: 'soloLectura' })).toBe('si')
    await expect(fuente.locator('.view-lines')).toContainText('CREATE')

    // Se recoge (ver la cabecera).
    for (const nombre of ['total_cliente', 'v_facturas']) {
      await win.locator(PESTANAS, { hasText: nombre }).click({ button: 'middle' })
    }
    await expect(win.locator(PESTANAS)).toHaveCount(2)
    await plegar(rutinas)
    await plegar(vistas)
  })

  // (4) Mod+N ABRE UNA CONSOLA EN CONTEXTO (la conexión del nodo seleccionado) y el
  // centro se parte en horizontal: el editor ENCIMA de los resultados.
  test('(4) Mod+N abre una consola con el editor encima de los resultados', async () => {
    const win = s!.win
    await fila(win, 'columna', 'importe').click()
    await win.keyboard.press(`${MOD}+KeyN`)
    const pestanas = win.locator('.db-area:not(.hidden) .db-tabs [role="tab"]')
    await expect(pestanas).toHaveCount(3)
    await expect(pestanas.nth(2)).toContainText('consola_1')
    await expect(win.locator(CONSOLA)).toBeVisible()
    await esperarConsolaLista(win)
    await aLaVista(win)
    const editor = await caja(win.locator(`${CONSOLA} .db-consola-editor`))
    const resultados = await caja(win.locator(`${CONSOLA} .db-consola-resultados`))
    expect(editor, 'el editor tiene caja').not.toBeNull()
    expect(resultados, 'los resultados tienen caja').not.toBeNull()
    expect(editor!.h, 'el editor tiene alto').toBeGreaterThan(40)
    expect(resultados!.h, 'los resultados tienen alto').toBeGreaterThan(40)
    expect(editor!.bottom, `editor ${JSON.stringify(editor)} encima de resultados ${JSON.stringify(resultados)}`).toBeLessThanOrEqual(
      resultados!.y + 1
    )
    expect(await seVeEnSuCentro(win.locator(`${CONSOLA} .db-consola-editor`)), 'el editor se ve').toBe(true)
    expect(await seVeEnSuCentro(win.locator(`${CONSOLA} .db-consola-resultados`)), 'los resultados se ven').toBe(true)
  })

  // (5) TRES SELECT, LA ÚLTIMA SIN `;` (vale, como en cualquier cliente SQL): Salida + una pestaña de
  // resultado por SELECT y un ✓ por sentencia en el margen.
  test('(5) tres SELECT dan Salida, tres pestañas de resultado y tres ✓', async () => {
    const win = s!.win
    await ejecutarTodoSeleccionado(
      win,
      'select * from ventas.cliente;\nselect * from ventas.factura;\nselect id, nombre, saldo from public.profile'
    )
    await esperarFinEjecucion(win)
    const tabs = win.locator(`${CONSOLA} .db-resultados-tabs [role="tab"]`)
    await expect(tabs).toHaveCount(4)
    await expect(tabs.first()).toContainText('Salida')
    await expect(win.locator(`${CONSOLA} .db-glifo-ok`)).toHaveCount(3)
    await expect(win.locator(`${CONSOLA} .db-glifo-error`)).toHaveCount(0)
    // Y el TIEMPO de cada una al final de su línea («3 ms»): es el `after` inyectado.
    const tiempos = win.locator(`${CONSOLA} .db-consola-editor .db-tiempo-linea`)
    // Si falta, se dice si es la VISTA o el modelo: la decoración con `after` puede
    // existir en el modelo y no pintarse (así fue: rango vacío sin `showIfCollapsed`).
    await expect(tiempos, `decoraciones con texto inyectado en el modelo: ${await monacoConsola(win, { op: 'inyectados' })}`).toHaveCount(3)
    for (const t of await tiempos.all()) await expect(t).toBeVisible()
    await capturar(win, '07-consola-3-resultados')
    await tabs.first().click()
    const salida = await textoSalida(win)
    expect(salida, 'la Salida cuenta las filas de cada SELECT').toMatch(/3 filas/)
    // El eco lleva el esquema YA en la primera sentencia, cuando la sesión de la consola
    // aún no existía (salía «> select …»).
    expect(salida, 'el eco de la primera sentencia lleva su esquema').toContain('public> select * from ventas.cliente')
  })

  // (6) DOS SENTENCIAS PEGADAS SIN `;`: el divisor las ve como UNA (no hay separador),
  // el servidor la rechaza y la consola lo marca en su sitio: ✗ en el margen, el
  // subrayado del error y el mensaje en Salida.
  test('(6) dos sentencias pegadas sin ; dan ✗, subrayado y el error en Salida', async () => {
    const win = s!.win
    await ejecutarTodoSeleccionado(win, 'select 1\nselect 2')
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-glifo-error`)).toHaveCount(1)
    await expect(win.locator(`${CONSOLA} .squiggly-error`).first()).toBeVisible()
    await win.locator(`${CONSOLA} .db-resultados-tabs [role="tab"]`).first().click()
    await expect(win.locator(`${CONSOLA} .db-salida`)).toContainText(/syntax error|error de sintaxis/)
    await capturar(win, '08-consola-error-marcado')
  })

  // (7) UPDATE: Salida dice cuántas filas tocó, y el cambio se ve desde OTRA sesión (la
  // consola nace en Tx Auto, así que ya está confirmado).
  test('(7) un UPDATE informa de las filas afectadas', async () => {
    const win = s!.win
    await ejecutarTodoSeleccionado(win, "update ventas.producto set precio = 1.5 where nombre = 'tuerca'")
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-glifo-ok`)).toHaveCount(1)
    await win.locator(`${CONSOLA} .db-resultados-tabs [role="tab"]`).first().click()
    await expect(win.locator(`${CONSOLA} .db-salida`)).toContainText(/1 fila afectada|filas afectadas/)
    const fuera = pg!.psql("select precio from ventas.producto where nombre = 'tuerca';")
    expect(fuera.out, 'el cambio está confirmado (Tx Auto)').toBe('1.50')
  })

  // (7b) TRANSACCIÓN MANUAL. En Manual un UPDATE deja la tx PENDIENTE (la barra lo dice
  // y otra sesión NO ve el cambio); Rollback lo deshace y Commit lo confirma. Es el
  // camino que el `tdb` de proceso corto no podía dar: una sesión que sobrevive entre
  // dos sentencias. Se comprueba desde fuera (psql en el contenedor), no fiándose de la
  // barra.
  test('(7b) Tx Manual: el UPDATE queda pendiente, Rollback lo deshace y Commit lo confirma', async () => {
    const win = s!.win
    const p = pg!
    const precio = (): string => p.psql("select precio from ventas.producto where nombre = 'tornillo';").out
    expect(precio(), 'partida').toBe('0.10')
    const modo = win.locator(`${CONSOLA} .db-consola-tx-modo`)
    const barraTx = win.locator(`${CONSOLA} .db-consola-tx`)
    const commit = win.locator(`${CONSOLA} button.db-consola-commit`)
    const rollback = win.locator(`${CONSOLA} button.db-consola-rollback`)
    await modo.click()
    await expect(modo).toHaveAttribute('aria-pressed', 'true')
    await expect(win.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Manual')

    await ejecutarTodoSeleccionado(win, "update ventas.producto set precio = 9.99 where nombre = 'tornillo'")
    await expect(barraTx).toHaveText('Tx pendiente (1)')
    expect(precio(), 'sin confirmar, otra sesión no lo ve').toBe('0.10')
    await expect(rollback).toBeEnabled()
    await capturar(win, '07b-consola-tx-pendiente')
    await rollback.click()
    await expect(barraTx).toHaveCount(0)
    await expect(rollback).toBeDisabled()
    expect(precio(), 'tras Rollback sigue como estaba').toBe('0.10')

    await ejecutarTodoSeleccionado(win, "update ventas.producto set precio = 9.99 where nombre = 'tornillo'")
    await expect(barraTx).toHaveText('Tx pendiente (1)')
    await commit.click()
    await expect(barraTx).toHaveCount(0)
    expect(precio(), 'tras Commit, otra sesión lo ve').toBe('9.99')

    // De vuelta a Auto, que es como nace cada consola y como la esperan las siguientes.
    await modo.click()
    await expect(modo).toHaveAttribute('aria-pressed', 'false')
  })

  // (7c) DETENER. Una sentencia larga se corta con ■ en el servidor (CancelRequest de
  // PG), en segundos y no a los 30, y la siguiente sentencia no recibe un cancel tardío.
  test('(7c) ■ corta un pg_sleep(30) en menos de 5 s y la consola sigue sirviendo', async () => {
    const win = s!.win
    const detener = win.locator(`${CONSOLA} .db-consola-detener`)
    await ejecutarTodoSeleccionado(win, 'select pg_sleep(30)')
    await expect(detener).toBeEnabled()
    await expect(win.locator(`${CONSOLA} .db-glifo-corriendo`)).toHaveCount(1)
    const t0 = Date.now()
    await detener.click()
    await expect(win.locator(`${CONSOLA} .db-glifo-cancelada`)).toHaveCount(1, { timeout: 5_000 })
    expect(Date.now() - t0, 'cancelada en menos de 5 s').toBeLessThan(5_000)
    await expect(detener).toBeDisabled()
    await capturar(win, '07c-consola-detenida')
    await ejecutarTodoSeleccionado(win, 'select 42 as respuesta')
    await expect(win.locator(`${CONSOLA} .db-glifo-ok`)).toHaveCount(1, { timeout: 15_000 })
  })

  // (8) AUTOCOMPLETADO: tras FROM sugiere objetos del catálogo, con su esquema y el
  // alias de la conexión (la fila de la captura del usuario: `profile (public)  ALIAS`).
  test('(8) «select * from pro» sugiere la tabla con su esquema y el alias', async () => {
    const win = s!.win
    await monacoConsola(win, { op: 'fijar', texto: '' })
    await monacoConsola(win, { op: 'teclear', texto: 'select * from pro' })
    await monacoConsola(win, { op: 'sugerir' })
    const widget = win.locator('.suggest-widget.visible')
    await expect(widget).toBeVisible({ timeout: 15_000 })
    const filaProfile = widget.locator('.monaco-list-row').filter({ hasText: 'profile' }).first()
    await expect(filaProfile).toBeVisible({ timeout: 15_000 })
    await expect(filaProfile).toContainText('public')
    await expect(filaProfile).toContainText(ALIAS)
    await capturar(win, '09-sugerencias')
    await win.keyboard.press('Escape')
    await expect(widget).toHaveCount(0)
  })

  // (9) EL AGENTE, A DEMANDA Y A LA DERECHA. Ctrl+Alt+B (⌥⌘B) prepara el espacio de
  // datos y enseña la columna vertical con su selector «Bases montadas» (`.db-mount-btn`);
  // otra vez la oculta. Se pulsa con el foco en la consola, que es donde estará.
  test('(9) Ctrl+Alt+B (⌥⌘B) muestra el agente a la derecha y lo vuelve a ocultar', async () => {
    const win = s!.win
    await monacoConsola(win, { op: 'foco' })
    await win.keyboard.press(ACORDE_AGENTE)
    const cc = win.locator('.right-panel')
    await expect(cc).toBeVisible({ timeout: 30_000 })
    await expect(win.locator('[role="separator"][aria-label="Redimensionar el agente"]')).toHaveCount(1)
    await aLaVista(win)
    const area = await caja(win.locator('.db-area:not(.hidden)'))
    const columna = await caja(cc)
    expect(area!.right, `centro ${JSON.stringify(area)} a la izquierda del agente ${JSON.stringify(columna)}`).toBeLessThanOrEqual(
      columna!.x + 1
    )
    expect(columna!.h, 'columna VERTICAL: ocupa el alto del centro').toBeGreaterThan(area!.h * 0.8)
    const montaje = cc.locator('.agent-pane:not(.hidden) .db-mount-btn')
    await expect(montaje).toBeVisible({ timeout: 30_000 })
    expect(await seVeEnSuCentro(montaje), 'el selector de bases montadas se ve').toBe(true)
    await capturar(win, '10-agente-a-la-derecha')

    await monacoConsola(win, { op: 'foco' })
    await win.keyboard.press(ACORDE_AGENTE)
    await expect(cc).toBeHidden()
    await expect(win.locator('[role="separator"][aria-label="Redimensionar el agente"]')).toHaveCount(0)
  })

  // (9b) MONTAR UNA BASE EN EL ESPACIO DE DATOS. El agente de datos sólo ve lo montado: su
  // selector «Bases montadas» ofrece las conexiones VERIFICADAS, y PG-E2E lo está porque las
  // pruebas anteriores ya abrieron sesión con ella (el explorador la marca al abrir, sin
  // pasar por «Probar conexión»). Montarla pone el contador del botón a 1. Se muestra el
  // agente otra vez: es el MISMO proceso (keep-alive), y la prueba de la vuelta a Archivos
  // cuenta que no se relanzó. Y NOMBRA BIEN EL SITIO: este agente no es un proyecto, así que
  // el título y el rótulo dicen «en el agente de datos» (`textosMontajeBases.ts`): es la
  // prueba de que `rutasEspacioDatos` llega de App al pane; la mitad negativa (el agente del
  // proyecto sigue diciendo «en este proyecto») la fija la prueba de la vuelta a Archivos.
  test('(9b) el selector «Bases montadas» del agente lista la conexión verificada y montarla aplica', async () => {
    const win = s!.win
    await monacoConsola(win, { op: 'foco' })
    await win.keyboard.press(ACORDE_AGENTE)
    const pane = win.locator('.right-panel .agent-pane:not(.hidden)')
    const boton = pane.locator('.db-mount-btn')
    await expect(boton).toBeVisible({ timeout: 30_000 })
    await expect(boton.locator('.db-mount-badge'), 'sin nada montado no hay contador').toHaveCount(0)
    await expect(boton, 'el rótulo nombra el agente de datos, no un proyecto').toHaveAttribute(
      'title',
      'Montar bases de datos en el agente de datos'
    )
    await boton.click()
    const pop = pane.locator('.db-mount-pop')
    await expect(pop).toBeVisible()
    const cabecera = pop.locator('.db-mount-pop-head')
    await expect(cabecera).toContainText('Bases montadas en el agente de datos')
    await expect(cabecera, 'en el agente de datos no se habla de «proyecto»').not.toContainText('proyecto')
    const item = pop
      .locator('.db-mount-item')
      .filter({ has: win.locator('.db-mount-alias', { hasText: new RegExp(`^${ALIAS}$`) }) })
    await expect(item, 'la conexión ya abrió sesión: está verificada y se ofrece').toHaveCount(1, { timeout: 15_000 })
    await expect(pop.locator('.db-mount-nota', { hasText: 'sin probar' })).toHaveCount(0)
    await item.click()
    await expect(item).toHaveClass(/\bon\b/)
    await expect(boton.locator('.db-mount-badge')).toHaveText('1')
    await expect(boton).toHaveClass(/\bactivo\b/)
    await expect(boton).toHaveAttribute('title', '1 base(s) montada(s) en el agente de datos')
    await capturar(win, '18-bases-montadas')
    await pop.getByRole('button', { name: 'Cerrar' }).click()
    await expect(pop).toHaveCount(0)
    await expect(boton.locator('.db-mount-badge'), 'cerrar el selector no desmonta').toHaveText('1')
  })

  // (9c) Mod+W EN LA TERMINAL DEL AGENTE NO ES DE LA VISTA. Ahí Ctrl+W es «borrar
  // palabra» (readline, zsh), así que el atajo de cerrar pestaña sólo vale con el foco
  // DENTRO del área (lo fija el (3b)); con el foco en la terminal no cierra ninguna
  // pestaña de la vista, ni el proyecto. Después se oculta el agente, como estaba.
  test('(9c) Mod+W con el foco en la terminal del agente no cierra ninguna pestaña de la vista', async () => {
    const win = s!.win
    const pestanas = win.locator(PESTANAS)
    const antes = await pestanas.allTextContents()
    expect(antes.length, 'hay pestañas que se podrían cerrar').toBeGreaterThan(0)
    const terminal = win.locator('.right-panel .agent-pane:not(.hidden) .xterm')
    await expect(terminal).toBeVisible()
    await terminal.click()
    await expect
      .poll(() => win.evaluate(() => document.activeElement?.closest('.right-panel .xterm') != null), {
        message: 'el foco está en la terminal del agente'
      })
      .toBe(true)
    await win.keyboard.press(`${MOD}+KeyW`)
    await asentar(win)
    await win.waitForTimeout(300)
    expect(await pestanas.allTextContents(), 'ninguna pestaña de la vista se cerró').toEqual(antes)
    await expect(win.locator('.tabs-projects .project-tab'), 'ni el proyecto').toHaveCount(1)

    await monacoConsola(win, { op: 'foco' })
    await win.keyboard.press(ACORDE_AGENTE)
    await expect(win.locator('.right-panel')).toBeHidden()
  })

  test('al volver a Archivos y Git, siguen como antes', async () => {
    const win = s!.win
    await botonVista(win, 'Archivos').click()
    await expect(win.locator('.db-area')).toBeHidden()
    await expect(win.locator('.sidebar .tree-row').first()).toBeVisible()
    // La columna del agente del PROYECTO vuelve: ocultar la del agente de datos no la
    // toca (son dos destinos distintos del mismo panel).
    await expect(win.locator('.right-panel')).toBeVisible()
    // Y SU SELECTOR DE MONTAJE SIGUE DICIENDO «en este proyecto»: el texto del agente
    // de datos (9b) no se filtra a los agentes de proyecto. La base se montó en el
    // espacio, no aquí, así que el proyecto no tiene ninguna y el rótulo es el de montar.
    await expect(
      win.locator('.right-panel .agent-pane:not(.hidden) .db-mount-btn'),
      'el agente del proyecto nombra el proyecto, como siempre'
    ).toHaveAttribute('title', 'Montar bases de datos en este proyecto')
    // Y NINGUNA SESIÓN SE RELANZÓ NI SE CERRÓ (Anexo D.12: entrar en 'db' no mata
    // sesiones). El agente falso apunta cada arranque con su pid: el del proyecto
    // arrancó UNA vez y sigue vivo tras pasar por la vista; el del espacio de datos
    // arrancó UNA vez al mostrarlo y sigue vivo aunque se ocultó (keep-alive).
    // Se espera a los dos (lanzar un pty es asíncrono) y luego se exige que no haya más.
    const cuenta = (): { proyecto: number; espacio: number } => {
      const a = falso!.arranques()
      return { proyecto: a.filter((x) => x.cwd === rutaProyecto).length, espacio: a.filter((x) => x.cwd !== rutaProyecto).length }
    }
    await expect.poll(cuenta, { timeout: 30_000, message: `arranques: ${JSON.stringify(falso!.arranques())}` }).toEqual({
      proyecto: 1,
      espacio: 1
    })
    for (const a of falso!.arranques()) expect(vivo(a.pid), `el agente de ${a.cwd} sigue vivo`).toBe(true)
    await capturar(win, '11-vista-files-tras-db')
    await botonVista(win, 'Git · Cambios').click()
    await asentar(win)
    await capturar(win, '12-vista-git-tras-db')
  })

  // (10) CERRAR LA APP CON UNA TRANSACCIÓN PENDIENTE, por `before-quit` y por la X, y lo
  // que queda después. Pregunta con un diálogo NATIVO que nombra `alias · consola`, el MISMO
  // por los dos caminos (pasan por `beginShutdown`); como no se puede pulsar desde
  // Playwright, se sustituye `dialog.showMessageBox` en el main por uno que apunta lo que
  // le piden y contesta lo que diga la prueba: se fija el FLUJO, no el pintado del sistema.
  // «Cancelar» deja la app VIVA y CERRABLE (el diálogo va antes de `shuttingDown`; después,
  // la segunda X cerraría sin preguntar). «Revertir y salir» revierte (psql lo ve) y cierra.
  // Y NO QUEDA NINGÚN PROCESO DE SESIÓN: cada conexión es un `fork` del ejecutable de la
  // app, y uno vivo bloquea la carpeta de la app (EBUSY del instalador) y el `userData`
  // temporal. Se miran los pids CONCRETOS, no «algún Tessera»: la del usuario puede estar abierta.
  test('(10) cerrar con una tx pendiente pregunta (before-quit y la X); Cancelar la deja viva y «Revertir y salir» revierte y no deja procesos', async () => {
    const sesion = s!
    const win = sesion.win
    const p = pg!
    const precio = (): string => p.psql("select precio from ventas.producto where nombre = 'tornillo';").out
    const confirmado = precio()

    await botonVista(win, 'Conexiones a bases de datos').click()
    await win.locator('.db-area:not(.hidden) .db-tabs [role="tab"]', { hasText: 'consola_1' }).click()
    await esperarConsolaLista(win)
    const modo = win.locator(`${CONSOLA} .db-consola-tx-modo`)
    await modo.click()
    await expect(modo).toHaveAttribute('aria-pressed', 'true')
    await ejecutarTodoSeleccionado(win, "update ventas.producto set precio = 7.77 where nombre = 'tornillo'")
    await expect(win.locator(`${CONSOLA} .db-consola-tx`)).toHaveText('Tx pendiente (1)')

    // El diálogo nativo, sustituido en el main (ver arriba). Contesta en orden lo que
    // haya en `__e2eRespuestas` (índices de sus botones).
    await sesion.app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { __e2eDialogos: unknown[]; __e2eRespuestas: number[] }
      g.__e2eDialogos = []
      g.__e2eRespuestas = []
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const o = args[args.length - 1] as { title?: string; message?: string; detail?: string; buttons?: string[] }
        g.__e2eDialogos.push({ title: o.title, message: o.message, detail: o.detail, buttons: o.buttons })
        return { response: g.__e2eRespuestas.shift() ?? 2, checkboxChecked: false }
      }) as unknown as typeof dialog.showMessageBox
    })
    const responder = (r: number): Promise<void> =>
      sesion.app.evaluate((_e, r) => {
        ;(globalThis as unknown as { __e2eRespuestas: number[] }).__e2eRespuestas.push(r)
      }, r)
    const dialogos = (): Promise<Array<{ title?: string; message?: string; detail?: string; buttons?: string[] }>> =>
      sesion.app.evaluate(() => (globalThis as unknown as { __e2eDialogos: [] }).__e2eDialogos)
    const pulsarX = (): Promise<void> =>
      sesion.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })

    // 0) `before-quit` con «Cancelar»: es el camino de Cmd+Q, de «Salir» y del
    //    `app.quit()` de quien instala una actualización, y pregunta IGUAL que la X
    //    (mismo diálogo, mismos botones). Cancelar lo deja todo como estaba: sin el
    //    `preventDefault` del `before-quit`, Electron cerraría las ventanas igualmente.
    const salir = (): Promise<void> =>
      sesion.app.evaluate(({ app }) => {
        app.quit()
      })
    await responder(2)
    await salir()
    await expect.poll(async () => (await dialogos()).length, { message: 'before-quit no preguntó' }).toBe(1)
    const q = (await dialogos())[0]
    expect(q.buttons).toEqual(['Confirmar y salir', 'Revertir y salir', 'Cancelar'])
    expect(q.detail, 'el diálogo nombra la conexión y la consola').toContain(`${ALIAS} · consola_1`)
    await win.waitForTimeout(500)
    await expect(win.locator('.titlebar'), 'la ventana sigue abierta').toBeVisible()
    await expect(win.locator(`${CONSOLA} .db-consola-tx`), 'la transacción sigue pendiente').toHaveText('Tx pendiente (1)')
    expect(precio(), 'nadie confirmó nada').toBe(confirmado)

    // 1) La X con «Cancelar»: pregunta lo mismo, y la app sigue viva y usable.
    await responder(2)
    await pulsarX()
    await expect.poll(async () => (await dialogos()).length, { message: 'el cierre no preguntó' }).toBe(2)
    const d = (await dialogos())[1]
    expect(d, 'la X y before-quit preguntan lo mismo').toEqual(q)
    await win.waitForTimeout(500)
    await expect(win.locator('.titlebar'), 'la ventana sigue abierta').toBeVisible()
    await expect(win.locator(`${CONSOLA} .db-consola-tx`), 'la transacción sigue pendiente').toHaveText('Tx pendiente (1)')
    expect(precio(), 'nadie confirmó nada').toBe(confirmado)

    // 2) La X otra vez, ahora «Revertir y salir»: vuelve a PREGUNTAR (no cierra a
    //    ciegas), revierte y la app sale.
    const raiz = sesion.app.process().pid
    expect(raiz, 'el proceso lanzado tiene pid').toBeTruthy()
    const antes = procesosDeSesion(raiz!)
    expect(antes.length, 'la prueba abrió al menos un proceso de sesión (el de PG-E2E)').toBeGreaterThan(0)
    s = null
    const cerrada = sesion.app.waitForEvent('close', { timeout: 60_000 })
    await responder(1)
    await pulsarX()
    await cerrada
    expect(precio(), 'se revirtió: sigue el último valor confirmado').toBe(confirmado)
    await expect
      .poll(() => antes.filter((pid) => vivo(pid)), { timeout: 15_000, message: 'procesos de sesión vivos tras cerrar' })
      .toEqual([])
    await sesion.cerrar()
  })
})
