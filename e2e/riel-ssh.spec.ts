// =============================================================================
// El riel de conexiones SSH de la terminal a pantalla completa, sobre la app empaquetada y con un ssh FALSO
// (`sshFalso.ts`): solo existe a pantalla completa; un clic en una conexión abre su pestaña y marca la fila;
// se pliega con «Ocultar la lista» o con su conmutador, y solo con la ventana estrecha; la ▾ del lanzador no
// existe mientras se ve, y el lanzador se cierra con la pantalla completa y se re-ancla con el panel; con
// dos perfiles cada uno guarda su preferencia; el aviso de error respeta su ancho; con grupos el riel deja
// varios abiertos y el lanzador uno. Nada toca la red.
// `TESSERA_E2E_CAPTURAS` guarda capturas.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { montarSshFalso, type SshFalso } from './sshFalso'
import { abrirTessera, borrarTemporal, MOD, type SesionTessera } from './tessera'

/** La terminal que se ve, dentro del panel, y la misma desde la raíz (para mirar dónde está el foco). */
const PANE_VISIBLE = '.terminal-pane[aria-hidden="false"]'
const PANE_VISIBLE_EN_PANEL = `section.terminal-panel ${PANE_VISIBLE}`
const MODO_PANTALLA_COMPLETA = /\bterminal-pantalla-completa\b/

interface Montaje {
  raiz: string
  env: Record<string, string>
  ssh: SshFalso
  proyecto: string
}

/** El agente falso, el ssh falso y un proyecto con una carpeta. */
function montar(): Montaje {
  const { raiz, env } = montarAgenteFalso()
  const ssh = montarSshFalso()
  const proyecto = join(raiz, 'alfa')
  mkdirSync(proyecto)
  writeFileSync(join(proyecto, 'alfa.txt'), 'alfa\n')
  return { raiz, env: { ...env, ...ssh.env }, ssh, proyecto }
}

/** Un perfil sin sandbox con el proyecto abierto en modo nativo (sin Docker ni modal de modo). */
function sembrar(datos: string, m: Montaje): void {
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify([
      {
        id: 'personal',
        nombre: 'Personal',
        color: '#9814c8',
        agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }],
        sandbox: { habilitado: false }
      }
    ])
  )
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: { personal: { openProjects: [{ projectHostPath: m.proyecto, name: 'alfa', estado: 'active' }], activePath: m.proyecto } },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${m.proyecto}`] }
    })
  )
}

/** Lo que dejó la app en su archivo de ajustes sobre el riel: el ancho (global) y qué perfiles lo ocultan. */
function guardado(datos: string): { ancho: number | undefined; visible: Record<string, boolean> | undefined } {
  try {
    const estado = JSON.parse(readFileSync(join(datos, 'workspace-state.json'), 'utf8')) as {
      settings?: { sshRielAncho?: number; sshRielVisiblePorPerfil?: Record<string, boolean> }
    }
    const a = estado.settings
    return { ancho: a?.sshRielAncho, visible: a?.sshRielVisiblePorPerfil }
  } catch {
    // La app lo está reescribiendo en este instante: el sondeo vuelve a mirar.
    return { ancho: undefined, visible: undefined }
  }
}

/** Ancho de un elemento visible, redondeado. */
async function anchoDe(l: Locator): Promise<number> {
  const caja = await l.boundingBox()
  if (caja === null) throw new Error('el elemento no tiene caja')
  return Math.round(caja.width)
}

/** La caja de un elemento visible, con los píxeles redondeados. */
async function cajaDe(l: Locator): Promise<{ x: number; y: number; ancho: number; alto: number }> {
  const caja = await l.boundingBox()
  if (caja === null) throw new Error('el elemento no tiene caja')
  return { x: Math.round(caja.x), y: Math.round(caja.y), ancho: Math.round(caja.width), alto: Math.round(caja.height) }
}

/** Pone el ratón en la cabecera de la terminal: sus acciones se funden en reposo y no se pueden pulsar escondidas. */
async function enCabecera(win: Page): Promise<void> {
  await win.locator('section.terminal-panel .panel-header').first().hover()
}

/** ¿Está el foco dentro de la xterm que se ve? Se mira `document.activeElement`: lo que se teclee llega a la shell. */
function focoEnLaXterm(win: Page): Promise<boolean> {
  return win.evaluate((sel) => Boolean(document.activeElement?.closest(`${sel} .xterm`)), PANE_VISIBLE_EN_PANEL)
}

/** Cuánto se sale de su caja, en píxeles, el documento y el cuerpo de la terminal (0 = nada se desborda). */
function desbordes(win: Page): Promise<{ documento: number; cuerpo: number }> {
  return win.evaluate(() => {
    const d = document.documentElement
    const c = document.querySelector('.terminal-body')
    return { documento: d.scrollWidth - d.clientWidth, cuerpo: c ? c.scrollWidth - c.clientWidth : 0 }
  })
}

/** Captura opcional: solo si quien corre la prueba pide dónde guardarla. */
async function capturar(win: Page, nombre: string): Promise<void> {
  const dir = process.env.TESSERA_E2E_CAPTURAS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await win.screenshot({ path: join(dir, `${nombre}.png`), animations: 'disabled' })
}

/** Los campos del formulario de una conexión, por su `data-campo`. */
function campos(dialogo: Locator): Record<'alias' | 'host' | 'usuario', Locator> {
  const c = (n: string): Locator => dialogo.locator(`[data-campo="${n}"]`)
  return { alias: c('alias'), host: c('host'), usuario: c('usuario') }
}

test.describe.serial('El riel de conexiones SSH a pantalla completa', () => {
  let s: SesionTessera
  let m: Montaje

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.env, { sembrar: (datos) => sembrar(datos, m) })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) {
      await borrarTemporal(m.ssh.raiz)
      await borrarTemporal(m.raiz)
    }
  })

  const panel = (): Locator => s.win.locator('section.terminal-panel')
  const riel = (): Locator => s.win.locator('aside.ssh-riel')
  const divisor = (): Locator => s.win.getByRole('separator', { name: 'Redimensionar la lista de conexiones SSH' })
  /** El conmutador del riel: al extremo izquierdo de la cabecera y solo a pantalla completa. */
  const conmutador = (): Locator => panel().getByRole('button', { name: 'Panel de conexiones' })
  /** La ▾ del botón dividido: abre el lanzador, fuera de la pantalla completa y con el riel plegado. */
  const flecha = (): Locator => panel().getByRole('button', { name: 'Conexiones SSH', exact: true })
  /** La ▾ por su clase y no por su rol: el rol da por inexistente la que se funde en reposo, y aquí importa que NO esté en el DOM. */
  const flechaEnDom = (): Locator => panel().locator('.boton-dividido-flecha')
  /** El «+» del botón dividido y el grupo entero (solo el «+», o el «+» y la ▾). */
  const nueva = (): Locator => panel().getByRole('button', { name: 'Nueva terminal', exact: true })
  const grupoNueva = (): Locator => panel().locator('.boton-dividido')
  const popover = (): Locator => s.win.getByRole('dialog', { name: 'Conexiones SSH' })
  const fila = (alias: string): Locator => riel().getByRole('treeitem', { name: new RegExp(`^${alias},`) })
  const hueco = (): Locator => panel().locator(`${PANE_VISIBLE} .terminal-host`)
  const lienzo = (): Locator => panel().locator(`${PANE_VISIBLE} .xterm-screen`)
  const maximizar = (): Locator => panel().getByRole('button', { name: 'Maximizar el panel de terminal' })
  const restaurar = (): Locator => panel().getByRole('button', { name: 'Restaurar el panel de terminal' })
  /** El mismo botón por su etiqueta y no por su rol: el rol lo da por inexistente mientras se funde en reposo. */
  const maximizarSinRol = (): Locator => panel().locator('button[aria-label="Maximizar el panel de terminal"]')

  /** Lleva la terminal a pantalla completa con el botón, como lo haría quien la usa. */
  async function irAPantallaCompleta(): Promise<void> {
    await enCabecera(s.win)
    await maximizar().click()
    await expect(s.win.locator('.shell')).toHaveClass(MODO_PANTALLA_COMPLETA)
  }

  /** La devuelve a la franja con el botón de restaurar. */
  async function salirDePantallaCompleta(): Promise<void> {
    await enCabecera(s.win)
    await restaurar().click()
    await expect(s.win.locator('.shell')).not.toHaveClass(/\bfranja-pantalla-completa\b/)
  }

  /** Cambia el ancho de la ventana (hasta donde deje la pantalla) y espera a que la app lo vea. */
  async function dimensionar(px: number): Promise<void> {
    await s.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 950), px)
    await expect
      .poll(() => s.win.evaluate((w) => Math.abs(window.innerWidth - Math.min(w, window.screen.availWidth)), px), {
        message: `la ventana pasa a medir unos ${px} px`
      })
      .toBeLessThanOrEqual(40)
  }

  test('el riel solo existe a pantalla completa: sale con la terminal maximizada, con su cabecera y su divisor, y se va al restaurar', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(panel()).toBeVisible()
    await expect(panel().locator('.terminal-tab')).toHaveCount(1)

    // Fuera de pantalla completa no hay riel ni conmutador: la ▾ es la única entrada a las conexiones.
    await expect(riel(), 'en la franja no hay riel').toHaveCount(0)
    await enCabecera(win)
    await expect(conmutador(), 'ni su conmutador').toHaveCount(0)
    await expect(flecha()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(await flecha().getAttribute('aria-pressed'), 'y no es un alternador').toBeNull()

    await irAPantallaCompleta()
    await expect(riel(), 'a pantalla completa el riel se ve').toBeVisible()
    expect(await riel().evaluate((el) => el.tagName), 'es un <aside>').toBe('ASIDE')
    await expect(riel()).toHaveAttribute('aria-label', 'Conexiones SSH')
    expect(await anchoDe(riel()), 'mide 260 px, el ancho del lateral').toBe(260)

    // Su cabecera es la de los laterales: el título y tres acciones.
    await expect(riel().locator('.sidebar-header .sidebar-title')).toHaveText('Conexiones SSH')
    for (const nombre of ['Nueva conexión SSH…', 'Nuevo grupo…', 'Ocultar la lista']) {
      await expect(riel().getByRole('button', { name: nombre }), `la cabecera ofrece «${nombre}»`).toBeVisible()
    }
    await expect(riel().getByText('Sin conexiones SSH en este perfil'), 'sin conexiones, la lista lo dice').toBeVisible()
    await expect(riel().locator('.ssh-riel-cuerpo').getByRole('button'), 'y sin un botón de alta en el cuerpo: el alta es la de la cabecera').toHaveCount(0)

    // El divisor: entre el riel y la pila de terminales, con el rango del lateral.
    await expect(divisor()).toBeVisible()
    await expect(divisor()).toHaveAttribute('aria-valuemin', '180')
    await expect(divisor()).toHaveAttribute('aria-valuenow', '260')
    await expect(divisor()).toHaveAttribute('aria-valuemax', '480')
    const cuerpo = await win.locator('.terminal-body').boundingBox()
    const cajaRiel = await riel().boundingBox()
    const cajaDivisor = await divisor().boundingBox()
    const cajaPila = await win.locator('.terminal-stack').boundingBox()
    expect(cuerpo && cajaRiel && Math.abs(cajaRiel.x - cuerpo.x) <= 1, 'el riel pega con el borde izquierdo del cuerpo').toBe(true)
    expect(cajaRiel && cajaDivisor && cajaDivisor.x >= cajaRiel.x + cajaRiel.width - 1, 'el divisor va a su derecha').toBe(true)
    expect(cajaDivisor && cajaPila && cajaPila.x >= cajaDivisor.x + cajaDivisor.width - 1, 'y la pila de terminales, a la del divisor').toBe(true)

    // Su conmutador: un icono propio al extremo izquierdo de la cabecera, encima del riel que gobierna. Encendido, con su
    // `aria-controls`, y no se funde en reposo (gobierna la columna que tiene debajo).
    await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await win.mouse.move(5, 5)
    await expect(panel().locator('button[aria-label="Nueva terminal"]'), 'en reposo las acciones se funden').toHaveCSS('visibility', 'hidden')
    await expect(panel().locator('button[aria-label="Ocultar el panel de terminal"]'), 'salvo las dos salidas del modo, que se quedan fijas').toBeVisible()
    await expect(conmutador(), 'y el conmutador tampoco: se ve con el ratón fuera del panel').toBeVisible()
    await expect(conmutador()).toHaveAttribute('aria-pressed', 'true')
    await expect(conmutador()).toHaveAttribute('aria-controls', 'ssh-riel')
    await expect(conmutador()).toHaveAttribute('title', 'Ocultar las conexiones')
    const cConmutador = await conmutador().boundingBox()
    const cTitulo = await panel().locator('.panel-title').boundingBox()
    expect(cConmutador && cTitulo && cConmutador.x + cConmutador.width <= cTitulo.x, 'va antes que el título: al extremo izquierdo').toBe(true)
    expect(
      cConmutador && cajaRiel && cConmutador.x >= cajaRiel.x && cConmutador.x + cConmutador.width <= cajaRiel.x + cajaRiel.width,
      'y encima del riel que gobierna'
    ).toBe(true)
    await enCabecera(win)
    await expect(flechaEnDom(), 'con el riel a la vista no hay ▾ (el riel ya es la lista): no está en el DOM, ni escondida').toHaveCount(0)
    await capturar(win, 'riel-ssh-vacio')

    await salirDePantallaCompleta()
    await expect(riel(), 'al restaurar, el riel se va').toHaveCount(0)
    await expect(conmutador(), 'y su conmutador con él').toHaveCount(0)
  })

  test('las altas de la cabecera del riel crean conexiones que salen en su lista', async () => {
    const win = s.win
    await irAPantallaCompleta()
    for (const [alias, host, usuario] of [
      ['Router', '192.0.2.10', 'pruebas'],
      ['Switch', '192.0.2.20', 'admin']
    ]) {
      await riel().getByRole('button', { name: 'Nueva conexión SSH…' }).click()
      const dialogo = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
      await expect(dialogo).toBeVisible()
      const c = campos(dialogo)
      await c.alias.fill(alias)
      await c.host.fill(host)
      await c.usuario.fill(usuario)
      await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
      await expect(dialogo).toHaveCount(0)
      await expect(fila(alias), `«${alias}» sale en el riel`).toBeVisible()
    }
    await expect(riel().getByRole('treeitem')).toHaveCount(2)
    await expect(riel().getByText('Sin conexiones SSH en este perfil')).toHaveCount(0)
    await expect(panel().locator('.terminal-tab.ssh'), 'guardar no abre ninguna pestaña').toHaveCount(0)
  })

  test('un clic en una conexión abre su pestaña, enfoca su xterm y marca su fila; Intro en el filtro hace lo mismo', async () => {
    const win = s.win
    await expect(fila('Router')).not.toHaveAttribute('aria-current', 'true')
    await fila('Router').click()
    const pestana = panel().getByRole('tab', { name: 'Router, SSH' })
    await expect(pestana, 'aparece la pestaña SSH').toBeVisible({ timeout: 30_000 })
    await expect(pestana).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => m.ssh.arranques().length, { message: 'ssh se lanzó una vez' }).toBe(1)
    await expect(panel().locator('.terminal-conectando'), 'la sesión ya dijo algo').toHaveCount(0)

    // El foco pasa a la xterm de la pestaña nueva y no se queda en el riel: lo tecleado llega a la sesión.
    await expect.poll(() => focoEnLaXterm(win), { message: 'tras conectar, el foco está dentro de la xterm', timeout: 30_000 }).toBe(true)
    await win.keyboard.type('hola riel')
    await win.keyboard.press('Enter')
    await expect.poll(() => m.ssh.recibidas(), { message: 'la sesión recibe lo tecleado' }).toContain('hola riel')

    // La fila de la conexión que se ve queda marcada (`aria-current` y una barra), con su recuento.
    await expect(fila('Router')).toHaveAttribute('aria-current', 'true')
    await expect(fila('Switch')).not.toHaveAttribute('aria-current', 'true')
    await expect(riel().getByRole('treeitem', { name: 'Router, pruebas@192.0.2.10, Contraseña, 1 abierta' })).toBeVisible()
    const barra = (l: Locator): Promise<string> => l.evaluate((el) => getComputedStyle(el, '::before').width)
    const contenido = (l: Locator): Promise<string> => l.evaluate((el) => getComputedStyle(el, '::before').content)
    expect(await barra(fila('Router')), 'la fila marcada lleva una barra de 3 px').toBe('3px')
    expect(['none', 'normal'], 'la otra no lleva ninguna').toContain(await contenido(fila('Switch')))
    await capturar(win, 'riel-ssh-con-conexion')

    // La marca sigue a la pestaña que se ve.
    await fila('Switch').click()
    await expect(panel().getByRole('tab', { name: 'Switch, SSH' })).toBeVisible({ timeout: 30_000 })
    await expect(fila('Switch')).toHaveAttribute('aria-current', 'true')
    await expect(fila('Router')).not.toHaveAttribute('aria-current', 'true')
    await pestana.click()
    await expect(fila('Router'), 'elegir otra pestaña mueve la marca').toHaveAttribute('aria-current', 'true')
    await expect(fila('Switch')).not.toHaveAttribute('aria-current', 'true')

    // Intro en el filtro conecta con la fila activa: segunda pestaña de la misma conexión.
    const filtro = riel().getByRole('combobox', { name: 'Buscar conexión' })
    await filtro.fill('rou')
    await filtro.press('Enter')
    await expect(panel().getByRole('tab', { name: 'Router (2), SSH' }), 'Intro abre otra pestaña').toBeVisible({ timeout: 30_000 })
    await expect.poll(() => focoEnLaXterm(win), { message: 'y el foco pasa a su xterm', timeout: 30_000 }).toBe(true)
    await expect(riel().getByRole('treeitem', { name: /^Router, .*, 2 abiertas$/ }), 'la fila cuenta sus dos pestañas').toBeVisible()
    await filtro.fill('')
    await expect.poll(() => m.ssh.arranques().length, { message: 'una sesión por cada conexión abierta' }).toBe(3)
  })

  test('«Ocultar la lista» pliega el riel y la xterm se ensancha; su conmutador lo vuelve a mostrar', async () => {
    const win = s.win
    await expect(riel()).toBeVisible()
    const huecoConRiel = await anchoDe(hueco())
    const lienzoConRiel = await anchoDe(lienzo())

    await riel().getByRole('button', { name: 'Ocultar la lista' }).click()
    await expect(riel(), 'el riel se pliega').toHaveCount(0)
    await expect(divisor(), 'y su divisor con él').toHaveCount(0)
    await expect
      .poll(async () => (await anchoDe(hueco())) - huecoConRiel, { message: 'el hueco de la terminal gana el ancho del riel y su divisor' })
      .toBeGreaterThanOrEqual(260)
    await expect
      .poll(async () => (await anchoDe(lienzo())) - lienzoConRiel, { message: 'y el lienzo de xterm se ensancha (su observador lo reajusta)' })
      .toBeGreaterThan(200)
    // El botón pulsado desaparece con el riel: el foco no se pierde, vuelve a la terminal, y con él el acorde de pantalla completa.
    await expect.poll(() => focoEnLaXterm(win), { message: 'ocultar devuelve el foco a la xterm' }).toBe(true)
    await expect.poll(() => guardado(s.datos).visible?.personal, { message: 'ocultarlo se guarda en el perfil' }).toBe(false)

    // El conmutador lo refleja: apagado, sin `aria-controls` (no hay a qué apuntar) y con el título de lo que haría.
    await expect(conmutador()).toHaveAttribute('aria-pressed', 'false')
    expect(await conmutador().getAttribute('aria-controls'), 'sin riel no apunta a nada').toBeNull()
    await expect(conmutador()).toHaveAttribute('title', 'Mostrar las conexiones')
    await capturar(win, 'riel-ssh-plegado')

    await conmutador().click()
    await expect(riel(), 'el conmutador lo vuelve a mostrar').toBeVisible()
    await expect(popover(), 'y no abre el lanzador').toHaveCount(0)
    await expect(conmutador()).toHaveAttribute('aria-pressed', 'true')
    await expect(conmutador()).toHaveAttribute('aria-controls', 'ssh-riel')
    expect(await anchoDe(riel()), 'con el ancho de antes').toBe(260)
    await expect
      .poll(async () => Math.abs((await anchoDe(hueco())) - huecoConRiel), { message: 'y la xterm vuelve a estrecharse' })
      .toBeLessThanOrEqual(2)
    await expect.poll(() => guardado(s.datos).visible?.personal, { message: 'mostrarlo borra la entrada: verse es lo de por defecto' }).toBeUndefined()
    // Plegar el riel no desmonta nada: las tres pestañas siguen vivas.
    await expect(panel().locator('.terminal-tab.ssh')).toHaveCount(3)
  })

  test('con el riel a la vista la ▾ no existe y el «+» queda como un botón simple; plegado el riel la ▾ vuelve y el «+» no se mueve', async () => {
    const win = s.win
    await expect(riel()).toBeVisible()
    await enCabecera(win)

    // Sin ▾: no está en el DOM (no es una mitad escondida) y el grupo mide lo que el «+», sin hueco ni borde.
    await expect(flechaEnDom(), 'con el riel a la vista no hay ▾').toHaveCount(0)
    await expect(nueva(), 'el «+» conserva su nombre y es el único botón del grupo').toHaveCount(1)
    await expect(grupoNueva().getByRole('button'), 'un solo botón en el grupo').toHaveCount(1)
    const sinFlecha = await cajaDe(nueva())
    expect([sinFlecha.ancho, sinFlecha.alto], 'el «+» mide 24×24').toEqual([24, 24])
    expect((await cajaDe(grupoNueva())).ancho, 'y el grupo no mide más que él: nada del hueco ni de la flecha').toBe(24)

    // Tab: del «+» se pasa a las acciones de la derecha, sin una parada fantasma entre medias.
    await nueva().focus()
    await win.keyboard.press('Tab')
    await expect
      .poll(() => win.evaluate(() => Boolean(document.activeElement?.closest('.panel-actions'))), { message: 'la siguiente parada de Tab está en las acciones' })
      .toBe(true)

    // Plegado el riel, la ▾ vuelve (22×24, a 2 px del «+», que ni se mueve ni cambia de tamaño) y es la siguiente parada de Tab.
    await conmutador().click()
    await expect(riel()).toHaveCount(0)
    await enCabecera(win)
    await expect(flecha(), 'plegado el riel la ▾ vuelve').toBeVisible()
    await expect(flecha()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(await cajaDe(nueva()), 'y el «+» queda donde estaba, del mismo tamaño').toEqual(sinFlecha)
    const conFlecha = await cajaDe(flecha())
    expect([conFlecha.ancho, conFlecha.alto], 'la ▾ mide 22×24').toEqual([22, 24])
    expect(conFlecha.x - (sinFlecha.x + sinFlecha.ancho), 'a 2 px del «+»').toBe(2)
    await nueva().focus()
    await win.keyboard.press('Tab')
    await expect(flecha(), 'con ▾ es la siguiente parada de Tab').toBeFocused()

    // Y se va otra vez al mostrar el riel.
    await conmutador().click()
    await expect(riel()).toBeVisible()
    await enCabecera(win)
    await expect(flechaEnDom()).toHaveCount(0)
    expect(await cajaDe(nueva()), 'y el «+» sigue sin moverse').toEqual(sinFlecha)

    // Con el foco en la ▾, entrar en pantalla completa con el acorde (que no mueve el foco) la quita con el foco puesto
    // en ella: pasa al «+» y no cae en <body>, donde el acorde dejaría de valer.
    await salirDePantallaCompleta()
    await enCabecera(win)
    await flecha().focus()
    await expect(flecha()).toBeFocused()
    await win.keyboard.press(`${MOD}+Shift+Enter`)
    await expect(win.locator('.shell')).toHaveClass(MODO_PANTALLA_COMPLETA)
    await expect(riel()).toBeVisible()
    await expect(flechaEnDom()).toHaveCount(0)
    await expect(nueva(), 'el foco pasó de la ▾ al «+»').toBeFocused()
    await win.keyboard.press(`${MOD}+Shift+Enter`)
    await expect(win.locator('.shell'), 'y el acorde sigue valiendo: sale del modo').not.toHaveClass(/\bfranja-pantalla-completa\b/)
    await irAPantallaCompleta()
  })

  test('la preferencia es del perfil y se recuerda al salir de pantalla completa y volver', async () => {
    await conmutador().click()
    await expect(riel()).toHaveCount(0)
    await expect.poll(() => guardado(s.datos).visible, { message: 'el perfil queda con el riel oculto' }).toEqual({ personal: false })

    await salirDePantallaCompleta()
    await expect(riel()).toHaveCount(0)
    await irAPantallaCompleta()
    await expect(riel(), 'al volver, el riel sigue oculto: es la preferencia, no un estado de la sesión').toHaveCount(0)
    await expect(conmutador()).toHaveAttribute('aria-pressed', 'false')

    await conmutador().click()
    await expect(riel()).toBeVisible()
    await salirDePantallaCompleta()
    await irAPantallaCompleta()
    await expect(riel(), 'y visible también se recuerda').toBeVisible()
  })

  test('con la ventana estrecha el riel se pliega solo sin tocar la preferencia, y reaparece al ensanchar', async () => {
    const win = s.win
    // Se ensancha al máximo con el teclado en el divisor (pasos de 16 px) y se guarda: es global.
    await divisor().focus()
    for (let i = 0; i < 14; i++) await win.keyboard.press('ArrowRight')
    await expect(divisor()).toHaveAttribute('aria-valuenow', '480')
    expect(await anchoDe(riel()), 'el riel mide 480 px, su máximo').toBe(480)
    await expect.poll(() => guardado(s.datos).ancho, { message: 'el ancho se guarda con la espera de los tamaños' }).toBe(480)

    // A 1024 px la terminal conserva más de 420 px y nada se desborda.
    await dimensionar(1024)
    await expect(riel(), 'a 1024 px el riel de 480 todavía cabe').toBeVisible()
    await expect(flechaEnDom(), 'y con él no hay ▾').toHaveCount(0)
    expect(await anchoDe(win.locator('.terminal-stack')), 'la terminal conserva su mínimo').toBeGreaterThanOrEqual(420)
    const desbordeA1024 = await desbordes(win)
    expect(desbordeA1024.documento, 'el documento no se desborda a 1024 px').toBeLessThanOrEqual(1)
    expect(desbordeA1024.cuerpo, 'ni el cuerpo de la terminal').toBeLessThanOrEqual(1)
    await capturar(win, 'riel-ssh-1024')

    // Más estrecha, la terminal quedaría por debajo de 420 px: el riel se pliega, su conmutador se apaga con su porqué y la ▾ deja la lista a mano.
    await dimensionar(900)
    await expect(riel(), 'sin sitio el riel se pliega solo').toHaveCount(0)
    expect((await anchoDe(win.locator('.terminal-body'))) - 480 - 6, 'es porque la terminal quedaría por debajo de 420 px').toBeLessThan(420)
    const desbordeMinimo = await desbordes(win)
    expect(desbordeMinimo.documento, 'sin desbordes a la ventana mínima').toBeLessThanOrEqual(1)
    expect(desbordeMinimo.cuerpo).toBeLessThanOrEqual(1)
    expect(guardado(s.datos).visible?.personal, 'plegarse solo no toca la preferencia del perfil').toBeUndefined()
    expect(guardado(s.datos).ancho, 'ni el ancho elegido').toBe(480)
    await expect(conmutador(), 'sin sitio el conmutador se apaga').toBeDisabled()
    await expect(panel().locator('.panel-header > .btn-envoltura'), 'y dice por qué').toHaveAttribute('title', /No cabe a este ancho/)
    await expect(conmutador(), 'sin tocar su estado: sigue sin pulsar un riel que no se ve').toHaveAttribute('aria-pressed', 'false')
    await enCabecera(win)
    await expect(flecha(), 'y la ▾ vuelve, para que la lista no se quede sin entrada').toBeVisible()
    await flecha().click()
    await expect(popover(), 'y la lista sigue al alcance en el lanzador').toBeVisible()
    await expect(popover().getByRole('treeitem', { name: /^Router,/ })).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)

    // Al ensanchar vuelve solo, con el ancho de siempre y el conmutador otra vez encendido, y la ▾ se va otra vez.
    await dimensionar(1500)
    await expect(riel(), 'al ensanchar el riel reaparece solo').toBeVisible()
    await expect(flechaEnDom()).toHaveCount(0)
    expect(await anchoDe(riel())).toBe(480)
    await expect(conmutador()).toBeEnabled()
    await expect(conmutador()).toHaveAttribute('aria-pressed', 'true')
  })

  test('el lanzador se cierra si con él abierto cambia la pantalla completa o el riel pasa a verse, y se re-ancla si cambia el tamaño del panel', async () => {
    const win = s.win
    await salirDePantallaCompleta()
    await enCabecera(win)
    await flecha().click()
    await expect(popover()).toBeVisible()

    // Cambiar la pantalla completa SIN un clic fuera (que ya lo cerraría): el ancla de la ▾ dejó de valer.
    await maximizarSinRol().dispatchEvent('click')
    await expect(win.locator('.shell')).toHaveClass(MODO_PANTALLA_COMPLETA)
    await expect(popover(), 'al pasar a pantalla completa el lanzador se cierra').toHaveCount(0)
    await salirDePantallaCompleta()

    // Arrastrar el divisor de la franja también cambia el panel: aquí, con el teclado, para no hacer clic fuera.
    await enCabecera(win)
    await flecha().click()
    await expect(popover()).toBeVisible()
    const altoAntes = (await panel().boundingBox())?.height ?? 0
    await win.getByRole('separator', { name: 'Redimensionar el panel inferior' }).focus()
    await win.keyboard.press('ArrowUp')
    await expect.poll(async () => (await panel().boundingBox())?.height ?? 0, { message: 'la franja crece' }).toBeGreaterThan(altoAntes)
    // El foco del teclado sigue en el divisor: Esc solo cierra el lanzador con el foco dentro de él, así que se lo devolvemos.
    // El panel cambió de tamaño: el lanzador se re-ancla al botón en vez de cerrarse (cerrarlo perdía el filtro tecleado).
    await expect(popover(), 'y con ella el lanzador sigue abierto, re-anclado a su botón').toBeVisible()
    await expect
      .poll(async () => Math.abs((await cajaDe(popover())).x - (await cajaDe(grupoNueva())).x), { message: 'alineado con el borde izquierdo del botón' })
      .toBeLessThanOrEqual(2)
    await popover().getByRole('combobox').focus()
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)

    // A pantalla completa y con el riel plegado, que el riel pase a verse quita la ▾ y cierra el lanzador con ella (sin un clic fuera).
    await irAPantallaCompleta()
    await conmutador().click()
    await expect(riel()).toHaveCount(0)
    await enCabecera(win)
    await flecha().click()
    await expect(popover()).toBeVisible()
    await conmutador().dispatchEvent('click')
    await expect(riel()).toBeVisible()
    await expect(popover(), 'al pasar a verse el riel el lanzador se cierra').toHaveCount(0)
    await expect(flechaEnDom()).toHaveCount(0)

    // Cerrado de verdad: al plegar el riel y volver la ▾, el lanzador no se reabre solo.
    await conmutador().click()
    await expect(riel()).toHaveCount(0)
    await enCabecera(win)
    await expect(flecha()).toHaveAttribute('aria-expanded', 'false')
    await expect(popover(), 'el lanzador no se reabre solo').toHaveCount(0)
    await conmutador().click()
    await expect(riel()).toBeVisible()
    await salirDePantallaCompleta()
  })

  test('con grupos, el riel deja abiertos varios a la vez y el lanzador solo uno, sin tocarse entre sí', async () => {
    const win = s.win
    // Dos grupos con dos conexiones cada uno, por la API del preload (Router y Switch siguen sueltas, en «Sin grupo»).
    await win.evaluate(async () => {
      let ip = 40
      for (const nombre of ['Alfa', 'Beta']) {
        const grupo = await window.tessera.ssh.crearGrupo({ profileId: 'personal', nombre })
        for (const n of [1, 2]) {
          const input = { profileId: 'personal', alias: `${nombre} ${n}`, grupoId: grupo.id, host: `192.0.2.${++ip}`, puerto: 22, usuario: 'pruebas' }
          await window.tessera.ssh.crear({ ...input, metodo: 'contrasena', disponibleAgentes: true })
        }
      }
    })
    await irAPantallaCompleta()
    await expect(riel()).toBeVisible()
    const grupoRiel = (nombre: string): Locator => riel().getByRole('treeitem', { name: new RegExp(`^${nombre}, \\d+ conexi`) })
    await expect(grupoRiel('Alfa'), 'en el riel los grupos nacen abiertos').toHaveAttribute('aria-expanded', 'true')
    await expect(grupoRiel('Beta')).toHaveAttribute('aria-expanded', 'true')
    await expect(riel().getByRole('treeitem', { name: /^Alfa 1,/ })).toBeVisible()
    await expect(riel().getByRole('treeitem', { name: /^Beta 1,/ })).toBeVisible()

    // Plegar uno no toca al otro, y desplegarlo vuelve a dejar los dos abiertos: el riel no es un acordeón.
    await grupoRiel('Alfa').click()
    await expect(grupoRiel('Alfa')).toHaveAttribute('aria-expanded', 'false')
    await expect(grupoRiel('Beta'), 'plegar «Alfa» no cierra «Beta»').toHaveAttribute('aria-expanded', 'true')
    await grupoRiel('Alfa').click()
    await expect(grupoRiel('Alfa')).toHaveAttribute('aria-expanded', 'true')
    await expect(grupoRiel('Beta'), 'abrir «Alfa» no cierra «Beta»: dos abiertos a la vez').toHaveAttribute('aria-expanded', 'true')
    await capturar(win, 'riel-ssh-con-grupos')

    // El lanzador es otra cosa y no convive con el riel (mientras este se ve no hay ▾): se abre con el riel plegado,
    // entra con todo plegado y deja abierto solo un grupo a la vez.
    await conmutador().click()
    await expect(riel()).toHaveCount(0)
    await enCabecera(win)
    await flecha().click()
    await expect(popover()).toBeVisible()
    const grupoLanzador = (nombre: string): Locator => popover().getByRole('treeitem', { name: new RegExp(`^${nombre}, \\d+ conexi`) })
    for (const nombre of ['Sin grupo', 'Alfa', 'Beta']) {
      await expect(grupoLanzador(nombre), `«${nombre}» entra plegado (se mira «Router», de «Sin grupo», y no abre el suyo)`).toHaveAttribute('aria-expanded', 'false')
    }
    await capturar(win, 'riel-ssh-lanzador-plegado')
    await grupoLanzador('Alfa').click()
    await expect(grupoLanzador('Alfa')).toHaveAttribute('aria-expanded', 'true')
    await grupoLanzador('Beta').click()
    await expect(grupoLanzador('Beta')).toHaveAttribute('aria-expanded', 'true')
    await expect(grupoLanzador('Alfa'), 'abrir uno cierra el otro: solo uno a la vez').toHaveAttribute('aria-expanded', 'false')
    await grupoLanzador('Sin grupo').click()
    await expect(grupoLanzador('Sin grupo'), '«Sin grupo» se abre como cualquier otro').toHaveAttribute('aria-expanded', 'true')
    await expect(grupoLanzador('Beta')).toHaveAttribute('aria-expanded', 'false')
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)

    // El riel no se enteró: al mostrarlo sigue con sus dos grupos abiertos.
    await conmutador().click()
    await expect(riel()).toBeVisible()
    await expect(grupoRiel('Alfa'), 'el riel sigue con sus dos grupos abiertos').toHaveAttribute('aria-expanded', 'true')
    await expect(grupoRiel('Beta')).toHaveAttribute('aria-expanded', 'true')

    // Reabierto no recuerda el último grupo que quedó abierto: vuelve a entrar todo plegado.
    await conmutador().click()
    await expect(riel()).toHaveCount(0)
    await enCabecera(win)
    await flecha().click()
    for (const nombre of ['Sin grupo', 'Alfa', 'Beta']) {
      await expect(grupoLanzador(nombre), `«${nombre}» vuelve plegado`).toHaveAttribute('aria-expanded', 'false')
    }
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)

    // Al abrir una conexión desde el riel, el lanzador la pone la primera de las recientes, sin abrir su grupo.
    await conmutador().click()
    await expect(riel()).toBeVisible()
    await riel().getByRole('treeitem', { name: /^Alfa 1,/ }).click()
    await expect(panel().getByRole('tab', { name: 'Alfa 1, SSH' })).toBeVisible({ timeout: 30_000 })
    await conmutador().click()
    await expect(riel()).toHaveCount(0)
    await enCabecera(win)
    await flecha().click()
    await expect(grupoLanzador('Alfa'), 'se mira «Alfa 1», pero su grupo no se abre solo').toHaveAttribute('aria-expanded', 'false')
    await expect(grupoLanzador('Beta')).toHaveAttribute('aria-expanded', 'false')
    await expect(popover().getByRole('treeitem').first(), 'y es la primera de las recientes').toHaveAccessibleName(/^Reciente, Alfa 1,/)
    await win.keyboard.press('Escape')
  })
})

/** Dos perfiles: «Personal», con el proyecto abierto, y «Trabajo», sin ninguno (su terminal enseña el estado vacío). */
function sembrarDosPerfiles(datos: string, m: Montaje): void {
  const perfil = (id: string, nombre: string, color: string): Record<string, unknown> => ({
    id,
    nombre,
    color,
    agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
    sandbox: { habilitado: false }
  })
  writeFileSync(join(datos, 'profiles.json'), JSON.stringify([perfil('personal', 'Personal', '#9814c8'), perfil('trabajo', 'Trabajo', '#1478c8')]))
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: { personal: { openProjects: [{ projectHostPath: m.proyecto, name: 'alfa', estado: 'active' }], activePath: m.proyecto } },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${m.proyecto}`] }
    })
  )
}

test.describe.serial('El riel de conexiones SSH con dos perfiles, a ventana estrecha y con foco', () => {
  let s: SesionTessera
  let m: Montaje

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.env, { sembrar: (datos) => sembrarDosPerfiles(datos, m) })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) {
      await borrarTemporal(m.ssh.raiz)
      await borrarTemporal(m.raiz)
    }
  })

  const panel = (): Locator => s.win.locator('section.terminal-panel')
  const riel = (): Locator => s.win.locator('aside.ssh-riel')
  const conmutador = (): Locator => panel().getByRole('button', { name: 'Panel de conexiones' })
  const popover = (): Locator => s.win.getByRole('dialog', { name: 'Conexiones SSH' })
  const filtroRiel = (): Locator => riel().getByRole('combobox', { name: 'Buscar conexión' })
  const perfil = (nombre: string): Locator => s.win.locator('.profile-tab', { hasText: nombre }).first()

  /** Cambia de perfil y deja su terminal a la vista: el panel se abre por perfil, y uno sin proyecto nace con él cerrado. */
  async function irAPerfil(nombre: string): Promise<void> {
    await perfil(nombre).click()
    if (!(await panel().isVisible())) await s.win.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(panel()).toBeVisible()
  }

  async function irAPantallaCompleta(): Promise<void> {
    await enCabecera(s.win)
    await panel().getByRole('button', { name: 'Maximizar el panel de terminal' }).click()
    await expect(s.win.locator('.shell')).toHaveClass(MODO_PANTALLA_COMPLETA)
  }

  async function salirDePantallaCompleta(): Promise<void> {
    await enCabecera(s.win)
    await panel().getByRole('button', { name: 'Restaurar el panel de terminal' }).click()
    await expect(s.win.locator('.shell')).not.toHaveClass(/\bfranja-pantalla-completa\b/)
  }

  async function dimensionar(px: number): Promise<void> {
    await s.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 950), px)
    await expect
      .poll(() => s.win.evaluate((w) => Math.abs(window.innerWidth - Math.min(w, window.screen.availWidth)), px), {
        message: `la ventana pasa a medir unos ${px} px`
      })
      .toBeLessThanOrEqual(40)
  }

  test('cada perfil guarda su preferencia del riel: ocultarlo en uno no toca al otro', async () => {
    const win = s.win
    // Una conexión por perfil, por la API del preload: el riel de cada uno enseña solo las suyas.
    await win.evaluate(async () => {
      for (const [profileId, alias, host] of [
        ['personal', 'Router', '192.0.2.10'],
        ['trabajo', 'Bastion', '192.0.2.50']
      ]) {
        await window.tessera.ssh.crear({ profileId, alias, grupoId: null, host, puerto: 22, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true })
      }
    })
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(panel()).toBeVisible()

    await irAPerfil('Personal')
    await irAPantallaCompleta()
    await expect(riel(), 'Personal: el riel se ve por defecto').toBeVisible()
    await expect(riel().getByRole('treeitem', { name: /^Router,/ })).toBeVisible()
    await riel().getByRole('button', { name: 'Ocultar la lista' }).click()
    await expect(riel()).toHaveCount(0)
    await salirDePantallaCompleta()

    await irAPerfil('Trabajo')
    await irAPantallaCompleta()
    await expect(riel(), 'Trabajo no heredó la preferencia de Personal').toBeVisible()
    await expect(riel().getByRole('treeitem', { name: /^Bastion,/ }), 'y enseña sus conexiones, no las de Personal').toBeVisible()
    await expect(riel().getByRole('treeitem', { name: /^Router,/ })).toHaveCount(0)
    await expect(conmutador()).toHaveAttribute('aria-pressed', 'true')
    await salirDePantallaCompleta()

    await irAPerfil('Personal')
    await irAPantallaCompleta()
    await expect(riel(), 'al volver a Personal sigue oculto: la preferencia es suya').toHaveCount(0)
    await expect(conmutador()).toHaveAttribute('aria-pressed', 'false')
    await salirDePantallaCompleta()
  })

  test('«Conectar por SSH…» del estado vacío: con el riel plegado abre el lanzador sin tocar la preferencia; con el riel a la vista enfoca su filtro', async () => {
    const win = s.win
    // «Trabajo» no tiene proyecto: su terminal enseña el estado vacío con el botón.
    await irAPerfil('Trabajo')
    await irAPantallaCompleta()
    const vacio = panel().locator('.pane-empty')
    await expect(riel()).toBeVisible()
    await vacio.getByRole('button', { name: 'Conectar por SSH…' }).click()
    await expect(filtroRiel(), 'con el riel a la vista el foco va a su filtro').toBeFocused()
    await expect(popover(), 'y no se abre el lanzador').toHaveCount(0)

    await conmutador().click()
    await expect(riel()).toHaveCount(0)
    await vacio.getByRole('button', { name: 'Conectar por SSH…' }).click()
    await expect(popover(), 'con el riel plegado abre el lanzador').toBeVisible()
    await expect(conmutador(), 'sin tocar la preferencia: el riel sigue plegado').toHaveAttribute('aria-pressed', 'false')
    await expect(riel()).toHaveCount(0)
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)

    await conmutador().click()
    await expect(riel()).toBeVisible()
    await salirDePantallaCompleta()
  })

  test('volver a pantalla completa con la ventana estrecha no monta el riel ni un instante (useAnchoDe); el aviso de error del riel respeta su ancho', async () => {
    const win = s.win
    await irAPerfil('Personal')
    await irAPantallaCompleta()
    await conmutador().click()
    await expect(riel()).toBeVisible()
    // Con el ancho por defecto el riel cabe a 900 px: se ensancha al máximo (480, global y guardado) para que sin sitio se pliegue.
    await s.win.getByRole('separator', { name: 'Redimensionar la lista de conexiones SSH' }).focus()
    for (let i = 0; i < 30; i++) await win.keyboard.press('ArrowRight')
    await expect(s.win.getByRole('separator', { name: 'Redimensionar la lista de conexiones SSH' })).toHaveAttribute('aria-valuenow', '480')
    await salirDePantallaCompleta()
    await dimensionar(900)
    // Un observador que anota si el riel llegó a montarse, aunque fuera un fotograma.
    await win.evaluate(() => {
      const w = window as unknown as { __rielMontado?: boolean }
      w.__rielMontado = false
      new MutationObserver((cambios) => {
        for (const c of cambios) {
          for (const n of Array.from(c.addedNodes)) {
            if (n instanceof HTMLElement && (n.matches('aside.ssh-riel') || n.querySelector('aside.ssh-riel'))) w.__rielMontado = true
          }
        }
      }).observe(document.body, { childList: true, subtree: true })
    })
    await irAPantallaCompleta()
    await expect(riel(), 'a esta anchura no hay sitio para el riel').toHaveCount(0)
    await expect(conmutador(), 'y su conmutador está apagado').toBeDisabled()
    expect(await win.evaluate(() => (window as unknown as { __rielMontado?: boolean }).__rielMontado), 'ni se montó un instante').toBe(false)
    const d = await desbordes(win)
    expect(d.documento, 'nada se desborda').toBeLessThanOrEqual(1)
    expect(d.cuerpo).toBeLessThanOrEqual(1)

    // Con sitio vuelve; entonces se comprueba el límite de error con un aviso inyectado (no hay forma de romper el riel desde fuera).
    await dimensionar(1500)
    await expect(riel()).toBeVisible()
    const ancho = await anchoDe(riel())
    const medidas = await win.evaluate(() => {
      const limite = document.querySelector('.ssh-riel-limite')
      if (!limite) return null
      const aviso = document.createElement('div')
      aviso.className = 'error-boundary-pane'
      aviso.id = 'aviso-inyectado-e2e'
      aviso.textContent = 'Fallo de prueba'
      limite.appendChild(aviso)
      const caja = aviso.getBoundingClientRect()
      const pila = document.querySelector('.terminal-stack')?.getBoundingClientRect()
      const cuerpo = document.querySelector('.terminal-body')?.getBoundingClientRect()
      aviso.remove()
      return { aviso: Math.round(caja.width), pila: Math.round(pila?.width ?? 0), cuerpo: Math.round(cuerpo?.width ?? 0) }
    })
    expect(medidas, 'el límite de error existe').not.toBeNull()
    expect(medidas?.aviso, 'el aviso mide lo que el riel y no se reparte la fila con la terminal').toBe(ancho)
    expect(medidas?.pila ?? 0, 'la terminal conserva el resto').toBeGreaterThanOrEqual(420)
    await salirDePantallaCompleta()
  })
})
