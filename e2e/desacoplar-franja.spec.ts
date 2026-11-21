// =============================================================================
// La franja cambia de documento conservando sus sesiones y vuelve por las tres vías de acople.
// Comprueba la identidad, el búfer y los píxeles de xterm con un agente nativo de prueba.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import type { Event as EventoElectron } from 'electron'
import type { Terminal } from '@xterm/xterm'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, normalize } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, MOD, PLATAFORMA, type SesionTessera } from './tessera'

const TERMINAL = 'section.terminal-panel .terminal-pane[aria-hidden="false"]'
const AGENTE = '.right-panel .agent-pane:not(.hidden)'
const IDIOMAS = {
  es: {
    desacoplar: 'Desacoplar', desacoplarEnVentana: 'Desacoplar en una ventana', pantallaCompleta: 'Pantalla completa',
    maximizarPanel: 'Maximizar el panel de terminal', opcionesMaximizar: 'Más formas de ver el panel',
    acoplar: 'Acoplar', acoplarTitulo: 'Acoplar la terminal y Git', acoplarEnPrincipal: 'Acoplar a la ventana principal', opcionesVista: 'Opciones de la vista',
    git: 'Git · Historial', mostrar: 'Mostrar el agente de la terminal',
    ocultar: 'Ocultar el agente de la terminal',
    maximizar: 'Maximizar Claude Code', restaurar: 'Restaurar terminales', cerrar: 'Cerrar el agente de la terminal',
    soloTerminal: 'Mostrar solo la terminal', vistaCompleta: 'Mostrar la vista completa',
    compactaPorAncho: 'Amplíe la ventana para mostrar la vista completa',
    tituloPerfil: 'Perfil: ', tituloProyecto: 'Proyecto activo: '
  },
  en: {
    desacoplar: 'Undock', desacoplarEnVentana: 'Undock into a window', pantallaCompleta: 'Full screen',
    maximizarPanel: 'Maximize terminal panel', opcionesMaximizar: 'More ways to view the panel',
    acoplar: 'Dock', acoplarTitulo: 'Dock the terminal and Git', acoplarEnPrincipal: 'Dock to the main window', opcionesVista: 'View options',
    git: 'Git · History', mostrar: 'Show the terminal agent',
    ocultar: 'Hide the terminal agent',
    maximizar: 'Maximize Claude Code', restaurar: 'Restore terminals', cerrar: 'Close the terminal agent',
    soloTerminal: 'Show terminal only', vistaCompleta: 'Show full view',
    compactaPorAncho: 'Widen the window to show the full view',
    tituloPerfil: 'Profile: ', tituloProyecto: 'Active project: '
  }
}
type Textos = (typeof IDIOMAS)['es']
/** Ancho (px) por debajo del cual la hija impone la vista compacta (`ANCHO_COMPLETA_FRANJA_MIN`: 480 + 330). */
const ANCHO_HIJA_ESTRECHA = 700

const { PNG } = createRequire(__filename)('playwright-core/lib/utilsBundle') as {
  PNG: { sync: { read: (captura: Buffer) => { data: Buffer } } }
}
type Color = readonly [rojo: number, verde: number, azul: number]

interface PaneVivo {
  nodo: HTMLElement
  terminal: Terminal
  id: string
  leerId: () => string | null
}

type VentanaDePrueba = Window & { panesPruebaFranja?: Record<string, PaneVivo> }

function sembrar(datos: string, proyectos: Record<string, string>): void {
  const perfiles = [
    { id: 'alfa', nombre: 'Alfa', color: '#7a51b2' },
    { id: 'beta', nombre: 'Beta', color: '#338851' }
  ]
  writeFileSync(join(datos, 'profiles.json'), JSON.stringify(perfiles.map((perfil) => ({
    ...perfil, agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${perfil.id}/claude` }],
    sandbox: { habilitado: false }
  }))))
  writeFileSync(join(datos, 'workspace-state.json'), JSON.stringify({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: Object.fromEntries(perfiles.map(({ id }) => [id, {
      activePath: proyectos[id],
      openProjects: [
        { projectHostPath: proyectos[id], name: id, estado: 'active' },
        ...(id === 'alfa' ? [{ projectHostPath: proyectos.alfaDos, name: 'Alfa dos', estado: 'active' }] : [])
      ]
    }])),
    settings: {
      defaultProjectMode: 'windows',
      windowsModeProjects: [`alfa|${proyectos.alfa}`, `alfa|${proyectos.alfaDos}`, `beta|${proyectos.beta}`]
    }
  }))
}

/** Retiene la identidad del pane y lee la sesión y el búfer del xterm que ya usa la app. */
async function guardarPane(pagina: Page, clave: string, selector: string): Promise<void> {
  await expect(pagina.locator(`${selector} .xterm`)).toBeVisible()
  await expect.poll(() => pagina.evaluate(({ clave, selector }) => {
    type Refs = { term?: { current?: Terminal }; sesion?: { current?: string | null; id?: () => string | null } }
    type Gancho = { memoizedState: unknown; next: Gancho | null }
    type Fibra = { memoizedState: Gancho | null; return: Fibra | null }
    const nodo = document.querySelector<HTMLElement>(selector)
    const xterm = nodo?.querySelector('.xterm')
    const anfitrion = xterm?.parentElement
    if (!nodo || !xterm || !anfitrion) return false
    const claveFibra = Object.keys(anfitrion).find((k) => k.startsWith('__reactFiber$'))
    if (!claveFibra) return false
    const fibras = anfitrion as unknown as Record<string, Fibra>
    for (let fibra: Fibra | null = fibras[claveFibra]; fibra; fibra = fibra.return) {
      for (let gancho = fibra.memoizedState; gancho; gancho = gancho.next) {
        const estado = gancho.memoizedState
        const refs = (Array.isArray(estado) ? estado[0] : estado) as Refs | null
        const terminal = refs?.term?.current
        const sesion = refs?.sesion
        if (!terminal || terminal.element !== xterm || !sesion) continue
        const leerId = (): string | null => sesion.id?.() ?? sesion.current ?? null
        const id = leerId()
        if (!id) continue
        const panes = (window as VentanaDePrueba).panesPruebaFranja ??= {}
        if (Object.values(panes).some((pane) => pane.nodo === nodo)) return false
        panes[clave] = { nodo, terminal, id, leerId }
        return true
      }
    }
    return false
  }, { clave, selector })).toBe(true)
}

function comprobarSesion(pagina: Page, clave: string, perfilHija: string | null, selector: string, texto: string): Promise<void> {
  return expect.poll(() => pagina.evaluate(({ clave, perfilHija, selector, texto }) => {
    const pane = (window as VentanaDePrueba).panesPruebaFranja?.[clave]
    if (!pane || !pane.nodo.isConnected || pane.leerId() !== pane.id) return false
    if (!pane.nodo.matches(selector) || pane.nodo.getClientRects().length === 0) return false
    const doc = pane.nodo.ownerDocument
    if (perfilHija === null ? doc !== document : doc === document || !doc.title.endsWith(perfilHija)) return false
    const bufer = pane.terminal.buffer.active
    for (let i = 0; i < bufer.length; i++) {
      const linea = bufer.getLine(i)?.translateToString(true).trim() ?? ''
      if (linea === texto || (texto === 'tick' && /^tick \d+$/.test(linea))) return true
    }
    return false
  }, { clave, perfilHija, selector, texto })).toBe(true)
}

async function comprobarPintado(pagina: Page, selector: string, marca?: Color): Promise<void> {
  await pagina.bringToFront()
  const pantalla = pagina.locator(`${selector} .xterm-screen`)
  await expect(pantalla).toBeVisible()
  await expect.poll(async () => {
    const captura = await pantalla.screenshot({ animations: 'disabled', timeout: 3000 })
    const { data: pixeles } = PNG.sync.read(captura)
    const colores = new Set<number>()
    let pixelesDeMarca = 0
    for (let i = 0; i < pixeles.length; i += 4) {
      colores.add(pixeles.readUInt32LE(i))
      if (marca && marca.every((componente, canal) => Math.abs(pixeles[i + canal] - componente) < 16)) pixelesDeMarca++
    }
    // El cursor puede añadir un segundo color sobre el fondo vacío.
    return colores.size > 2 && (!marca || pixelesDeMarca > 8)
  }, { message: `La pantalla de ${selector} debe pintar texto`, timeout: 10_000 }).toBe(true)
}

async function comprobarPane(
  principal: Page, pagina: Page, clave: string, selector: string, texto: string, perfil?: string, marca?: Color
): Promise<void> {
  await comprobarSesion(principal, clave, perfil ?? null, selector, texto)
  await comprobarPintado(pagina, selector, marca)
}

/**
 * Desacopla el panel desde su cabecera. Con la franja a pantalla completa (maximizar y ocultar viven en el riel) es el
 * icono suelto «Desacoplar»; si no, la flecha de «Maximizar» abre el menú con «Desacoplar en una ventana».
 */
async function pedirDesacople(principal: Page, panel: string, textos: Textos): Promise<void> {
  const cabecera = principal.locator(`${panel} > .panel-header`)
  await cabecera.hover()
  const completa = await principal.locator('.shell').evaluate((el) => /\bfranja-pantalla-completa\b/.test(el.className))
  if (completa) {
    await cabecera.getByRole('button', { name: textos.desacoplar, exact: true }).click()
    return
  }
  await cabecera.getByRole('button', { name: textos.opcionesMaximizar, exact: true }).click()
  await principal.getByRole('menuitem', { name: textos.desacoplarEnVentana, exact: true }).click()
}

function rutaComparable(ruta: string): string {
  let real = normalize(ruta)
  try { real = realpathSync.native(ruta) } catch { /* La carpeta aún puede estar creándose. */ }
  return PLATAFORMA === 'windows' ? real.toLowerCase() : real
}

async function esperarTamanoEstable(pagina: Page, clave: string): Promise<void> {
  let anterior: string | null = null
  await expect.poll(async () => {
    const actual = await pagina.evaluate((clavePane) => {
      const terminal = (window as VentanaDePrueba).panesPruebaFranja?.[clavePane]?.terminal
      return terminal ? `${terminal.cols}x${terminal.rows}` : null
    }, clave)
    const estable = actual !== null && actual === anterior
    anterior = actual
    return estable
  }, { intervals: [250], timeout: 5_000, message: `Esperar un tamaño estable de la terminal ${clave}` }).toBe(true)
}

async function escribirPty(pagina: Page, clave: string, texto: string, color?: Color): Promise<void> {
  await esperarTamanoEstable(pagina, clave)
  const estilo = color ? `38;2;${color.join(';')}m` : null
  const orden = estilo === null ? `echo ${texto}` : PLATAFORMA === 'windows'
    ? `[Console]::WriteLine("$([char]27)[${estilo}${texto}$([char]27)[0m")`
    : `printf '\\033[${estilo}%s\\033[0m\\n' '${texto}'`
  await pagina.evaluate(({ clave, orden }) => {
    const pane = (window as VentanaDePrueba).panesPruebaFranja?.[clave]
    if (!pane) throw new Error('Falta la sesión de prueba')
    window.tessera.terminal.escribir({ sessionId: pane.id, data: `${orden}\r` })
  }, { clave, orden })
}

/**
 * Espera a que el xterm de `clave` deje de cambiar de tamaño. El pty recibe el tamaño con rebote y ConPTY
 * repinta la pantalla al redimensionarse: lo que se escribe a mitad de ese repintado puede quedar sobre
 * restos de la fila anterior.
 */
async function esperarTamanoQuieto(pagina: Page, clave: string): Promise<void> {
  let previo = ''
  await expect.poll(async () => {
    const ahora = await pagina.evaluate((c) => {
      const terminal = (window as VentanaDePrueba).panesPruebaFranja?.[c]?.terminal
      return terminal ? `${terminal.cols}x${terminal.rows}` : ''
    }, clave)
    const quieto = ahora !== '' && ahora === previo
    previo = ahora
    return quieto
  }, { message: 'el tamaño del xterm se asienta', intervals: [600] }).toBe(true)
}

async function cerrarConAspa(app: ElectronApplication, pagina: Page): Promise<void> {
  const ventana = await app.browserWindow(pagina)
  try {
    await ventana.evaluate((nativa) => { setTimeout(() => nativa.close(), 0) })
  } finally {
    await ventana.dispose().catch(() => undefined)
  }
}

async function acotarPrincipal(sesion: SesionTessera, ancho: number, alto: number): Promise<void> {
  const ventana = await sesion.app.browserWindow(sesion.ventana)
  try {
    await ventana.evaluate((nativa, medida) => {
      nativa.unmaximize()
      nativa.setSize(medida.ancho, medida.alto)
    }, { ancho, alto })
  } finally {
    await ventana.dispose()
  }
}

async function comprobarPtySinPrincipalAlFrente(app: ElectronApplication, principal: Page, hija: Page): Promise<void> {
  const nativaPrincipal = await app.browserWindow(principal)
  const nativaHija = await app.browserWindow(hija)
  try {
    await test.step('la hija pinta una línea nueva con la principal minimizada', async (paso) => {
      // La suite de Linux corre en Xvfb sin gestor de ventanas: minimizar no hace nada y ocultar la ventana no
      // detiene los fotogramas de su documento, así que no hay forma de dejar la principal sin pintar.
      paso.skip(PLATAFORMA === 'linux', 'Xvfb no minimiza ventanas')
      const marca: Color = [255, 0, 255]
      await nativaPrincipal.evaluate((ventana) => ventana.minimize())
      try {
        await expect.poll(() => nativaPrincipal.evaluate((ventana) => ventana.isMinimized())).toBe(true)
        await hija.bringToFront()
        await escribirPty(principal, 'shell', 'marca-minimizada', marca)
        await comprobarPane(principal, hija, 'shell', TERMINAL, 'marca-minimizada', 'Alfa', marca)
        expect(await nativaPrincipal.evaluate((ventana) => ventana.isMinimized())).toBe(true)
      } finally {
        await nativaPrincipal.evaluate((ventana) => ventana.restore())
      }
    })

    await test.step('la hija pinta una línea nueva cuando tapa por completo a la principal', async () => {
      const marca: Color = [0, 255, 0]
      const limites = await nativaPrincipal.evaluate((ventana) => ventana.getBounds())
      await nativaHija.evaluate((ventana, limitesPrincipal) => {
        ventana.unmaximize()
        ventana.setBounds(limitesPrincipal)
        ventana.focus()
      }, limites)
      const tapaPrincipal = (): Promise<boolean> => nativaHija.evaluate((ventana, principal) => {
        const hija = ventana.getBounds()
        return ventana.isFocused() && hija.x <= principal.x && hija.y <= principal.y &&
          hija.x + hija.width >= principal.x + principal.width && hija.y + hija.height >= principal.y + principal.height
      }, limites)
      await expect.poll(tapaPrincipal).toBe(true)
      await esperarTamanoQuieto(principal, 'shell')
      await escribirPty(principal, 'shell', 'marca-tapada', marca)
      await comprobarPane(principal, hija, 'shell', TERMINAL, 'marca-tapada', 'Alfa', marca)
      expect(await tapaPrincipal()).toBe(true)
    })
  } finally {
    await nativaHija.dispose()
    await nativaPrincipal.dispose()
  }
}

for (const [idioma, textos] of Object.entries(IDIOMAS)) {
  test(`la franja conserva sus panes entre ventanas (${idioma})`, async () => {
    test.setTimeout(180_000)
    const falso = montarAgenteFalso()
    let sesion: SesionTessera | undefined
    try {
      const proyectos = { alfa: join(falso.raiz, 'alfa'), alfaDos: join(falso.raiz, 'alfa-dos'), beta: join(falso.raiz, 'beta') }
      for (const ruta of Object.values(proyectos)) {
        mkdirSync(ruta)
        writeFileSync(join(ruta, 'LEEME.txt'), 'hola\n')
      }
      sesion = await abrirTessera({ ...falso.env, TESSERA_FORZAR_IDIOMA: idioma }, { sembrar: (datos) => sembrar(datos, proyectos) })
      const { app, datos, ventana: principal } = sesion
      const riel = principal.locator('.activity-bar')
      const acoplar = riel.getByRole('button', { name: textos.acoplar, exact: true })
      const abrirTerminal = riel.getByRole('button', { name: 'Terminal', exact: true })
      const abrirGit = riel.getByRole('button', { name: textos.git, exact: true })
      const bandaProyectos = principal.locator('.tabs-projects')
      const cambiarProyecto = async (nombre: string): Promise<void> => {
        await principal.bringToFront()
        await bandaProyectos.getByText(nombre, { exact: true }).click()
      }
      const comprobarAmbos = async (pagina: Page, perfil?: string): Promise<void> => {
        await comprobarPane(principal, pagina, 'shell', TERMINAL, 'marca-previa', perfil)
        await comprobarPane(principal, pagina, 'agente', AGENTE, 'tick', perfil)
      }
      const desacoplar = async (panel: string, perfil: string): Promise<Page> => {
        await principal.bringToFront()
        const nueva = app.waitForEvent('window', { timeout: 15_000 })
        await pedirDesacople(principal, panel, textos)
        const hija = await nueva
        await expect(hija).toHaveTitle(new RegExp(`^Tessera · .* · ${perfil}$`))
        await expect(hija.locator(panel)).toBeVisible()
        expect(await hija.evaluate(() => typeof window.tessera)).toBe('undefined')
        return hija
      }

      await acotarPrincipal(sesion, 1366, 820)
      await expect(riel.getByRole('button', { name: textos.desacoplar, exact: true })).toHaveCount(0)
      await abrirTerminal.click()
      await guardarPane(principal, 'shell', TERMINAL)
      await escribirPty(principal, 'shell', 'marca-previa')
      await comprobarPane(principal, principal, 'shell', TERMINAL, 'marca-previa')
      await cambiarProyecto('Alfa dos')
      await guardarPane(principal, 'shell-dos', TERMINAL)
      await escribirPty(principal, 'shell-dos', 'marca-alfa-dos')
      await comprobarPane(principal, principal, 'shell-dos', TERMINAL, 'marca-alfa-dos')
      await cambiarProyecto('alfa')
      await principal.locator(`${TERMINAL} .xterm-screen`).click()
      await principal.keyboard.press(`${MOD}+Shift+Enter`)
      await expect(principal.locator('.shell')).toHaveClass(/\bterminal-pantalla-completa\b/)
      await principal.locator('.status-bar').getByRole('button', { name: new RegExp(textos.mostrar) }).click()
      await guardarPane(principal, 'agente', AGENTE)
      const principalAgente = join(sesion.datos, 'terminal', 'alfa')
      const arranquesDelAgente = (): number[] => falso.arranques('claude')
        .filter((a) => rutaComparable(a.cwd) === rutaComparable(principalAgente)).map((a) => a.pid)
      await expect.poll(() => arranquesDelAgente().length).toBe(1)
      const pidAgente = arranquesDelAgente()[0]

      for (const via of ['riel', 'barra', 'aspa'] as const) {
        const hija = await desacoplar('section.terminal-panel', 'Alfa')
        await expect(abrirTerminal).toHaveCount(0)
        await expect(abrirGit).toHaveCount(0)
        await expect(acoplar).toHaveCount(1)
        await expect(principal.locator('.shell-main .terminal-panel, .shell-main .git-log-panel:visible')).toHaveCount(0)
        await comprobarAmbos(hija, 'Alfa')
        await escribirPty(principal, 'shell', `marca-pty-${via}`)
        await comprobarPane(principal, hija, 'shell', TERMINAL, `marca-pty-${via}`, 'Alfa')
        await hija.locator(`${TERMINAL} .xterm-screen`).click()
        await hija.keyboard.type(`echo marca-teclado-${via}`)
        await hija.keyboard.press('Enter')
        await comprobarPane(principal, hija, 'shell', TERMINAL, `marca-teclado-${via}`, 'Alfa')
        if (via === 'riel') {
          const agente = hija.locator(AGENTE)
          await agente.getByRole('button', { name: textos.maximizar, exact: true }).click()
          await expect(hija.locator(`${TERMINAL} .xterm-screen`)).toBeHidden()
          await comprobarPane(principal, hija, 'agente', AGENTE, 'tick', 'Alfa')
          await agente.getByRole('button', { name: textos.restaurar, exact: true }).click()
          await comprobarAmbos(hija, 'Alfa')
          await comprobarPtySinPrincipalAlFrente(app, principal, hija)
          await principal.bringToFront()
          await acoplar.click()
        }
        if (via === 'barra') {
          // «Acoplar» ya no está en la cabecera: es el último botón de la barra lateral de la ventana.
          const cabecera = hija.locator('.terminal-panel > .panel-header')
          await cabecera.hover()
          await expect(cabecera.getByRole('button', { name: textos.acoplar, exact: true })).toHaveCount(0)
          // El clic cierra la ventana que lo recibe: su promesa puede rechazarse aunque el acople se haya hecho.
          await hija.locator('.riel-franja').getByRole('button', { name: textos.acoplar, exact: true }).click().catch(() => undefined)
        }
        if (via === 'aspa') await cerrarConAspa(app, hija)
        await expect.poll(() => hija.isClosed()).toBe(true)
        await expect(abrirTerminal).toBeVisible()
        await expect(abrirGit).toBeVisible()
        await expect(acoplar).toHaveCount(0)
        await expect(principal.locator('.shell')).not.toHaveClass(/\bfranja-pantalla-completa\b/)
        await expect(principal.locator(TERMINAL)).toBeVisible()
        await comprobarPane(principal, principal, 'shell', TERMINAL, 'marca-previa')
        // Sin pantalla completa el agente de la terminal no se ve en la principal, pero su sesión vuelve con ella.
        await expect.poll(() => principal.evaluate(() => {
          const pane = (window as VentanaDePrueba).panesPruebaFranja?.agente
          return Boolean(pane) && pane!.nodo.isConnected && pane!.leerId() === pane!.id && pane!.nodo.ownerDocument === document
        })).toBe(true)
        expect(arranquesDelAgente()).toEqual([pidAgente])
        if (via === 'riel') {
          await cambiarProyecto('Alfa dos')
          await comprobarPane(principal, principal, 'shell-dos', TERMINAL, 'marca-alfa-dos')
          await cambiarProyecto('alfa')
        }
      }

      const alfa = await desacoplar('section.terminal-panel', 'Alfa')
      await comprobarAmbos(alfa, 'Alfa')
      await cambiarProyecto('Alfa dos')
      // El proyecto activo lo dice el pie de la ventana desacoplada, no la cabecera de la terminal.
      await expect(alfa.locator('footer.estado-franja .estado-franja-proyecto')).toHaveText('Alfa dos')
      await expect(alfa.locator('.terminal-panel .panel-title')).toHaveText('Terminal')
      await comprobarPane(principal, alfa, 'shell-dos', TERMINAL, 'marca-alfa-dos', 'Alfa')
      await comprobarPane(principal, alfa, 'agente', AGENTE, 'tick', 'Alfa')
      await cambiarProyecto('alfa')
      await comprobarAmbos(alfa, 'Alfa')
      await principal.bringToFront()
      await principal.locator('.tabs-profiles .profile-tab', { hasText: 'Beta' }).first().click()
      await comprobarAmbos(alfa, 'Alfa')
      await principal.bringToFront()
      await expect(abrirTerminal).toBeVisible()
      await abrirGit.click()
      const beta = await desacoplar('.git-log-panel', 'Beta')
      await expect.poll(() => app.windows().length).toBe(3)
      await principal.bringToFront()
      await principal.locator('.tabs-profiles .profile-tab', { hasText: 'Alfa' }).first().click()
      // Se resuelve en cada lectura: la carpeta nace al mostrar el agente y en macOS `/var` enlaza a `/private/var`.
      const rutaAgenteBeta = join(datos, 'terminal', 'beta')
      const arranquesBeta = (): number[] => falso.arranques('claude')
        .filter((a) => rutaComparable(a.cwd) === rutaComparable(rutaAgenteBeta)).map((a) => a.pid)
      await probarAgenteDelPie(beta, textos, arranquesBeta)
      await comprobarAmbos(alfa, 'Alfa')
      expect(arranquesDelAgente()).toEqual([pidAgente])
      await alfa.locator(AGENTE).getByRole('button', { name: textos.cerrar, exact: true }).click()
      await expect(alfa.locator('.right-panel .agent-pane')).toHaveCount(0)
      await comprobarPane(principal, alfa, 'shell', TERMINAL, 'marca-previa', 'Alfa')
      await principal.bringToFront()
      await acotarPrincipal(sesion, 900, 620)
      await expect.poll(() => principal.evaluate(() => {
        const zonas = [document.documentElement, ...Array.from(document.querySelectorAll('.shell, .shell-main, .shell-main-top'))]
        return zonas.every((el) => el.scrollWidth === el.clientWidth)
      })).toBe(true)

      await cerrarConAspa(app, principal)
      await expect.poll(() => [principal, alfa, beta].every((pagina) => pagina.isClosed()), { timeout: 30_000 }).toBe(true)
    } finally {
      await sesion?.cerrar()
      await borrarTemporal(falso.raiz)
    }
  })
}

interface Escenario {
  app: ElectronApplication
  principal: Page
  abrirTerminal: Locator
  cambiarProyecto: (nombre: string) => Promise<void>
  desacoplar: (panel: string, perfil: string) => Promise<Page>
  arranquesDelAgente: () => number[]
  pidAgente: number
}

/** Levanta la app con el agente de la terminal visible y la terminal de Alfa con una línea conocida. */
async function prepararEscenario(
  falso: ReturnType<typeof montarAgenteFalso>, idioma: string, textos: Textos, ref: { sesion?: SesionTessera },
  prepararAlfa?: (ruta: string) => void
): Promise<Escenario> {
  const proyectos = { alfa: join(falso.raiz, 'alfa'), alfaDos: join(falso.raiz, 'alfa-dos'), beta: join(falso.raiz, 'beta') }
  for (const ruta of Object.values(proyectos)) {
    mkdirSync(ruta)
    writeFileSync(join(ruta, 'LEEME.txt'), 'hola\n')
  }
  prepararAlfa?.(proyectos.alfa)
  const sesion = await abrirTessera({ ...falso.env, TESSERA_FORZAR_IDIOMA: idioma }, { sembrar: (datos) => sembrar(datos, proyectos) })
  ref.sesion = sesion
  const { app, ventana: principal } = sesion
  const abrirTerminal = principal.locator('.activity-bar').getByRole('button', { name: 'Terminal', exact: true })
  const cambiarProyecto = async (nombre: string): Promise<void> => {
    await principal.bringToFront()
    await principal.locator('.tabs-projects').getByText(nombre, { exact: true }).click()
  }
  const desacoplar = async (panel: string, perfil: string): Promise<Page> => {
    await principal.bringToFront()
    const nueva = app.waitForEvent('window', { timeout: 15_000 })
    await pedirDesacople(principal, panel, textos)
    const hija = await nueva
    await expect(hija).toHaveTitle(new RegExp(`^Tessera · .* · ${perfil}$`))
    await expect(hija.locator(panel)).toBeVisible()
    return hija
  }
  await acotarPrincipal(sesion, 1366, 820)
  await abrirTerminal.click()
  await guardarPane(principal, 'shell', TERMINAL)
  await escribirPty(principal, 'shell', 'marca-previa')
  await comprobarPane(principal, principal, 'shell', TERMINAL, 'marca-previa')
  await principal.locator(`${TERMINAL} .xterm-screen`).click()
  await principal.keyboard.press(`${MOD}+Shift+Enter`)
  await expect(principal.locator('.shell')).toHaveClass(/\bterminal-pantalla-completa\b/)
  await principal.locator('.status-bar').getByRole('button', { name: new RegExp(textos.mostrar) }).click()
  await guardarPane(principal, 'agente', AGENTE)
  const rutaAgente = rutaComparable(join(sesion.datos, 'terminal', 'alfa'))
  const arranquesDelAgente = (): number[] => falso.arranques('claude')
    .filter((a) => rutaComparable(a.cwd) === rutaAgente).map((a) => a.pid)
  await expect.poll(() => arranquesDelAgente().length).toBe(1)
  return { app, principal, abrirTerminal, cambiarProyecto, desacoplar, arranquesDelAgente, pidAgente: arranquesDelAgente()[0] }
}

/** La sesión del agente sigue viva en la hija aunque su columna esté oculta (misma identidad, mismo documento). */
function comprobarAgenteConservado(e: Escenario): Promise<void> {
  return expect.poll(() => e.principal.evaluate(() => {
    const pane = (window as VentanaDePrueba).panesPruebaFranja?.agente
    return Boolean(pane) && pane!.nodo.isConnected && pane!.leerId() === pane!.id &&
      pane!.nodo.ownerDocument !== document && pane!.nodo.ownerDocument.title.endsWith('Alfa')
  })).toBe(true)
}

// La navegación cancelada deja a Playwright esperando una navegación de la principal que nunca llega:
// por eso vive en su propio test y ninguna acción posterior depende de esa página.
test('una navegación cancelada en la principal no cierra la ventana de la franja ni sus sesiones', async () => {
  test.setTimeout(180_000)
  const falso = montarAgenteFalso()
  const ref: { sesion?: SesionTessera } = {}
  try {
    const { app, principal, desacoplar } = await prepararEscenario(falso, 'es', IDIOMAS.es, ref)
    const hija = await desacoplar('section.terminal-panel', 'Alfa')
    await comprobarPane(principal, hija, 'shell', TERMINAL, 'marca-previa', 'Alfa')

    // El icono de relanzamiento en disco solo existe en Windows.
    if (PLATAFORMA === 'windows') await test.step('la ventana lleva un icono compuesto con el color de su perfil', async () => {
      const carpeta = join(ref.sesion!.datos, 'iconos-franja')
      await expect.poll(() => (existsSync(carpeta) ? readdirSync(carpeta).filter((n) => /^[0-9a-f]{6}\.ico$/.test(n)).length : 0)).toBe(1)
      const ico = readFileSync(join(carpeta, readdirSync(carpeta)[0]))
      expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 7])
    })

    await test.step('un enlace que la principal bloquea no destruye la hija', async () => {
      const nativa = await app.browserWindow(principal)
      try {
        await nativa.evaluate((ventana) => {
          const contenido = ventana.webContents as typeof ventana.webContents & { navegacionCancelada?: boolean }
          contenido.once('will-navigate', (evento: EventoElectron) => {
            contenido.navegacionCancelada = evento.defaultPrevented
          })
        })
        const original = principal.url()
        await principal.evaluate(() => {
          const enlace = document.createElement('a')
          enlace.href = new URL('archivo-de-prueba.txt', location.href).href
          document.body.append(enlace)
          enlace.click()
          enlace.remove()
        })
        await expect.poll(() => nativa.evaluate((ventana) => (
          ventana.webContents as typeof ventana.webContents & { navegacionCancelada?: boolean }
        ).navegacionCancelada)).toBe(true)
        expect(principal.url()).toBe(original)
        await comprobarPane(principal, hija, 'shell', TERMINAL, 'marca-previa', 'Alfa')
        await comprobarPane(principal, hija, 'agente', AGENTE, 'tick', 'Alfa')
      } finally {
        await nativa.dispose()
      }
    })
  } finally {
    await ref.sesion?.cerrar()
    await borrarTemporal(falso.raiz)
  }
})

test('el lanzador SSH es por perfil y el acople devuelve el formulario abierto a la principal', async () => {
  test.setTimeout(180_000)
  const falso = montarAgenteFalso()
  const ref: { sesion?: SesionTessera } = {}
  try {
    const { app, principal, desacoplar, abrirTerminal } = await prepararEscenario(falso, 'es', IDIOMAS.es, ref)
    const hija = await desacoplar('section.terminal-panel', 'Alfa')
    await comprobarPane(principal, hija, 'shell', TERMINAL, 'marca-previa', 'Alfa')

    const nativaHija = await app.browserWindow(hija)
    try {
      await nativaHija.evaluate((ventana) => ventana.setContentSize(1180, 760))
    } finally {
      await nativaHija.dispose()
    }
    const cabecera = hija.locator('section.terminal-panel > .panel-header')
    await cabecera.hover()
    await cabecera.getByRole('button', { name: IDIOMAS.es.soloTerminal, exact: true }).click()
    await principal.bringToFront()
    await principal.locator('.tabs-profiles .profile-tab', { hasText: 'Beta' }).first().click()
    await abrirTerminal.click()
    const flecha = (pagina: Page): Locator => pagina.locator('section.terminal-panel button.boton-dividido-flecha[aria-haspopup="dialog"]')
    await test.step('abrir el lanzador de Alfa o esconder la terminal de Beta solo afecta a su perfil', async () => {
      await expect(flecha(principal)).toBeVisible()
      await hija.bringToFront()
      await flecha(hija).click()
      await expect(hija.locator('#lanzador-ssh')).toBeVisible()
      await expect(flecha(principal)).toHaveAttribute('aria-expanded', 'false')
      await expect(principal.locator('#lanzador-ssh')).toHaveCount(0)
      await principal.bringToFront()
      await abrirTerminal.click()
      await expect(principal.locator('section.terminal-panel')).toBeHidden()
      await expect(hija.locator('#lanzador-ssh')).toBeVisible()
    })

    await test.step('el acople conserva un formulario abierto en la hija', async () => {
      await hija.bringToFront()
      await hija.locator('#lanzador-ssh').getByRole('button', { name: 'Nueva conexión SSH…' }).click()
      const nombre = 'Nueva conexión SSH'
      const dialogo = hija.getByRole('dialog', { name: nombre, exact: true })
      const alias = '[data-campo="alias"]'
      await dialogo.locator(alias).fill('Faro de prueba')
      await principal.bringToFront()
      await principal.locator('.tabs-profiles .profile-tab', { hasText: 'Alfa' }).first().click()
      await principal.locator('.activity-bar').getByRole('button', { name: IDIOMAS.es.acoplar, exact: true }).click()
      await expect.poll(() => hija.isClosed()).toBe(true)
      const devuelto = principal.getByRole('dialog', { name: nombre, exact: true })
      await expect(devuelto).toBeVisible()
      await expect(devuelto.locator(alias)).toHaveValue('Faro de prueba')
      await devuelto.locator(alias).fill('Faro editado')
      await expect(devuelto.locator(alias)).toHaveValue('Faro editado')
      await principal.keyboard.press('Escape')
      await expect(devuelto).toHaveCount(0)
      await comprobarPane(principal, principal, 'shell', TERMINAL, 'marca-previa')
    })
  } finally {
    await ref.sesion?.cerrar()
    await borrarTemporal(falso.raiz)
  }
})

test('Git·Log desacoplado abre el historial de archivo y su diff en la principal', async () => {
  test.setTimeout(180_000)
  const falso = montarAgenteFalso()
  const ref: { sesion?: SesionTessera } = {}
  try {
    const { principal, desacoplar } = await prepararEscenario(falso, 'es', IDIOMAS.es, ref, (ruta) => {
      const git = (...args: string[]): void => {
        execFileSync('git', ['-c', 'user.name=Pruebas', '-c', 'user.email=pruebas@example.invalid', ...args], {
          cwd: ruta, stdio: 'ignore', timeout: 10_000
        })
      }
      git('init', '-q')
      git('add', 'LEEME.txt')
      git('commit', '-qm', 'Versión inicial')
      writeFileSync(join(ruta, 'LEEME.txt'), 'hola\nsegunda versión\n')
      git('add', 'LEEME.txt')
      git('commit', '-qm', 'Segunda versión')
    })
    const hija = await desacoplar('section.terminal-panel', 'Alfa')
    await principal.bringToFront()
    await principal.locator('.sidebar .tree-row:visible', { hasText: 'LEEME.txt' }).first().click({ button: 'right' })
    await principal.locator('.ctx-menu').getByRole('menuitem', { name: 'Historial del archivo' }).click()
    await expect(hija.locator('.git-log-panel:not(.hidden)')).toBeVisible()
    const historial = principal.getByRole('dialog', { name: 'Historial: LEEME.txt' })
    await expect(historial.locator('.git-hist-fila')).toHaveCount(2, { timeout: 30_000 })
    await expect(historial.locator('.monaco-diff-editor .view-lines').filter({ hasText: 'segunda versión' })).toBeVisible()
    await expect(hija.locator('.monaco-diff-editor')).toHaveCount(0)
    await principal.keyboard.press('Escape')
    await expect(historial).toHaveCount(0)

    await hija.bringToFront()
    await hija.getByRole('tab', { name: 'Historial: LEEME.txt' }).click()
    await expect(historial).toBeVisible()
    await expect.poll(() => principal.evaluate(() => document.hasFocus())).toBe(true)
    await expect(hija.locator('.git-log-panel:not(.hidden)')).toBeVisible()
  } finally {
    await ref.sesion?.cerrar()
    await borrarTemporal(falso.raiz)
  }
})

async function comprobarSinDesborde(pagina: Page): Promise<void> {
  await expect.poll(() => pagina.evaluate(() => {
    const zonas = [document.documentElement, ...Array.from(document.querySelectorAll('.shell, .shell-body, .shell-main'))]
    return zonas.every((el) => el.scrollWidth === el.clientWidth)
  })).toBe(true)
}

async function probarAgenteDelPie(hija: Page, textos: Textos, arranques: () => number[]): Promise<void> {
  await test.step('el pie gobierna el agente de la hija y conserva su sesión al cerrar la última terminal', async () => {
    await hija.bringToFront()
    const pie = hija.locator('footer.estado-franja')
    const mostrar = pie.getByRole('button', { name: new RegExp(`^${textos.mostrar}`) })
    const ocultar = pie.getByRole('button', { name: new RegExp(`^${textos.ocultar}`) })
    await expect(mostrar).toHaveAttribute('aria-pressed', 'false')
    const acorde = PLATAFORMA === 'mac' ? '⌥⌘B' : 'Ctrl+Alt+B'
    await expect(mostrar).toHaveAttribute('title', `${textos.mostrar} (${acorde})`)
    expect(arranques()).toHaveLength(0)
    await mostrar.click()
    await expect(ocultar).toHaveAttribute('aria-pressed', 'true')
    await guardarPane(hija, 'agente', AGENTE)
    await expect.poll(() => arranques().length).toBe(1)
    const primerArranque = arranques()
    await ocultar.click()
    await expect(hija.locator(AGENTE)).toBeHidden()
    await expect(mostrar).toBeEnabled()
    await mostrar.click()
    await comprobarSesion(hija, 'agente', null, AGENTE, 'tick')
    expect(arranques()).toEqual(primerArranque)
    await hija.keyboard.press(PLATAFORMA === 'mac' ? 'Meta+Alt+KeyB' : 'Control+Alt+KeyB')
    await expect(mostrar).toBeEnabled()
    await mostrar.click()

    await hija.locator('.riel-franja').getByRole('button', { name: 'Terminal', exact: true }).click()
    const panel = hija.locator('section.terminal-panel')
    const cerrar = panel.locator('.terminal-tab-kill')
    await expect(cerrar).toHaveCount(1)
    const anchoAgente = (): Promise<number> => hija.locator(AGENTE).evaluate((pane) => pane.getBoundingClientRect().width)
    const anchoConTerminal = await anchoAgente()
    await cerrar.click()
    await expect(cerrar).toHaveCount(0)
    await expect(hija.locator('.ventana-franja')).toHaveClass(/\bterminal-plegada\b/)
    await expect.poll(anchoAgente).toBeGreaterThan(anchoConTerminal)
    await expect(ocultar).toHaveAttribute('aria-pressed', 'true')
    await comprobarSesion(hija, 'agente', null, AGENTE, 'tick')
    await comprobarPintado(hija, AGENTE)
    expect(arranques()).toEqual(primerArranque)
  })
}

/** En la vista compacta el agente está oculto por definición: el pie no pinta su botón (sale con su fundido). */
async function comprobarSinBotonAgente(hija: Page): Promise<void> {
  await expect(hija.locator('footer.estado-franja .status-bar-right button')).toHaveCount(0)
}

async function probarConmutador(e: Escenario, hija: Page, textos: Textos): Promise<void> {
  await test.step('el riel de la hija solo conmuta entre terminal y Git·Log', async () => {
    const riel = hija.locator('.riel-franja')
    const terminal = riel.getByRole('button', { name: 'Terminal', exact: true })
    const git = riel.getByRole('button', { name: textos.git, exact: true })
    const acoplar = riel.getByRole('button', { name: textos.acoplar, exact: true })
    await expect(riel.getByRole('button')).toHaveCount(3)
    await expect(acoplar, 'Acoplar es el último botón de la barra lateral, al final y aparte').toHaveCount(1)
    expect(await riel.getByRole('button').evaluateAll((botones) => botones.map((b) => b.getAttribute('aria-label')).at(-1))).toBe(textos.acoplar)
    expect(await acoplar.evaluate((b) => {
      const hueco = b.closest('nav')!.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom
      return hueco >= 8 && hueco <= 24
    })).toBe(true)
    expect(await acoplar.evaluate((b) => b.getBoundingClientRect().top)).toBeGreaterThan(await git.evaluate((b) => b.getBoundingClientRect().bottom) + 40)
    await expect(acoplar).toHaveAttribute('title', textos.acoplarTitulo)
    await expect(terminal).toHaveAttribute('aria-pressed', 'true')
    await expect(git).toHaveAttribute('aria-pressed', 'false')
    await git.click()
    await expect(hija.locator('.git-log-panel:not(.hidden)')).toBeVisible()
    await expect(hija.locator('section.terminal-panel')).toBeHidden()
    await expect(git).toHaveAttribute('aria-pressed', 'true')
    await expect(terminal).toHaveAttribute('aria-pressed', 'false')
    await terminal.click()
    await expect(terminal).toHaveAttribute('aria-pressed', 'true')
    await expect(hija.locator('.git-log-panel:not(.hidden)')).toHaveCount(0)
    await comprobarPane(e.principal, hija, 'shell', TERMINAL, 'marca-previa', 'Alfa')
    await escribirPty(e.principal, 'shell', 'marca-conmutador')
    await comprobarPane(e.principal, hija, 'shell', TERMINAL, 'marca-conmutador', 'Alfa')
  })
}

async function probarCabeceraDeLaHija(hija: Page, textos: Textos): Promise<void> {
  await test.step('la cabecera de la hija: reiniciar, filete y un solo icono de vista, que no se parece al del agente', async () => {
    const cabecera = hija.locator('section.terminal-panel > .panel-header')
    await cabecera.hover()
    // El conmutador de panel sigue en el DOM, plegado e inerte: el árbol de accesibilidad solo ve lo que se ofrece.
    const nombres = await cabecera.locator('.panel-actions').getByRole('button').evaluateAll((botones) => botones.map((b) => b.getAttribute('aria-label')))
    expect(nombres.slice(1), 'tras reiniciar solo queda la vista: sin acoplar, sin maximizar y sin ocultar').toEqual([textos.soloTerminal])
    await expect(cabecera.locator('.panel-actions-sep')).toHaveCount(1)
    const iconoVista = cabecera.getByRole('button', { name: textos.soloTerminal, exact: true }).locator('svg')
    const iconoAgente = hija.locator('footer.estado-franja .status-bar-right button svg')
    const vista = await iconoVista.evaluate((svg) => svg.innerHTML)
    expect(vista, 'el icono de la vista dibuja un símbolo de terminal (>_)').toContain('M5 6.5l2 1.5-2 1.5')
    expect(vista, 'y no es el de la columna del agente').not.toBe(await iconoAgente.evaluate((svg) => svg.innerHTML))
    expect(await cabecera.evaluate((c) => c.scrollWidth === c.clientWidth)).toBe(true)
  })
}

async function probarPie(e: Escenario, hija: Page, textos: Textos): Promise<void> {
  await test.step('la barra de título está vacía y el pie enseña el perfil y el proyecto activo', async () => {
    await expect(hija).toHaveTitle('Tessera · Terminal · Alfa')
    const barra = hija.locator('.ventana-franja > .titlebar')
    await expect(barra).toBeVisible()
    await expect(barra).toBeEmpty()
    const pie = hija.locator('footer.estado-franja')
    await expect(pie.locator('.estado-franja-perfil')).toHaveText('Alfa')
    await expect(pie.locator('.estado-franja-perfil')).toHaveAttribute('title', `${textos.tituloPerfil}Alfa`)
    await expect(pie.locator('.estado-franja-proyecto')).toHaveText('alfa')
    await expect(pie.locator('.estado-franja-proyecto')).toHaveAttribute('title', `${textos.tituloProyecto}alfa`)
    await e.cambiarProyecto('Alfa dos')
    await expect(pie.locator('.estado-franja-proyecto')).toHaveText('Alfa dos')
    await expect(pie.locator('.estado-franja-proyecto')).toHaveAttribute('title', `${textos.tituloProyecto}Alfa dos`)
    await e.cambiarProyecto('alfa')
    await expect(pie.locator('.estado-franja-proyecto')).toHaveText('alfa')
    await expect(pie.locator('.estado-franja-perfil')).toHaveText('Alfa')
  })
}

async function probarCompactaPorBoton(e: Escenario, hijaInicial: Page, textos: Textos): Promise<Page> {
  let hija = hijaInicial
  const cabecera = (): Locator => hija.locator('section.terminal-panel > .panel-header')
  const boton = (nombre: string): Locator => cabecera().getByRole('button', { name: nombre, exact: true })
  const pulsar = async (nombre: string): Promise<void> => {
    await hija.bringToFront()
    await cabecera().hover()
    await boton(nombre).click()
  }
  const rielLateral = (): Locator => hija.locator('.riel-franja')
  const columnaAgente = (): Locator => hija.locator('.right-panel')
  const rielSsh = (): Locator => hija.locator('.ssh-riel')
  const comprobarCompleta = async (): Promise<void> => {
    await expect(rielLateral()).toBeVisible()
    await expect(columnaAgente()).toBeVisible()
    await expect(boton(textos.git)).toHaveCount(0)
    await expect(boton(textos.soloTerminal)).toHaveAttribute('aria-pressed', 'false')
    // En la vista completa la vista es un icono suelto: sin flecha, y «Acoplar» vive en la barra lateral.
    await expect(boton(textos.opcionesVista)).toHaveCount(0)
    await expect(boton(textos.acoplar)).toHaveCount(0)
    await expect(hija.locator('footer.estado-franja .status-bar-right button')).toHaveCount(1)
  }
  const comprobarCompacta = async (): Promise<void> => {
    await expect(rielLateral()).toBeHidden()
    await expect(columnaAgente()).toBeHidden()
    await comprobarSinBotonAgente(hija)
    await expect(rielSsh()).toBeHidden()
    await expect(boton(textos.git)).toBeVisible()
    await expect(boton(textos.vistaCompleta)).toHaveAttribute('aria-pressed', 'true')
    await expect(boton(textos.opcionesVista)).toHaveAttribute('aria-haspopup', 'menu')
  }

  await test.step('el botón oculta barra, riel SSH y agente sin desmontarlos', async () => {
    await comprobarCompleta()
    await expect(rielLateral()).toHaveCount(1)
    const panesAgente = await hija.locator('.right-panel .agent-pane').count()
    expect(panesAgente).toBeGreaterThan(0)
    // El riel SSH solo existe si la hija lo llegó a enseñar con la franja a pantalla completa.
    const hayRielSsh = (await rielSsh().count()) > 0
    await pulsar(textos.soloTerminal)
    await comprobarCompacta()
    await expect(rielLateral()).toHaveCount(1)
    await expect(hija.locator('.right-panel .agent-pane')).toHaveCount(panesAgente)
    if (hayRielSsh) await expect(rielSsh()).toHaveCount(1)
    await comprobarAgenteConservado(e)
    await comprobarPane(e.principal, hija, 'shell', TERMINAL, 'marca-previa', 'Alfa')
    await escribirPty(e.principal, 'shell', 'marca-compacta')
    await comprobarPane(e.principal, hija, 'shell', TERMINAL, 'marca-compacta', 'Alfa')
    expect(e.arranquesDelAgente()).toEqual([e.pidAgente])
  })

  await test.step('el mismo botón vuelve a la vista completa', async () => {
    await pulsar(textos.vistaCompleta)
    await comprobarCompleta()
    await comprobarPane(e.principal, hija, 'shell', TERMINAL, 'marca-compacta', 'Alfa')
    await comprobarPane(e.principal, hija, 'agente', AGENTE, 'tick', 'Alfa')
    expect(e.arranquesDelAgente()).toEqual([e.pidAgente])
  })

  await test.step('volver a la vista completa desde el menú con teclado deja el foco en el botón de vista', async () => {
    await pulsar(textos.soloTerminal)
    // Ocultar el agente devuelve el teclado a la terminal un fotograma después (`useFocoAlOcultarAgente`): si
    // llegara entre el foco que `press` pone en la flecha y su Intro, la tecla iría al pty y el menú no se abriría.
    await expect(hija.locator(`${TERMINAL} .xterm-helper-textarea`)).toBeFocused()
    await boton(textos.opcionesVista).press('Enter')
    await expect(hija.getByRole('menuitem', { name: textos.vistaCompleta, exact: true })).toBeFocused()
    await hija.keyboard.press('Enter')
    await expect(boton(textos.soloTerminal)).toBeFocused()
    await comprobarCompleta()
    const atajoAgente = PLATAFORMA === 'mac' ? 'Meta+Alt+KeyB' : 'Control+Alt+KeyB'
    await hija.keyboard.press(atajoAgente)
    await expect(columnaAgente()).toBeHidden()
    await hija.keyboard.press(atajoAgente)
    await comprobarCompleta()
  })

  await test.step('la elección sobrevive a acoplar y volver a desacoplar', async () => {
    await pulsar(textos.soloTerminal)
    await comprobarCompacta()
    await cabecera().hover()
    // En la compacta no hay barra lateral: «Acoplar a la ventana principal» está en la flecha de la vista.
    await boton(textos.opcionesVista).click()
    await expect(hija.getByRole('menuitem')).toHaveText([textos.vistaCompleta, textos.acoplarEnPrincipal])
    // El clic cierra la ventana que lo recibe: su promesa puede rechazarse aunque el acople se haya hecho.
    await hija.getByRole('menuitem', { name: textos.acoplarEnPrincipal, exact: true }).click().catch(() => undefined)
    await expect.poll(() => hija.isClosed()).toBe(true)
    await expect(e.abrirTerminal).toBeVisible()
    hija = await e.desacoplar('section.terminal-panel', 'Alfa')
    await comprobarCompacta()
    await comprobarPane(e.principal, hija, 'shell', TERMINAL, 'marca-compacta', 'Alfa')
    await pulsar(textos.vistaCompleta)
    await comprobarCompleta()
    await comprobarPane(e.principal, hija, 'agente', AGENTE, 'tick', 'Alfa')
  })
  return hija
}

async function probarCompactaPorAncho(e: Escenario, hija: Page, textos: Textos): Promise<void> {
  const nativa = await e.app.browserWindow(hija)
  try {
    const original = await nativa.evaluate((ventana) => { ventana.unmaximize(); return ventana.getBounds() })
    const cabecera = hija.locator('section.terminal-panel > .panel-header')
    await test.step('por debajo del ancho mínimo se impone la compacta y el botón se deshabilita', async () => {
      await nativa.evaluate((ventana, ancho) => { ventana.setSize(ancho, ventana.getBounds().height) }, ANCHO_HIJA_ESTRECHA)
      await expect.poll(() => hija.evaluate(() => window.innerWidth)).toBeLessThan(ANCHO_HIJA_ESTRECHA + 40)
      await expect(hija.locator('.riel-franja')).toBeHidden()
      await expect(hija.locator('.right-panel')).toBeHidden()
      await comprobarSinBotonAgente(hija)
      await cabecera.hover()
      const boton = cabecera.getByRole('button', { name: textos.vistaCompleta, exact: true })
      await expect(boton).toBeDisabled()
      await expect(cabecera.locator('.btn-envoltura')).toHaveAttribute('title', textos.compactaPorAncho)
      await expect(cabecera.getByRole('button', { name: textos.git, exact: true })).toBeVisible()
      // La flecha sigue sirviendo para acoplar; «Mostrar la vista completa» sale apagada y explica por qué.
      await cabecera.getByRole('button', { name: textos.opcionesVista, exact: true }).click()
      await expect(hija.getByRole('menuitem', { name: textos.vistaCompleta, exact: true })).toBeDisabled()
      await expect(hija.getByRole('menuitem', { name: textos.vistaCompleta, exact: true })).toHaveAttribute('title', textos.compactaPorAncho)
      await expect(hija.getByRole('menuitem', { name: textos.acoplarEnPrincipal, exact: true })).toBeEnabled()
      await hija.keyboard.press('Escape')
      await expect(hija.getByRole('menu')).toHaveCount(0)
      await expect(cabecera.getByRole('button', { name: textos.opcionesVista, exact: true }), 'Esc devuelve el foco a la flecha').toBeFocused()
      await comprobarPane(e.principal, hija, 'shell', TERMINAL, 'marca-compacta', 'Alfa')
      await comprobarAgenteConservado(e)
    })
    await test.step('en el tamaño mínimo de la ventana nada desborda', async () => {
      await nativa.evaluate((ventana) => { ventana.setSize(100, 100) })
      await expect.poll(() => nativa.evaluate((ventana) => ventana.getBounds().width)).toBe(460)
      await comprobarSinDesborde(hija)
      await expect.poll(() => hija.locator('footer.estado-franja').evaluate((pie) => pie.scrollWidth === pie.clientWidth)).toBe(true)
      await cabecera.hover()
      await expect.poll(() => cabecera.evaluate((c) => {
        const caja = c.getBoundingClientRect()
        const botones = Array.from(c.querySelectorAll('.panel-actions button'), (b) => b.getBoundingClientRect())
        return c.scrollWidth === c.clientWidth && botones.length > 0 && botones.every((b) => b.left >= caja.left && b.right <= caja.right - 4)
      }), 'la cabecera a 460 px no desborda ni pega sus botones al borde').toBe(true)
      await expect(hija.locator(TERMINAL)).toBeVisible()
    })
    await test.step('al ensanchar vuelve la vista completa y se cierra el menú de la flecha', async () => {
      await cabecera.getByRole('button', { name: textos.opcionesVista, exact: true }).click()
      await expect(hija.getByRole('menu')).toBeVisible()
      await nativa.evaluate((ventana, limites) => { ventana.setBounds(limites) }, original)
      await expect(hija.locator('.riel-franja')).toBeVisible()
      await expect(hija.locator('.ctx-menu')).toHaveCount(0)
      await expect(hija.locator('.right-panel')).toBeVisible()
      await cabecera.hover()
      await expect(cabecera.getByRole('button', { name: textos.soloTerminal, exact: true })).toBeEnabled()
      await comprobarAmbosEnHija(e, hija)
    })
  } finally {
    await nativa.dispose()
  }
}

async function comprobarAmbosEnHija(e: Escenario, hija: Page): Promise<void> {
  await comprobarPane(e.principal, hija, 'shell', TERMINAL, 'marca-compacta', 'Alfa')
  await comprobarPane(e.principal, hija, 'agente', AGENTE, 'tick', 'Alfa')
}

async function probarAtajos(e: Escenario, hija: Page, textos: Textos): Promise<void> {
  const nativa = await e.app.browserWindow(hija)
  try {
    await test.step('Ctrl+` en la principal trae la hija al frente y enfoca su terminal', async () => {
      await hija.locator('.riel-franja').getByRole('button', { name: textos.git, exact: true }).click()
      await expect(hija.locator('.git-log-panel:not(.hidden)')).toBeVisible()
      await e.cambiarProyecto('alfa')
      await e.principal.keyboard.press('Control+`')
      await expect(hija.locator('section.terminal-panel')).toBeVisible()
      await expect.poll(() => nativa.evaluate((ventana) => ventana.isFocused())).toBe(true)
      await expect.poll(() => hija.evaluate(() => {
        const activo = document.activeElement
        return document.hasFocus() && activo?.classList.contains('xterm-helper-textarea') === true &&
          activo.closest('.terminal-pane')?.getAttribute('aria-hidden') === 'false'
      })).toBe(true)
    })

    await test.step('Mod+Shift+Intro en la terminal de la hija no acopla ni escribe en el pty', async () => {
      await hija.locator(`${TERMINAL} .xterm-screen`).click()
      await hija.keyboard.type('echo sin-intro')
      await hija.keyboard.press(`${MOD}+Shift+Enter`)
      await hija.keyboard.type('-fin')
      await hija.keyboard.press('Enter')
      // Si el acorde hubiera llegado al pty como Intro, la primera línea se ejecutaría y quedaría "sin-intro" suelto.
      // Una sola palabra: el `echo` de PowerShell escribe cada argumento en su propia línea.
      await expect.poll(() => e.principal.evaluate(() => {
        const bufer = (window as VentanaDePrueba).panesPruebaFranja?.shell?.terminal.buffer.active
        if (!bufer) return false
        const lineas = Array.from({ length: bufer.length }, (_, i) => bufer.getLine(i)?.translateToString(true).trim() ?? '')
        return lineas.some((l) => l === 'sin-intro-fin') && lineas.some((l) => l.endsWith('echo sin-intro-fin')) &&
          !lineas.some((l) => l === 'sin-intro')
      })).toBe(true)
      expect(hija.isClosed()).toBe(false)
      expect(e.app.windows().length).toBe(2)
      await expect(hija.locator('section.terminal-panel')).toBeVisible()
      await expect(e.abrirTerminal).toHaveCount(0)
    })
  } finally {
    await nativa.dispose()
  }
}

for (const [idioma, textos] of Object.entries(IDIOMAS)) {
  test(`la ventana de la franja conmuta, muestra su pie, se compacta y atiende los atajos (${idioma})`, async () => {
    test.setTimeout(240_000)
    const falso = montarAgenteFalso()
    const ref: { sesion?: SesionTessera } = {}
    try {
      const e = await prepararEscenario(falso, idioma, textos, ref)
      let hija = await e.desacoplar('section.terminal-panel', 'Alfa')
      await comprobarPane(e.principal, hija, 'shell', TERMINAL, 'marca-previa', 'Alfa')
      await comprobarPane(e.principal, hija, 'agente', AGENTE, 'tick', 'Alfa')
      await probarCabeceraDeLaHija(hija, textos)
      await probarConmutador(e, hija, textos)
      await probarPie(e, hija, textos)
      hija = await probarCompactaPorBoton(e, hija, textos)
      await probarCompactaPorAncho(e, hija, textos)
      await probarAtajos(e, hija, textos)
    } finally {
      await ref.sesion?.cerrar()
      await borrarTemporal(falso.raiz)
    }
  })
}
