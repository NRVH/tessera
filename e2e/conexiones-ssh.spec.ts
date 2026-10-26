// =============================================================================
// Las conexiones SSH del perfil en la terminal, sobre la app empaquetada y con un ssh FALSO
// (`sshFalso.ts`, vía `TESSERA_SSH_BINARIO`): el botón dividido y su lanzador de conexiones (todo plegado al
// abrirlo, un solo grupo abierto), los grupos, el formulario y la lista de su selector «Grupo»,
// «Guardar» (solo guarda), las pestañas SSH del perfil, «Reconectar», «No se pudo conectar», «Disponible para
// los agentes», editar y eliminar, el archivo de clave y la contraseña guardada (el programa de contraseñas
// de verdad contra el falso), «Probar» y «Olvidar la huella guardada», la ▾ con el perfil vacío a pantalla
// completa y «Importar desde OpenSSH…». Nada toca la red.
// `TESSERA_E2E_CAPTURAS` guarda capturas.
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { BANNER_FALSO, HOST_QUE_FALLA, HUELLA_FALSA, HUELLA_NUEVA_FALSA, montarSshFalso, type SshFalso } from './sshFalso'
import { abrirTessera, borrarTemporal, MOD, PLATAFORMA, type SesionTessera } from './tessera'

interface Montaje {
  raiz: string
  env: Record<string, string>
  ssh: SshFalso
  rutas: { alfa: string; beta: string }
}

/** El agente falso, el ssh falso y dos proyectos con una carpeta cada uno. */
function montar(): Montaje {
  const { raiz, env } = montarAgenteFalso()
  const ssh = montarSshFalso()
  const rutas = { alfa: join(raiz, 'alfa'), beta: join(raiz, 'beta') }
  for (const [nombre, ruta] of Object.entries(rutas)) {
    mkdirSync(ruta)
    writeFileSync(join(ruta, `${nombre}.txt`), `${nombre}\n`)
  }
  return { raiz, env: { ...env, ...ssh.env }, ssh, rutas }
}

/** Un perfil sin sandbox con los dos proyectos abiertos en modo nativo (sin Docker ni modal de modo). */
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
      byProfile: {
        personal: {
          openProjects: [
            { projectHostPath: m.rutas.alfa, name: 'alfa', estado: 'active' },
            { projectHostPath: m.rutas.beta, name: 'beta', estado: 'active' }
          ],
          activePath: m.rutas.alfa
        }
      },
      settings: {
        defaultProjectMode: 'windows',
        windowsModeProjects: [`personal|${m.rutas.alfa}`, `personal|${m.rutas.beta}`]
      }
    })
  )
}

/** Deja que React confirme el render provocado por el gesto (dos fotogramas). */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Pone el ratón en la cabecera de la terminal: sus acciones se funden en reposo y no se pueden pulsar escondidas. */
async function enCabecera(win: Page): Promise<void> {
  await win.locator('section.terminal-panel .panel-header').first().hover()
}

/** Número de coincidencias que anuncia el buscador de la terminal (`3 coincidencias` o `1 / 3`). */
function totalDe(etiqueta: string): number {
  const m = /(\d+) coincidencias|\d+ \/ (\d+)/.exec(etiqueta)
  return m ? Number(m[1] ?? m[2]) : 0
}

/**
 * Cuántas veces sale `texto` en el búfer de la terminal que se ve, con el buscador de la propia
 * terminal: mira el búfer y no el dibujo, así que vale igual con WebGL que con el renderer DOM.
 */
async function contarEnTerminal(win: Page, texto: string): Promise<number> {
  const pane = win.locator('section.terminal-panel .terminal-pane[aria-hidden="false"]')
  await pane.locator('.xterm-screen').click()
  await win.keyboard.press(`${MOD}+f`)
  const buscador = pane.locator('.search-box')
  await expect(buscador).toBeVisible()
  const entrada = buscador.locator('.search-box-input')
  await entrada.fill(texto)
  await entrada.press('Enter')
  const cuenta = totalDe(await buscador.locator('.search-box-count').innerText())
  await buscador.getByRole('button', { name: 'Cerrar buscador' }).click()
  return cuenta
}

/** Espera a que la terminal que se ve tenga `texto` exactamente `n` veces. */
async function esperarEnTerminal(win: Page, texto: string, n: number, mensaje: string): Promise<void> {
  await expect.poll(() => contarEnTerminal(win, texto), { message: mensaje, timeout: 30_000 }).toBe(n)
}

/** Teclea una línea en la terminal que se ve y pulsa Intro. */
async function teclear(win: Page, linea: string): Promise<void> {
  await win.locator('section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm-screen').click()
  await asentar(win)
  await win.keyboard.type(linea)
  await win.keyboard.press('Enter')
}

/** Lo que el archivo de ajustes guarda del lanzador del perfil `personal`: a propósito, ningún grupo abierto. */
function lanzadorGuardado(datos: string): { grupoAbierto: unknown } {
  try {
    const estado = JSON.parse(readFileSync(join(datos, 'workspace-state.json'), 'utf8')) as {
      settings?: { sshGrupoAbiertoPorPerfil?: unknown }
    }
    return { grupoAbierto: estado.settings?.sshGrupoAbiertoPorPerfil }
  } catch {
    // La app lo está reescribiendo en este instante: el sondeo vuelve a mirar.
    return { grupoAbierto: undefined }
  }
}

/** Captura opcional: solo si quien corre la prueba pide dónde guardarla. */
async function capturar(win: Page, nombre: string): Promise<void> {
  const dir = process.env.TESSERA_E2E_CAPTURAS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await win.screenshot({ path: join(dir, `${nombre}.png`), animations: 'disabled' })
}

/** Los campos del formulario de una conexión, por su `data-campo`. */
function campos(dialogo: Locator): Record<'alias' | 'grupo' | 'host' | 'puerto' | 'usuario' | 'secreto', Locator> {
  const c = (n: string): Locator => dialogo.locator(`[data-campo="${n}"]`)
  return { alias: c('alias'), grupo: c('grupo'), host: c('host'), puerto: c('puerto'), usuario: c('usuario'), secreto: c('secreto') }
}

test.describe.serial('Las conexiones SSH del perfil en la terminal', () => {
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
  /** La ▾ del botón dividido: abre el lanzador de conexiones. */
  const flecha = (): Locator => panel().getByRole('button', { name: 'Conexiones SSH', exact: true })
  const popover = (): Locator => s.win.getByRole('dialog', { name: 'Conexiones SSH' })
  const menu = (nombre: string): Locator => s.win.getByRole('menuitem', { name: nombre })
  /** La cabecera de un grupo por su nombre: «Nombre, N conexión» o «N conexiones». */
  const cabeceraGrupo = (lista: Locator, nombre: string): Locator => lista.getByRole('treeitem', { name: new RegExp(`^${nombre}, \\d+ conexi`) })

  /** Despliega un grupo del lanzador; si ya estaba abierto no hace nada. */
  async function abrirGrupo(lista: Locator, nombre: string): Promise<void> {
    const cabecera = cabeceraGrupo(lista, nombre)
    if ((await cabecera.getAttribute('aria-expanded')) !== 'true') await cabecera.click()
    await expect(cabecera, `«${nombre}» queda abierto`).toHaveAttribute('aria-expanded', 'true')
  }

  /** Guarda el alta (guardar solo guarda) y abre la conexión desde el lanzador: el filtro con su nombre e Intro. */
  async function guardarYConectar(dialogo: Locator, alias: string): Promise<void> {
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    const lista = await abrirLista()
    await lista.getByRole('combobox', { name: 'Buscar conexión' }).fill(alias)
    await s.win.keyboard.press('Enter')
    await expect(popover()).toHaveCount(0)
  }

  /** Abre el lanzador con la ▾ de la cabecera y, si se pide, deja abierto ese grupo. */
  async function abrirLista(grupo?: string): Promise<Locator> {
    await enCabecera(s.win)
    await flecha().click()
    await expect(popover()).toBeVisible()
    if (grupo !== undefined) await abrirGrupo(popover(), grupo)
    return popover()
  }

  test('la flecha del botón dividido es una parada de Tab aparte y abre el lanzador de conexiones, no un menú: ↓, Intro y Espacio la abren, el filtro toma el foco y Esc lo devuelve a ella', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(panel()).toBeVisible()
    await expect(panel().locator('.terminal-tab')).toHaveCount(1)
    await enCabecera(win)
    const principal = panel().getByRole('button', { name: 'Nueva terminal' })
    await expect(principal, 'la principal conserva su nombre «Nueva terminal» y es la única').toHaveCount(1)
    await expect(flecha(), 'la flecha tiene otro nombre que no contiene «Nueva terminal»').toHaveAttribute('aria-haspopup', 'dialog')
    await expect(flecha()).toHaveAttribute('aria-expanded', 'false')
    await expect(panel().getByRole('button', { name: /conexion/i }), 'una sola entrada a lo SSH en la cabecera: se acabó el botón «Conexiones»').toHaveCount(1)
    // Medidas del diseño: la principal 24×24, la flecha 22×24 y 2 px entre las dos.
    const cp = await principal.boundingBox()
    const cf = await flecha().boundingBox()
    expect([cp?.width, cp?.height], 'la principal mide 24×24').toEqual([24, 24])
    expect([cf?.width, cf?.height], 'la flecha mide 22×24').toEqual([22, 24])
    expect(cf && cp ? Math.round(cf.x - (cp.x + cp.width)) : null, 'dos píxeles entre las mitades').toBe(2)
    await capturar(win, 'ssh-boton-dividido')

    // El reinicio ya no está pegado a la ▾: es el primero del grupo de la derecha, entre filetes.
    const reiniciar = panel().getByRole('button', { name: 'Reiniciar terminal' })
    await expect(panel().locator('.panel-actions').getByRole('button', { name: 'Reiniciar terminal' }), 'el reinicio vive en las acciones de la derecha').toHaveCount(1)
    await expect(panel().locator('.terminal-tabs-zona').getByRole('button', { name: 'Reiniciar terminal' }), 'y no en la zona de pestañas').toHaveCount(0)
    await expect(panel().locator('.panel-actions .panel-actions-sep'), 'dos filetes: reinicio | pantalla completa | ocultar').toHaveCount(2)
    const cr = await reiniciar.boundingBox()
    expect(cf && cr ? cr.x - (cf.x + cf.width) : 0, 'lejos de la ▾ (un clic errado ya no lo dispara)').toBeGreaterThan(100)

    // Dos paradas de Tab: de la principal se pasa a la flecha.
    await principal.focus()
    await win.keyboard.press('Tab')
    await expect(flecha(), 'la flecha es la siguiente parada de Tab').toBeFocused()

    const abierto = async (tecla: string, motivo: string): Promise<void> => {
      await win.keyboard.press(tecla)
      await expect(popover(), motivo).toBeVisible()
      await expect(win.getByRole('menu'), 'es un diálogo, no un menú').toHaveCount(0)
      await expect(flecha()).toHaveAttribute('aria-expanded', 'true')
      await expect(flecha()).toHaveAttribute('aria-controls', 'lanzador-ssh')
      await expect(popover().getByRole('combobox', { name: 'Buscar conexión' }), 'el filtro tiene el foco al abrir').toBeFocused()
      await win.keyboard.press('Escape')
      await expect(popover()).toHaveCount(0)
      await expect(flecha(), 'Esc devuelve el foco a la flecha').toBeFocused()
      await expect(flecha()).toHaveAttribute('aria-expanded', 'false')
      await expect(flecha()).not.toHaveAttribute('aria-controls', /.+/)
    }
    await abierto('ArrowDown', '↓ abre el lanzador')
    await abierto('Enter', 'Intro abre el lanzador')
    await abierto('Space', 'Espacio abre el lanzador')
  })

  test('con el perfil sin conexiones ni grupos, a pantalla completa, la ▾ falta con el riel a la vista, vuelve al plegarlo y su lanzador dice que no hay nada y ofrece las dos altas', async () => {
    const win = s.win
    await enCabecera(win)
    await panel().getByRole('button', { name: 'Maximizar el panel de terminal' }).click()
    await expect(win.locator('.shell')).toHaveClass(/\bterminal-pantalla-completa\b/)
    const riel = win.locator('aside.ssh-riel')
    await expect(riel, 'a pantalla completa el riel enseña la lista').toBeVisible()
    await expect(riel.getByText('Sin conexiones SSH en este perfil'), 'vacía, y sin botón de alta repetido en su cuerpo').toBeVisible()
    await expect(flecha(), 'con el riel a la vista no hay ▾').toHaveCount(0)

    const conmutador = panel().getByRole('button', { name: 'Panel de conexiones' })
    await conmutador.click()
    await expect(riel, 'plegado a mano').toBeHidden()
    await enCabecera(win)
    await expect(flecha(), 'con el riel plegado la ▾ vuelve, aunque no haya conexiones ni grupos').toBeVisible()
    await flecha().click()
    await expect(popover()).toBeVisible()
    await expect(popover().getByText('Sin conexiones SSH en este perfil'), 'el lanzador de un perfil vacío lo dice').toBeVisible()
    await expect(popover().getByRole('button', { name: 'Nueva conexión SSH…' }), 'y ofrece las dos altas').toBeVisible()
    await expect(popover().getByRole('button', { name: 'Nuevo grupo…' })).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)

    // Se deja todo como estaba: el riel a la vista y el panel restaurado.
    await conmutador.click()
    await expect(riel).toBeVisible()
    await panel().getByRole('button', { name: 'Restaurar el panel de terminal' }).click()
    await expect(win.locator('.shell')).not.toHaveClass(/\bterminal-pantalla-completa\b/)
  })

  test('lanzador → «Nuevo grupo…» crea un grupo y aparece en la lista; sin conexiones ni grupos el pie ya ofrece las dos altas', async () => {
    const win = s.win
    const vacia = await abrirLista()
    await expect(vacia.getByText('Sin conexiones SSH en este perfil'), 'un perfil vacío lo dice').toBeVisible()
    await expect(vacia.getByRole('button', { name: 'Nueva conexión SSH…' }), 'y el pie ofrece las dos altas').toBeVisible()
    await expect(vacia.locator('.ssh-vacio'), 'sin un segundo botón igual en el cuerpo').toHaveCount(0)
    await vacia.getByRole('button', { name: 'Nuevo grupo…' }).click()
    await expect(popover(), 'abrir un diálogo cierra el lanzador').toHaveCount(0)
    const dialogo = win.getByRole('dialog', { name: 'Nuevo grupo' })
    await expect(dialogo).toBeVisible()
    // Los botones no van pegados al campo: el mismo aire que deja el mensaje de una confirmación (18 px). Se
    // sondea porque la tarjeta entra escalándose y solo al terminar la animación la medida es la final.
    await expect
      .poll(
        async () => {
          const campo = await dialogo.getByRole('textbox', { name: 'Nombre del grupo' }).boundingBox()
          const crear = await dialogo.getByRole('button', { name: 'Crear' }).boundingBox()
          return campo && crear ? Math.round(crear.y - (campo.y + campo.height)) : null
        },
        { message: 'entre el campo y los botones hay 18 px' }
      )
      .toBe(18)
    await dialogo.getByRole('textbox', { name: 'Nombre del grupo' }).fill('Servidores')
    await dialogo.getByRole('button', { name: 'Crear' }).click()
    await expect(dialogo).toHaveCount(0)

    const lista = await abrirLista()
    await expect(cabeceraGrupo(lista, 'Servidores'), 'el grupo vacío se ve en la lista').toHaveAccessibleName('Servidores, 0 conexiones')
    // El lanzador: 360 px, alineado al borde izquierdo del botón dividido, sin taparlo (sale hacia arriba si abajo no cabe)
    // y por debajo del menú contextual (1000).
    const cp = await lista.boundingBox()
    const cg = await panel().locator('.boton-dividido').boundingBox()
    expect(cp?.width, 'mide 360 px').toBe(360)
    expect(cp && cg ? Math.abs(cp.x - cg.x) : null, 'alineado al borde izquierdo del botón dividido').toBeLessThanOrEqual(1)
    expect(cp && cg ? cp.y + cp.height <= cg.y + 1 || cp.y >= cg.y + cg.height - 1 : null, 'no tapa al botón').toBe(true)
    await expect(lista).toHaveCSS('z-index', '900')
    await capturar(win, 'ssh-lista-con-grupo')
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)
  })

  test('en el formulario, «Nuevo grupo…» abre un diálogo anidado: Esc cierra solo ese, y el grupo creado queda elegido', async () => {
    const win = s.win
    const lista = await abrirLista()
    await lista.getByRole('button', { name: 'Nueva conexión SSH…' }).click()
    const dialogo = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    await expect(dialogo).toBeVisible()
    await expect(campos(dialogo).alias, 'el nombre tiene el foco al abrir').toBeFocused()
    await expect(campos(dialogo).puerto, 'el puerto nace en 22').toHaveValue('22')
    await expect(dialogo.getByRole('radio', { name: 'Contraseña' }), 'la contraseña es el método por defecto').toBeChecked()
    await expect(dialogo.getByText('Tessera puede guardarla cifrada y darla sola al conectar.')).toBeVisible()
    await expect(campos(dialogo).secreto, 'con su campo, vacío y sin «(sin cambios)» en un alta').toHaveAttribute('placeholder', '')
    await expect(dialogo.getByRole('radio', { name: 'Archivo de clave' }), 'el archivo de clave se ofrece, sin elegir').not.toBeChecked()

    await dialogo.getByRole('button', { name: 'Nuevo grupo…' }).click()
    const anidado = win.getByRole('dialog', { name: 'Nuevo grupo' })
    await expect(anidado).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(anidado, 'Esc cierra solo el diálogo de encima').toHaveCount(0)
    await expect(dialogo, 'y el formulario sigue abierto').toBeVisible()

    await dialogo.getByRole('button', { name: 'Nuevo grupo…' }).click()
    await anidado.getByRole('textbox', { name: 'Nombre del grupo' }).fill('Producción')
    await win.keyboard.press('Enter')
    await expect(anidado).toHaveCount(0)
    await expect(campos(dialogo).grupo.locator('option:checked'), 'el grupo recién creado queda elegido').toHaveText('Producción')

    await win.keyboard.press('Escape')
    await expect(dialogo, 'un segundo Esc cierra el formulario').toHaveCount(0)
  })

  test('el selector «Grupo» despliega la lista de Tessera, redondeada y por encima del modal; flechas, Intro, escribir y Esc la manejan sin cerrar el diálogo', async () => {
    const win = s.win
    const alta = await abrirLista()
    await alta.getByRole('button', { name: 'Nueva conexión SSH…' }).click()
    const dialogo = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    await expect(dialogo).toBeVisible()
    const c = campos(dialogo)
    const abierta = (): Promise<boolean> => c.grupo.evaluate((el) => el.matches(':open'))
    const enfocada = (): Promise<string> => win.evaluate(() => document.activeElement?.textContent ?? '')
    const grupos = await c.grupo.locator('option').allTextContents()
    expect(grupos, 'ofrece «Sin grupo» y los dos grupos creados').toHaveLength(3)

    // El control cerrado es el personalizable y mide lo de siempre, 30 px (se sondea: la tarjeta entra escalándose).
    await expect(c.grupo, 'la «select personalizable» y no la lista del sistema').toHaveCSS('appearance', 'base-select')
    await expect.poll(async () => (await c.grupo.boundingBox())?.height, { message: 'cerrado, sigue midiendo 30 px' }).toBe(30)

    // Con el ratón: la lista sale de la capa superior, con la piel de los menús, y todas sus opciones se ven encima del modal.
    await c.grupo.click()
    await expect.poll(abierta, { message: 'el clic abre la lista' }).toBe(true)
    const piel = await c.grupo.evaluate((el) => {
      const lista = getComputedStyle(el, '::picker(select)')
      // El fondo del menú contextual, resuelto a color con una sonda: `--bg-elevated` es un token del tema.
      const sonda = document.body.appendChild(document.createElement('i'))
      sonda.style.background = 'var(--bg-elevated)'
      const fondoMenu = getComputedStyle(sonda).backgroundColor
      sonda.remove()
      return { radio: lista.borderTopLeftRadius, filete: lista.borderTopWidth, fondo: lista.backgroundColor, sombra: lista.boxShadow, fondoMenu }
    })
    expect([piel.radio, piel.filete], 'redondeada y con filete, como el menú contextual').toEqual(['6px', '1px'])
    expect(piel.fondo, 'con el fondo del menú contextual').toBe(piel.fondoMenu)
    expect(piel.sombra, 'y su sombra').not.toBe('none')
    const encima = await win.evaluate(() =>
      Array.from(document.querySelectorAll('[data-campo="grupo"] option')).map((o) => {
        const r = o.getBoundingClientRect()
        const dentro = r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight
        return dentro && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === o
      })
    )
    expect(encima, 'las tres opciones, enteras y encima de todo').toEqual([true, true, true])
    await capturar(win, 'ssh-select-grupo-abierto')

    // Teclado, con la lista abierta: ↓ mueve el foco a la opción siguiente (no elige), Intro elige y cierra, y el foco vuelve al selector.
    await expect.poll(enfocada, { message: 'al abrir, el foco está en lo elegido' }).toBe(grupos[0])
    await win.keyboard.press('ArrowDown')
    await expect.poll(enfocada, { message: '↓ baja a la siguiente' }).toBe(grupos[1])
    await expect(c.grupo.locator('option:checked'), '↓ no elige: sigue «Sin grupo»').toHaveText(grupos[0])
    await win.keyboard.press('Enter')
    await expect.poll(abierta, { message: 'Intro cierra la lista' }).toBe(false)
    await expect(c.grupo.locator('option:checked'), 'y elige la opción').toHaveText(grupos[1])
    await expect(c.grupo, 'el foco vuelve al selector').toBeFocused()
    await expect(dialogo, 'Intro en la lista no cierra ni envía el formulario').toBeVisible()
    await expect(c.alias, 'ni marca lo que falta').not.toHaveAttribute('aria-invalid', 'true')

    // La tecla que abre el selector cerrado es la del sistema: Intro en Windows y Espacio en macOS, donde
    // Chromium no lo abre con Intro (como Safari y el sistema). Escribir salta a la opción que empieza así;
    // Esc la cierra SOLO a ella.
    const teclaAbrir = PLATAFORMA === 'mac' ? 'Space' : 'Enter'
    await win.keyboard.press(teclaAbrir)
    await expect.poll(abierta, { message: `${teclaAbrir} abre la lista` }).toBe(true)
    await win.keyboard.type(grupos[2].slice(0, 3))
    await expect.poll(enfocada, { message: 'escribir salta a la opción que empieza así' }).toBe(grupos[2])
    await win.keyboard.press('Escape')
    await expect.poll(abierta, { message: 'Esc cierra la lista' }).toBe(false)
    await expect(dialogo, 'y solo la lista: el diálogo sigue abierto').toBeVisible()
    await expect(c.grupo.locator('option:checked'), 'sin elegir nada: saltar no es elegir').toHaveText(grupos[1])

    // Un segundo Esc, ya sin lista, sí cierra el diálogo.
    await win.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
  })

  test('lanzador → «Nueva conexión SSH…» → «Guardar» (solo guarda) y conectar: la pestaña SSH sale a la izquierda de las locales y ssh recibe la línea', async () => {
    const win = s.win
    const alta = await abrirLista()
    await alta.getByRole('button', { name: 'Nueva conexión SSH…' }).click()
    const dialogo = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    const c = campos(dialogo)

    // Marcas solo tras intentar guardar, y el foco al primer campo que falta.
    await expect(dialogo.getByRole('button', { name: 'Guardar y conectar' }), 'guardar solo guarda: no hay «Guardar y conectar»').toHaveCount(0)
    await expect(c.host).not.toHaveAttribute('aria-invalid', 'true')
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(c.alias).toHaveAttribute('aria-invalid', 'true')
    await expect(c.alias, 'el foco va al primer campo que falta').toBeFocused()
    await expect(dialogo, 'sin lo obligatorio no se guarda').toBeVisible()

    await c.alias.fill('Router')
    await c.grupo.selectOption({ label: 'Servidores' })
    await c.host.fill('192.0.2.10')
    await c.puerto.fill('2222')
    await c.usuario.fill('pruebas')
    await capturar(win, 'ssh-formulario')
    // Con el banner retrasado se ve el «Conectando a…» hasta el primer dato.
    m.ssh.retardo(2_500)
    await guardarYConectar(dialogo, 'Router')

    const pestana = panel().getByRole('tab', { name: 'Router, SSH' })
    await expect(pestana, 'aparece la pestaña SSH').toBeVisible({ timeout: 30_000 })
    await expect(panel().locator('.terminal-tab.ssh')).toHaveCount(1)
    await expect(pestana.locator('.terminal-tab-icono svg'), 'con su icono de servidor').toBeVisible()
    await expect(pestana).toHaveAttribute('aria-selected', 'true')
    await expect(panel().locator('.terminal-tabs-filete'), 'un filete la separa de las locales').toHaveCount(1)
    const cajaSsh = await pestana.boundingBox()
    const cajaLocal = await panel().locator('.terminal-tab:not(.ssh)').first().boundingBox()
    expect(cajaSsh && cajaLocal && cajaSsh.x < cajaLocal.x, 'la SSH va a la izquierda de las locales').toBe(true)

    const conectando = panel().locator('.terminal-conectando')
    const hueco = panel().locator('.terminal-pane[aria-hidden="false"] .terminal-host')
    await expect(conectando.locator('.terminal-conectando-texto'), 'mientras ssh no dice nada se ve «Conectando a…»').toHaveText('Conectando a pruebas@192.0.2.10:2222…')
    await expect(conectando.getByRole('button', { name: 'Cancelar' }), 'y se puede cancelar').toBeVisible()
    await expect(conectando).toHaveAttribute('role', 'status')
    await expect(conectando, 'es una capa absoluta: no empuja a la xterm').toHaveCSS('position', 'absolute')
    const altoHueco = (await hueco.boundingBox())?.height
    await esperarEnTerminal(win, BANNER_FALSO, 1, 'el ssh falso arrancó y escribió su banner')
    m.ssh.retardo(0)
    await expect(conectando, 'el «Conectando a…» se retira con el primer dato').toHaveCount(0)
    expect((await hueco.boundingBox())?.height, 'y la xterm no cambió de alto').toBe(altoHueco)
    await expect.poll(() => m.ssh.arranques().length, { message: 'ssh se lanzó una vez' }).toBe(1)
    const argv = m.ssh.arranques()[0]
    expect(argv[argv.indexOf('-F') + 1], '-F none: sin la configuración del usuario').toBe('none')
    expect(argv[argv.indexOf('-p') + 1]).toBe('2222')
    expect(argv[argv.indexOf('-l') + 1]).toBe('pruebas')
    expect(argv.indexOf('--'), 'siempre `--` antes del host').toBeGreaterThan(argv.indexOf('-l'))
    expect(argv[argv.length - 1], 'y el host va el último').toBe('192.0.2.10')
    await capturar(win, 'ssh-pestana')

    // El grupo de la conexión que se mira NO se abre solo: todo entra plegado.
    const lista = await abrirLista()
    await expect(cabeceraGrupo(lista, 'Servidores'), 'el grupo de la conexión que se mira no se abre solo').toHaveAttribute('aria-expanded', 'false')
    await expect(cabeceraGrupo(lista, 'Producción'), 'ni ningún otro').toHaveAttribute('aria-expanded', 'false')
    await abrirGrupo(lista, 'Servidores')
    await expect(lista.getByRole('treeitem', { name: /^Router, pruebas@192\.0\.2\.10:2222, Contraseña, 1 abierta$/ }), 'en su grupo, su fila también cuenta la pestaña').toBeVisible()
    await capturar(win, 'ssh-lista-con-conexion')
    await win.keyboard.press('Escape')
  })

  test('la pestaña SSH sigue al cambiar de proyecto y al cerrarlos todos, y su sesión no se relanza', async () => {
    const win = s.win
    const pestana = panel().getByRole('tab', { name: 'Router, SSH' })
    await win.locator('.tabs-projects .project-tab', { hasText: 'beta' }).first().click()
    await expect(win.locator('.tabs-projects .project-tab.active', { hasText: 'beta' })).toHaveCount(1)
    await expect(pestana, 'sigue en la tira al cambiar de proyecto').toBeVisible()
    await expect(pestana, 'cada proyecto recuerda cuál mira: en beta se ve su terminal local').toHaveAttribute('aria-selected', 'false')
    await pestana.click()
    await expect(pestana).toHaveAttribute('aria-selected', 'true')
    await esperarEnTerminal(win, BANNER_FALSO, 1, 'es la misma sesión de antes, no una nueva')

    const cerrar = async (nombre: string): Promise<void> => {
      const p = win.locator('.tabs-projects .project-tab', { hasText: nombre }).first()
      await p.hover()
      await p.getByRole('button', { name: `Cerrar ${nombre}` }).click()
      await win.getByRole('dialog', { name: 'Cerrar proyecto' }).getByRole('button', { name: 'Cerrar', exact: true }).click()
      await expect(win.locator('.tabs-projects .project-tab', { hasText: nombre })).toHaveCount(0)
    }
    await cerrar('alfa')
    await cerrar('beta')
    await expect(win.locator('.tabs-projects .project-tab')).toHaveCount(0)

    await expect(pestana, 'sin ningún proyecto la pestaña SSH sigue').toBeVisible()
    await expect(pestana).toHaveAttribute('aria-selected', 'true')
    await expect(panel().locator('.pane-empty'), 'y el estado vacío no la tapa').toHaveCount(0)
    await expect(panel().locator('.terminal-tab:not(.ssh)'), 'las locales eran de los proyectos').toHaveCount(0)
    expect(m.ssh.arranques().length, 'nada relanzó la sesión').toBe(1)
    await teclear(win, 'hola')
    await expect.poll(() => m.ssh.recibidas(), { message: 'la sesión sigue viva y recibe lo tecleado' }).toContain('hola')

    // Sin proyecto no hay terminal local, y la flecha sigue ofreciendo lo de SSH.
    await enCabecera(win)
    const principal = panel().getByRole('button', { name: 'Nueva terminal' })
    await expect(principal).toBeDisabled()
    await expect(panel().locator('.boton-dividido .btn-envoltura')).toHaveAttribute('title', 'Abre un proyecto para tener una terminal local')
    await expect(flecha()).toBeEnabled()
    await flecha().click()
    await expect(popover().getByRole('button', { name: 'Nueva conexión SSH…' }), 'el lanzador sigue ofreciendo las altas de SSH').toBeEnabled()
    await win.keyboard.press('Escape')
    await capturar(win, 'ssh-sin-proyecto')
  })

  test('escribir «exit» termina la sesión: «La sesión terminó», el ● y la franja; Intro reconecta, «Cancelar» corta la conexión y «Reconectar» la vuelve a abrir', async () => {
    const win = s.win
    const pestana = panel().getByRole('tab', { name: 'Router, SSH' })
    await teclear(win, 'exit')
    await esperarEnTerminal(win, 'La sesión terminó', 1, 'la xterm cuenta que terminó')
    await esperarEnTerminal(win, 'Pulsa Intro', 1, 'y dice cómo volver a conectar')
    await expect(pestana, 'desconectada').toHaveAccessibleName('Router, SSH, desconectada')
    await expect(pestana.locator('.terminal-tab-dead'), 'con el ● como único indicador').toBeVisible()
    const franja = panel().locator('.terminal-fin-ssh')
    await expect(franja.locator('.terminal-fin-ssh-motivo'), 'la franja dice qué pasó').toHaveText('La sesión terminó')
    const reconectar = franja.getByRole('button', { name: 'Reconectar' })
    await expect(reconectar, 'y ofrece «Reconectar»').toBeEnabled()
    await enCabecera(win)
    await expect(panel().locator('.panel-actions').getByRole('button', { name: 'Reconectar' }), 'la cabecera ya no reconecta').toHaveCount(0)
    await capturar(win, 'ssh-desconectada')

    m.ssh.retardo(5_000)
    await teclear(win, '')
    await expect.poll(() => m.ssh.arranques().length, { message: 'Intro reconecta' }).toBe(2)
    const cancelar = panel().locator('.terminal-conectando').getByRole('button', { name: 'Cancelar' })
    await cancelar.click()
    await expect(franja.locator('.terminal-fin-ssh-motivo'), 'cancelar deja la franja con su motivo').toHaveText('Conexión cancelada')
    m.ssh.retardo(0)

    await reconectar.click()
    await expect.poll(() => m.ssh.arranques().length, { message: 'ssh arrancó otra vez' }).toBe(3)
    await esperarEnTerminal(win, BANNER_FALSO, 1, 'el banner nuevo aparece')
    await expect(franja, 'la franja se va al reconectar').toHaveCount(0)
    await expect(pestana, 'ya no está desconectada').toHaveAccessibleName('Router, SSH')
    await expect(pestana.locator('.terminal-tab-dead')).toHaveCount(0)
  })

  /** Abre el formulario de una conexión nueva desde el menú de un grupo del lanzador (con el grupo ya elegido). */
  async function altaEnGrupo(grupo: string): Promise<Locator> {
    const lista = await abrirLista()
    await cabeceraGrupo(lista, grupo).click({ button: 'right' })
    await menu('Nueva conexión en este grupo…').click()
    const dialogo = s.win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    return dialogo
  }

  test('una conexión que no se resuelve termina con «No se pudo conectar» y su motivo', async () => {
    const win = s.win
    const dialogo = await altaEnGrupo('Producción')
    const c = campos(dialogo)
    await expect(c.grupo.locator('option:checked'), 'el grupo del que se abrió el alta viene elegido').toHaveText('Producción')
    await c.alias.fill('Falla')
    await c.host.fill(HOST_QUE_FALLA)
    await c.usuario.fill('pruebas')
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(panel().getByRole('tab', { name: /^Falla, SSH/ }), 'guardar no abre la conexión').toHaveCount(0)

    const abierta = await abrirLista('Producción')
    await expect(abierta.getByRole('treeitem', { name: /^Falla, pruebas@falla\.invalid, Contraseña/ }), 'la conexión quedó guardada en el grupo del que se abrió').toBeVisible()
    await abierta.getByRole('combobox', { name: 'Buscar conexión' }).fill('Falla')
    await win.keyboard.press('Enter')
    await expect(popover()).toHaveCount(0)
    const falla = panel().getByRole('tab', { name: /^Falla, SSH/ })
    await expect(falla).toBeVisible({ timeout: 30_000 })
    await esperarEnTerminal(win, 'No se pudo conectar', 1, 'el 255 temprano es «No se pudo conectar»')
    await esperarEnTerminal(win, 'falta la VPN', 1, 'con el motivo que clasificó el main')
    await expect(falla, 'la pestaña queda desconectada').toHaveAccessibleName('Falla, SSH, desconectada')
    await capturar(win, 'ssh-no-se-pudo-conectar')
  })

  test('«Abrir explorador SFTP» abre una pestaña «SFTP · alias» sin terminal; si no se puede abrir la sesión, lo dice y ofrece «Reintentar», y cerrarla la quita', async () => {
    const win = s.win
    const lista = await abrirLista('Producción')
    await lista.getByRole('treeitem', { name: /^Falla,/ }).click({ button: 'right' })
    await menu('Abrir explorador SFTP').click()
    const pestana = panel().getByRole('tab', { name: 'SFTP · Falla, archivos remotos por SFTP' })
    await expect(pestana, 'la pestaña del explorador, con su nombre').toBeVisible({ timeout: 30_000 })
    const explorador = panel().locator('.terminal-pane:visible')
    await expect(explorador.locator('.xterm'), 'el explorador no es una terminal').toHaveCount(0)
    await expect(explorador.getByRole('button', { name: 'Reintentar' }), 'el ssh falso no habla SFTP: fallo con «Reintentar»').toBeVisible({ timeout: 30_000 })
    await capturar(win, 'sftp-no-se-pudo-abrir')
    await enCabecera(win)
    await panel().getByRole('button', { name: 'Cerrar SFTP · Falla', exact: true }).click()
    await expect(pestana).toHaveCount(0)
  })

  test('«Disponible para los agentes» nace marcada; desmarcada, la fila de la lista lo dice y la edición la conserva', async () => {
    const win = s.win
    // El alta se abre desde el menú de un grupo del RIEL, que solo guarda (E51): así la conexión no se abre.
    await enCabecera(win)
    await panel().getByRole('button', { name: 'Maximizar el panel de terminal' }).click()
    const riel = win.locator('aside.ssh-riel')
    await expect(riel, 'a pantalla completa el riel enseña la lista').toBeVisible()
    await cabeceraGrupo(riel, 'Producción').click({ button: 'right' })
    await menu('Nueva conexión en este grupo…').click()
    const dialogo = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    await expect(dialogo.getByRole('button', { name: 'Guardar', exact: true }), 'el alta solo guarda').toBeVisible()
    await expect(campos(dialogo).grupo.locator('option:checked'), 'con el grupo del que se abrió ya elegido').toHaveText('Producción')
    const casilla = dialogo.getByRole('checkbox', { name: 'Disponible para los agentes' })
    await expect(casilla, 'marcada por defecto en un alta').toBeChecked()
    const c = campos(dialogo)
    await c.alias.fill('Solo mía')
    await c.host.fill('192.0.2.30')
    await c.usuario.fill('pruebas')
    await casilla.uncheck()
    await expect(dialogo.getByText('Los agentes no la ven'), 'la ayuda dice qué significa desmarcarla').toBeVisible()
    await capturar(win, 'ssh-casilla-agentes')
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(panel().getByRole('tab', { name: /^Solo mía, SSH/ }), 'guardar desde el riel no abre la pestaña').toHaveCount(0)
    await panel().getByRole('button', { name: 'Restaurar el panel de terminal' }).click()
    await expect(win.locator('.shell')).not.toHaveClass(/\bterminal-pantalla-completa\b/)

    const abierta = await abrirLista('Producción')
    await expect(abierta.getByRole('treeitem', { name: 'Solo mía, pruebas@192.0.2.30, Contraseña, no disponible para los agentes' }), 'la fila la marca').toBeVisible()
    await expect(abierta.getByRole('treeitem', { name: /^Falla,/ }), 'las disponibles, sin marca').not.toHaveAccessibleName(/no disponible/)
    await abierta.getByRole('treeitem', { name: /^Solo mía,/ }).click({ button: 'right' })
    await menu('Editar…').click()
    const edicion = win.getByRole('dialog', { name: 'Editar conexión SSH' })
    await expect(edicion.getByRole('checkbox', { name: 'Disponible para los agentes' }), 'la edición la conserva desmarcada').not.toBeChecked()
    await edicion.getByRole('button', { name: 'Cancelar' }).click()
    await expect(edicion).toHaveCount(0)
  })

  test('editar el alias renombra la pestaña sin tocar la sesión; eliminar la conexión deja la pestaña viva y «Reconectar» de su menú deshabilitado con su motivo', async () => {
    const win = s.win
    const antes = m.ssh.arranques().length
    const lista = await abrirLista('Servidores')
    await lista.getByRole('treeitem', { name: /^Router,/ }).click({ button: 'right' })
    await menu('Editar…').click()
    const dialogo = win.getByRole('dialog', { name: 'Editar conexión SSH' })
    await expect(dialogo).toBeVisible()
    await expect(popover(), 'abrir un diálogo cierra el popover').toHaveCount(0)
    const c = campos(dialogo)
    await expect(c.alias).toHaveValue('Router')
    await expect(c.puerto).toHaveValue('2222')
    await expect(dialogo.getByRole('button', { name: 'Guardar', exact: true }), 'al editar no se conecta').toBeVisible()
    await c.alias.fill('Router casa')
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    const pestana = panel().getByRole('tab', { name: /^Router casa, SSH/ })
    await expect(pestana, 'la pestaña sigue al alias nuevo').toBeVisible()
    expect(m.ssh.arranques().length, 'la sesión sigue con lo que tenía hasta reconectar').toBe(antes)

    const otra = await abrirLista('Servidores')
    await otra.getByRole('treeitem', { name: /^Router casa,/ }).click({ button: 'right' })
    await menu('Ir a la sesión abierta').click()
    await expect(pestana, 'ir a la sesión abierta la elige').toHaveAttribute('aria-selected', 'true')

    const ultima = await abrirLista('Servidores')
    await ultima.getByRole('treeitem', { name: /^Router casa,/ }).click({ button: 'right' })
    await menu('Eliminar…').click()
    const confirmar = win.getByRole('dialog', { name: 'Eliminar conexión' })
    await expect(confirmar).toBeVisible()
    await confirmar.getByRole('button', { name: 'Eliminar' }).click()
    await expect(confirmar).toHaveCount(0)

    await expect(pestana, 'la pestaña sigue viva aunque la conexión ya no exista').toBeVisible()
    await pestana.click({ button: 'right' })
    const reconectar = menu('Reconectar')
    await expect(reconectar, 'sin conexión no hay con qué reconectar').toBeDisabled()
    await expect(reconectar).toHaveAttribute('title', /la conexión se eliminó/)
    await win.keyboard.press('Escape')
    await esperarEnTerminal(win, BANNER_FALSO, 1, 'la sesión sigue viva y a la vista')
    const tras = await abrirLista()
    await expect(tras.getByRole('treeitem', { name: /Router casa,/ }), 'ya no está en la lista').toHaveCount(0)
    await win.keyboard.press('Escape')
  })

  test('el lanzador se abre con todos los grupos plegados y deja abierto uno solo, sin recordarlo; con filtro salen las coincidencias de todos los grupos', async () => {
    const win = s.win
    const lista = await abrirLista()
    const servidores = cabeceraGrupo(lista, 'Servidores')
    const produccion = cabeceraGrupo(lista, 'Producción')
    // Al abrirlo no hay ninguno desplegado, aunque ya se hubiera abierto uno.
    await expect(servidores, 'entra plegado').toHaveAttribute('aria-expanded', 'false')
    await expect(produccion).toHaveAttribute('aria-expanded', 'false')
    await expect(lista.getByRole('treeitem', { name: /^Falla,/ }), 'y sus conexiones no se ven').toHaveCount(0)
    await capturar(win, 'ssh-lista-plegada')

    // Abrir uno cierra el otro.
    await servidores.click()
    await expect(servidores).toHaveAttribute('aria-expanded', 'true')
    await produccion.click()
    await expect(produccion).toHaveAttribute('aria-expanded', 'true')
    await expect(servidores, 'abrir «Producción» cierra «Servidores»').toHaveAttribute('aria-expanded', 'false')
    await expect(lista.getByRole('treeitem', { name: /^Falla,/ }), 'las conexiones del abierto se ven').toBeVisible()
    await expect(lista.getByRole('treeitem', { name: /^Solo mía,/ })).toBeVisible()
    await capturar(win, 'ssh-lista-acordeon')

    // Cerrar el abierto no deja ninguno.
    await produccion.click()
    await expect(produccion).toHaveAttribute('aria-expanded', 'false')

    // Con filtro el acordeón no cuenta: sale lo que coincide, esté su grupo abierto o no.
    const filtro = lista.getByRole('combobox', { name: 'Buscar conexión' })
    await filtro.fill('fal')
    await expect(produccion, 'con filtro los grupos con coincidencias se ven abiertos').toHaveAttribute('aria-expanded', 'true')
    await expect(lista.getByRole('treeitem', { name: /^Falla,/ })).toBeVisible()
    await filtro.fill('')
    await expect(produccion, 'sin filtro vuelve el acordeón: ninguno abierto').toHaveAttribute('aria-expanded', 'false')

    // Reabierto con uno abierto, vuelve a entrar todo plegado: no recuerda el último, ni en pantalla ni en el archivo de ajustes.
    await produccion.click()
    await expect(produccion).toHaveAttribute('aria-expanded', 'true')
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)
    const otra = await abrirLista()
    await expect(cabeceraGrupo(otra, 'Producción'), 'no recuerda «Producción», que era el abierto').toHaveAttribute('aria-expanded', 'false')
    await expect(cabeceraGrupo(otra, 'Servidores')).toHaveAttribute('aria-expanded', 'false')
    expect(lanzadorGuardado(s.datos).grupoAbierto, 'y el archivo de ajustes ya no guarda ningún grupo abierto').toBeUndefined()
    await win.keyboard.press('Escape')
  })

  test('la lista flotante: filtra sin tildes, Intro conecta y Esc devuelve el foco a la flecha', async () => {
    const win = s.win
    const lista = await abrirLista('Producción')
    const filtro = lista.getByRole('combobox', { name: 'Buscar conexión' })
    await expect(filtro, 'al abrir, el foco está en el filtro').toBeFocused()
    await expect(flecha()).toHaveAttribute('aria-expanded', 'true')

    // El menú de una fila: Esc cierra solo el menú (el popover sigue) y el foco vuelve al filtro.
    await lista.getByRole('treeitem', { name: /^Falla,/ }).click({ button: 'right' })
    await expect(win.getByRole('menu')).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(win.getByRole('menu')).toHaveCount(0)
    await expect(popover(), 'Esc cerró solo el menú').toBeVisible()
    await expect(filtro, 'y el foco volvió al filtro').toBeFocused()

    await filtro.fill('FÁL')
    await expect(lista.getByRole('treeitem', { name: /^Falla,/ }), 'el filtro no distingue tildes ni mayúsculas').toBeVisible()
    await expect(lista.getByRole('treeitem', { name: /^Servidores/ }), 'con filtro solo salen los grupos con coincidencias').toHaveCount(0)
    await filtro.fill('zzz')
    await expect(lista.getByText('Ninguna conexión coincide con "zzz"')).toBeVisible()
    await filtro.fill('fal')
    await expect(filtro).toHaveAttribute('aria-activedescendant', /.+/)

    await win.keyboard.press('Enter')
    await expect(popover(), 'Intro conecta y cierra el popover').toHaveCount(0)
    await expect(panel().getByRole('tab', { name: /^Falla \(2\), SSH/ }), 'una segunda pestaña de la misma conexión lleva « (2)»').toBeVisible({ timeout: 30_000 })

    await abrirLista()
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)
    await expect(flecha(), 'Esc devuelve el foco a la flecha').toBeFocused()
  })

  test('«Mover a grupo…» abre el formulario con el foco en el grupo; sin proyectos ni pestañas SSH, el estado vacío ofrece «Conectar por SSH…», que a pantalla completa lleva al riel o al lanzador', async () => {
    const win = s.win
    const lista = await abrirLista('Producción')
    await lista.getByRole('treeitem', { name: /^Falla,/ }).click({ button: 'right' })
    await menu('Mover a grupo…').click()
    const dialogo = win.getByRole('dialog', { name: 'Editar conexión SSH' })
    await expect(dialogo).toBeVisible()
    await expect(campos(dialogo).grupo, 'el foco va al selector de grupo').toBeFocused()
    await win.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)

    // Cerrar las tres pestañas SSH (matan sus sesiones): la tira se queda sin ellas y sin proyectos no hay nada que ver.
    await enCabecera(win)
    for (const nombre of ['Router casa', 'Falla', 'Falla (2)']) {
      await panel().getByRole('button', { name: `Cerrar ${nombre}`, exact: true }).click()
    }
    await expect(panel().locator('.terminal-tab')).toHaveCount(0)
    await expect(panel().getByRole('button', { name: 'Reconectar' }), 'sin pane no hay reinicio que ofrecer').toHaveCount(0)
    const vacio = panel().locator('.pane-empty')
    await expect(vacio).toContainText('Sin proyecto abierto')
    await vacio.getByRole('button', { name: 'Conectar por SSH…' }).click()
    await expect(popover(), '«Conectar por SSH…» abre el lanzador de conexiones').toBeVisible()
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)

    // A pantalla completa, la misma pulsación lleva al riel si se ve y al lanzador (y a su ▾) si está plegado.
    await enCabecera(win)
    await panel().getByRole('button', { name: 'Maximizar el panel de terminal' }).click()
    await expect(win.locator('.shell')).toHaveClass(/\bterminal-pantalla-completa\b/)
    const riel = win.locator('aside.ssh-riel')
    await expect(riel, 'a pantalla completa el riel enseña la lista').toBeVisible()
    await vacio.getByRole('button', { name: 'Conectar por SSH…' }).click()
    await expect(riel.getByRole('combobox', { name: 'Buscar conexión' }), '«Conectar por SSH…» lleva el foco al filtro del riel').toBeFocused()
    await expect(popover(), 'y no abre el lanzador').toHaveCount(0)
    const conmutador = panel().getByRole('button', { name: 'Panel de conexiones' })
    await conmutador.click()
    await expect(riel).toBeHidden()
    await vacio.getByRole('button', { name: 'Conectar por SSH…' }).click()
    await expect(popover(), 'con el riel plegado vuelve al lanzador').toBeVisible()
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)
    await conmutador.click()
    await expect(riel, 'se deja el riel como estaba: a la vista').toBeVisible()
    await panel().getByRole('button', { name: 'Restaurar el panel de terminal' }).click()
    await expect(win.locator('.shell')).not.toHaveClass(/\bfranja-pantalla-completa\b/)
  })

  test('«Archivo de clave»: la pública se rechaza, la privada se importa (copia normalizada, original intacto) y ssh la recibe por -o IdentityFile; la interfaz solo ve el nombre', async () => {
    const win = s.win
    // Una RSA con frase generada aquí, con CRLF (como la deja un editor de Windows), y una «pública».
    const origen = join(m.raiz, 'claves de origen')
    mkdirSync(origen)
    const privada = join(origen, 'id_e2e.pem')
    const publica = join(origen, 'id_e2e.pub')
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = String(privateKey.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'frase-e2e' }))
    writeFileSync(privada, pem.replace(/\n/g, '\r\n'))
    writeFileSync(publica, 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ e2e@prueba\n')
    const original = { texto: readFileSync(privada, 'utf8'), mtime: statSync(privada).mtimeMs }
    // El diálogo nativo no lo conduce Playwright: se sustituye en el main y da, por orden, la pública y la privada.
    await s.app.evaluate(({ dialog }, rutas) => {
      const cola = [...rutas]
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [cola.shift() ?? rutas[rutas.length - 1]] })
    }, [publica, privada])

    const alta = await abrirLista()
    await alta.getByRole('button', { name: 'Nueva conexión SSH…' }).click()
    const dialogo = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    const c = campos(dialogo)
    await c.alias.fill('Con clave')
    await c.host.fill('192.0.2.20')
    await c.usuario.fill('clave')
    await dialogo.getByRole('radio', { name: 'Archivo de clave' }).check()
    await expect(dialogo.getByText('Tessera guarda una copia protegida de la clave; el archivo original no se toca.')).toBeVisible()
    const archivo = dialogo.locator('[data-campo="clave"]')
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(archivo, 'sin archivo, el alta marca el campo').toHaveAttribute('aria-invalid', 'true')
    await expect(archivo, 'y le da el foco').toBeFocused()

    await dialogo.getByRole('button', { name: 'Elegir…' }).click()
    await expect(dialogo.getByRole('alert'), 'la pública se rechaza diciendo qué elegir').toContainText('«id_e2e.pub» es la clave pública')
    await expect(archivo).toHaveValue('')
    await dialogo.getByRole('button', { name: 'Elegir…' }).click()
    await expect(archivo, 'de la privada, solo el nombre').toHaveValue('id_e2e.pem')
    await expect(dialogo.getByRole('alert')).toHaveCount(0)
    await expect(c.secreto, 'una clave con frase trae su campo').toBeVisible()
    await expect(dialogo.getByRole('button', { name: 'Mostrar frase de la clave' }), 'que es el de la frase, no el de una contraseña').toBeVisible()
    const visible = `${await dialogo.innerText()} ${(await dialogo.locator('input').evaluateAll((els) => els.map((e) => `${(e as HTMLInputElement).value} ${e.getAttribute('title') ?? ''}`))).join(' ')}`
    expect(visible, 'ninguna ruta en el diálogo').not.toContain(basename(m.raiz))
    await capturar(win, 'ssh-archivo-de-clave')

    const antes = m.ssh.arranques().length
    await guardarYConectar(dialogo, 'Con clave')
    await expect(panel().getByRole('tab', { name: 'Con clave, SSH' }), 'aparece la pestaña SSH').toBeVisible({ timeout: 30_000 })
    await expect.poll(() => m.ssh.arranques().length, { message: 'ssh se lanzó' }).toBe(antes + 1)
    const argv = m.ssh.arranques()[antes]
    const identidad = argv.find((a) => a.startsWith('IdentityFile='))
    expect(identidad, 'la clave va por -o IdentityFile, con la copia de userData').toMatch(/^IdentityFile=".*\/ssh\/claves\/[0-9a-f-]{36}"$/)
    expect(argv).toContain('IdentitiesOnly=yes')
    expect(argv).toContain('PreferredAuthentications=publickey')
    expect(argv, 'sin «-i»').not.toContain('-i')
    const copia = (identidad ?? '').slice('IdentityFile="'.length, -1)
    // Rutas reales a los dos lados: en macOS el temporal es `/var/...`, un enlace a `/private/var/...`.
    const enDatos = realpathSync(copia).replace(/\\/g, '/').startsWith(realpathSync(s.datos).replace(/\\/g, '/'))
    expect(enDatos, `la copia vive en userData (${copia})`).toBe(true)
    expect(readFileSync(copia, 'utf8'), 'copia normalizada (LF)').toBe(pem)
    expect({ texto: readFileSync(privada, 'utf8'), mtime: statSync(privada).mtimeMs }, 'el original no se toca').toEqual(original)

    const lista = await win.evaluate(() => window.tessera.ssh.listar())
    const conClave = lista.conexiones.find((x) => x.alias === 'Con clave')
    expect(conClave?.clave, 'el DTO lleva nombre, tipo y frase').toEqual({ nombre: 'id_e2e.pem', tipo: 'RSA', cifrada: true })
    expect(JSON.stringify(lista), 'y ninguna ruta').not.toContain(basename(s.datos))
    const popoverLista = await abrirLista('Sin grupo')
    await expect(popoverLista.getByRole('treeitem', { name: /^Con clave, clave@192\.0\.2\.20, Archivo de clave/ }), 'la fila anuncia el método').toBeVisible()
    // «Sin grupo» no es un grupo real: su «Nueva conexión…» repetía la del pie y se quitó, así que no tiene menú.
    await cabeceraGrupo(popoverLista, 'Sin grupo').click({ button: 'right' })
    await expect(win.getByRole('menu'), '«Sin grupo» no abre ningún menú').toHaveCount(0)
    await win.keyboard.press('Escape')
  })

  const CLAVE_GUARDADA = 'contraseña-e2e "ñ" #1'

  test('una contraseña guardada: la pestaña entra sin pedirla (el programa de contraseñas se la pide a Tessera); cifrada en disco y fuera del DTO', async () => {
    const win = s.win
    m.ssh.contrasena(CLAVE_GUARDADA)
    const alta = await abrirLista()
    await alta.getByRole('button', { name: 'Nueva conexión SSH…' }).click()
    const dialogo = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    const c = campos(dialogo)
    await c.alias.fill('Con contraseña')
    await c.host.fill('192.0.2.30')
    await c.usuario.fill('pruebas')
    await expect(c.secreto, 'de solo escritura: tipo password').toHaveAttribute('type', 'password')
    await expect(dialogo.getByText('Se guarda cifrada; si la dejas vacía, la pedirá la terminal.')).toBeVisible()
    await c.secreto.fill(CLAVE_GUARDADA)
    await dialogo.getByRole('button', { name: 'Mostrar contraseña' }).click()
    await expect(c.secreto, 'el ojo la enseña').toHaveAttribute('type', 'text')
    await expect(dialogo.getByRole('button', { name: 'Guardar y probar' }), 'un alta prueba lo guardado: «Guardar y probar»').toBeVisible()
    await capturar(win, 'ssh-contrasena-guardada')

    const antes = m.ssh.arranques().length
    await guardarYConectar(dialogo, 'Con contraseña')
    await expect(panel().getByRole('tab', { name: 'Con contraseña, SSH' })).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => m.ssh.autenticaciones(), { message: 'el falso la pidió por SSH_ASKPASS y casó', timeout: 30_000 }).toEqual(['ok'])
    await esperarEnTerminal(win, BANNER_FALSO, 1, 'entró sin que nadie tecleara la contraseña')
    expect(m.ssh.arranques()[antes], 'con la contraseña guardada y el diálogo detrás, ssh puede volver a preguntar tras un rechazo').toContain('NumberOfPasswordPrompts=3')

    const lista = await win.evaluate(() => window.tessera.ssh.listar())
    expect(lista.conexiones.find((x) => x.alias === 'Con contraseña')?.tieneSecreto, 'el DTO dice que hay una').toBe(true)
    expect(JSON.stringify(lista), 'y nunca cuál').not.toContain(CLAVE_GUARDADA)
    const enDisco = readFileSync(join(s.datos, 'ssh-connections.json'), 'utf8')
    expect(enDisco, 'en disco va cifrada').not.toContain(CLAVE_GUARDADA)
    expect(enDisco).toContain('"secretEnc"')
  })

  test('editar sin tocar la contraseña la conserva («(sin cambios)»), y «Guardar y probar» enseña lo que tardó y la huella del servidor', async () => {
    const win = s.win
    const lista = await abrirLista('Sin grupo')
    await lista.getByRole('treeitem', { name: /^Con contraseña,/ }).click({ button: 'right' })
    await menu('Editar…').click()
    const dialogo = win.getByRole('dialog', { name: 'Editar conexión SSH' })
    const c = campos(dialogo)
    await expect(c.secreto, 'la guardada no llega al formulario').toHaveValue('')
    await expect(c.secreto).toHaveAttribute('placeholder', '(sin cambios)')
    await expect(dialogo.getByText('Hay una guardada, cifrada: si la dejas vacía, se conserva.')).toBeVisible()
    await expect(dialogo.getByRole('button', { name: 'Probar', exact: true }), 'sin cambios, «Probar»').toBeVisible()
    await c.alias.fill('Con contraseña editada')
    const guardarYProbar = dialogo.getByRole('button', { name: 'Guardar y probar' })
    await expect(guardarYProbar, 'con cambios, «Guardar y probar»').toBeVisible()
    const antes = m.ssh.autenticaciones().length
    await guardarYProbar.click()
    const estado = dialogo.getByRole('status')
    await expect(estado, '«Probar» dice lo que tardó').toContainText(/Conectó en \d+ ms/, { timeout: 30_000 })
    await expect(estado, 'y la huella del servidor, que guardó').toContainText(`Huella del servidor: ${HUELLA_FALSA}`)
    expect(m.ssh.autenticaciones().slice(antes), 'la contraseña se conservó: el programa de contraseñas la volvió a dar').toEqual(['ok'])
    await expect(dialogo.getByRole('button', { name: 'Probar', exact: true }), 'lo probado quedó guardado: vuelve a «Probar»').toBeVisible()
    await capturar(win, 'ssh-probar')
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(panel().getByRole('tab', { name: /^Con contraseña editada, SSH/ }), 'el nombre nuevo llega a la pestaña').toBeVisible()
  })

  test('con la huella cambiada, «Probar» lo dice en rojo y «Olvidar la huella guardada…» (confirmación anidada) la olvida y vuelve a probar', async () => {
    const win = s.win
    const lista = await abrirLista('Sin grupo')
    await lista.getByRole('treeitem', { name: /^Con contraseña editada,/ }).click({ button: 'right' })
    await menu('Editar…').click()
    const dialogo = win.getByRole('dialog', { name: 'Editar conexión SSH' })
    m.ssh.huellaCambiada(true)
    await dialogo.getByRole('button', { name: 'Probar', exact: true }).click()
    const estado = dialogo.getByRole('status')
    await expect(estado).toContainText('La huella del servidor no es la que tienes guardada.', { timeout: 30_000 })
    await expect(estado, 'en rojo').toHaveClass(/falla/)
    await expect(estado, 'con la guardada').toContainText(`Huella guardada: ${HUELLA_FALSA}`)
    await expect(estado, 'y la que presenta ahora').toContainText(`Presenta ahora: ${HUELLA_NUEVA_FALSA}`)
    const olvidar = dialogo.getByRole('button', { name: 'Olvidar la huella guardada…' })
    await olvidar.click()
    const confirmar = win.getByRole('dialog', { name: 'Olvidar la huella guardada' })
    await expect(confirmar).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(confirmar, 'Esc cierra solo la confirmación').toHaveCount(0)
    await expect(dialogo, 'y el diálogo de la conexión sigue').toBeVisible()

    // Una huella vieja más en su known_hosts: olvidar tiene que vaciarlo entero.
    const conexion = (await win.evaluate(() => window.tessera.ssh.listar())).conexiones.find((x) => x.alias === 'Con contraseña editada')
    const knownHosts = join(s.datos, 'ssh', 'huellas', conexion?.id ?? 'sin-id')
    writeFileSync(knownHosts, `${readFileSync(knownHosts, 'utf8')}[192.0.2.30]:22 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQC0vieja\n`)
    m.ssh.huellaCambiada(false)
    await olvidar.click()
    await capturar(win, 'ssh-olvidar-huella')
    await confirmar.getByRole('button', { name: 'Olvidar y volver a probar' }).click()
    await expect(confirmar).toHaveCount(0)
    await expect(estado, 'olvidada, vuelve a probar y entra').toContainText(/Conectó en \d+ ms/, { timeout: 30_000 })
    await expect(estado).toContainText(`Huella del servidor: ${HUELLA_FALSA}`)
    expect(readFileSync(knownHosts, 'utf8'), 'el known_hosts se vació: la vieja no está').not.toContain('ssh-rsa')
    await win.keyboard.press('Escape')
    await expect(dialogo, 'sin cambios, Esc cierra el diálogo').toHaveCount(0)
  })

  test('«Olvidar la huella guardada…» del menú de la conexión vacía su known_hosts tras confirmar, y sin huella la opción no sale', async () => {
    const win = s.win
    const conexion = (await win.evaluate(() => window.tessera.ssh.listar())).conexiones.find((x) => x.alias === 'Con contraseña editada')
    const knownHosts = join(s.datos, 'ssh', 'huellas', conexion?.id ?? 'sin-id')
    expect(readFileSync(knownHosts, 'utf8'), 'la prueba anterior la dejó guardada').toContain('ssh-ed25519')
    const fila = (await abrirLista('Sin grupo')).getByRole('treeitem', { name: /^Con contraseña editada,/ })
    await fila.click({ button: 'right' })
    await menu('Olvidar la huella guardada…').click()
    const confirmar = win.getByRole('dialog', { name: 'Olvidar la huella guardada' })
    await expect(confirmar).toContainText('¿Olvidar la huella guardada de «Con contraseña editada»?')
    await win.keyboard.press('Escape')
    await expect(confirmar).toHaveCount(0)
    expect(readFileSync(knownHosts, 'utf8'), 'cancelar no la olvida').toContain('ssh-ed25519')

    await (await abrirLista('Sin grupo')).getByRole('treeitem', { name: /^Con contraseña editada,/ }).click({ button: 'right' })
    await menu('Olvidar la huella guardada…').click()
    await confirmar.getByRole('button', { name: 'Olvidar', exact: true }).click()
    await expect(win.locator('.toast', { hasText: 'Se olvidó la huella de «Con contraseña editada»' })).toBeVisible({ timeout: 15_000 })
    expect(readFileSync(knownHosts, 'utf8'), 'el known_hosts se vació').toBe('')
    // El menú se arma al abrirse: antes, la lista del renderer tiene que haber recogido el cambio.
    await expect
      .poll(async () => (await win.evaluate(() => window.tessera.ssh.listar())).conexiones.find((x) => x.alias === 'Con contraseña editada')?.huellaServidor.length)
      .toBe(0)

    await (await abrirLista('Sin grupo')).getByRole('treeitem', { name: /^Con contraseña editada,/ }).click({ button: 'right' })
    await expect(menu('Editar…'), 'el menú se abrió').toBeVisible()
    await expect(menu('Olvidar la huella guardada…'), 'sin huella guardada no hay nada que olvidar').toHaveCount(0)
    await win.keyboard.press('Escape')
    await expect(menu('Editar…')).toHaveCount(0)
    await win.keyboard.press('Escape')
    await expect(popover()).toHaveCount(0)
  })

  test('«Nueva conexión SSH…» → «Importar desde OpenSSH…» (no en el lanzador; con el formulario vacío): varios Host abren la revisión (elegir, renombrar, grupo por fila y creado ahí); uno solo rellena el formulario', async () => {
    const win = s.win
    const dir = join(m.raiz, 'openssh')
    mkdirSync(dir)
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    writeFileSync(join(dir, 'id_importada'), String(privateKey.export({ type: 'pkcs1', format: 'pem' })))
    const config = join(dir, 'config')
    writeFileSync(
      config,
      [
        'Host importada-clave',
        '  HostName 192.0.2.40',
        '  User deploy',
        `  IdentityFile "${join(dir, 'id_importada').replace(/\\/g, '/')}"`,
        'Host importada-sistema',
        '  HostName=192.0.2.41',
        '  Port 2222',
        '  User ops',
        'Host Falla',
        '  User otro',
        'Host *',
        '  User todos'
      ].join('\n')
    )
    // El diálogo nativo no lo conduce Playwright: se sustituye en el main y devuelve el archivo.
    await s.app.evaluate(({ dialog }, ruta) => {
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [ruta] })
    }, config)

    const lista = await abrirLista()
    await expect(lista.getByRole('button', { name: 'Importar desde OpenSSH…' }), 'el lanzador ya no lo ofrece: vive en el formulario de alta').toHaveCount(0)
    await lista.getByRole('button', { name: 'Nueva conexión SSH…' }).click()
    const alta = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    const importar = alta.getByRole('button', { name: 'Importar desde OpenSSH…' })
    await campos(alta).alias.fill('a medias')
    await expect(importar, 'con algo escrito no se ofrece: se perdería').toBeDisabled()
    await campos(alta).alias.fill('')
    await importar.click()
    // Varios Host: el alta deja paso a la revisión, donde se elige qué entra, cómo se llama y en qué grupo.
    const revision = win.getByRole('dialog', { name: 'Importar desde OpenSSH' })
    await expect(revision, 'varios Host: la revisión sustituye al alta').toBeVisible({ timeout: 15_000 })
    await expect(alta).toHaveCount(0)
    await expect(revision.getByRole('checkbox', { name: 'Importar importada-clave' })).toBeChecked()
    await expect(revision.getByRole('checkbox', { name: 'Importar importada-sistema' })).toBeChecked()
    await expect(revision.getByRole('checkbox', { name: 'Importar Falla' }), 'la que ya existe nace sin elegir').not.toBeChecked()
    await expect(revision.getByRole('button', { name: 'id_importada' }), 'la clave del IdentityFile, ya importada').toHaveAttribute('title', 'Elegir otro archivo de clave')
    await expect(revision.getByRole('radiogroup', { name: 'Autenticación de importada-clave' }).getByRole('radio', { name: 'Archivo de clave' })).toHaveAttribute('aria-checked', 'true')
    const metodoSistema = revision.getByRole('radiogroup', { name: 'Autenticación de importada-sistema' })
    await expect(metodoSistema.getByRole('radio', { name: 'Claves del sistema' }), 'sin IdentityFile nace con las claves del sistema').toHaveAttribute('aria-checked', 'true')
    await metodoSistema.getByRole('radio', { name: 'Contraseña' }).click()
    await revision.getByRole('textbox', { name: 'Contraseña de importada-sistema' }).fill('pw-importada')
    await expect(revision.getByText('No se importa: 1 bloque con comodines o Match.')).toBeVisible()
    await revision.getByRole('checkbox', { name: 'Importar Falla' }).check()
    await expect(revision.getByRole('alert').filter({ hasText: 'Ya hay una conexión con ese nombre.' }), 'elegir la repetida dice por qué no').toBeVisible()
    await expect(revision.getByRole('button', { name: 'Importar 3 conexiones' })).toBeDisabled()
    await revision.getByRole('checkbox', { name: 'Importar Falla' }).uncheck()
    await revision.getByRole('listitem').nth(1).getByRole('textbox', { name: 'Nombre' }).fill('Sistema renombrada')
    // Una fila desmarcada no se importa: todo bloqueado salvo su casilla, para que nada haga creer que se guarda.
    const falla = revision.getByRole('listitem').filter({ has: win.getByRole('checkbox', { name: 'Importar Falla' }) })
    for (const control of [falla.getByRole('textbox', { name: 'Nombre' }), falla.getByRole('textbox', { name: 'Usuario' }), falla.getByRole('combobox', { name: 'Grupo de Falla' }), falla.getByRole('radio', { name: 'Contraseña' })])
      await expect(control, 'desmarcada, no se edita').toBeDisabled()
    // El grupo, fila a fila: el atajo de arriba pone las marcadas en uno y luego una se va a otro creado aquí mismo.
    const todas = revision.getByRole('combobox', { name: 'Poner las marcadas en el grupo' })
    await todas.selectOption({ label: 'Producción' })
    await expect(revision.getByRole('combobox', { name: 'Grupo de importada-clave' }), 'el atajo llega a cada fila marcada').toHaveValue(await todas.inputValue())
    await expect(falla.getByRole('combobox', { name: 'Grupo de Falla' }).locator('option:checked'), 'y no a la desmarcada').toHaveText('Sin grupo')
    await revision.getByRole('checkbox', { name: 'Importar Falla' }).check()
    await expect(falla.getByRole('combobox', { name: 'Grupo de Falla' }).locator('option:checked'), 'al marcarla entra en el grupo de las marcadas').toHaveText('Producción')
    await revision.getByRole('checkbox', { name: 'Importar Falla' }).uncheck()
    await expect(falla.getByRole('combobox', { name: 'Grupo de Falla' }).locator('option:checked'), 'y al desmarcarla vuelve a «Sin grupo»').toHaveText('Sin grupo')
    await revision.getByRole('combobox', { name: 'Grupo de Sistema renombrada' }).selectOption({ label: 'Nuevo grupo…' })
    const grupoNuevo = win.getByRole('dialog', { name: 'Nuevo grupo para «Sistema renombrada»' })
    await grupoNuevo.getByRole('textbox').fill('Importadas')
    await grupoNuevo.getByRole('button', { name: 'Crear' }).click()
    await expect(grupoNuevo).toHaveCount(0)
    await expect(revision.getByRole('combobox', { name: 'Grupo de Sistema renombrada' }).locator('option:checked'), 'el grupo creado queda puesto en su fila').toHaveText('Importadas')
    await expect(revision.getByRole('combobox', { name: 'Grupo de importada-clave' }).locator('option:checked'), 'y las demás no cambian').toHaveText('Producción')
    await expect(todas.locator('option:checked'), 'el atajo dice que van a grupos distintos').toHaveText('Varios grupos')
    await expect(revision.getByRole('combobox', { name: 'Grupo de importada-clave' }).getByRole('option', { name: 'Importadas' }), 'el grupo nuevo se ofrece en todas las filas').toHaveCount(1)
    await capturar(win, 'ssh-importar-revision')
    await revision.getByRole('button', { name: 'Importar 2 conexiones' }).click()
    await expect(revision).toHaveCount(0)
    await expect(win.locator('.toast', { hasText: 'Se importaron 2 conexiones SSH: 1 en «Producción» y 1 en «Importadas»' }), 'el aviso dice cuántas y el reparto').toBeVisible({ timeout: 15_000 })

    const datos = await win.evaluate(() => window.tessera.ssh.listar())
    const produccion = datos.grupos.find((g) => g.nombre === 'Producción')?.id
    const importadas = datos.grupos.find((g) => g.nombre === 'Importadas')?.id
    expect(importadas, 'el grupo creado en la revisión existe').toBeTruthy()
    const conClave = datos.conexiones.find((x) => x.alias === 'importada-clave')
    const sistema = datos.conexiones.find((x) => x.alias === 'Sistema renombrada')
    expect(conClave && { host: conClave.host, usuario: conClave.usuario, metodo: conClave.metodo, clave: conClave.clave?.nombre, grupo: conClave.grupoId }, 'con su IdentityFile: archivo de clave importado, en el grupo elegido').toEqual({
      host: '192.0.2.40',
      usuario: 'deploy',
      metodo: 'clave',
      clave: 'id_importada',
      grupo: produccion
    })
    expect(sistema && { host: sistema.host, puerto: sistema.puerto, metodo: sistema.metodo, secreto: sistema.tieneSecreto, grupo: sistema.grupoId }, 'pasada a contraseña: la escrita en la revisión, guardada, el nombre cambiado y en su propio grupo').toEqual({
      host: '192.0.2.41',
      puerto: 2222,
      metodo: 'contrasena',
      secreto: true,
      grupo: importadas
    })
    expect(JSON.stringify(datos), 'la contraseña nunca vuelve al renderer').not.toContain('pw-importada')
    expect(datos.conexiones.filter((x) => x.alias.toLowerCase() === 'falla'), 'la que ya existía no se duplica').toHaveLength(1)

    // Un solo Host: el propio formulario se rellena, con una nota, y se elige el grupo antes de guardar.
    const unico = join(dir, 'config-unico')
    writeFileSync(unico, ['Host unica', '  HostName 192.0.2.50', '  User solo', '  Port 2200'].join('\n'))
    await s.app.evaluate(({ dialog }, ruta) => {
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [ruta] })
    }, unico)
    const otraLista = await abrirLista()
    await otraLista.getByRole('button', { name: 'Nueva conexión SSH…' }).click()
    const otraAlta = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    await otraAlta.getByRole('button', { name: 'Importar desde OpenSSH…' }).click()
    const c = campos(otraAlta)
    await expect(c.alias, 'el formulario sigue abierto y se rellena').toHaveValue('unica')
    await expect(c.host).toHaveValue('192.0.2.50')
    await expect(c.puerto).toHaveValue('2200')
    await expect(c.usuario).toHaveValue('solo')
    await expect(otraAlta.getByRole('status').filter({ hasText: 'Datos de «unica» leídos de «config-unico»' })).toBeVisible()
    await capturar(win, 'ssh-importar-uno')
    await otraAlta.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(otraAlta).toHaveCount(0)

    // Lo escrito mientras se lee el archivo no se pisa al llegar la lectura.
    await s.app.evaluate(({ dialog }, ruta) => {
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => {
        await new Promise((r) => setTimeout(r, 1500))
        return { canceled: false, filePaths: [ruta] }
      }
    }, unico)
    const terceraLista = await abrirLista()
    await terceraLista.getByRole('button', { name: 'Nueva conexión SSH…' }).click()
    const tercera = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    await tercera.getByRole('button', { name: 'Importar desde OpenSSH…' }).click()
    await expect(tercera.getByRole('button', { name: 'Leyendo…' })).toBeVisible()
    await campos(tercera).alias.fill('escrita a mano')
    await expect(tercera.getByRole('status').filter({ hasText: 'No se rellenó' }), 'la lectura llega y no pisa lo escrito').toBeVisible({ timeout: 10_000 })
    await expect(campos(tercera).alias).toHaveValue('escrita a mano')
    await expect(campos(tercera).host).toHaveValue('')
    await tercera.getByRole('button', { name: 'Cancelar', exact: true }).click()
  })

  test('la revisión de «Importar desde OpenSSH» se ve bien a cualquier tamaño: nada se sale ni se encima, y en estrecho el método y el grupo bajan de línea', async () => {
    const win = s.win
    const dir = join(m.raiz, 'openssh-tamanos')
    mkdirSync(dir)
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    writeFileSync(join(dir, 'id_tamanos'), String(privateKey.export({ type: 'pkcs1', format: 'pem' })))
    const config = join(dir, 'config')
    writeFileSync(
      config,
      [
        'Host corta',
        '  HostName 192.0.2.60',
        '  User a',
        `  IdentityFile "${join(dir, 'id_tamanos').replace(/\\/g, '/')}"`,
        'Host un-nombre-de-conexion-bastante-largo-para-ver-el-recorte',
        '  HostName servidor-con-un-nombre-de-host-muy-largo.ejemplo.interno',
        '  Port 22022',
        '  User usuario-con-nombre-largo',
        'Host con-contrasena',
        '  HostName 192.0.2.62',
        '  User ops',
        'Host sistema',
        '  HostName 192.0.2.63',
        '  User ops'
      ].join('\n')
    )
    await s.app.evaluate(({ dialog }, ruta) => {
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [ruta] })
    }, config)
    const lista = await abrirLista()
    await lista.getByRole('button', { name: 'Nueva conexión SSH…' }).click()
    await win.getByRole('dialog', { name: 'Nueva conexión SSH' }).getByRole('button', { name: 'Importar desde OpenSSH…' }).click()
    const revision = win.getByRole('dialog', { name: 'Importar desde OpenSSH' })
    await expect(revision).toBeVisible({ timeout: 15_000 })
    await revision.getByRole('radiogroup', { name: 'Autenticación de con-contrasena' }).getByRole('radio', { name: 'Contraseña' }).click()
    // Un grupo de nombre largo, para que el selector tenga que recortar.
    await revision.getByRole('combobox', { name: 'Grupo de corta' }).selectOption({ label: 'Nuevo grupo…' })
    const grupoNuevo = win.getByRole('dialog', { name: 'Nuevo grupo para «corta»' })
    await grupoNuevo.getByRole('textbox').fill('Servidores de integración continua del equipo')
    await grupoNuevo.getByRole('button', { name: 'Crear' }).click()
    await expect(grupoNuevo).toHaveCount(0)

    /** Lo que se mide en un tamaño: los controles de cada fila, dentro de su fila y sin encimarse, y el modal dentro de la ventana. */
    const medir = (): Promise<{ problemas: string[]; grupoBajo: boolean[] }> =>
      revision.evaluate((dlg) => {
        const problemas: string[] = []
        const vw = window.innerWidth
        const vh = window.innerHeight
        const r = dlg.getBoundingClientRect()
        if (r.left < 0 || r.top < 0 || r.right > vw + 0.5 || r.bottom > vh + 0.5) problemas.push(`el modal se sale de la ventana: ${JSON.stringify(r)} en ${vw}×${vh}`)
        const cuerpo = dlg.querySelector('.dbc-cuerpo') as HTMLElement
        if (cuerpo.scrollWidth > cuerpo.clientWidth + 1) problemas.push(`el cuerpo tiene scroll horizontal: ${cuerpo.scrollWidth} > ${cuerpo.clientWidth}`)
        const lista = dlg.querySelector('.ssh-importar-lista') as HTMLElement
        if (lista.scrollHeight > lista.clientHeight + 1) problemas.push(`la lista recorta sus filas: ${lista.scrollHeight} > ${lista.clientHeight}`)
        const pie = dlg.querySelector('.dbc-acciones button[type="submit"]') as HTMLElement
        const rp = pie.getBoundingClientRect()
        if (rp.bottom > vh || rp.right > vw) problemas.push('el botón de importar no se ve entero')
        const grupoBajo: boolean[] = []
        for (const fila of Array.from(dlg.querySelectorAll('.ssh-importar-fila'))) {
          const datos = (fila.querySelector('.ssh-importar-datos') as HTMLElement).getBoundingClientRect()
          const nombre = (fila.querySelector('.ssh-importar-nombre') as HTMLInputElement).value
          const controles = Array.from(fila.querySelectorAll('.ssh-importar-campos > *, .ssh-importar-credencial > *')).map((e) => ({ e, c: e.getBoundingClientRect() }))
          for (const { e, c } of controles) {
            if (c.width === 0) continue
            if (c.left < datos.left - 0.5 || c.right > datos.right + 0.5) problemas.push(`«${nombre}»: ${e.className} se sale de su fila`)
          }
          for (let i = 0; i < controles.length; i++)
            for (let j = i + 1; j < controles.length; j++) {
              const a = controles[i].c
              const b = controles[j].c
              const encima = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
              if (encima && a.width > 0 && b.width > 0) problemas.push(`«${nombre}»: ${controles[i].e.className} y ${controles[j].e.className} se encima`)
            }
          const sel = fila.querySelector('.ssh-importar-grupo') as HTMLElement
          const rs = sel.getBoundingClientRect()
          if (rs.width < 100) problemas.push(`«${nombre}»: el selector de grupo mide ${Math.round(rs.width)} px`)
          if (Math.round(rs.height) !== 26) problemas.push(`«${nombre}»: el selector de grupo mide ${rs.height} px de alto`)
          // Lo elegido se recorta antes de la flecha (que va en los últimos 14 px), no por encima de ella.
          const elegido = sel.querySelector('selectedcontent')
          const re = elegido?.getBoundingClientRect()
          if (!re || re.width === 0) problemas.push(`«${nombre}»: el selector de grupo no enseña lo elegido`)
          else if (re.right > rs.right - 14) problemas.push(`«${nombre}»: el nombre del grupo pisa la flecha (${Math.round(rs.right - re.right)} px libres)`)
          const primero = (fila.querySelector('.ssh-importar-credencial > :first-child') as HTMLElement).getBoundingClientRect()
          grupoBajo.push(rs.top >= primero.bottom - 0.5)
        }
        // Las columnas se alinean entre filas, aunque una traiga un nombre o un destino largos.
        for (const sel of ['.ssh-importar-nombre', '.ssh-importar-usuario', '.ssh-importar-grupo']) {
          const bordes = Array.from(dlg.querySelectorAll(sel)).map((e) => e.getBoundingClientRect())
          if (bordes.some((b) => Math.abs(b.left - bordes[0].left) > 1 || Math.abs(b.right - bordes[0].right) > 1)) problemas.push(`${sel}: las filas no están alineadas (${bordes.map((b) => `${Math.round(b.left)}-${Math.round(b.right)}`).join(', ')})`)
        }
        return { problemas, grupoBajo }
      })

    const ventana = (ancho: number, alto: number, zoom: number): Promise<void> =>
      s.app.evaluate(({ BrowserWindow }, t) => {
        const w = BrowserWindow.getAllWindows()[0]
        w.setSize(t.ancho, t.alto)
        w.webContents.setZoomFactor(t.zoom)
      }, { ancho, alto, zoom })
    // La captura la hace la ventana y no Playwright, que con zoom recorta la imagen al tamaño sin zoom.
    const capturarVentana = async (nombre: string): Promise<void> => {
      const dirCapturas = process.env.TESSERA_E2E_CAPTURAS
      if (!dirCapturas) return
      mkdirSync(dirCapturas, { recursive: true })
      const png = await s.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
      writeFileSync(join(dirCapturas, `${nombre}.png`), Buffer.from(png, 'base64'))
    }
    const zoomInicial = await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
    const tamanos = [
      { ancho: 1500, alto: 950, zoom: 1, estrecho: false },
      { ancho: 900, alto: 620, zoom: 1, estrecho: false },
      { ancho: 900, alto: 620, zoom: 1.25, estrecho: false },
      { ancho: 900, alto: 620, zoom: 1.5, estrecho: true },
      { ancho: 900, alto: 620, zoom: 2, estrecho: true }
    ]
    try {
      for (const t of tamanos) {
        const caso = `${t.ancho}×${t.alto} al ${t.zoom * 100} %`
        await ventana(t.ancho, t.alto, t.zoom)
        // Se sondea: el cambio de tamaño y de zoom llega al renderer en el siguiente fotograma.
        await expect.poll(async () => (await medir()).problemas, { message: `nada se sale ni se encima — ${caso}` }).toEqual([])
        const { grupoBajo } = await medir()
        expect(grupoBajo, `en estrecho el método y el grupo bajan bajo la credencial; en ancho van al lado — ${caso}`).toEqual(grupoBajo.map(() => t.estrecho))
        await expect(revision.getByRole('combobox', { name: 'Grupo de corta' }).locator('option:checked'), `el grupo largo sigue elegido — ${caso}`).toHaveText('Servidores de integración continua del equipo')
        await capturarVentana(`ssh-importar-revision-${t.ancho}x${t.alto}-${t.zoom * 100}`)
        // La última fila se alcanza con el scroll del cuerpo, y se ve entera.
        const ultima = revision.getByRole('combobox', { name: 'Grupo de sistema' })
        await ultima.scrollIntoViewIfNeeded()
        await expect(ultima, `la última fila se alcanza — ${caso}`).toBeInViewport({ ratio: 1 })
        await capturarVentana(`ssh-importar-revision-${t.ancho}x${t.alto}-${t.zoom * 100}-final`)
        await revision.locator('.dbc-cuerpo').evaluate((e) => e.scrollTo(0, 0))
      }
    } finally {
      await ventana(1500, 950, zoomInicial)
    }
    await revision.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(revision).toHaveCount(0)
  })

  test('«Bastión y túneles»: plegada en un alta; el bastión es otra conexión del perfil, un túnel a medias se marca, y ssh recibe el salto y el túnel local', async () => {
    const win = s.win
    const lista = await abrirLista()
    await lista.getByRole('button', { name: 'Nueva conexión SSH…' }).click()
    const dialogo = win.getByRole('dialog', { name: 'Nueva conexión SSH' })
    const c = campos(dialogo)
    await c.alias.fill('Tras el bastión')
    await c.host.fill('10.0.0.5')
    await c.usuario.fill('pruebas')
    const seccion = dialogo.locator('details.ssh-avanzado')
    await expect(seccion, 'en un alta nace plegada').not.toHaveAttribute('open', '')
    await seccion.locator('summary').click()
    const saltar = dialogo.locator('[data-campo="salto"]')
    await expect(saltar.locator('option:checked'), 'directo por defecto').toHaveText('Directo (sin bastión)')
    await saltar.selectOption({ label: 'Solo mía' })
    await dialogo.getByRole('button', { name: 'Añadir túnel' }).click()
    await dialogo.getByRole('textbox', { name: 'Puerto que escucha el túnel 1' }).fill('15432')
    await expect(dialogo.getByRole('textbox', { name: 'Host de destino del túnel 1' }), 'el destino nace en localhost').toHaveValue('localhost')
    await dialogo.getByRole('textbox', { name: 'Puerto de destino del túnel 1' }).fill('5432')
    await dialogo.getByRole('button', { name: 'Añadir túnel' }).click()
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialogo.getByRole('textbox', { name: 'Puerto que escucha el túnel 2' }), 'el túnel a medias se marca y no se guarda').toHaveAttribute('aria-invalid', 'true')
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByText('127.0.0.1:15432 de este equipo lleva a localhost:5432'), 'cada túnel dice qué hace').toBeVisible()
    await capturar(win, 'ssh-bastion-tuneles')
    await dialogo.getByRole('button', { name: 'Quitar el túnel 2' }).click()
    const antes = m.ssh.arranques().length
    await guardarYConectar(dialogo, 'Tras el bastión')
    await expect.poll(() => m.ssh.arranques().length, { message: 'ssh se lanzó' }).toBe(antes + 1)
    const argv = m.ssh.arranques()[antes]
    const proxy = argv.find((a) => a.startsWith('ProxyCommand=')) ?? ''
    expect(proxy, 'salta por el bastión con la configuración generada').toContain('-W')
    expect(proxy).toContain('tessera-salto-0')
    expect(argv[argv.indexOf('-L') + 1], 'el túnel local, solo en 127.0.0.1').toBe('127.0.0.1:15432:localhost:5432')
    expect(argv[argv.length - 1]).toBe('10.0.0.5')
    // Sin contraseña guardada: con bastión, lo que Tessera no contesta va al diálogo (un bastión no tiene terminal).
    const pregunta = win.getByRole('dialog', { name: 'Conexión SSH «Tras el bastión»' })
    await expect(pregunta, 'la contraseña del destino se pide en el diálogo').toBeVisible({ timeout: 30_000 })
    await expect(pregunta.getByText('Contraseña de pruebas@10.0.0.5')).toBeVisible()
    await pregunta.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(pregunta).toHaveCount(0)

    const edicion = await abrirLista()
    await edicion.getByRole('combobox', { name: 'Buscar conexión' }).fill('Tras el bastión')
    await edicion.getByRole('treeitem', { name: /^Tras el bastión,/ }).click({ button: 'right' })
    await menu('Editar…').click()
    const editar = win.getByRole('dialog', { name: 'Editar conexión SSH' })
    await expect(editar.locator('details.ssh-avanzado'), 'con bastión o túneles, la edición la abre desplegada').toHaveAttribute('open', '')
    await expect(editar.locator('[data-campo="salto"] option:checked')).toHaveText('Solo mía')
    await expect(editar.getByRole('textbox', { name: 'Puerto que escucha el túnel 1' })).toHaveValue('15432')
    await editar.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(editar).toHaveCount(0)
  })

  test('«Duplicar» crea la copia «… (1)» al momento, con el bastión y los túneles, sin abrir nada; duplicarla da «… (2)»', async () => {
    const win = s.win
    const lista = await abrirLista()
    await lista.getByRole('combobox', { name: 'Buscar conexión' }).fill('Tras el bastión')
    await lista.getByRole('treeitem', { name: /^Tras el bastión,/ }).click({ button: 'right' })
    await menu('Duplicar').click()
    await expect(win.locator('.toast', { hasText: 'Se duplicó como «Tras el bastión (1)»' }), 'avisa del nombre de la copia').toBeVisible({ timeout: 15_000 })
    await expect(win.getByRole('dialog', { name: 'Editar conexión SSH' }), 'y no abre ningún formulario').toHaveCount(0)
    await expect(lista.getByRole('treeitem', { name: /^Tras el bastión \(1\), pruebas@10\.0\.0\.5/ }), 'el lanzador sigue abierto y la copia sale en él').toBeVisible()
    const copia = await win.evaluate(async () => (await window.tessera.ssh.listar()).conexiones.find((c) => c.alias === 'Tras el bastión (1)'))
    const original = await win.evaluate(async () => (await window.tessera.ssh.listar()).conexiones.find((c) => c.alias === 'Tras el bastión'))
    expect(copia && { salto: copia.saltoId, tuneles: copia.tuneles }, 'con el mismo bastión y los mismos túneles').toEqual(original && { salto: original.saltoId, tuneles: original.tuneles })
    await lista.getByRole('treeitem', { name: /^Tras el bastión \(1\),/ }).click({ button: 'right' })
    await menu('Duplicar').click()
    await expect(lista.getByRole('treeitem', { name: /^Tras el bastión \(2\),/ }), 'duplicar la copia no acumula: «(2)», no «(1) (1)»').toBeVisible({ timeout: 15_000 })
    await win.keyboard.press('Escape')
  })
})

test.describe.serial('Las pestañas SSH del arranque anterior vuelven, sin conectarse hasta que se miran', () => {
  let s: SesionTessera
  let m: Montaje

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.env, {
      sembrar: (datos) => {
        sembrar(datos, m)
        const conexion = { id: 'c-web', profileId: 'personal', alias: 'Web', host: '192.0.2.40', puerto: 22, usuario: 'pruebas', metodo: 'sistema', disponibleAgentes: true }
        writeFileSync(join(datos, 'ssh-connections.json'), JSON.stringify({ version: 1, grupos: [], conexiones: [conexion] }))
        const ruta = join(datos, 'workspace-state.json')
        const estado = JSON.parse(readFileSync(ruta, 'utf8')) as { settings: Record<string, unknown> }
        estado.settings.sshPestanasPorPerfil = {
          personal: [
            { conexionId: 'c-web', alias: 'Web' },
            { conexionId: 'c-web', alias: 'Web', nombre: 'Logs' },
            { conexionId: 'c-web', alias: 'Web', sftp: true },
            { conexionId: 'c-borrada', alias: 'Ya no existe' }
          ]
        }
        writeFileSync(ruta, JSON.stringify(estado))
      }
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) {
      await borrarTemporal(m.ssh.raiz)
      await borrarTemporal(m.raiz)
    }
  })

  test('vuelven en su orden y con su nombre, ninguna se conecta sola, y mirar una la conecta; cerrar otra se guarda', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    const panel = win.locator('section.terminal-panel')
    await expect(panel).toBeVisible()
    const web = panel.getByRole('tab', { name: 'Web, SSH' })
    const logs = panel.getByRole('tab', { name: 'Logs, SSH' })
    await expect(web, 'la pestaña guardada vuelve').toBeVisible()
    await expect(logs, 'con su nombre puesto a mano').toBeVisible()
    await expect(panel.getByRole('tab', { name: /^SFTP · Web, archivos remotos/ }), 'y la del explorador SFTP').toBeVisible()
    await expect(web, 'sin elegir: se ve la terminal local').toHaveAttribute('aria-selected', 'false')
    await asentar(win)
    await win.waitForTimeout(1500)
    expect(m.ssh.arranques().length, 'ninguna se conectó al arrancar, tampoco el explorador SFTP').toBe(0)
    await web.click()
    await expect.poll(() => m.ssh.arranques().length, { message: 'mirarla la conecta' }).toBe(1)
    await esperarEnTerminal(win, BANNER_FALSO, 1, 'el ssh falso escribió su banner')
    expect(m.ssh.arranques().length, 'solo la que se mira').toBe(1)

    await logs.getByRole('button', { name: /^Cerrar/ }).click()
    await expect(logs).toHaveCount(0)
    const guardadas = (): string[] | null => {
      try {
        const e = JSON.parse(readFileSync(join(s.datos, 'workspace-state.json'), 'utf8')) as { settings?: { sshPestanasPorPerfil?: Record<string, Array<{ alias: string; nombre?: string }>> } }
        return (e.settings?.sshPestanasPorPerfil?.personal ?? []).map((p) => p.nombre ?? p.alias)
      } catch {
        return null
      }
    }
    await expect
      .poll(guardadas, { message: 'cerrarla llega al archivo; la de una conexión que ya no existe no se vuelve a guardar' })
      .toEqual(['Web', 'Web'])
  })
})

test.describe.serial('Cerrar la terminal local con una pestaña SSH restaurada', () => {
  let s: SesionTessera
  let m: Montaje

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.env, {
      sembrar: (datos) => {
        sembrar(datos, m)
        const conexion = { id: 'c-web', profileId: 'personal', alias: 'Web', host: '192.0.2.40', puerto: 22, usuario: 'pruebas', metodo: 'sistema', disponibleAgentes: true }
        writeFileSync(join(datos, 'ssh-connections.json'), JSON.stringify({ version: 1, grupos: [], conexiones: [conexion] }))
        const ruta = join(datos, 'workspace-state.json')
        const estado = JSON.parse(readFileSync(ruta, 'utf8')) as { settings: Record<string, unknown> }
        estado.settings.sshPestanasPorPerfil = { personal: [{ conexionId: 'c-web', alias: 'Web' }] }
        writeFileSync(ruta, JSON.stringify(estado))
      }
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) {
      await borrarTemporal(m.ssh.raiz)
      await borrarTemporal(m.raiz)
    }
  })

  test('pasa a verse la SSH (y se conecta): el panel no se queda sin terminal elegida', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    const panel = win.locator('section.terminal-panel')
    await expect(panel).toBeVisible()
    const web = panel.getByRole('tab', { name: 'Web, SSH' })
    await expect(web, 'restaurada y sin elegir').toHaveAttribute('aria-selected', 'false')
    const local = panel.locator('.terminal-tab', { hasNotText: 'Web' }).first()
    await local.getByRole('button', { name: /^Cerrar/ }).click()
    await expect(web, 'cerrar la local la elige').toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => m.ssh.arranques().length, { message: 'y se conecta, porque la cerró el usuario' }).toBe(1)
    await expect(panel, 'el panel sigue con terminal').not.toHaveClass(/\bsin-terminal\b/)
  })
})

test.describe.serial('Un archivo de conexiones que esta versión no sabe leer', () => {
  let s: SesionTessera
  let m: Montaje

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.env, {
      sembrar: (datos) => {
        sembrar(datos, m)
        // Una `version` que no es un número: el main lo bloquea y la lista llega vacía.
        writeFileSync(join(datos, 'ssh-connections.json'), JSON.stringify({ version: 'de-otra-version', grupos: [], conexiones: [] }))
        // Y una pestaña SSH guardada por una versión que sí leía el archivo.
        const ruta = join(datos, 'workspace-state.json')
        const estado = JSON.parse(readFileSync(ruta, 'utf8')) as { settings: Record<string, unknown> }
        estado.settings.sshPestanasPorPerfil = { personal: [{ conexionId: 'c-web', alias: 'Web' }] }
        writeFileSync(ruta, JSON.stringify(estado))
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
    if (m) {
      await borrarTemporal(m.ssh.raiz)
      await borrarTemporal(m.raiz)
    }
  })

  test('el riel lo dice, en vez de «Sin conexiones», y guardar los ajustes no borra las pestañas SSH recordadas', async () => {
    const win = s.win
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    const panel = win.locator('section.terminal-panel')
    await expect(panel).toBeVisible()
    await panel.locator('.panel-header').first().hover()
    await panel.getByRole('button', { name: 'Maximizar el panel de terminal' }).click()
    const riel = win.locator('aside.ssh-riel')
    await expect(riel.getByText('No se pueden usar las conexiones SSH')).toBeVisible()

    // Plegar el riel guarda los ajustes enteros: con una lista vacía que no es de fiar no se poda nada.
    await panel.getByRole('button', { name: 'Panel de conexiones' }).click()
    await expect(riel).toBeHidden()
    const guardado = (): { riel: unknown; pestanas: unknown } => {
      try {
        const e = JSON.parse(readFileSync(join(s.datos, 'workspace-state.json'), 'utf8')) as {
          settings?: { sshRielVisiblePorPerfil?: Record<string, boolean>; sshPestanasPorPerfil?: Record<string, unknown[]> }
        }
        return { riel: e.settings?.sshRielVisiblePorPerfil?.personal, pestanas: e.settings?.sshPestanasPorPerfil?.personal }
      } catch {
        // La app lo está reescribiendo en este instante: el sondeo vuelve a mirar.
        return { riel: undefined, pestanas: undefined }
      }
    }
    await expect.poll(() => guardado().riel, { message: 'plegar el riel llegó al archivo de ajustes' }).toBe(false)
    expect(guardado().pestanas, 'la pestaña recordada sigue: un archivo ajeno no dice qué conexiones existen').toEqual([{ conexionId: 'c-web', alias: 'Web' }])
  })
})
