// =============================================================================
// «Uso de las cuentas» en la barra de estado, en los dos idiomas: la lista abre con todas las cuentas del perfil menos
// la que está a la vista en el pie de un panel, fija y quita cuentas en la barra, se cierra con Escape y con un clic
// fuera, y ni la lista ni la barra desbordan en una ventana pequeña ni en una grande. El pie del panel vuelve a ser un
// desplegable informativo. Cada tarea delegada (simulada por el evento del indicador) enseña el uso de su cuenta, y la
// vista de agentes no enseña cuentas en la barra. Sin contenedores: las cuentas se leen en el equipo.
// =============================================================================
import { expect, test, type Page } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MOD } from './tessera'
import { abrirUsoCuentas } from './usoCuentasAyudas'

/** Lo de la derecha de la barra no pisa la marca (si se ve) ni lo de la izquierda. */
async function barraSinEncimar(win: Page): Promise<{ encimado: boolean; escalon: string | null }> {
  return win.evaluate(() => {
    const barra = document.querySelector<HTMLElement>('footer.status-bar')!
    const der = barra.querySelector('.status-bar-right')!.getBoundingClientRect()
    const marca = barra.querySelector<HTMLElement>('.status-bar-marca')!
    const izq = Array.from(barra.querySelector('.status-bar-left')!.children).map((h) => h.getBoundingClientRect().right)
    const tope = getComputedStyle(marca).visibility === 'visible' ? marca.getBoundingClientRect().right : Math.max(0, ...izq)
    return { encimado: der.left < tope, escalon: barra.dataset.escalon ?? null }
  })
}

for (const idioma of ['es', 'en'] as const) {
  const tx = idioma === 'es'
    ? { titulo: 'Uso de las cuentas', equipo: 'En su equipo', sinSesion: 'Sin sesión iniciada', sinCredenciales: 'Esta cuenta aún no ha iniciado sesión.', nota: 'No se lista la cuenta del panel a la vista', administrar: 'Administrar las cuentas…' }
    : { titulo: 'Account usage', equipo: 'On your computer', sinSesion: 'Not signed in', sinCredenciales: 'This account has not signed in yet.', nota: 'The account of the visible panel is not listed', administrar: 'Manage accounts…' }

  test(`uso de las cuentas en la barra de estado (${idioma})`, async () => {
    const { s, cerrar } = await abrirUsoCuentas({ idioma })
    try {
      const win = s.win
      const boton = win.locator('footer.status-bar .uso-cuentas-boton')
      const panel = win.locator('.uso-cuentas-panel:not([data-saliendo])')
      const codex = panel.locator('.uso-cuentas-grupo', { hasText: 'Codex' })
      const nativa = codex.locator('.uso-cuentas-fila', { hasText: tx.equipo })
      const nutria = panel.locator('.uso-cuentas-fila', { hasText: 'Nutria' })
      const fijada = win.locator('footer.status-bar .uso-fijada')
      await expect(boton.locator('.uso-cuentas-icono')).toBeVisible()
      await boton.click()
      await expect(panel.locator('.uso-cuentas-titulo')).toHaveText(tx.titulo)
      await expect(nativa).toBeVisible()
      await expect(nutria).toContainText(tx.sinSesion)
      await expect(nutria.getByRole('button')).toBeDisabled()
      // Claude Code nativo está a la vista en el pie de su panel: no se repite, y la nota lo dice.
      await expect(panel.locator('.uso-cuentas-agente', { hasText: 'Claude Code' })).toHaveCount(0)
      await expect(panel.locator('.uso-cuentas-nota')).toContainText(tx.nota)
      await expect(panel.locator('.uso-cuentas-administrar')).toHaveText(tx.administrar)

      await nativa.getByRole('button').click()
      await expect(nativa.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
      await expect(fijada.locator('.uso-fijada-nombre')).toHaveText('Codex')
      await expect(boton.locator('.uso-cuentas-icono')).toHaveCount(0)
      // Con la lista abierta no sale la tarjeta de la cápsula: la de la fila sí, a la izquierda de la lista.
      const tarjeta = win.locator('.tarjeta-cuenta:not([data-saliendo])')
      // Pulsar la quita, como al tooltip: vuelve al entrar otra vez en la fila.
      await panel.locator('.uso-cuentas-cabecera').hover()
      await nativa.hover()
      await expect(tarjeta.locator('.tarjeta-cuenta-nombre')).toHaveText('Codex')
      await expect(tarjeta.locator('.tarjeta-cuenta-donde')).toHaveText(tx.equipo)
      await expect(tarjeta.locator('.agent-usage-row')).toHaveCount(2)
      expect(await tarjeta.evaluate((el) => el.getBoundingClientRect().right <= document.querySelector('.uso-cuentas-panel')!.getBoundingClientRect().left), 'no tapa la lista').toBe(true)
      await nutria.hover()
      await expect(tarjeta.locator('.agent-usage-foot')).toHaveText(tx.sinCredenciales)

      await win.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)
      await expect(boton).toBeFocused()
      await boton.click()
      await expect(nativa).toBeVisible()
      await win.mouse.click(5, 5)
      await expect(panel).toHaveCount(0)
      // La cápsula enseña su tarjeta encima, dentro de la ventana, y sin el tooltip del botón.
      await fijada.hover()
      await expect(tarjeta.locator('.agent-usage-row')).toHaveCount(2)
      expect(await tarjeta.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return r.bottom <= document.querySelector('footer.status-bar')!.getBoundingClientRect().top && r.left >= 0 && r.right <= window.innerWidth && getComputedStyle(el).pointerEvents
      })).toBe('none')
      await expect(boton).not.toHaveAttribute('title')
      await win.mouse.move(5, 5)
      await expect(tarjeta).toHaveCount(0)

      for (const [width, height] of [[900, 620], [1600, 1000]]) {
        await s.app.evaluate(({ BrowserWindow }, dimensiones) => {
          const ventana = BrowserWindow.getAllWindows()[0]
          ventana.unmaximize()
          ventana.setSize(dimensiones.width, dimensiones.height)
        }, { width, height })
        await expect.poll(() => barraSinEncimar(win), `${width}: lo fijado no pisa la marca ni la izquierda`).toMatchObject({ encimado: false })
        if (width === 1600) expect((await barraSinEncimar(win)).escalon, 'con sitio, la marca se queda').toBe('0')
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
        await win.keyboard.press('Escape')
        await expect(panel).toHaveCount(0)
      }

      await boton.click()
      await nativa.getByRole('button').click()
      await expect(nativa.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
      await expect(fijada).toHaveCount(0)
      await expect(boton.locator('.uso-cuentas-icono')).toBeVisible()
    } finally { await cerrar() }
  })
}

test('el desplegable del pie es solo informativo y no queda encima del del contexto', async () => {
  const { s, cerrar } = await abrirUsoCuentas()
  try {
    const win = s.win
    const uso = win.locator('.agent-pane:not(.hidden) .agent-usage')
    const pop = win.locator('.agent-usage-pop:not([data-saliendo])')
    await uso.hover()
    await expect(pop).toBeVisible()
    expect(await pop.evaluate((el) => ({ rol: el.getAttribute('role'), ancho: getComputedStyle(el).width, puntero: getComputedStyle(el).pointerEvents })))
      .toEqual({ rol: 'tooltip', ancho: '240px', puntero: 'none' })
    await expect(uso).not.toHaveAttribute('tabindex')
    await win.locator('.agent-pane:not(.hidden) .agent-context').hover()
    await expect(win.locator('.agent-usage-pop:not([data-saliendo])'), 'solo queda el del contexto').toHaveCount(1)
  } finally { await cerrar() }
})

/** La carpeta de una cuenta de Docker, buscada por su id bajo los datos de la prueba. */
function carpetaDeCuenta(raiz: string, id: string): string | null {
  for (const entrada of readdirSync(raiz, { withFileTypes: true, recursive: true })) {
    if (entrada.isDirectory() && entrada.name === id) return join(entrada.parentPath, entrada.name)
  }
  return null
}

for (const idioma of ['es', 'en'] as const) {
  test(`cada tarea delegada enseña el uso de su cuenta y la vista de agentes no enseña cuentas en la barra (${idioma})`, async () => {
    const { s, cerrar } = await abrirUsoCuentas({ idioma })
    try {
      const win = s.win
      const { cuenta, sesion } = await win.evaluate(async () => {
        const nueva = await window.tessera.agentAccounts.create({ nombre: 'Garza', agente: 'claude-code', profileId: 'personal' })
        const activa = (await window.tessera.agentTerminal.activitySnapshot()).find((x) => x.agente === 'claude-code')
        return { cuenta: nueva.id, sesion: activa?.sessionId ?? null }
      })
      expect(sesion, 'la sesión de Claude Code del panel').toBeTruthy()
      // Con credenciales, su uso sale del servidor local de la prueba (16 % y 42 %).
      const carpeta = carpetaDeCuenta(s.datos, cuenta)
      expect(carpeta, 'la carpeta de la cuenta').toBeTruthy()
      writeFileSync(join(carpeta!, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'token-inventado' } }))
      const ahora = Date.now()
      const tarea = { id: 'ab12cd34', origen: `agent:${sesion}`, profileId: 'personal', agente: 'claude-code', cuenta: 'Garza', accountId: cuenta, soloLectura: true, estado: 'en-marcha', resumen: 'Revise la migración de la tabla de clientes', inicio: ahora - 65_000, ultimaActividad: ahora, actividad: [] }
      await s.app.evaluate(({ BrowserWindow }, tareas) => BrowserWindow.getAllWindows()[0].webContents.send('delegacion:cambio', tareas), [tarea])

      await win.locator('.agent-pane:not(.hidden) .delegadas-abrir').click()
      const fila = win.locator('.delegadas-pop .delegadas-fila')
      await expect(fila.locator('.delegadas-resumen')).toHaveText(tarea.resumen)
      await expect(fila.locator('.cuenta-tarea')).toContainText('Claude Code · Garza')
      await expect(fila.locator('.cuenta-tarea .cuenta-uso-celda')).toHaveText(['5h16%', '7d42%'])
      for (const [width, height] of [[900, 620], [1600, 1000]]) {
        // Cambiar el tamaño de la ventana cierra la lista: se cierra antes, se espera el tamaño y se vuelve a abrir.
        await win.keyboard.press('Escape')
        await expect(fila).toHaveCount(0)
        await s.app.evaluate(({ BrowserWindow }, dimensiones) => {
          const ventana = BrowserWindow.getAllWindows()[0]
          ventana.unmaximize()
          ventana.setSize(dimensiones.width, dimensiones.height)
        }, { width, height })
        // El renderer ya vio el tamaño nuevo: su `resize`, que cierra la lista, no llega después de abrirla.
        const contenido = await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize()[0])
        await expect.poll(() => win.evaluate(() => window.innerWidth)).toBe(contenido)
        await win.locator('.agent-pane:not(.hidden) .delegadas-abrir').click()
        await expect(fila.locator('.cuenta-tarea')).toBeVisible()
        const medida = await fila.evaluate((el) => {
          const cuentaTarea = el.querySelector<HTMLElement>('.cuenta-tarea')!
          const r = el.closest('.delegadas-ancla')!.getBoundingClientRect()
          return {
            fila: el.scrollWidth === el.clientWidth,
            cuenta: cuentaTarea.scrollWidth === cuentaTarea.clientWidth && cuentaTarea.getBoundingClientRect().height <= 20,
            dentro: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight
          }
        })
        expect(medida, `${width}×${height}`).toEqual({ fila: true, cuenta: true, dentro: true })
      }
      await win.keyboard.press('Escape')

      // Con una fijada en la barra, la vista de agentes la saca junto con «Uso de las cuentas», y volver la trae.
      const boton = win.locator('footer.status-bar .uso-cuentas-boton')
      await boton.click()
      await win.locator('.uso-cuentas-panel .uso-cuentas-fila', { hasText: idioma === 'es' ? 'En su equipo' : 'On your computer' }).getByRole('button').click()
      await win.keyboard.press('Escape')
      await expect(win.locator('footer.status-bar .uso-fijada')).toHaveCount(1)
      await win.keyboard.press(`${MOD}+Shift+KeyM`)
      await expect(win.locator('.shell.modo-mosaico')).toHaveCount(1)
      await expect(boton).toHaveCount(0)
      await expect(win.locator('.uso-cuentas-panel')).toHaveCount(0)
      await win.keyboard.press(`${MOD}+Shift+KeyM`)
      await expect(win.locator('.shell.modo-mosaico')).toHaveCount(0)
      await expect(win.locator('footer.status-bar .uso-fijada .uso-fijada-nombre')).toHaveText('Codex')
    } finally { await cerrar() }
  })
}

test('sin datos de la nativa de Codex, la lista enseña la de Docker y no la nativa', async () => {
  const { s, cerrar } = await abrirUsoCuentas({ nativaConDatos: false })
  try {
    const boton = s.win.locator('footer.status-bar .uso-cuentas-boton')
    await boton.focus()
    await s.win.keyboard.press('Enter')
    const panel = s.win.locator('.uso-cuentas-panel:not([data-saliendo])')
    // La lista se lee al abrirse: con el equipo cargado tarda más que la espera por defecto.
    await expect(panel.locator('.uso-cuentas-fila', { hasText: 'Nutria' })).toBeVisible({ timeout: 15_000 })
    await expect(panel.locator('.uso-cuentas-fila', { hasText: 'En su equipo' })).toHaveCount(0)
    await expect(panel).toBeFocused()
    await s.win.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(boton).toBeFocused()
  } finally { await cerrar() }
})
