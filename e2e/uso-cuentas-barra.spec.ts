// =============================================================================
// «Uso de las cuentas» en la barra de estado, en los dos idiomas: la lista abre con todas las cuentas del perfil menos
// la que está a la vista en el pie de un panel, fija y quita cuentas en la barra, se cierra con Escape y con un clic
// fuera, y ni la lista ni la barra desbordan en una ventana pequeña ni en una grande. El pie del panel vuelve a ser un
// desplegable informativo. Las tareas delegadas (simuladas por el evento del indicador) reúnen el uso de cada cuenta al pie, y la
// vista de agentes no enseña cuentas en la barra. El menú de una fijada abre encima sin taparla ni partir sus filas,
// con ratón y teclado en ambos tamaños, y sus dos entradas llevan icono. Sin contenedores: las cuentas se leen en el equipo.
// =============================================================================
import { expect, test, type Locator, type Page } from '@playwright/test'
import { cpSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { carpetasAgentes, MOD, PLATAFORMA } from './tessera'
import { abrirUsoCuentas, carpetaDeCuenta } from './usoCuentasAyudas'

const GESTO_LECTOR_PANTALLA = 'lector-de-pantalla'
/**
 * Los gestos de teclado que abren el menú contextual del elemento enfocado. En macOS no existen ni Mayús+F10 ni la tecla
 * Menú (`docs/TESSERA_MACOS.md`, gestos por plataforma): desde el teclado solo llega el `contextmenu` que el lector de
 * pantalla (VO+⇧+M) entrega al elemento enfocado, sin coordenadas de puntero.
 */
const GESTOS_MENU_TECLADO = PLATAFORMA === 'mac' ? [GESTO_LECTOR_PANTALLA] : ['Shift+F10', 'ContextMenu']

async function abrirMenuConTeclado(enfocado: Locator, gesto: string): Promise<void> {
  if (gesto !== GESTO_LECTOR_PANTALLA) return enfocado.press(gesto)
  await enfocado.evaluate((el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true })))
}

/** Lo de la derecha de la barra no pisa la marca (si se ve) ni lo de la izquierda. */
async function barraSinEncimar(ventana: Page): Promise<{ encimado: boolean; escalon: string | null }> {
  return ventana.evaluate(() => {
    const barra = document.querySelector<HTMLElement>('footer.status-bar')!
    const der = barra.querySelector('.status-bar-right')!.getBoundingClientRect()
    const marca = barra.querySelector<HTMLElement>('.status-bar-marca')!
    const izq = Array.from(barra.querySelector('.status-bar-left')!.children).map((h) => h.getBoundingClientRect().right)
    const tope = getComputedStyle(marca).visibility === 'visible' ? marca.getBoundingClientRect().right : Math.max(0, ...izq)
    return { encimado: der.left < tope, escalon: barra.dataset.escalon ?? null }
  })
}

const textos = {
  es: {
    titulo: 'Uso de las cuentas', equipo: 'En su equipo', sinSesion: 'Sin sesión iniciada',
    sinCredencialesConBoton: 'Esta cuenta no tiene la sesión iniciada. Iníciela con el botón de su fila o en Configuración › Agentes.',
    nota: 'No se lista la cuenta del panel a la vista', administrar: 'Administrar las cuentas…',
    iniciar: 'Iniciar sesión en "Nutria"', dialogo: 'Iniciar sesión', subtitulo: 'Cuenta "Nutria" · Codex'
  },
  en: {
    titulo: 'Account usage', equipo: 'On your computer', sinSesion: 'Not signed in',
    sinCredencialesConBoton: 'This account is not signed in. Sign in with the button in its row or in Settings › Agents.',
    nota: 'The account of the visible panel is not listed', administrar: 'Manage accounts…',
    iniciar: 'Sign in to "Nutria"', dialogo: 'Sign in', subtitulo: 'Account "Nutria" · Codex'
  }
}

for (const idioma of ['es', 'en'] as const) {
  const tx = textos[idioma]
  test(`uso de las cuentas en la barra de estado (${idioma})`, async () => {
    const { s, nutria: cuentaNutria, cerrar } = await abrirUsoCuentas({ idioma })
    try {
      const ventana = s.ventana
      const boton = ventana.locator('footer.status-bar .uso-cuentas-boton')
      const panel = ventana.locator('.uso-cuentas-panel:not([data-saliendo])')
      const codex = panel.locator('.uso-cuentas-grupo', { hasText: 'Codex' })
      const nativa = codex.locator('.uso-cuentas-fila', { hasText: tx.equipo })
      const nutria = panel.locator('.uso-cuentas-fila', { hasText: 'Nutria' })
      const iniciar = nutria.getByRole('button', { name: tx.iniciar, exact: true })
      const dialogo = ventana.getByRole('dialog', { name: tx.dialogo, exact: true })
      const fijada = ventana.locator('footer.status-bar .uso-fijada')
      const capsula = ventana.locator('footer.status-bar .uso-fijada-presencia')
      const nombreBoton = idioma === 'es' ? 'Uso de las cuentas: consultar y fijar cuentas' : 'Account usage: view and pin accounts'
      const abrirDesdeMenu = idioma === 'es' ? 'Uso de las cuentas…' : 'Account usage…'
      const quitarDesdeMenu = idioma === 'es' ? 'Desfijar "Codex"' : 'Unpin "Codex"'
      await expect(boton).toHaveAccessibleName(nombreBoton)
      await expect(boton.locator('.uso-cuentas-icono')).toBeVisible()
      const derechaBoton = await boton.evaluate((el) => el.getBoundingClientRect().right)
      await boton.click()
      await expect(panel.locator('.uso-cuentas-titulo')).toHaveText(tx.titulo)
      await expect(nativa).toBeVisible()
      await expect(nutria).toContainText(tx.sinSesion)
      await expect(iniciar).toBeEnabled()
      await expect(iniciar).toHaveAttribute('title', tx.iniciar)
      await expect(nutria.locator('button[aria-pressed]')).toHaveCount(0)
      await expect(nutria.locator('.cuenta-uso-sin-sesion button')).toHaveCount(0)
      await expect(nativa.getByRole('button', { pressed: false })).toBeEnabled()
      const cajaIniciar = await iniciar.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right }
      })
      const cajaPin = await nativa.getByRole('button', { pressed: false }).evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right }
      })
      expect(Math.abs(cajaIniciar.left - cajaPin.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(cajaIniciar.right - cajaPin.right)).toBeLessThanOrEqual(1)
      // Claude Code nativo está a la vista en el pie de su panel: no se repite, y la nota lo dice.
      await expect(panel.locator('.uso-cuentas-agente', { hasText: 'Claude Code' })).toHaveCount(0)
      await expect(panel.locator('.uso-cuentas-nota')).toContainText(tx.nota)
      await expect(panel.locator('.uso-cuentas-administrar')).toHaveText(tx.administrar)

      await nativa.getByRole('button').click()
      await expect(nativa.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
      await expect(nativa.getByRole('button')).toHaveAttribute('title', idioma === 'es'
        ? `Desfijar "${tx.equipo}" de la barra de estado` : `Unpin "${tx.equipo}" from the status bar`)
      await expect(fijada.locator('.uso-fijada-nombre')).toHaveText('Codex')
      await expect(boton.locator('.uso-cuentas-icono')).toBeVisible()
      await expect.poll(() => boton.evaluate((el) => el.getBoundingClientRect().right)).toBe(derechaBoton)
      expect(await fijada.evaluate((el) => el.getBoundingClientRect().right <= document.querySelector('.uso-cuentas-boton')!.getBoundingClientRect().left)).toBe(true)
      // Con la lista abierta no sale la tarjeta de la cápsula: la de la fila sí, a la izquierda de la lista.
      const tarjeta = ventana.locator('.tarjeta-cuenta:not([data-saliendo])')
      // Pulsar la quita, como al tooltip: vuelve al entrar otra vez en la fila.
      await panel.locator('.uso-cuentas-cabecera').hover()
      await nativa.hover()
      await expect(tarjeta.locator('.tarjeta-cuenta-nombre')).toHaveText('Codex')
      await expect(tarjeta.locator('.tarjeta-cuenta-donde')).toHaveText(tx.equipo)
      await expect(tarjeta.locator('.agent-usage-row')).toHaveCount(2)
      expect(await tarjeta.evaluate((el) => el.getBoundingClientRect().right <= document.querySelector('.uso-cuentas-panel')!.getBoundingClientRect().left), 'no tapa la lista').toBe(true)
      await nutria.hover()
      await expect(iniciar).toBeVisible()
      await expect(tarjeta.locator('.agent-usage-foot')).toHaveText(tx.sinCredencialesConBoton)

      await iniciar.click()
      await expect(dialogo).toBeVisible()
      await expect(dialogo.locator('.modal-subtitulo')).toHaveText(tx.subtitulo)
      const panelDeUso = ventana.locator('.uso-cuentas-panel')
      const focoDentro = (): Promise<boolean> => dialogo.evaluate((el) => el.contains(document.activeElement))
      await expect(panelDeUso).toHaveCount(0)
      await expect.poll(focoDentro).toBe(true)
      for (const tecla of ['Space', 'Enter']) {
        await ventana.keyboard.press(tecla)
        await expect(panelDeUso).toHaveCount(0)
        await expect(dialogo).toBeVisible()
      }
      for (const tecla of ['Tab', 'Tab', 'Tab', 'Tab']) {
        await ventana.keyboard.press(tecla)
        await expect.poll(focoDentro).toBe(true)
      }
      await ventana.keyboard.press('Escape')
      await expect(dialogo).toHaveCount(0)
      await expect(boton).toBeFocused()
      await boton.click()
      await expect(nativa).toBeVisible()
      await ventana.mouse.click(5, 5)
      await expect(panel).toHaveCount(0)
      // La cápsula enseña su tarjeta encima, dentro de la ventana, y sin el tooltip del botón.
      await fijada.hover()
      await expect(tarjeta.locator('.agent-usage-row')).toHaveCount(2)
      expect(await tarjeta.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return r.bottom <= document.querySelector('footer.status-bar')!.getBoundingClientRect().top && r.left >= 0 && r.right <= window.innerWidth && getComputedStyle(el).pointerEvents
      })).toBe('none')
      await expect(boton).toHaveAttribute('title', nombreBoton)
      await ventana.mouse.move(5, 5)
      await expect(tarjeta).toHaveCount(0)
      await fijada.click()
      await expect(panel).toHaveCount(0)
      await ventana.mouse.move(5, 5)
      await expect(tarjeta, 'el clic izquierdo no deja la tarjeta fija').toHaveCount(0)
      await boton.focus()
      await ventana.keyboard.press('Shift+Tab')
      await expect(capsula).toBeFocused()
      await expect(tarjeta).toBeVisible()
      for (const gesto of GESTOS_MENU_TECLADO) {
        await abrirMenuConTeclado(capsula, gesto)
        await expect(ventana.getByRole('menuitem', { name: quitarDesdeMenu, exact: true })).toBeFocused()
        for (const nombre of [quitarDesdeMenu, abrirDesdeMenu]) {
          await expect(ventana.getByRole('menuitem', { name: nombre, exact: true }).locator('.ctx-menu-icono svg')).toBeVisible()
        }
        await expect(tarjeta).toHaveCount(0)
        await ventana.keyboard.press('Escape')
        await expect(capsula).toBeFocused()
      }
      await boton.focus()

      for (const [width, height] of [[900, 620], [1600, 1000]]) {
        await s.app.evaluate(({ BrowserWindow }, dimensiones) => {
          const ventana = BrowserWindow.getAllWindows()[0]
          ventana.unmaximize()
          ventana.setSize(dimensiones.width, dimensiones.height)
        }, { width, height })
        await expect.poll(() => barraSinEncimar(ventana), `${width}: lo fijado no pisa la marca ni la izquierda`).toMatchObject({ encimado: false })
        await expect.poll(() => ventana.locator('footer.status-bar').evaluate((el) => el.scrollWidth === el.clientWidth), `${width}×${height}: la barra no desborda`).toBe(true)
        await expect(boton.locator('.uso-cuentas-icono')).toBeVisible()
        if (width === 1600) expect((await barraSinEncimar(ventana)).escalon, 'con sitio, la marca se queda').toBe('0')
        await boton.click()
        await expect(nativa).toBeVisible()
        const medida = await panel.evaluate((el) => ({
          panel: el.scrollWidth === el.clientWidth,
          filas: Array.from(el.querySelectorAll<HTMLElement>('.uso-cuentas-fila')).every((f) => f.scrollWidth === f.clientWidth),
          // El pie de la lista va en una línea: el enlace no se parte y la pista se recorta, sin bajar de renglón.
          pie: (() => {
            const pie = el.querySelector<HTMLElement>('.uso-cuentas-pie')!
            const enlace = pie.querySelector<HTMLElement>('.uso-cuentas-administrar')!.getBoundingClientRect()
            const pista = pie.querySelector<HTMLElement>('.uso-cuentas-pista')!.getBoundingClientRect()
            return enlace.height <= 24 && pista.height <= 18 && pie.scrollWidth === pie.clientWidth
          })(),
          dentro: el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= window.innerWidth && el.getBoundingClientRect().top >= 0
        }))
        expect(medida, `${width}×${height}`).toEqual({ panel: true, filas: true, pie: true, dentro: true })
        await ventana.keyboard.press('Escape')
        await expect(panel).toHaveCount(0)
        for (const apertura of ['ratón', ...GESTOS_MENU_TECLADO]) {
          if (apertura === 'ratón') await fijada.click({ button: 'right' })
          else { await capsula.focus(); await abrirMenuConTeclado(capsula, apertura) }
          const quitar = ventana.getByRole('menuitem', { name: quitarDesdeMenu, exact: true })
          await expect(quitar).toBeFocused()
          await expect(tarjeta).toHaveCount(0)
          await expect.poll(() => quitar.evaluate((el) => {
            const menu = el.closest('[role="menu"]')!.getBoundingClientRect()
            const capsula = document.querySelector('footer.status-bar .uso-fijada-presencia')!.getBoundingClientRect()
            const estilo = getComputedStyle(el)
            const altoNormal = Math.max(parseFloat(estilo.minHeight), parseFloat(estilo.lineHeight) + parseFloat(estilo.paddingTop) + parseFloat(estilo.paddingBottom))
            return {
              sinSolapar: menu.bottom <= capsula.top - 4,
              dentro: menu.left >= 8 && menu.right <= window.innerWidth - 8 && menu.top >= 8 && menu.bottom <= window.innerHeight - 8,
              alineado: Math.abs(menu.left - Math.max(8, Math.min(capsula.left, window.innerWidth - menu.width - 8))) < 1,
              unaLinea: Math.abs(el.getBoundingClientRect().height - altoNormal) < 1
            }
          }), `${width}×${height}, ${apertura}: menú sobre la cápsula y fila sin partir`).toEqual({ sinSolapar: true, dentro: true, alineado: true, unaLinea: true })
          await ventana.keyboard.press('Escape')
          await expect(capsula).toBeFocused()
        }
      }

      await fijada.click({ button: 'right' })
      await expect(tarjeta).toHaveCount(0)
      await ventana.getByRole('menuitem', { name: quitarDesdeMenu, exact: true }).click()
      await expect(fijada).toHaveCount(0)
      await expect(boton).toBeFocused()
      await boton.click()
      await nativa.getByRole('button').click()
      await ventana.keyboard.press('Escape')
      await fijada.click({ button: 'right' })
      await ventana.getByRole('menuitem', { name: abrirDesdeMenu, exact: true }).click()
      await expect(panel).toBeVisible()
      await expect(tarjeta).toHaveCount(0)
      await nativa.getByRole('button').click()
      await expect(nativa.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
      await expect(fijada).toHaveCount(0)
      await expect(boton.locator('.uso-cuentas-icono')).toBeVisible()

      await ventana.keyboard.press('Escape')
      const carpeta = carpetaDeCuenta(s.datos, cuentaNutria.id)
      expect(carpeta).toBeTruthy()
      const credenciales = join(carpeta!, 'auth.json')
      writeFileSync(credenciales, JSON.stringify({ auth_mode: 'chatgpt' }))
      await boton.click()
      await expect(nutria.getByRole('button', { pressed: false })).toBeEnabled()
      await expect(iniciar).toHaveCount(0)
      await expect(nutria.locator('.cuenta-uso-celda')).toHaveCount(2)
      await nutria.getByRole('button', { pressed: false }).click()
      await ventana.keyboard.press('Escape')
      await expect(fijada.locator('.uso-fijada-nombre')).toHaveText('Nutria')

      unlinkSync(credenciales)
      await boton.click()
      await expect(nutria).toHaveClass(/\bfijada\b/)
      await expect(nutria.locator('button[aria-pressed]')).toHaveCount(0)
      await expect(iniciar).toBeEnabled()
      await expect(fijada).toHaveCount(0)
      await iniciar.click()
      await expect(dialogo).toBeVisible()
      await expect(panel).toHaveCount(0)
      await expect(fijada).toHaveCount(0)
      cpSync(join(carpetasAgentes(s.datos).codex, 'sessions'), join(carpeta!, 'sessions'), { recursive: true })
      writeFileSync(credenciales, JSON.stringify({ auth_mode: 'chatgpt' }))
      await ventana.keyboard.press('Escape')
      await expect(dialogo).toHaveCount(0)
      await expect(panel).toHaveCount(0)
      await expect(fijada.locator('.uso-fijada-nombre')).toHaveText('Nutria')
      await expect(fijada.locator('.cuenta-uso-celda')).toHaveText(['5h6%', '7d59%'])

      unlinkSync(credenciales)
      await boton.click()
      await expect(nutria).toHaveClass(/\bfijada\b/)
      await expect(nutria.locator('button[aria-pressed]')).toHaveCount(0)
      await expect(iniciar).toBeEnabled()
      const desfijarNutria = ventana.getByRole('menuitem', { name: idioma === 'es' ? 'Desfijar "Nutria"' : 'Unpin "Nutria"', exact: true })
      for (const gesto of GESTOS_MENU_TECLADO) {
        await iniciar.focus()
        await abrirMenuConTeclado(iniciar, gesto)
        await expect(desfijarNutria).toBeFocused()
        await expect(desfijarNutria.locator('.ctx-menu-icono svg')).toBeVisible()
        await ventana.keyboard.press('Escape')
        await expect(panel).toBeVisible()
        await expect(iniciar).toBeFocused()
      }
      await nutria.click({ button: 'right' })
      await desfijarNutria.click()
      await expect(nutria).not.toHaveClass(/\bfijada\b/)
      await expect(panel).toBeVisible()
    } finally { await cerrar() }
  })
}

test('el desplegable del pie es solo informativo y no queda encima del del contexto', async () => {
  const { s, cerrar } = await abrirUsoCuentas()
  try {
    const ventana = s.ventana
    const uso = ventana.locator('.agent-pane:not(.hidden) .agent-usage')
    const emergente = ventana.locator('.agent-usage-pop:not([data-saliendo])')
    await uso.hover()
    await expect(emergente).toBeVisible()
    expect(await emergente.evaluate((el) => ({ rol: el.getAttribute('role'), ancho: getComputedStyle(el).width, puntero: getComputedStyle(el).pointerEvents })))
      .toEqual({ rol: 'tooltip', ancho: '240px', puntero: 'none' })
    await expect(uso).not.toHaveAttribute('tabindex')
    await ventana.locator('.agent-pane:not(.hidden) .agent-context').hover()
    await expect(ventana.locator('.agent-usage-pop:not([data-saliendo])'), 'solo queda el del contexto').toHaveCount(1)
  } finally { await cerrar() }
})

for (const idioma of ['es', 'en'] as const) {
  const tx = textos[idioma]
  test(`las tareas reúnen cada cuenta una vez al pie y la vista de agentes no enseña cuentas en la barra (${idioma})`, async () => {
    const { s, nutria, cerrar } = await abrirUsoCuentas({ idioma })
    try {
      const ventana = s.ventana
      const { cuenta, sesion } = await ventana.evaluate(async () => {
        const nueva = await window.tessera.cuentasAgente.crear({ nombre: 'Garza', agente: 'claude-code', profileId: 'personal' })
        const activa = (await window.tessera.terminalAgente.fotoActividad()).find((x) => x.agente === 'claude-code')
        return { cuenta: nueva.id, sesion: activa?.sesionId ?? null }
      })
      expect(sesion, 'la sesión de Claude Code del panel').toBeTruthy()
      // Con credenciales, su uso sale del servidor local de la prueba (16 % y 42 %).
      const carpeta = carpetaDeCuenta(s.datos, cuenta)
      expect(carpeta, 'la carpeta de la cuenta').toBeTruthy()
      writeFileSync(join(carpeta!, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'token-inventado' } }))
      const ahora = Date.now()
      const tarea = { id: 'ab12cd34', origen: `agent:${sesion}`, profileId: 'personal', agente: 'claude-code', cuenta: 'Garza', accountId: cuenta, soloLectura: true, estado: 'en-marcha', resumen: 'Revise la migración de la tabla de clientes', inicio: ahora - 65_000, ultimaActividad: ahora, actividad: [] }
      await s.app.evaluate(({ BrowserWindow }, tareas) => BrowserWindow.getAllWindows()[0].webContents.send('delegacion:cambio', tareas), [tarea])

      const indicador = ventana.locator('.agent-pane:not(.hidden) .delegadas-abrir')
      await indicador.click()
      const filas = ventana.locator('.delegadas-pop .delegadas-fila')
      const fila = filas.first()
      const cuentas = ventana.getByRole('region', { name: idioma === 'es' ? 'Cuentas en uso' : 'Accounts in use', exact: true })
      await expect(fila.locator('.delegadas-resumen')).toHaveText(tarea.resumen)
      await expect(fila.locator('.delegadas-cuenta-nombre')).toHaveText('Claude Code · Garza')
      await expect(fila.locator('.cuenta-tarea')).toHaveCount(0)
      await expect(cuentas.locator('.cuenta-tarea .cuenta-uso-celda')).toHaveText(['5h16%', '7d42%'])
      const segunda = { ...tarea, id: 'cd34ef56', resumen: 'Revise los índices de clientes' }
      await s.app.evaluate(({ BrowserWindow }, tareas) => BrowserWindow.getAllWindows()[0].webContents.send('delegacion:cambio', tareas), [tarea, segunda])
      await expect(filas).toHaveCount(2)
      await expect(filas.locator('.delegadas-cuenta-nombre')).toHaveText(['Claude Code · Garza', 'Claude Code · Garza'])
      await expect(filas.locator('.cuenta-uso-celda')).toHaveCount(0)
      await expect(cuentas.locator('.cuenta-tarea')).toHaveCount(1)
      const sinSesion = { ...tarea, id: 'ef56ab12', agente: 'codex', cuenta: nutria.nombre, accountId: nutria.id }
      await s.app.evaluate(({ BrowserWindow }, tareas) => BrowserWindow.getAllWindows()[0].webContents.send('delegacion:cambio', tareas), [tarea, segunda, sinSesion])
      const filaNutria = cuentas.locator('.cuenta-tarea', { hasText: 'Nutria' })
      await expect(filaNutria).toContainText(tx.sinSesion)
      await filaNutria.getByRole('button', { name: tx.iniciar, exact: true }).click()
      const dialogo = ventana.getByRole('dialog', { name: tx.dialogo, exact: true })
      await expect(dialogo.locator('.modal-subtitulo')).toHaveText(tx.subtitulo)
      await expect(cuentas).toHaveCount(0)
      await expect.poll(() => dialogo.evaluate((el) => el.contains(document.activeElement))).toBe(true)
      await ventana.keyboard.press('Escape')
      await expect(dialogo).toHaveCount(0)
      await expect(indicador).toBeFocused()
      await indicador.click()
      await expect(filas).toHaveCount(3)
      for (const [width, height] of [[900, 620], [1600, 1000]]) {
        // Cambiar el tamaño de la ventana cierra la lista: se cierra antes, se espera el tamaño y se vuelve a abrir.
        await ventana.keyboard.press('Escape')
        await expect(fila).toHaveCount(0)
        await s.app.evaluate(({ BrowserWindow }, dimensiones) => {
          const ventana = BrowserWindow.getAllWindows()[0]
          ventana.unmaximize()
          ventana.setSize(dimensiones.width, dimensiones.height)
        }, { width, height })
        // El renderer ya vio el tamaño nuevo: su `resize`, que cierra la lista, no llega después de abrirla.
        const contenido = await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize()[0])
        await expect.poll(() => ventana.evaluate(() => window.innerWidth)).toBe(contenido)
        await indicador.click()
        await expect(filaNutria.getByRole('button', { name: tx.iniciar, exact: true })).toBeVisible()
        const medida = await fila.evaluate((el) => {
          const panel = el.closest('.delegadas-pop')!
          const r = el.closest('.delegadas-ancla')!.getBoundingClientRect()
          return {
            fila: el.scrollWidth === el.clientWidth,
            panel: panel.scrollWidth === panel.clientWidth,
            cuenta: Array.from(panel.querySelectorAll('.cuenta-tarea')).every((cuenta) => cuenta.scrollWidth === cuenta.clientWidth),
            dentro: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight
          }
        })
        expect(medida, `${width}×${height}`).toEqual({ fila: true, panel: true, cuenta: true, dentro: true })
        const muchas = Array.from({ length: 12 }, (_, i) => ({ ...tarea, id: `tarea-${i}`, accountId: `cuenta-${Math.floor(i / 2)}`, cuenta: `Cuenta con un nombre muy largo para comprobar el recorte ${Math.floor(i / 2)}` }))
        await s.app.evaluate(({ BrowserWindow }, tareas) => BrowserWindow.getAllWindows()[0].webContents.send('delegacion:cambio', tareas), muchas)
        await expect(filas).toHaveCount(12)
        await expect(cuentas.locator('.cuenta-tarea')).toHaveCount(6)
        const desplazamiento = await ventana.locator('.delegadas-pop').evaluate((el) => {
          const lista = el.querySelector<HTMLElement>('.delegadas-lista')!
          const pie = el.querySelector<HTMLElement>('.delegadas-cuentas')!
          const cuentas = el.querySelector<HTMLElement>('.delegadas-cuentas-lista')!
          const quinta = cuentas.children[4].getBoundingClientRect()
          const borde = cuentas.getBoundingClientRect().bottom
          const antes = pie.getBoundingClientRect().top
          lista.scrollTop = lista.scrollHeight
          return {
            panel: el.scrollWidth === el.clientWidth,
            cuentas: cuentas.scrollWidth === cuentas.clientWidth,
            tareasDesplazables: lista.scrollHeight > lista.clientHeight && lista.scrollTop > 0,
            cuentasDesplazables: cuentas.scrollHeight > cuentas.clientHeight,
            siguienteParcial: quinta.top < borde && quinta.bottom > borde,
            pieFijo: pie.getBoundingClientRect().top === antes
          }
        })
        expect(desplazamiento, `${width}×${height}, seis cuentas`).toEqual({ panel: true, cuentas: true, tareasDesplazables: true, cuentasDesplazables: true, siguienteParcial: true, pieFijo: true })
        const listaCuentas = cuentas.locator('.delegadas-cuentas-lista')
        await filas.last().getByRole('button').focus()
        await ventana.keyboard.press('Tab')
        await expect(listaCuentas).toBeFocused()
        await ventana.keyboard.press('End')
        await expect.poll(() => listaCuentas.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
        await s.app.evaluate(({ BrowserWindow }, tareas) => BrowserWindow.getAllWindows()[0].webContents.send('delegacion:cambio', tareas), [tarea, segunda, sinSesion])
        await expect(filas).toHaveCount(3)
        await expect(cuentas.locator('.cuenta-tarea')).toHaveCount(2)
      }
      await ventana.keyboard.press('Escape')

      // Con una fijada en la barra, la vista de agentes la saca junto con «Uso de las cuentas», y volver la trae.
      const boton = ventana.locator('footer.status-bar .uso-cuentas-boton')
      await boton.click()
      await expect(ventana.locator('.uso-cuentas-panel .uso-cuentas-fila', { hasText: 'Garza' }).getByRole('button', { pressed: false })).toBeEnabled()
      await ventana.locator('.uso-cuentas-panel .uso-cuentas-fila', { hasText: idioma === 'es' ? 'En su equipo' : 'On your computer' }).getByRole('button').click()
      await ventana.keyboard.press('Escape')
      await expect(ventana.locator('footer.status-bar .uso-fijada')).toHaveCount(1)
      await ventana.keyboard.press(`${MOD}+Shift+KeyM`)
      await expect(ventana.locator('.shell.modo-mosaico')).toHaveCount(1)
      await expect(boton).toHaveCount(0)
      await expect(ventana.locator('.uso-cuentas-panel')).toHaveCount(0)
      await ventana.keyboard.press(`${MOD}+Shift+KeyM`)
      await expect(ventana.locator('.shell.modo-mosaico')).toHaveCount(0)
      await expect(ventana.locator('footer.status-bar .uso-fijada .uso-fijada-nombre')).toHaveText('Codex')
    } finally { await cerrar() }
  })
}

test('sin datos de la nativa de Codex, la lista enseña la de Docker y no la nativa', async () => {
  const { s, cerrar } = await abrirUsoCuentas({ nativaConDatos: false })
  try {
    // La sesión del agente, al terminar de abrirse, enfoca su terminal: se espera a que exista antes de abrir la lista.
    await expect.poll(() => s.ventana.evaluate(async () => (await window.tessera.terminalAgente.fotoActividad()).length), { timeout: 15_000 }).toBeGreaterThan(0)
    await s.ventana.evaluate(() => new Promise<void>((listo) => requestAnimationFrame(() => requestAnimationFrame(() => listo()))))
    const boton = s.ventana.locator('footer.status-bar .uso-cuentas-boton')
    await boton.focus()
    await s.ventana.keyboard.press('Enter')
    const panel = s.ventana.locator('.uso-cuentas-panel:not([data-saliendo])')
    // La lista se lee al abrirse: con el equipo cargado tarda más que la espera por defecto.
    await expect(panel.locator('.uso-cuentas-fila', { hasText: 'Nutria' })).toBeVisible({ timeout: 15_000 })
    await expect(panel.locator('.uso-cuentas-fila', { hasText: 'En su equipo' })).toHaveCount(0)
    await expect(panel).toBeFocused()
    await s.ventana.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(boton).toBeFocused()
  } finally { await cerrar() }
})
