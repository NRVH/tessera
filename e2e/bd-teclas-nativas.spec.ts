// =============================================================================
// Los acordes del explorador de BD con teclas NATIVAS de macOS (System Events por `osascript`), que
// atraviesan la distribución del teclado y el menú de la app: los sintéticos de Playwright no pasan
// por ninguno de los dos. ⌥⌘B, ⌥X y ⌥⌘N no escriben su carácter compuesto y hacen lo suyo, ⌘↩
// ejecuta sin insertar línea, ⌘. detiene una consulta, ⌘C de la rejilla deja TSV en el
// portapapeles del sistema, ⌘W cierra la pestaña de datos y no la ventana, ⌘↓ abre una tabla, ⇧↩
// el visor, ⌘⌫ marca para borrar (⌫ a secas no) y ⌥ + letra compone en el editor de la celda.
// Solo Mac y con permiso de Accesibilidad; sin él, o sin Docker, se salta con su motivo.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { CONSOLA, PESTANAS, abrirConsolaNueva, celdaResultado, esperarFinEjecucion } from './consolaAyudas'
import { monacoConsola } from './monaco'
import { PANE, abrirTablaPublica, arrancarRejilla, celda, fila, type EntornoRejilla } from './rejillaAyudas'
import { MOD, PLATAFORMA } from './tessera'

/** Corre un AppleScript; `null` si `osascript` falla. */
function osascript(guion: string): string | null {
  try {
    return execFileSync('osascript', ['-e', guion], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  } catch {
    return null
  }
}

/** System Events solo teclea con el permiso de Accesibilidad del proceso que corre las pruebas. */
function accesibilidadConcedida(): boolean {
  return osascript('tell application "System Events" to get UI elements enabled') === 'true'
}

/** Deja los dos fotogramas que React necesita para confirmar lo que provocó la tecla. */
async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

test.describe.serial('explorador de BD: acordes con teclas nativas de macOS', () => {
  test.skip(PLATAFORMA !== 'mac', 'las teclas nativas por System Events solo existen en macOS')
  test.skip(!accesibilidadConcedida(), 'requiere permiso de Accesibilidad para el proceso que corre las pruebas')

  let e: EntornoRejilla | null = null
  let motivoSalto: string | null = null

  /**
   * Pone ESTA Tessera al frente (por pid: la instalada del usuario se llama igual) y manda la
   * pulsación. Si no queda al frente no teclea: escribiría en la ventana de otra aplicación.
   */
  async function teclear(guion: string): Promise<void> {
    const pid = e!.s.app.process().pid
    await e!.s.app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true })
      BrowserWindow.getAllWindows()[0]?.focus()
    })
    let alFrente = false
    for (let i = 0; i < 20 && !alFrente; i++) {
      alFrente = osascript('tell application "System Events" to get unix id of first application process whose frontmost is true') === String(pid)
      if (!alFrente) await e!.s.win.waitForTimeout(200)
    }
    expect(alFrente, 'esta Tessera no quedó al frente: no se teclea en la ventana de otra aplicación').toBe(true)
    expect(osascript(`tell application "System Events"\n${guion}\nend tell`), `osascript: ${guion}`).not.toBeNull()
  }

  test.beforeAll(async () => {
    const r = await arrancarRejilla()
    if ('motivo' in r) motivoSalto = r.motivo
    else e = r
  })

  test.afterAll(async () => {
    await e?.cerrar()
  })

  test('⌥⌘B muestra y oculta el agente de datos con el foco en la consola, sin escribir «∫»', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    await abrirConsolaNueva(win, `${MOD}+KeyN`)
    await monacoConsola(win, { op: 'fijar', texto: 'select 1' })
    await monacoConsola(win, { op: 'foco' })
    const columna = win.locator('.right-panel')
    await teclear('keystroke "b" using {command down, option down}')
    await expect(columna, '⌥⌘B enseña la columna del agente').toBeVisible({ timeout: 30_000 })
    await monacoConsola(win, { op: 'foco' })
    await teclear('keystroke "b" using {command down, option down}')
    await expect(columna, 'otra vez la oculta').toBeHidden({ timeout: 10_000 })
    expect(await monacoConsola(win, { op: 'texto' }), 'ninguna de las dos escribió en la consola').toBe('select 1')
  })

  test('⌘↩ ejecuta la sentencia y no inserta una línea debajo', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    await monacoConsola(win, { op: 'fijar', texto: 'select 41 + 1 as r' })
    await monacoConsola(win, { op: 'cursorAlFinal' })
    await monacoConsola(win, { op: 'foco' })
    await teclear('key code 36 using command down')
    await expect(celdaResultado(win, 0, 0), 'ejecutó la sentencia').toHaveText('42', { timeout: 30_000 })
    expect(await monacoConsola(win, { op: 'texto' }), 'sin línea nueva').toBe('select 41 + 1 as r')
  })

  test('⌥X ejecuta todo y no escribe su carácter compuesto', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    const texto = 'select 7 as a;\nselect 8 as b'
    await monacoConsola(win, { op: 'fijar', texto })
    await monacoConsola(win, { op: 'foco' })
    await teclear('keystroke "x" using option down')
    await esperarFinEjecucion(win)
    // Ejecutar todo deja un resultado por sentencia: el activo es el de la última.
    await expect(celdaResultado(win, 0, 0), 'ejecutó las dos sentencias').toHaveText('8', { timeout: 30_000 })
    expect(await monacoConsola(win, { op: 'texto' }), 'no escribió nada en la consola').toBe(texto)
  })

  test('⌘. detiene una consulta larga en menos de 5 s', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    await monacoConsola(win, { op: 'fijar', texto: 'select pg_sleep(30)' })
    await monacoConsola(win, { op: 'cursorAlFinal' })
    await monacoConsola(win, { op: 'foco' })
    await teclear('key code 36 using command down')
    const detener = win.locator(`${CONSOLA} .db-consola-detener`)
    await expect(detener, 'la consulta está en marcha').toBeEnabled({ timeout: 15_000 })
    const t0 = Date.now()
    await teclear('keystroke "." using command down')
    await expect(detener, '⌘. la detuvo').toBeDisabled({ timeout: 5_000 })
    expect(Date.now() - t0, 'en menos de 5 s').toBeLessThan(5_000)
  })

  test('⌘C en la rejilla deja TSV en el portapapeles del sistema (por el menú de la app)', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    await abrirTablaPublica(win, 'grande')
    execFileSync('pbcopy', { input: 'testigo' })
    await celda(win, 0, 0).click()
    await celda(win, 1, 1).click({ modifiers: ['Shift'] })
    await asentar(win)
    await teclear('keystroke "c" using command down')
    await expect
      .poll(() => execFileSync('pbpaste').toString(), { message: 'el portapapeles del sistema lleva dos filas y dos columnas en TSV' })
      .toMatch(/^[^\t\n]+\t[^\t\n]+\r?\n[^\t\n]+\t[^\t\n]+\r?\n?$/)
  })

  test('⌘W con el foco en la rejilla cierra la pestaña de datos y no la ventana', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    const pestanas = win.locator(PESTANAS)
    const antes = await pestanas.count()
    await celda(win, 0, 0).click()
    await teclear('keystroke "w" using command down')
    await expect(pestanas, 'cerró una pestaña').toHaveCount(antes - 1)
    expect(await e!.s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 'la ventana sigue').toBe(1)
  })

  test('⌘↓ sobre la tabla del árbol abre su pestaña', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    await fila(win, 'objeto', 'grande').click()
    await teclear('key code 125 using command down')
    await expect(win.locator(PESTANAS, { hasText: 'grande' }), '⌘↓ la abrió').toHaveClass(/\bactive\b/, { timeout: 15_000 })
    await expect(celda(win, 0, 0)).toBeVisible({ timeout: 30_000 })
  })

  test('⇧↩ abre el visor de la celda y Esc lo cierra devolviendo el foco a la rejilla', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    await celda(win, 0, 2).click()
    await teclear('key code 36 using shift down')
    const visor = win.locator('.db-visor-modal')
    await expect(visor, '⇧↩ abre el visor').toBeVisible({ timeout: 10_000 })
    await teclear('key code 53')
    await expect(visor, 'Esc lo cierra').toHaveCount(0)
    expect(await win.evaluate(() => document.activeElement?.closest('.db-rejilla') !== null), 'el foco vuelve a la rejilla').toBe(true)
  })

  test('⌘⌫ marca la fila para borrar y ⌫ a secas no (abre el editor vacío); ⌥⌘Z lo revierte', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    const fila2 = win.locator(`${PANE} .db-rejilla-fila[aria-rowindex="4"]`)
    await celda(win, 2, 1).click()
    await teclear('key code 51')
    await expect(win.locator(`${PANE} .db-celda-editor`), '⌫ a secas abre el editor para escribir').toHaveCount(1)
    await expect(fila2, '⌫ a secas no marca la fila').not.toHaveClass(/\bborrada\b/)
    await teclear('key code 53')
    await expect(win.locator(`${PANE} .db-celda-editor`)).toHaveCount(0)
    await celda(win, 2, 1).click()
    await teclear('key code 51 using command down')
    await expect(fila2, '⌘⌫ la marca para borrar').toHaveClass(/\bborrada\b/)
    await teclear('keystroke "z" using {command down, option down}')
    await expect(fila2, '⌥⌘Z revierte la marca').not.toHaveClass(/\bborrada\b/)
  })

  test('⌥⌘N pone NULL sin escribir su carácter compuesto, y ⌥⌘Z lo revierte', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    const datos = celda(win, 3, 2)
    const antes = (await datos.textContent()) ?? ''
    await datos.click()
    await teclear('keystroke "n" using {command down, option down}')
    await expect(datos, '⌥⌘N la deja en NULL, marcada como cambiada').toHaveClass(/\bcambiada\b/)
    await expect(win.locator(`${PANE} .db-celda-editor`), 'sin abrir el editor (no escribió nada)').toHaveCount(0)
    await teclear('keystroke "z" using {command down, option down}')
    await expect(datos, '⌥⌘Z la revierte').not.toHaveClass(/\bcambiada\b/)
    await expect(datos).toHaveText(antes)
  })

  test('en el editor de la celda, la tecla muerta ⌥N y luego N compone «ñ» y no dispara ningún atajo', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    const fila3 = win.locator(`${PANE} .db-rejilla-fila[aria-rowindex="5"]`)
    await celda(win, 3, 1).click()
    await teclear('key code 36')
    const editor = win.locator(`${PANE} .db-celda-editor`)
    await expect(editor, '↩ abre el editor').toHaveCount(1)
    // El editor nace con el valor seleccionado: lo compuesto lo sustituye. ⌥N es la tecla muerta
    // de la tilde en las distribuciones estadounidense y latinoamericana. Las dos pulsaciones van
    // en una sola orden, con una pausa de persona: pegadas, la segunda llega antes de que la
    // composición esté abierta y se queda solo la tilde.
    await teclear('keystroke "n" using option down\ndelay 0.3\nkeystroke "n"')
    await expect(editor, 'el editor sigue abierto: ⌥N no fue un atajo').toHaveCount(1)
    const valor = await editor.evaluate((el) => (el as HTMLTextAreaElement | HTMLInputElement).value)
    expect(valor.normalize('NFC'), 'compuso «ñ» en el editor').toBe('ñ')
    await expect(fila3, 'ni marcó la fila').not.toHaveClass(/\bborrada\b/)
    await teclear('key code 53')
    await expect(editor, 'Esc descarta la edición').toHaveCount(0)
    await expect(celda(win, 3, 1)).not.toHaveClass(/\bcambiada\b/)
  })

  test('⌘→ y ⌘↓ llevan el foco de la rejilla a la última columna y a la última fila cargada', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    const foco = win.locator(`${PANE} .db-celda[id]`)
    await celda(win, 0, 0).click()
    await teclear('key code 124 using command down')
    await expect(foco, '⌘→ va a la última columna (largo, la 5.ª)').toHaveAttribute('aria-colindex', '6')
    await teclear('key code 125 using command down')
    await expect
      .poll(async () => Number(await foco.evaluate((el) => el.closest('[aria-rowindex]')?.getAttribute('aria-rowindex'))), {
        message: '⌘↓ va a la última fila cargada (la primera página es de 500)'
      })
      .toBeGreaterThanOrEqual(500)
    await teclear('key code 126 using command down')
    await expect
      .poll(async () => foco.evaluate((el) => el.closest('[aria-rowindex]')?.getAttribute('aria-rowindex')), { message: '⌘↑ vuelve a la primera' })
      .toBe('2')
  })

  test('⌃+clic (el clic derecho de Mac, con el ratón de verdad) abre el menú de la fila del árbol y el de la celda', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const win = e!.s.win
    const menu = win.locator('.ctx-menu')
    for (const [que, objetivo] of [
      ['la fila del árbol', fila(win, 'objeto', 'grande')],
      ['la celda', celda(win, 1, 1)]
    ] as const) {
      await clicConControl(objetivo)
      await expect(menu, `⌃+clic abre el menú de ${que}`).toBeVisible({ timeout: 5_000 })
      await teclear('key code 53')
      await expect(menu).toHaveCount(0)
    }
  })

  /**
   * Un clic IZQUIERDO con ⌃ de verdad (un CGEvent del sistema, en coordenadas de pantalla): es
   * macOS quien lo convierte en clic secundario. Un clic sintético de Playwright con el
   * modificador no pasa por esa conversión, así que no demostraría nada.
   */
  async function clicConControl(objetivo: import('@playwright/test').Locator): Promise<void> {
    const caja = await objetivo.boundingBox()
    expect(caja, 'el objetivo del clic se ve').not.toBeNull()
    const ventana = await e!.s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds())
    const x = Math.round(ventana.x + caja!.x + caja!.width / 2)
    const y = Math.round(ventana.y + caja!.y + caja!.height / 2)
    await teclear('delay 0')
    const jxa = `ObjC.import('CoreGraphics');
      const p = $.CGPointMake(${x}, ${y});
      for (const tipo of [$.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) {
        const ev = $.CGEventCreateMouseEvent($(), tipo, p, $.kCGMouseButtonLeft);
        $.CGEventSetFlags(ev, $.kCGEventFlagMaskControl);
        $.CGEventPost($.kCGHIDEventTap, ev);
      }`
    execFileSync('osascript', ['-l', 'JavaScript', '-e', jxa])
  }

  // Va la ÚLTIMA: acaba cerrando la app. El diálogo nativo se sustituye en el main por uno que
  // apunta lo que pregunta y contesta en orden (como en `conexiones.spec.ts`, prueba 10).
  test('⌘Q con una transacción pendiente pregunta; Cancelar la deja viva, otra ⌘Q vuelve a preguntar y «Revertir y salir» cierra', async () => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
    const app = e!.s.app
    const win = e!.s.win
    await win.locator(PESTANAS, { hasText: 'consola' }).first().click()
    const modo = win.locator(`${CONSOLA} .db-consola-tx-modo`)
    await modo.click()
    await expect(modo).toHaveAttribute('aria-pressed', 'true')
    await monacoConsola(win, { op: 'fijar', texto: "update public.grande set nombre = 'cambio' where id = 1" })
    await monacoConsola(win, { op: 'foco' })
    await teclear('key code 36 using command down')
    await expect(win.locator(`${CONSOLA} .db-consola-tx`)).toHaveText('Tx pendiente (1)', { timeout: 15_000 })

    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { __e2eDialogos: unknown[]; __e2eRespuestas: number[] }
      g.__e2eDialogos = []
      g.__e2eRespuestas = []
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const o = args[args.length - 1] as { detail?: string; buttons?: string[] }
        g.__e2eDialogos.push({ detail: o.detail, buttons: o.buttons })
        return { response: g.__e2eRespuestas.shift() ?? 2, checkboxChecked: false }
      }) as unknown as typeof dialog.showMessageBox
    })
    const responder = (r: number): Promise<void> =>
      app.evaluate((_e, r) => void (globalThis as unknown as { __e2eRespuestas: number[] }).__e2eRespuestas.push(r), r)
    const preguntas = (): Promise<number> =>
      app.evaluate(() => (globalThis as unknown as { __e2eDialogos: unknown[] }).__e2eDialogos.length)

    await responder(2)
    await teclear('keystroke "q" using command down')
    await expect.poll(preguntas, { message: '⌘Q, por el menú de la app, preguntó' }).toBe(1)
    await win.waitForTimeout(500)
    await expect(win.locator('.titlebar'), 'Cancelar deja la app viva').toBeVisible()
    await expect(win.locator(`${CONSOLA} .db-consola-tx`), 'y la transacción pendiente').toHaveText('Tx pendiente (1)')

    await responder(2)
    await teclear('keystroke "q" using command down')
    await expect.poll(preguntas, { message: 'una segunda ⌘Q vuelve a preguntar' }).toBe(2)
    await win.waitForTimeout(500)
    await expect(win.locator('.titlebar')).toBeVisible()

    const cerrada = app.waitForEvent('close', { timeout: 60_000 })
    await responder(1)
    await teclear('keystroke "q" using command down')
    await cerrada
    expect(e!.pg.psql('select nombre from public.grande where id = 1;').out.trim(), 'se revirtió').toBe('fila 1')
  })
})
