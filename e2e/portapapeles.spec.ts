// =============================================================================
// El portapapeles y el menú de aplicación, pulsando las teclas de verdad, sobre el buscador
// de Configuración (un `<input>` controlado por React). Dos capas: la de Playwright/CDP
// (`MOD`, en las dos plataformas) demuestra que nada en la app se traga Mod+C/V/X/A/Z, y la
// NATIVA (`osascript`, solo Mac, se salta sin permiso de Accesibilidad) atraviesa el menú
// de verdad: es la única que distingue el menú por defecto de Electron del de Tessera
// (Cmd+W cerraba la ventana). El portapapeles se maneja con `clipboard` de Electron desde
// el main: la API web pide permiso y en un contexto automatizado no resuelve.
// Decisiones: docs/decisiones/pruebas/que-va-en-e2e-y-que-en-test-mts.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { abrirTessera, MOD, PLATAFORMA, type SesionTessera } from './tessera'

let s: SesionTessera

/** El buscador de Configuración: el `<input>` real donde se pulsan las teclas. */
const CAMPO = '.ajustes-buscador input'

/**
 * Cuánto se espera antes de dar por buena una comprobación NEGATIVA (que Cmd+R
 * no recargó, que Cmd+W no cerró). No hay evento que observar cuando NO pasa
 * nada, así que aquí un tiempo fijo es inevitable; lo que se puede es acotarlo
 * con lo que tarda el suceso que se niega. Un acelerador de menú se despacha en
 * el mismo turno de la cola de eventos, y una recarga de una página ya cargada
 * borra el contexto JS en decenas de milisegundos (la última prueba del archivo
 * lo mide de verdad: 103 ms de reload completo). 1,5 s es margen de sobra.
 */
const MARGEN_NO_PASA_NADA = 1_500

/** Valor con el que se ensucia el portapapeles antes de una prueba de copiado. */
const CENTINELA = 'centinela-que-nadie-copio'

test.beforeAll(async () => {
  s = await abrirTessera()
})
test.afterAll(async () => {
  await s?.cerrar()
})

/** Abre Configuración si no está abierta (`Cmd+,` la ALTERNA, no la abre siempre). */
async function abrirConfiguracion(): Promise<void> {
  if ((await s.win.locator('.ajustes-modal').count()) > 0) return
  await s.win.keyboard.press(`${MOD}+,`)
  await s.win.waitForSelector('.ajustes-modal')
}

/**
 * Deja el buscador de Configuración enfocado y con `texto` dentro.
 *
 * `fill()` y no `type()`: el contenido de partida no es lo que se prueba, y
 * `fill` además deja el foco en el campo, que es lo que las teclas necesitan.
 */
async function prepararCampo(texto = ''): Promise<void> {
  await abrirConfiguracion()
  await s.win.fill(CAMPO, texto)
  await expect(s.win.locator(CAMPO)).toBeFocused()
}

/** Lo que hay AHORA en el portapapeles del sistema. */
async function portapapeles(): Promise<string> {
  return s.app.evaluate(({ clipboard }) => clipboard.readText())
}

// ---------------------------------------------------------------------------
// CAPA CDP: la app no se traga los acordes de edición.
// ---------------------------------------------------------------------------

test('pegar mete en un campo real lo que hay en el portapapeles del sistema', async () => {
  await prepararCampo('')
  await s.app.evaluate(({ clipboard }) => clipboard.writeText('pegado-desde-el-sistema'))
  await s.win.keyboard.press(`${MOD}+V`)
  // `expect.poll` y no una espera fija: el pegado nativo viaja al renderer y de
  // ahí al `setState` de React, así que el valor aparece un par de turnos después.
  await expect.poll(() => s.win.inputValue(CAMPO)).toBe('pegado-desde-el-sistema')
})

test('copiar desde un campo deja el texto en el portapapeles del sistema', async () => {
  await prepararCampo('')
  await s.win.keyboard.type('texto-para-copiar')
  // El portapapeles se ensucia primero: si no, un `readText()` que devolviera lo
  // esperado por seguir ahí de la prueba anterior daría un verde falso.
  await s.app.evaluate((e, c) => e.clipboard.writeText(c), CENTINELA)
  // Sin selección no hay nada que copiar: este `Cmd+A` es también la prueba del
  // rol `selectall`, que no tiene otro efecto observable en un `<input>`.
  await s.win.keyboard.press(`${MOD}+A`)
  await s.win.keyboard.press(`${MOD}+C`)
  await expect.poll(portapapeles).toBe('texto-para-copiar')
})

test('cortar deja el texto en el portapapeles y vacía el campo', async () => {
  await prepararCampo('')
  await s.win.keyboard.type('texto-para-cortar')
  await s.app.evaluate((e, c) => e.clipboard.writeText(c), CENTINELA)
  await s.win.keyboard.press(`${MOD}+A`)
  await s.win.keyboard.press(`${MOD}+X`)
  await expect.poll(portapapeles).toBe('texto-para-cortar')
  // Las dos mitades de "cortar" se comprueban por separado a propósito: con sólo
  // la primera, un `copy` mal etiquetado como `cut` pasaría.
  await expect.poll(() => s.win.inputValue(CAMPO)).toBe('')
})

test('deshacer revierte la última edición del campo', async () => {
  // Se deshace un PEGADO y no un tecleo porque un pegado es UNA unidad de
  // edición: el resultado exacto ('' otra vez) es determinista. Chromium agrupa
  // el tecleo en tramos, y aquí esos tramos ni siquiera son los suyos —React
  // reescribe el valor del input controlado en cada pulsación y parte la
  // agrupación en trozos irregulares (medido: 'hola' se deshace en 'ho', 'h',
  // '')—. Fijar ese reparto sería fijar un detalle de Blink, no la conducta.
  await prepararCampo('')
  await s.app.evaluate(({ clipboard }) => clipboard.writeText('bloque-que-se-deshace'))
  await s.win.keyboard.press(`${MOD}+V`)
  await expect.poll(() => s.win.inputValue(CAMPO)).toBe('bloque-que-se-deshace')

  await s.win.keyboard.press(`${MOD}+Z`)
  await expect.poll(() => s.win.inputValue(CAMPO)).toBe('')

  // Y del tecleo se exige lo único que no depende de la agrupación: que deshacer
  // deje MENOS de lo escrito y que sea un prefijo, o sea que borró por el final.
  const ESCRITO = 'escrito-a-mano'
  await s.win.keyboard.type(ESCRITO)
  await expect.poll(() => s.win.inputValue(CAMPO)).toBe(ESCRITO)
  await s.win.keyboard.press(`${MOD}+Z`)
  await expect
    .poll(
      async () => {
        const valor = await s.win.inputValue(CAMPO)
        return valor.length < ESCRITO.length && ESCRITO.startsWith(valor)
      },
      { message: 'deshacer tenía que dejar un prefijo más corto de lo tecleado' }
    )
    .toBe(true)
})

// ---------------------------------------------------------------------------
// EL MENÚ CONSTRUIDO. Ésta es la prueba con poder de detección sobre el bug
// original: con `setApplicationMenu(null)` en el paquete, es la única de este
// archivo que se pone roja (verificado relanzando la app parcheada).
// ---------------------------------------------------------------------------

test('el menú de aplicación construido trae los roles de edición y ninguno de los retirados', async () => {
  test.skip(PLATAFORMA !== 'mac', 'en Windows no hay menú de aplicación: lo fija la prueba siguiente')
  const roles = await s.app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    if (menu === null) return null
    type Items = NonNullable<ReturnType<typeof Menu.getApplicationMenu>>['items']
    const encontrados: string[] = []
    const recorrer = (items: Items): void => {
      for (const item of items) {
        // El rol vuelve del lado nativo SIEMPRE en minúsculas ('selectall',
        // 'hideothers'), aunque la plantilla lo escriba en camelCase.
        if (item.role) encontrados.push(String(item.role).toLowerCase())
        if (item.submenu) recorrer(item.submenu.items)
      }
    }
    recorrer(menu.items)
    return encontrados
  })

  // `null` es exactamente el bug original: Tessera sin menú propio en macOS.
  expect(roles, 'Tessera no instaló menú de aplicación').not.toBeNull()
  for (const rol of ['undo', 'cut', 'copy', 'paste', 'selectall']) {
    expect(roles, `falta el rol '${rol}' en el menú`).toContain(rol)
  }
  // Y lo que MUERE A PROPÓSITO. Se comprueba sobre el menú CONSTRUIDO y no sobre
  // la plantilla porque un rol-contenedor (`viewMenu`, `fileMenu`) los metería
  // sin que se vean en la plantilla: `reload` le robaba Cmd+R a las terminales
  // (la búsqueda inversa de bash), `close` hacía que Cmd+W cerrase la APP, y
  // `about` duplicaría el «Acerca de» que hoy es una categoría de Configuración.
  for (const rol of ['reload', 'forcereload', 'toggledevtools', 'close', 'about']) {
    expect(roles, `el rol '${rol}' volvió al menú`).not.toContain(rol)
  }
})

test('en Windows NO hay menú de aplicación, ni siquiera escondido', async () => {
  test.skip(PLATAFORMA !== 'windows', 'en Mac el menú es obligatorio: lo fija la prueba anterior')
  // La mitad de Windows de la misma decisión. Un menú ESCONDIDO sigue despachando los
  // aceleradores de sus roles: con el de Electron por defecto, `reload` le robaba Ctrl+R
  // a la búsqueda inversa de bash y `close` hacía que Ctrl+W cerrase la app. Por eso en
  // Windows no se esconde, se quita (`Menu.setApplicationMenu(null)`), y las teclas que
  // sí se quieren (F11, F12) van por `before-input-event`.
  expect(await s.app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null)).toBe(true)
})

// ---------------------------------------------------------------------------
// LAS DOS TECLAS QUE MUEREN A PROPÓSITO.
// ---------------------------------------------------------------------------

test('Cmd+R no recarga la ventana', async () => {
  // Una recarga tira el renderer entero, y con él todo lo que aún no está en
  // disco: los modelos de Monaco de las pestañas sucias y las pestañas «sin
  // título», que no tienen respaldo ninguno. El testigo es la forma más directa
  // de observarlo: es una variable del `window`, y una recarga estrena contexto.
  await s.win.evaluate(() => {
    ;(window as unknown as { __testigoSinRecarga?: number }).__testigoSinRecarga = 1
  })
  await s.win.keyboard.press(`${MOD}+R`)
  await s.win.waitForTimeout(MARGEN_NO_PASA_NADA)
  expect(
    await s.win.evaluate(
      () => (window as unknown as { __testigoSinRecarga?: number }).__testigoSinRecarga ?? null
    )
  ).toBe(1)
})

test('Cmd+W no cierra la ventana ni la app', async () => {
  // En un IDE, Cmd+W significa «cerrar pestaña». Con el rol `close` en el menú
  // cerraba la aplicación entera, que es la peor traducción posible del gesto.
  await s.win.keyboard.press(`${MOD}+W`)
  await s.win.waitForTimeout(MARGEN_NO_PASA_NADA)
  expect(s.app.windows().length).toBe(1)
  // Y se pregunta también al proceso principal: una ventana escondida o
  // destruida seguiría contando en la lista de Playwright hasta que se entere.
  const estado = await s.app.evaluate(({ BrowserWindow }) => {
    const ventanas = BrowserWindow.getAllWindows()
    return { cuantas: ventanas.length, destruida: ventanas[0]?.isDestroyed() ?? true }
  })
  expect(estado).toEqual({ cuantas: 1, destruida: false })
  // La app sigue respondiendo, no sólo existiendo.
  expect(await s.win.evaluate(() => typeof window.tessera)).toBe('object')
})

// ---------------------------------------------------------------------------
// CAPA NATIVA. Teclas de verdad, por NSApp y por el menú.
// ---------------------------------------------------------------------------

/** Corre un AppleScript. Devuelve `null` si `osascript` falla (sin permiso). */
function osascript(guion: string): string | null {
  try {
    return execFileSync('osascript', ['-e', guion], { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

/**
 * ¿Tiene el proceso que corre las pruebas permiso de ACCESIBILIDAD?
 *
 * ES OTRA PREGUNTA QUE «¿quién está al frente?», y confundirlas costó dos pruebas
 * en rojo permanente. `get name of ... whose frontmost is true` FUNCIONA sin
 * Accesibilidad —leer la lista de procesos no la necesita—, así que la guarda daba
 * verde y la prueba se estrellaba después, en el `keystroke`, que sí la necesita. El
 * resultado era el peor: un fallo que parece del producto y es del permiso.
 *
 * `UI elements enabled` es la pregunta directa (el `AXIsProcessTrusted` de toda la
 * vida), y aquí devuelve `false` sin el permiso, medido en esta máquina.
 */
function accesibilidadConcedida(): boolean {
  return osascript('tell application "System Events" to get UI elements enabled') === 'true'
}

/**
 * Pone Tessera en primer plano y confirma con el sistema que lo está.
 *
 * LA CONFIRMACIÓN NO ES CEREMONIA: una pulsación de System Events va a la app
 * que esté al frente, sea cual sea. Si el robo de foco falla y se manda igual,
 * el Cmd+W de la prueba siguiente se lo come la ventana del usuario. Antes de
 * teclear nada hay que saber quién lo va a recibir.
 *
 * Y SE COMPARA EL PID, NO EL NOMBRE. La comparación por nombre decía «Tessera» tanto
 * si al frente estaba la app de la prueba como si estaba la TESSERA INSTALADA del
 * usuario —se llaman igual—, así que la guarda que existe para no teclear en la
 * ventana de otro daba por buena exactamente el caso que venía a impedir. Medido:
 * con la Tessera del usuario delante, `frontmost` respondía «Tessera».
 */
async function tesseraAlFrente(): Promise<boolean> {
  const pid = s.app.process().pid
  if (pid === undefined) return false
  await s.app.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true })
    BrowserWindow.getAllWindows()[0]?.focus()
  })
  // La activación de una app en macOS es asíncrona y pasa por el WindowServer:
  // preguntar en el mismo turno devuelve todavía la app anterior. Se sondea en
  // vez de dormir un número fijo.
  for (let intento = 0; intento < 20; intento++) {
    const frente = osascript(
      'tell application "System Events" to get unix id of first application process whose frontmost is true'
    )
    if (frente === String(pid)) return true
    await s.win.waitForTimeout(200)
  }
  return false
}

/**
 * Motivos de salto, para que un `skipped` diga QUÉ falta y no parezca verde.
 *
 * Son dos y no uno porque son dos causas distintas con dos arreglos distintos, y
 * mezclarlas mandaba a conceder un permiso ya concedido: sin Accesibilidad no se
 * puede teclear en absoluto; con ella pero sin foco, se teclearía en la ventana de
 * otra aplicación, que es peor que no teclear.
 */
const SIN_ACCESIBILIDAD =
  'requiere permiso de Accesibilidad para el proceso que corre las pruebas ' +
  '(Ajustes → Privacidad y seguridad → Accesibilidad): sin él System Events no ' +
  'puede teclear y NO se puede comprobar el camino real NSApp → menú → Blink'

const SIN_FOCO =
  'la Tessera de la prueba no llegó a primer plano (¿hay otra app robando el foco?): ' +
  'teclear ahora se lo llevaría esa otra ventana'

test('nativo: Cmd+V pega pasando de verdad por el menú del sistema', async () => {
  test.skip(PLATAFORMA !== 'mac', 'la capa nativa es de macOS')
  test.skip(!accesibilidadConcedida(), SIN_ACCESIBILIDAD)
  await prepararCampo('')
  test.skip(!(await tesseraAlFrente()), SIN_FOCO)
  await s.app.evaluate(({ clipboard }) => clipboard.writeText('pegado-con-tecla-nativa'))
  expect(
    osascript('tell application "System Events" to keystroke "v" using command down'),
    SIN_ACCESIBILIDAD
  ).not.toBeNull()
  // Ésta es la ÚNICA prueba del archivo en la que el acorde recorre el camino
  // del usuario entero; la capa CDP se salta el menú por diseño.
  await expect.poll(() => s.win.inputValue(CAMPO)).toBe('pegado-con-tecla-nativa')
})

test('nativo: Cmd+W no cierra la ventana', async () => {
  test.skip(PLATAFORMA !== 'mac', 'la capa nativa es de macOS')
  test.skip(!accesibilidadConcedida(), SIN_ACCESIBILIDAD)
  test.skip(!(await tesseraAlFrente()), SIN_FOCO)
  // ESTA PRUEBA SÍ DISTINGUE las dos versiones de la app, y es la razón de que la
  // capa nativa exista: con el bug puesto, el menú por defecto de Electron trae
  // «File → Close Window», y esta misma tecla nativa CIERRA la ventana (medido).
  // Por CDP no se nota, porque Playwright no consulta el menú.
  expect(
    osascript('tell application "System Events" to keystroke "w" using command down'),
    SIN_ACCESIBILIDAD
  ).not.toBeNull()
  await s.win.waitForTimeout(MARGEN_NO_PASA_NADA)
  const estado = await s.app.evaluate(({ BrowserWindow }) => {
    const ventanas = BrowserWindow.getAllWindows()
    return { cuantas: ventanas.length, destruida: ventanas[0]?.isDestroyed() ?? true }
  })
  expect(estado).toEqual({ cuantas: 1, destruida: false })
})

test('control positivo: una recarga de verdad SÍ borra el testigo', async () => {
  // Sin esta prueba, la de Cmd+R sería un verde vacío: si el testigo sobreviviese
  // a CUALQUIER cosa (por ejemplo porque `evaluate` reinyecta algo, o porque la
  // recarga no toca ese objeto), «el testigo sigue ahí» no probaría nada. Aquí se
  // recarga a propósito y se exige que el testigo desaparezca, que es lo que
  // convierte a la otra en una prueba con poder de detección.
  //
  // Va la ÚLTIMA del archivo porque deja el renderer recién arrancado y sin el
  // modal de Configuración abierto; cualquier prueba posterior lo pagaría.
  await s.win.evaluate(() => {
    ;(window as unknown as { __testigoSinRecarga?: number }).__testigoSinRecarga = 1
  })
  await s.win.reload({ waitUntil: 'domcontentloaded' })
  await s.win.waitForSelector('.titlebar')
  expect(
    await s.win.evaluate(
      () => (window as unknown as { __testigoSinRecarga?: number }).__testigoSinRecarga ?? null
    )
  ).toBeNull()
})
