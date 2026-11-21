// =============================================================================
// El movimiento de la interfaz, con las animaciones ENCENDIDAS (el resto de specs las apaga para ser estables, así
// que solo este caza una regresión de movimiento). Fija el contrato de `docs/decisiones/renderer/movimiento.md`:
// abrir una zona viaja; cerrarla es una transición propia, con la zona que se va marcada aparte (el último archivo, la terminal y
// el agente de la terminal, aunque su columna siga en la página); cambiar de vista es instantáneo; Configuración
// entra y deja su despedida al cerrarse; las cuentas se despliegan y el ampliado de Markdown se funde al entrar y salir.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirLogin, dockerMontaProyectos, sembrarLogin } from './loginCuenta'
import { abrirTessera, borrarTemporal, MOD, type SesionTessera } from './tessera'
import { abrirUsoCuentas, carpetaDeCuenta } from './usoCuentasAyudas'

test('la cuenta fijada entra en la barra de estado y conserva su contenido mientras sale', async () => {
  const { s, cerrar } = await abrirUsoCuentas({ conMovimiento: true })
  try {
    const abrir = s.ventana.locator('footer.status-bar .uso-cuentas-boton')
    // Abrir la lista anima solo la lista: ni la marca ni las cápsulas ni el icono se mueven por el clic (el fondo del
    // botón al pasar el puntero sí tiene su transición, y no cuenta).
    await abrir.click()
    const fueraDeLaLista = await s.ventana.evaluate(() => document.getAnimations()
      .map((a) => (a.effect as KeyframeEffect | null)?.target)
      .filter((el): el is Element => el instanceof Element && !!el.closest('.status-bar-marca, .uso-fijada-presencia, .uso-cuentas-icono')).length)
    expect(fueraDeLaLista, 'abrir la lista no anima la barra de estado').toBe(0)
    const boton = s.ventana.locator('.uso-cuentas-panel .uso-cuentas-fila').filter({ hasText: 'En su equipo' }).getByRole('button')
    await expect(boton).toBeEnabled()
    const presencia = s.ventana.locator('footer.status-bar .uso-fijada-presencia')
    await s.ventana.clock.install()
    await boton.click()
    await expect(presencia).toHaveClass(/mov-aparece/)
    await expect(abrir.locator('.uso-cuentas-icono')).toBeVisible()
    expect(await abrir.locator('.uso-cuentas-icono').evaluate((el) => el.getAnimations().length)).toBe(0)
    expect(await presencia.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) > 0)).toBe(true)
    await s.ventana.clock.runFor(300)
    await boton.click()
    await expect(presencia).toHaveAttribute('data-saliendo', '')
    await expect(presencia.locator('.uso-fijada-nombre')).toHaveText('Codex')
    await s.ventana.clock.runFor(300)
    await expect(presencia).toHaveCount(0)
    await expect(abrir.locator('.uso-cuentas-icono')).toBeVisible()
    // La vista de agentes no es la de un perfil: «Uso de las cuentas» sale de la barra con un fundido y vuelve igual.
    const uso = s.ventana.locator('footer.status-bar .uso-cuentas-presencia')
    await s.ventana.keyboard.press('Escape')
    await s.ventana.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(uso).toHaveAttribute('data-saliendo', '')
    await s.ventana.clock.runFor(300)
    await expect(uso).toHaveCount(0)
    await s.ventana.keyboard.press(`${MOD}+Shift+KeyM`)
    await expect(uso).toHaveClass(/mov-aparece/)
    await expect(uso).not.toHaveAttribute('data-saliendo')
  } finally { await cerrar() }
})

test('el botón de iniciar sesión se funde con el pin sin mover la fila', async () => {
  const { s, nutria, cerrar } = await abrirUsoCuentas({ conMovimiento: true })
  try {
    const ventana = s.ventana
    await ventana.clock.install()
    await ventana.locator('footer.status-bar .uso-cuentas-boton').click()
    const panel = ventana.locator('.uso-cuentas-panel')
    const fila = panel.locator('.uso-cuentas-fila', { hasText: nutria.nombre })
    const iniciar = fila.getByRole('button', { name: 'Iniciar sesión en "Nutria"', exact: true })
    await expect(iniciar).toBeVisible()
    await panel.evaluate(async (el) => {
      await Promise.all(el.getAnimations({ subtree: true }).map((animacion) => animacion.finished))
    })
    const cajaFila = await fila.boundingBox()
    const cajaBoton = await iniciar.boundingBox()
    await fila.evaluate((el) => {
      el.addEventListener('transitionrun', (e) => {
        if (e instanceof TransitionEvent && e.propertyName === 'opacity' && e.target instanceof HTMLElement
          && e.target.matches('.mov-cruce-capa:not([data-saliendo])') && e.target.querySelector('button[aria-pressed]')) {
          el.setAttribute('data-fundido-prueba', '')
        }
      })
    })
    const carpeta = carpetaDeCuenta(s.datos, nutria.id)
    expect(carpeta).toBeTruthy()
    writeFileSync(join(carpeta!, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }))
    await ventana.clock.fastForward(30_000)
    await expect(fila).toHaveAttribute('data-fundido-prueba', '')
    const pin = fila.getByRole('button', { pressed: false })
    await expect(pin).toBeVisible()
    await expect(iniciar).toHaveCount(0)
    expect(await fila.boundingBox()).toEqual(cajaFila)
    expect(await pin.boundingBox()).toEqual(cajaBoton)
  } finally { await cerrar() }
})

test('las cuentas de tareas delegadas entran y salen plegándose al pie de la lista', async () => {
  const { s, cerrar } = await abrirUsoCuentas({ conMovimiento: true })
  try {
    const sesion = await s.ventana.evaluate(async () => (await window.tessera.terminalAgente.fotoActividad()).find((a) => a.agente === 'claude-code')?.sesionId)
    expect(sesion).toBeTruthy()
    const ahora = Date.now()
    const primera = { id: 'tarea-uno', origen: `agent:${sesion}`, profileId: 'personal', agente: 'claude-code', accountId: 'cuenta-uno', cuenta: 'Garza', estado: 'en-marcha', soloLectura: true, resumen: 'Revisar índices', inicio: ahora, ultimaActividad: ahora, actividad: [] }
    const segunda = { ...primera, id: 'tarea-dos', accountId: 'cuenta-dos', cuenta: 'Alondra' }
    await s.app.evaluate(({ BrowserWindow }, tareas) => BrowserWindow.getAllWindows()[0].webContents.send('delegacion:cambio', tareas), [primera])
    const alturasAlAbrir = s.ventana.evaluate(() => new Promise<number[]>((resolver) => {
      const alturas: number[] = []
      let inicio: number | null = null
      const medir = (ahora: number): void => {
        const panel = document.querySelector<HTMLElement>('.delegadas-pop:not([data-saliendo])')
        if (panel && Number(getComputedStyle(panel).opacity) > 0) {
          inicio ??= ahora
          // El alto del flujo excluye la escala de entrada del propio popover.
          alturas.push(panel.offsetHeight)
        }
        if (inicio !== null && ahora - inicio >= 300) resolver(alturas)
        else requestAnimationFrame(medir)
      }
      requestAnimationFrame(medir)
    }))
    await s.ventana.locator('.agent-pane:not(.hidden) .delegadas-abrir').click()
    const alturas = await alturasAlAbrir
    expect(alturas.length).toBeGreaterThan(1)
    expect(Math.max(...alturas) - Math.min(...alturas), 'el panel abre con el alto definitivo de sus cuentas').toBeLessThan(1)
    const cuentas = s.ventana.locator('.delegadas-cuentas .delegadas-cuenta')
    await expect(cuentas).toHaveCount(1)
    await s.ventana.clock.install()
    await s.ventana.clock.runFor(300)
    await s.app.evaluate(({ BrowserWindow }, tareas) => BrowserWindow.getAllWindows()[0].webContents.send('delegacion:cambio', tareas), [primera, segunda])
    const alondra = cuentas.filter({ hasText: 'Alondra' })
    await expect(alondra).toHaveClass(/mov-despliega/)
    expect(await alondra.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) > 0)).toBe(true)
    await s.ventana.clock.runFor(300)
    await s.app.evaluate(({ BrowserWindow }, tareas) => BrowserWindow.getAllWindows()[0].webContents.send('delegacion:cambio', tareas), [primera])
    await expect(alondra).toHaveAttribute('data-saliendo', '')
    await expect(alondra).toContainText('Claude Code · Alondra')
    await expect(alondra).toHaveAttribute('aria-hidden', 'true')
    await s.ventana.clock.runFor(300)
    await expect(alondra).toHaveCount(0)
    await expect(cuentas).toHaveCount(1)
  } finally { await cerrar() }
})

test('el panel de tareas delegadas conserva el pie dentro de su copia de salida', async () => {
  const { s, cerrar } = await abrirUsoCuentas({ conMovimiento: true })
  try {
    const ventana = s.ventana
    const sesion = await ventana.evaluate(async () => (await window.tessera.terminalAgente.fotoActividad()).find((a) => a.agente === 'claude-code')?.sesionId)
    expect(sesion).toBeTruthy()
    const ahora = Date.now()
    const tareas = Array.from({ length: 12 }, (_, i) => ({
      id: `tarea-${i}`, origen: `agent:${sesion}`, profileId: 'personal', agente: 'claude-code', accountId: 'cuenta-uno',
      cuenta: 'Garza', estado: 'en-marcha', soloLectura: true, resumen: 'Revisar índices', inicio: ahora, ultimaActividad: ahora, actividad: []
    }))
    await s.app.evaluate(({ BrowserWindow }, tareas) => BrowserWindow.getAllWindows()[0].webContents.send('delegacion:cambio', tareas), tareas)
    await ventana.locator('.agent-pane:not(.hidden) .delegadas-abrir').click()
    const panel = ventana.locator('.delegadas-ancla .delegadas-pop')
    const lista = panel.locator('.delegadas-lista')
    await expect(lista.locator('.delegadas-fila')).toHaveCount(tareas.length)
    expect(await lista.evaluate((el) => el.scrollHeight > el.clientHeight), 'la lista abierta tiene contenido para desplazar').toBe(true)
    await panel.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((animacion) => animacion.finished))
    })

    const copia = ventana.locator('.delegadas-pop.mov-despedida')
    await ventana.keyboard.press('Escape')
    const medida = await copia.evaluate((el) => {
      const { display, padding } = getComputedStyle(el)
      const pie = el.querySelector('.delegadas-cuentas')
      return { display, padding, pieDentro: pie !== null && pie.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom }
    }, undefined, { timeout: 1000 })
    expect(medida, 'la copia mantiene la columna sin relleno y contiene el pie').toEqual({ display: 'flex', padding: '0px', pieDentro: true })
    await expect(copia).toHaveCount(0)
  } finally { await cerrar() }
})

/** Lo que se anotó de cada transición del reparto al empezar: si era un cierre y qué zonas se iban. */
interface Transicion {
  cierre: boolean
  seVan: string[]
}

/** Envuelve `startViewTransition` para anotar cada transición del reparto. */
async function espiarTransiciones(ventana: Page): Promise<void> {
  await ventana.evaluate(() => {
    const w = window as unknown as { __transiciones: Transicion[] }
    w.__transiciones = []
    const original = document.startViewTransition.bind(document)
    document.startViewTransition = ((cb: () => void) => {
      w.__transiciones.push({
        cierre: document.documentElement.classList.contains('transicion-cierre'),
        seVan: Array.from(document.querySelectorAll('[data-transicion-se-va]'), (el) => (el as HTMLElement).className.split(' ')[0])
      })
      return original(cb)
    }) as typeof document.startViewTransition
  })
}

/** Las transiciones que ocurren mientras se hace `accion` (espera a que el reparto se asiente). */
async function transicionesDe(ventana: Page, accion: () => Promise<void>): Promise<Transicion[]> {
  const antes = await ventana.evaluate(() => (window as unknown as { __transiciones: Transicion[] }).__transiciones.length)
  await accion()
  await ventana.waitForTimeout(700)
  return ventana.evaluate((n) => (window as unknown as { __transiciones: Transicion[] }).__transiciones.slice(n), antes)
}

/** Las animaciones vivas justo después de `accion`, con el elemento o la zona de cada una. */
async function animacionesTras(ventana: Page, accion: () => Promise<void>): Promise<string[]> {
  await accion()
  return ventana.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return document.getAnimations().map((a) => `${(a as CSSAnimation).animationName}${(a.effect as KeyframeEffect).pseudoElement ?? ''}`)
  })
}

/** Lo que se midió en el documento de una ventana con sus animaciones congeladas a mitad. */
interface MedidaAMitad {
  /** Cada animación viva con su nombre, el pseudoelemento al que anima y su progreso. */
  animaciones: { nombre: string; progreso: number }[]
  /** El porcentaje de `translate` de cada grupo de transición medido (0 si no tiene o no es un porcentaje). */
  desplazamiento: Record<string, number>
  /** La opacidad calculada de cada pseudoelemento medido. */
  opacidad: Record<string, number>
  /** Las clases de `<html>` durante la transición. */
  clasesRaiz: string
}

/**
 * Congela a mitad las animaciones que lanza `accion` en el documento de `pagina` (las de la transición de vista y las
 * de CSS) y mide ahí los pseudoelementos pedidos: así el elemento que sale o entra se ve con una opacidad o un
 * desplazamiento intermedios y no depende de la velocidad de la máquina. Después las deja seguir y espera a que acaben.
 */
async function aMitadDeLaTransicion(
  pagina: Page, accion: () => Promise<void>, grupos: string[], pseudos: string[]
): Promise<MedidaAMitad> {
  await pagina.evaluate(() => {
    const w = window as unknown as { __congeladas: Animation[] | null }
    w.__congeladas = null
    const vigilar = (): void => {
      const todas = document.getAnimations()
      if (todas.some((a) => ((a.effect as KeyframeEffect | null)?.pseudoElement ?? '').includes('view-transition-'))) {
        // Las infinitas (un indicador de carga) no tienen mitad: se dejan correr.
        const finitas = todas.filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
        for (const a of finitas) {
          a.pause()
          a.currentTime = 0
        }
        w.__congeladas = finitas
        return
      }
      requestAnimationFrame(vigilar)
    }
    requestAnimationFrame(vigilar)
  })
  await accion()
  await expect.poll(() => pagina.evaluate(() => (window as unknown as { __congeladas: unknown }).__congeladas !== null), { timeout: 5000, message: 'la transición de vista no arrancó en ese documento' }).toBe(true)
  const medida = await pagina.evaluate(({ grupos, pseudos }) => {
    const w = window as unknown as { __congeladas: Animation[] }
    for (const a of w.__congeladas) a.currentTime = Number(a.effect?.getComputedTiming().endTime ?? 0) / 2
    return new Promise<MedidaAMitad>((resolver) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const raiz = document.documentElement
      const desplazamiento: Record<string, number> = {}
      for (const g of grupos) {
        const t = getComputedStyle(raiz, `::view-transition-group(${g})`).translate
        desplazamiento[g] = Number(/(-?\d+(?:\.\d+)?)%/.exec(t)?.[1] ?? 0)
      }
      const opacidad: Record<string, number> = {}
      for (const p of pseudos) opacidad[p] = Number(getComputedStyle(raiz, p).opacity)
      resolver({
        animaciones: w.__congeladas.map((a) => ({
          nombre: `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty}${(a.effect as KeyframeEffect).pseudoElement ?? ''}`,
          progreso: Number(a.effect?.getComputedTiming().progress ?? 0)
        })),
        desplazamiento,
        opacidad,
        clasesRaiz: raiz.className
      })
    })))
  }, { grupos, pseudos })
  await pagina.evaluate(async () => {
    const w = window as unknown as { __congeladas: Animation[] }
    for (const a of w.__congeladas) a.play()
    await Promise.all(w.__congeladas.map((a) => a.finished.catch(() => undefined)))
  })
  await pagina.waitForTimeout(150)
  return medida
}

function sembrar(datos: string, repo: string, ajustes: Record<string, unknown> = {}, otroRepo?: string): void {
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify([
      { id: 'personal', nombre: 'Personal', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }], sandbox: { habilitado: false } }
    ])
  )
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: { personal: { openProjects: [
        { projectHostPath: repo, name: 'repo', estado: 'active' },
        ...(otroRepo ? [{ projectHostPath: otroRepo, name: 'otro repo', estado: 'active' }] : [])
      ], activePath: repo } },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [repo, ...(otroRepo ? [otroRepo] : [])].map((ruta) => `personal|${ruta}`), ...ajustes }
    })
  )
}

test('cambiar de proyecto actualiza la franja desacoplada sin transición de reparto', async () => {
  const agentes = montarAgenteFalso()
  let s: SesionTessera | undefined
  try {
    const repo = join(agentes.raiz, 'repo')
    const otroRepo = join(agentes.raiz, 'otro-repo')
    mkdirSync(repo)
    mkdirSync(otroRepo)
    s = await abrirTessera(agentes.env, { conMovimiento: true, sembrar: (datos) => sembrar(datos, repo, {}, otroRepo) })
    const principal = s.ventana
    const panel = principal.locator('section.terminal-panel')
    const terminal = panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen')
    const proyectos = principal.locator('.tabs-projects')
    await principal.locator('.activity-bar').getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(terminal).toBeVisible()
    await proyectos.getByText('otro repo', { exact: true }).click()
    await terminal.click()
    await principal.keyboard.press(`${MOD}+Shift+Enter`)
    await expect(principal.locator('.shell')).toHaveClass(/terminal-pantalla-completa/)
    await principal.locator('.status-bar').getByRole('button', { name: /Mostrar el agente de la terminal/ }).click()
    const cabecera = panel.locator('> .panel-header')
    await cabecera.hover()
    const nueva = s.app.waitForEvent('window', { timeout: 15_000 })
    await cabecera.getByRole('button', { name: 'Desacoplar', exact: true }).click()
    const hija = await nueva
    const nativa = await s.app.browserWindow(hija)
    try {
      await nativa.evaluate((ventana) => ventana.setContentSize(1500, 760))
      await hija.bringToFront()
      await expect(hija.locator('.right-panel')).toBeVisible()
      const cerrar = hija.locator('section.terminal-panel .terminal-tab-kill')
      await expect(cerrar).toHaveCount(1)
      await cerrar.click()
      const franja = hija.locator('.ventana-franja')
      await expect(franja).toHaveClass(/\bterminal-plegada\b/)
      await expect(hija.locator('html')).not.toHaveClass(/transicion-layout/)
      await espiarTransiciones(hija)
      await principal.bringToFront()
      const transiciones = await transicionesDe(hija, () => proyectos.getByText('repo', { exact: true }).click())
      await expect(hija.locator('.estado-franja-proyecto')).toHaveText('repo')
      await expect(franja).not.toHaveClass(/\bterminal-plegada\b/)
      await expect(hija.locator('html')).not.toHaveClass(/transicion-layout/)
      expect(transiciones).toEqual([])
    } finally {
      await nativa.dispose()
    }
  } finally {
    await s?.cerrar()
    await borrarTemporal(agentes.raiz)
  }
})

test.describe.serial('El inicio de sesión de una cuenta, con las animaciones encendidas', () => {
  test.skip(!dockerMontaProyectos(), 'Docker no responde o no ve las carpetas de este sistema')
  test.setTimeout(300_000)

  test('la ayuda del minuto y la terminal entran con su transición', async () => {
    const agente = montarAgenteFalso()
    const s = await abrirTessera(agente.env, { conMovimiento: true, sembrar: (datos) => sembrarLogin(datos, join(agente.raiz, 'proyecto')) })
    try {
      await s.ventana.clock.install()
      const modal = await abrirLogin(s.ventana)
      const transiciones = (): Promise<string[]> => s.ventana.evaluate(async () => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        return document.getAnimations().flatMap((a) => (a instanceof CSSTransition ? [`${Number(a.effect?.getComputedTiming().duration ?? 0) > 0 ? 'con-duracion' : 'sin'}:${a.transitionProperty}:${(a.effect as KeyframeEffect).target instanceof Element ? ((a.effect as KeyframeEffect).target as Element).className : ''}`] : []))
      })
      const [ayuda] = await Promise.all([
        modal.locator('.cuentas-login-ayuda').waitFor().then(transiciones),
        s.ventana.clock.fastForward(61_000)
      ])
      expect(ayuda.some((x) => x.startsWith('con-duracion:opacity') && x.includes('cuentas-login-ayuda')), `la ayuda se funde: ${ayuda.join(', ')}`).toBe(true)
      await s.ventana.waitForTimeout(400)
      await modal.locator('.cuentas-login-ver').click()
      const terminal = await transiciones()
      expect(terminal.some((x) => x.startsWith('con-duracion:height') && x.includes('cuentas-login-plegable')), `la terminal se despliega: ${terminal.join(', ')}`).toBe(true)
    } finally {
      await s.cerrar()
      await borrarTemporal(agente.raiz)
    }
  })
})

test.describe.serial('El movimiento de la interfaz, con las animaciones encendidas', () => {
  let s: SesionTessera
  let agentes: AgenteFalso

  test.beforeAll(async () => {
    agentes = montarAgenteFalso()
    const repo = join(agentes.raiz, 'repo')
    mkdirSync(repo)
    writeFileSync(join(repo, 'LEEME.txt'), 'hola\n')
    writeFileSync(join(repo, 'diagrama.md'), '# Flujo\n\n```mermaid\nflowchart LR\n  A --> B\n```\n')
    s = await abrirTessera(agentes.env, { conMovimiento: true, sembrar: (datos) => sembrar(datos, repo) })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
    const ventana = s.ventana
    await expect(ventana.locator('.right-panel .agent-pane:not(.hidden)')).toBeVisible({ timeout: 60_000 })
    expect(await ventana.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'el movimiento está encendido').toBe(false)
    await espiarTransiciones(ventana)
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agentes) await borrarTemporal(agentes.raiz)
  })

  test('abrir el primer archivo viaja y cerrarlo se funde, con el editor marcado como la zona que se va', async () => {
    const ventana = s.ventana
    const abrir = await transicionesDe(ventana, () => ventana.locator('.sidebar .tree-row:visible', { hasText: 'LEEME.txt' }).first().click())
    expect(abrir, 'abrir el primer archivo es una transición').toHaveLength(1)
    expect(abrir[0].cierre, 'una apertura, no un cierre').toBe(false)

    const cerrar = await transicionesDe(ventana, () => ventana.locator('.editor-tab.active .editor-tab-close').click())
    expect(cerrar, 'cerrar el último archivo también es una transición: nada desaparece de golpe').toHaveLength(1)
    expect(cerrar[0].cierre, 'un cierre').toBe(true)
    expect(cerrar[0].seVan, 'se va el editor').toEqual(['editor-area'])
  })

  test('abrir la terminal es una apertura y ocultarla un cierre, con la franja marcada como la zona que se va', async () => {
    const ventana = s.ventana
    const abrir = await transicionesDe(ventana, () => ventana.getByRole('button', { name: 'Terminal', exact: true }).click())
    expect(abrir).toHaveLength(1)
    expect(abrir[0].cierre).toBe(false)
    await expect(ventana.locator('section.terminal-panel')).toBeVisible()
    const cerrar = await transicionesDe(ventana, () => ventana.getByRole('button', { name: 'Terminal', exact: true }).click())
    expect(cerrar, 'ocultar la terminal es una transición').toHaveLength(1)
    expect(cerrar[0].cierre).toBe(true)
    expect(cerrar[0].seVan, 'se va la franja de terminales').toEqual(['terminal-panel'])
  })

  test('el ampliado de Markdown se funde al entrar y salir dentro del pane', async () => {
    const ventana = s.ventana
    await ventana.locator('.sidebar .tree-row:visible', { hasText: 'diagrama.md' }).click()
    const boton = ventana.locator('.markdown-preview').getByRole('button', { name: 'Ampliar', exact: true })
    await expect(boton).toBeAttached()
    await ventana.evaluate(() => {
      document.addEventListener('transitionrun', (e) => {
        const el = e.target
        if (e.propertyName !== 'opacity' || !(el instanceof HTMLElement) || !el.matches('.ampliado-markdown')) return
        document.body.dataset.transicionAmpliado = el.hasAttribute('data-saliendo') ? 'salida' : 'entrada'
      })
    })
    await boton.focus()
    await boton.press('Enter')
    const ampliado = ventana.locator('.ampliado-markdown')
    await expect(ampliado).toBeVisible()
    await expect(ventana.locator('body')).toHaveAttribute('data-transicion-ampliado', 'entrada')
    await expect(ampliado).toHaveCSS('opacity', '1')
    await ventana.keyboard.press('Escape')
    await expect(ventana.locator('body')).toHaveAttribute('data-transicion-ampliado', 'salida')
    await expect(ampliado).toHaveCount(0)
    await ventana.locator('.editor-tab.active .editor-tab-close').click()
    await expect(ventana.locator('.editor-area')).toBeHidden()
  })

  test('la terminal sube con su texto a la vista y la vista del lateral se funde', async () => {
    const ventana = s.ventana
    const terminal = ventana.getByRole('button', { name: 'Terminal', exact: true })
    const abrir = await animacionesTras(ventana, () => terminal.click())
    expect(abrir, 'la franja entra por abajo').toContain('mov-zona-sube::view-transition-image-pair(zona-terminales)')
    const opacidad = await ventana.locator('section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm-screen').evaluate((el) => getComputedStyle(el).opacity)
    expect(opacidad, 'con su texto a la vista').toBe('1')
    await ventana.waitForTimeout(700)
    const cerrar = await animacionesTras(ventana, () => terminal.click())
    expect(cerrar, 'y sale por donde entró').toContain('mov-zona-baja::view-transition-image-pair(zona-que-se-va)')
    await ventana.waitForTimeout(700)
    const vista = await animacionesTras(ventana, () => ventana.locator('.activity-item[title="Git · Cambios"]').click())
    expect(vista, 'la vista del lateral se funde').toContain('mov-lateral-funde')
    await ventana.locator('.activity-item[title="Archivos"]').click()
    await ventana.waitForTimeout(300)
  })

  test('al maximizar y restaurar, la lista de conexiones se abre y se cierra con el borde de la terminal', async () => {
    const ventana = s.ventana
    const terminal = ventana.getByRole('button', { name: 'Terminal', exact: true })
    await terminal.click()
    const panel = ventana.locator('section.terminal-panel')
    await expect(panel).toBeVisible()
    await ventana.waitForTimeout(700)
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    const maximizar = await animacionesTras(ventana, () => ventana.keyboard.press(`${MOD}+Shift+Enter`))
    expect(maximizar, 'el texto se desplaza con la lista').toContain('mov-morfa-texto-abre::view-transition-new(zona-terminales)')
    expect(maximizar, 'y la lista se abre').toContain('mov-morfa-riel-abre::view-transition-image-pair(zona-riel)')
    await ventana.waitForTimeout(700)
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    const restaurar = await animacionesTras(ventana, () => ventana.keyboard.press(`${MOD}+Shift+Enter`))
    expect(restaurar, 'al restaurar la lista se cierra con su contenido').toContain('mov-morfa-riel-cierra::view-transition-image-pair(zona-riel)')
    const grupos = await ventana.evaluate(() => document.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).pseudoElement ?? []))
    expect(grupos, 'y su captura es solo la vieja: una nueva en blanco dejaría el cajón vacío').not.toContain('::view-transition-new(zona-riel)')
    await ventana.waitForTimeout(700)
    await terminal.click()
    await ventana.waitForTimeout(700)
  })

  test('maximizar, ocultar y volver a abrir la terminal también se mueve', async () => {
    const ventana = s.ventana
    const terminal = ventana.getByRole('button', { name: 'Terminal', exact: true })
    await terminal.click()
    const panel = ventana.locator('section.terminal-panel')
    await expect(panel).toBeVisible()
    await ventana.waitForTimeout(700)
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    const shell = ventana.locator('.shell')
    const maximizar = await transicionesDe(ventana, () => ventana.keyboard.press(`${MOD}+Shift+Enter`))
    await expect(shell).toHaveClass(/terminal-pantalla-completa/)
    expect(maximizar, 'maximizar es una transición').toHaveLength(1)
    const ocultar = await transicionesDe(ventana, () => ventana.locator('.activity-bar').getByRole('button', { name: 'Ocultar el panel de terminal' }).click())
    expect(ocultar, 'ocultarla maximizada también').toHaveLength(1)
    expect(ocultar[0].seVan, 'y se va la franja').toEqual(['terminal-panel'])
    await expect(ventana.locator('.activity-bar:not(.riel-pantalla-completa) .activity-item[aria-label="Terminal"]'), 'el foco vuelve a su icono').toBeFocused()
    const abrir = await transicionesDe(ventana, () => terminal.click())
    expect(abrir, 'volver a abrirla maximizada también').toHaveLength(1)
    await expect(shell).toHaveClass(/terminal-pantalla-completa/)
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    const restaurar = await transicionesDe(ventana, () => ventana.keyboard.press(`${MOD}+Shift+Enter`))
    expect(restaurar, 'y restaurarla').toHaveLength(1)
    await expect(shell).not.toHaveClass(/terminal-pantalla-completa/)
    await terminal.click()
    await ventana.waitForTimeout(500)
  })

  test('cambiar de vista es instantáneo, también de ida y vuelta', async () => {
    const ventana = s.ventana
    const ida = await transicionesDe(ventana, () => ventana.locator('.activity-item[title="Git · Cambios"]').click())
    const vuelta = await transicionesDe(ventana, () => ventana.locator('.activity-item[title="Archivos"]').click())
    expect([...ida, ...vuelta], 'ninguna transición del reparto').toHaveLength(0)
  })

  test('cerrar el agente de la terminal es un cierre aunque su columna siga en la página', async () => {
    const ventana = s.ventana
    await ventana.getByRole('button', { name: 'Terminal', exact: true }).click()
    const panel = ventana.locator('section.terminal-panel')
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    await ventana.keyboard.press(`${MOD}+Shift+Enter`)
    await expect(ventana.locator('.shell')).toHaveClass(/terminal-pantalla-completa/)
    await ventana.locator('.status-bar').getByRole('button', { name: /Mostrar el agente de la terminal/ }).click()
    const pane = ventana.locator('.right-panel .agent-pane:not(.hidden)')
    await expect(ventana.locator('.shell')).toHaveClass(/agente-terminal-visible/, { timeout: 30_000 })
    await ventana.waitForTimeout(800)
    const cerrar = await transicionesDe(ventana, async () => {
      await pane.locator('.panel-header').hover()
      await pane.getByRole('button', { name: 'Cerrar el agente de la terminal' }).click()
    })
    expect(cerrar, 'cerrarlo es una transición').toHaveLength(1)
    expect(cerrar[0].cierre).toBe(true)
    expect(cerrar[0].seVan, 'se va la columna del agente, aunque siga en la página con el del proyecto').toEqual(['right-panel'])
    await ventana.locator('.activity-bar').getByRole('button', { name: 'Restaurar el panel de terminal' }).click()
  })

  test('de la terminal maximizada a Git y de vuelta se funden en su sitio, sin que el viejo desaparezca de golpe', async () => {
    const ventana = s.ventana
    const panel = ventana.locator('section.terminal-panel')
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    await ventana.keyboard.press(`${MOD}+Shift+Enter`)
    await expect(ventana.locator('.shell')).toHaveClass(/terminal-pantalla-completa/)
    await ventana.waitForTimeout(700)
    const riel = ventana.locator('.activity-bar')
    const aGit = await aMitadDeLaTransicion(ventana, () => riel.getByRole('button', { name: /^Git · Historial/ }).click(), [],
      ['::view-transition-new(zona-panel-franja)', '::view-transition-old(zona-panel-franja)'])
    expect(aGit.animaciones.map((a) => a.nombre), 'Git entra fundiéndose sobre la terminal').toContain('mov-zona-cruce::view-transition-new(zona-panel-franja)')
    expect(aGit.animaciones.map((a) => a.nombre), 'y no sube desde abajo mientras la terminal se esfuma').not.toContain('mov-zona-sube::view-transition-image-pair(zona-git)')
    expect(aGit.opacidad['::view-transition-new(zona-panel-franja)']).toBeGreaterThan(0.05)
    expect(aGit.opacidad['::view-transition-new(zona-panel-franja)']).toBeLessThan(0.95)
    expect(aGit.opacidad['::view-transition-old(zona-panel-franja)'], 'la terminal sigue opaca debajo hasta que Git la cubre').toBe(1)
    await expect(ventana.locator('.git-log-panel:not(.hidden)')).toBeVisible()
    await ventana.waitForTimeout(700)
    const aTerminal = await aMitadDeLaTransicion(ventana, () => riel.getByRole('button', { name: 'Terminal', exact: true }).click(), [],
      ['::view-transition-new(zona-panel-franja)'])
    expect(aTerminal.opacidad['::view-transition-new(zona-panel-franja)']).toBeGreaterThan(0.05)
    expect(aTerminal.opacidad['::view-transition-new(zona-panel-franja)']).toBeLessThan(0.95)
    await expect(panel).toBeVisible()
    await ventana.waitForTimeout(500)
    await riel.getByRole('button', { name: 'Restaurar el panel de terminal' }).click()
    await expect(ventana.locator('.shell')).not.toHaveClass(/terminal-pantalla-completa/)
    await ventana.waitForTimeout(700)
  })

  test('el riel de la hija y la columna del agente entran y salen al cambiar la vista compacta', async () => {
    const principal = s.ventana
    const panel = principal.locator('section.terminal-panel')
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    await principal.keyboard.press(`${MOD}+Shift+Enter`)
    await expect(principal.locator('.shell')).toHaveClass(/terminal-pantalla-completa/)
    await principal.locator('.status-bar').getByRole('button', { name: /Mostrar el agente de la terminal/ }).click()
    const cabecera = panel.locator('> .panel-header')
    await cabecera.hover()
    const nueva = s.app.waitForEvent('window', { timeout: 15_000 })
    await cabecera.getByRole('button', { name: 'Desacoplar', exact: true }).click()
    const hija = await nueva
    const nativa = await s.app.browserWindow(hija)
    try {
      await nativa.evaluate((ventana) => ventana.setContentSize(1280, 760))
      await hija.bringToFront()
      const riel = hija.locator('.riel-franja')
      const agente = hija.locator('.right-panel')
      const cabeceraHija = hija.locator('.terminal-panel > .panel-header')
      const control = cabeceraHija.locator('.control-plegable')
      await expect(riel).toBeVisible()
      await expect(riel).toHaveCSS('animation-name', 'mov-panel-entra')
      await expect(riel).toHaveCSS('--mov-panel-x', '-12px')
      expect(await riel.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))).toBeGreaterThan(0)
      await expect(agente).toBeVisible()
      await expect(control).toHaveCSS('transition-property', /width/)
      await cabeceraHija.hover()
      const salir = await animacionesTras(hija, () => cabeceraHija.getByRole('button', { name: 'Mostrar solo la terminal' }).click())
      expect(salir).toContain('mov-zona-hacia-izquierda::view-transition-group(zona-que-se-va)')
      // La lista de conexiones se cierra a la vez (morfa): la columna sale por su lado con el recorte de ese gesto.
      expect(salir).toContain('mov-morfa-agente-sale::view-transition-group(zona-que-se-va-agente)')
      await expect(riel).toBeHidden()
      await expect(agente).toBeHidden()
      await expect(control).toHaveClass(/control-plegable(?!.*plegado)/)
      // El botón del agente del pie no se pinta en la compacta: se va con su fundido y vuelve con su entrada.
      const botonAgente = hija.locator('footer.estado-franja .estado-franja-agente')
      await expect(botonAgente).toHaveCount(0)
      await expect(hija.locator('html')).not.toHaveClass(/transicion-layout/)
      const entrar = await animacionesTras(hija, () => cabeceraHija.getByRole('button', { name: 'Mostrar la vista completa' }).click())
      expect(entrar).toContain('mov-zona-desde-izquierda::view-transition-group(zona-riel-franja)')
      expect(entrar).toContain('mov-morfa-agente-entra::view-transition-group(zona-agente)')
      await expect(riel).toBeVisible()
      await expect(agente).toBeVisible()
      await expect(botonAgente).toHaveClass(/mov-aparece/)
      await expect(control).toHaveClass(/\bplegado\b/)
      await expect(hija.locator('html')).not.toHaveClass(/transicion-layout/)
      await agente.locator('.agent-pane:not(.hidden) .panel-header').hover()
      await hija.getByRole('button', { name: 'Cerrar el agente de la terminal' }).click()
      await principal.bringToFront()
      await principal.locator('.activity-bar').getByRole('button', { name: 'Acoplar', exact: true }).click()
      await expect.poll(() => hija.isClosed()).toBe(true)
    } finally {
      await nativa.dispose()
    }
  })

  test('cada cambio de vista de la ventana desacoplada se anima en su propio documento, nada se queda quieto ni salta', async () => {
    const principal = s.ventana
    const panel = principal.locator('section.terminal-panel')
    await panel.locator('.terminal-pane[aria-hidden="false"] .xterm-screen').click()
    await principal.keyboard.press(`${MOD}+Shift+Enter`)
    await expect(principal.locator('.shell')).toHaveClass(/terminal-pantalla-completa/)
    await principal.locator('.status-bar').getByRole('button', { name: /Mostrar el agente de la terminal/ }).click()
    const cabecera = panel.locator('> .panel-header')
    await cabecera.hover()
    const nueva = s.app.waitForEvent('window', { timeout: 15_000 })
    await cabecera.getByRole('button', { name: 'Desacoplar', exact: true }).click()
    const hija = await nueva
    const nativa = await s.app.browserWindow(hija)
    try {
      await nativa.evaluate((ventana) => ventana.setContentSize(1500, 760))
      await hija.bringToFront()
      const riel = hija.locator('.riel-franja')
      const agente = hija.locator('.right-panel')
      const pie = hija.locator('footer.estado-franja')
      await expect(riel).toBeVisible()
      await expect(agente).toBeVisible()
      // La cabecera de la terminal de la ventana desacoplada no repite el proyecto: ya lo dice su pie.
      await expect(hija.locator('section.terminal-panel .panel-title')).toHaveText('Terminal')
      await hija.waitForTimeout(800)
      const raizPrincipal = (): Promise<string> => principal.evaluate(() => document.documentElement.className)

      const ocultar = await aMitadDeLaTransicion(hija, () => pie.getByRole('button', { name: /^Ocultar el agente de la terminal/ }).click(),
        ['zona-que-se-va-agente'], [])
      expect(ocultar.animaciones.map((a) => a.nombre), 'la columna del agente sale por la derecha').toContain('mov-zona-hacia-derecha::view-transition-group(zona-que-se-va-agente)')
      expect(ocultar.desplazamiento['zona-que-se-va-agente'], 'a mitad de camino: ni quieta ni ya fuera').toBeGreaterThan(5)
      expect(ocultar.desplazamiento['zona-que-se-va-agente']).toBeLessThan(100)
      expect(await raizPrincipal(), 'la ventana principal no se entera').not.toMatch(/transicion-/)
      await expect(agente).toBeHidden()
      await expect(hija.locator('html')).not.toHaveClass(/transicion-layout/)

      const mostrar = await aMitadDeLaTransicion(hija, () => pie.getByRole('button', { name: /^Mostrar el agente de la terminal/ }).click(),
        ['zona-agente', 'zona-agente-pie'], [])
      const nombresMostrar = mostrar.animaciones.map((a) => a.nombre)
      expect(nombresMostrar, 'la columna entra por la derecha').toContain('mov-zona-desde-derecha::view-transition-group(zona-agente)')
      expect(nombresMostrar, 'y su pie con ella, sin esperar en su sitio final').toContain('mov-zona-desde-derecha::view-transition-group(zona-agente-pie)')
      expect(mostrar.desplazamiento['zona-agente'], 'la columna está a medio entrar').toBeGreaterThan(5)
      expect(mostrar.desplazamiento['zona-agente-pie'], 'y su pie también').toBeGreaterThan(5)
      await expect(agente).toBeVisible()

      const aGit = await aMitadDeLaTransicion(hija, () => riel.getByRole('button', { name: /^Git/ }).click(), [],
        ['::view-transition-new(zona-panel-franja)', '::view-transition-old(zona-panel-franja)'])
      expect(aGit.animaciones.map((a) => a.nombre), 'Git entra fundiéndose sobre la terminal').toContain('mov-zona-cruce::view-transition-new(zona-panel-franja)')
      expect(aGit.opacidad['::view-transition-new(zona-panel-franja)'], 'el panel nuevo está a medio fundir').toBeGreaterThan(0.05)
      expect(aGit.opacidad['::view-transition-new(zona-panel-franja)']).toBeLessThan(0.95)
      expect(aGit.opacidad['::view-transition-old(zona-panel-franja)'], 'y el viejo sigue opaco debajo: nada desaparece de golpe').toBe(1)
      await expect(hija.locator('.git-log-panel:not(.hidden)')).toBeVisible()
      await expect(hija.locator('section.terminal-panel')).toBeHidden()
      const aTerminal = await aMitadDeLaTransicion(hija, () => riel.getByRole('button', { name: 'Terminal', exact: true }).click(), [],
        ['::view-transition-new(zona-panel-franja)'])
      expect(aTerminal.opacidad['::view-transition-new(zona-panel-franja)'], 'y al volver a la terminal también').toBeGreaterThan(0.05)
      expect(aTerminal.opacidad['::view-transition-new(zona-panel-franja)']).toBeLessThan(0.95)
      await expect(hija.locator('section.terminal-panel')).toBeVisible()
      await expect(hija.locator('.git-log-panel:not(.hidden)')).toHaveCount(0)
      await expect.poll(() => hija.evaluate(() => document.activeElement?.closest('.terminal-pane') !== null), { message: 'el foco vuelve a la terminal' }).toBe(true)

      // Con el agente oculto cabe la lista de conexiones: al pasar a la vista compacta se cierra por la izquierda y
      // el texto la sigue; no se queda quieta en una captura para desaparecer al final.
      await pie.getByRole('button', { name: /^Ocultar el agente de la terminal/ }).click()
      await expect(hija.locator('.capa-viva:not(.oculta) .ssh-riel')).toBeVisible()
      await hija.waitForTimeout(500)
      const cabeceraHija = hija.locator('.terminal-panel > .panel-header')
      await cabeceraHija.hover()
      const compacta = await aMitadDeLaTransicion(hija, () => cabeceraHija.getByRole('button', { name: 'Mostrar solo la terminal' }).click(),
        ['zona-que-se-va', 'zona-riel'], [])
      const nombresCompacta = compacta.animaciones.map((a) => a.nombre)
      expect(nombresCompacta, 'la barra lateral sale por la izquierda').toContain('mov-zona-hacia-izquierda::view-transition-group(zona-que-se-va)')
      expect(nombresCompacta, 'la lista de conexiones se cierra con el borde de la terminal').toContain('mov-morfa-riel-cierra::view-transition-image-pair(zona-riel)')
      expect(nombresCompacta, 'y el texto de la terminal la sigue').toContain('mov-morfa-texto-cierra::view-transition-old(zona-terminales)')
      expect(Math.abs(compacta.desplazamiento['zona-que-se-va']), 'la barra lateral va a medio camino').toBeGreaterThan(5)
      await expect(hija.locator('.capa-viva:not(.oculta) .ssh-riel')).toHaveCount(0)
      await cabeceraHija.hover()
      const completa = await aMitadDeLaTransicion(hija, () => cabeceraHija.getByRole('button', { name: 'Mostrar la vista completa' }).click(),
        ['zona-riel-franja'], [])
      const nombresCompleta = completa.animaciones.map((a) => a.nombre)
      expect(nombresCompleta, 'la barra lateral vuelve por la izquierda').toContain('mov-zona-desde-izquierda::view-transition-group(zona-riel-franja)')
      expect(nombresCompleta, 'y la lista de conexiones se abre con el texto').toContain('mov-morfa-riel-abre::view-transition-image-pair(zona-riel)')
      await expect(riel).toBeVisible()
      await expect(hija.locator('html')).not.toHaveClass(/transicion-/)
      expect(await raizPrincipal(), 'la principal sigue sin transición propia').not.toMatch(/transicion-/)

      await principal.bringToFront()
      await principal.locator('.activity-bar').getByRole('button', { name: 'Acoplar', exact: true }).click()
      await expect.poll(() => hija.isClosed()).toBe(true)
    } finally {
      await nativa.dispose()
    }
  })

  test('Configuración entra con su transición y, al cerrarse, deja su copia de despedida', async () => {
    const ventana = s.ventana
    await ventana.keyboard.press(`${MOD}+,`)
    const modal = ventana.locator('.ajustes-modal')
    await expect(modal).toBeVisible()
    const entrada = await modal.evaluate((tarjeta) => {
      const velo = tarjeta.closest('.modal-overlay') as HTMLElement
      const a = (el: Element): string => `${getComputedStyle(el).animationName} ${getComputedStyle(el).animationDuration}`
      return { velo: a(velo), tarjeta: a(tarjeta) }
    })
    const conDuracion = (v: string, nombre: string): boolean => v.startsWith(`${nombre} `) && parseFloat(v.split(' ')[1]) > 0
    expect(conDuracion(entrada.velo, 'modal-fade'), `el velo entra con su fundido (${entrada.velo})`).toBe(true)
    expect(conDuracion(entrada.tarjeta, 'modal-pop'), `y la tarjeta con su entrada (${entrada.tarjeta})`).toBe(true)
    await ventana.keyboard.press('Escape')
    await expect(ventana.locator('.mov-despedida'), 'al cerrarse deja una copia que hace la salida').not.toHaveCount(0)
    await expect(ventana.locator('.mov-despedida'), 'y la copia se borra al terminar').toHaveCount(0)
  })

  test('un submenú entra y sale con el mismo fundido que su menú', async () => {
    const ventana = s.ventana
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 620))
    await ventana.locator('.profile-tab-name', { hasText: 'Personal' }).click({ button: 'right' })
    const fila = ventana.getByRole('menuitem', { name: 'Agentes en Docker' })
    await fila.hover()
    const panel = ventana.getByRole('menu', { name: 'Agentes en Docker' })
    await expect(panel, 'se abre al detener el ratón').toBeVisible()
    await expect(panel).toHaveClass(/mov-aparece/)
    if (process.env.TESSERA_E2E_CAPTURAS) await ventana.screenshot({ path: join(process.env.TESSERA_E2E_CAPTURAS, 'submenu-perfil.png') })
    const caja = await panel.boundingBox()
    expect(caja !== null && caja.x >= 0 && caja.x + caja.width <= 900 && caja.y + caja.height <= 620, 'cabe en 900 × 620').toBe(true)
    expect(await panel.evaluate((p) => p.scrollWidth === p.clientWidth), 'sin desbordes').toBe(true)
    await ventana.keyboard.press('ArrowRight')
    await expect(panel.getByRole('menuitem').first(), '→ entra en él').toBeFocused()
    await ventana.keyboard.press('ArrowLeft')
    await expect(panel, '← lo cierra').toHaveCount(0)
    await expect(fila, 'y el foco vuelve a su fila').toBeFocused()
    await ventana.keyboard.press('ArrowRight')
    await expect(panel).toBeVisible()
    await ventana.keyboard.press('Escape')
    await expect(panel, 'Esc cierra solo el submenú').toHaveCount(0)
    await ventana.keyboard.press('Escape')
    await expect(ventana.locator('.ctx-menu:not(.mov-despedida)')).toHaveCount(0)
    await expect(ventana.locator('.mov-despedida'), 'y la copia se borra al terminar').toHaveCount(0)
  })
})

/** Lo que se ve del diff en un cuadro: su opacidad real y si se pinta una línea que el plegado esconde. */
interface CuadroDiff {
  t: number
  op: number
  sinPlegar: boolean
}

/** Graba cuadro a cuadro el diff visible mientras se hace `accion` y hasta que se asienta. */
async function grabarDiff(ventana: Page, accion: () => Promise<void>): Promise<CuadroDiff[]> {
  await ventana.evaluate(() => {
    const w = window as unknown as { __cuadros: CuadroDiff[]; __grabando: boolean }
    w.__cuadros = []
    w.__grabando = true
    const inicio = performance.now()
    const paso = (): void => {
      if (!w.__grabando) return
      const seccion = Array.from(document.querySelectorAll('section[aria-label="Diff"]')).find((s) => !s.classList.contains('hidden'))
      const host = seccion?.querySelector<HTMLElement>('.editor-host')
      let op = 0
      if (host) {
        op = 1
        for (let e: HTMLElement | null = host; e && e !== document.body; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
      }
      w.__cuadros.push({
        t: Math.round(performance.now() - inicio),
        op: Math.round(op * 100) / 100,
        sinPlegar: /l[ií]nea\s5(?!\d)/.test(host?.querySelector('.editor.modified .view-lines')?.textContent ?? '')
      })
      requestAnimationFrame(paso)
    }
    requestAnimationFrame(paso)
  })
  await accion()
  await ventana.waitForTimeout(1500)
  return ventana.evaluate(() => {
    const w = window as unknown as { __cuadros: CuadroDiff[]; __grabando: boolean }
    w.__grabando = false
    return w.__cuadros
  })
}

/** Cuántas veces baja la opacidad después de haber empezado a subir: 0 es un solo fundido, sin parpadeos. */
function caidasDeOpacidad(cuadros: CuadroDiff[]): number {
  let subio = false
  let caidas = 0
  for (let i = 1; i < cuadros.length; i++) {
    if (cuadros[i].op > cuadros[i - 1].op) subio = true
    else if (subio && cuadros[i].op < cuadros[i - 1].op - 0.05) caidas++
  }
  return caidas
}

test.describe.serial('La entrada del diff, con las animaciones encendidas', () => {
  let s: SesionTessera
  let agentes: AgenteFalso

  test.beforeAll(async () => {
    agentes = montarAgenteFalso()
    const repo = join(agentes.raiz, 'repo')
    mkdirSync(repo)
    const git = (...a: string[]): void => void execFileSync('git', a, { cwd: repo })
    const contenido = (marca: string): string => Array.from({ length: 400 }, (_, i) => (i === 200 ? marca : `línea ${i}`)).join('\n') + '\n'
    const archivos = ['uno.txt', 'dos.txt', 'tres.txt', 'cuatro.txt']
    for (const a of archivos) writeFileSync(join(repo, a), contenido('original'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Pruebas')
    git('config', 'user.email', 'pruebas@example.invalid')
    git('add', '.')
    git('commit', '-qm', 'inicial')
    for (const a of archivos) writeFileSync(join(repo, a), contenido('cambiada'))
    s = await abrirTessera(agentes.env, { conMovimiento: true, sembrar: (datos) => sembrar(datos, repo, { diffColapsarSinCambios: true }) })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1500, 950)
    })
    await s.ventana.getByRole('button', { name: /^Git · Cambios/ }).click()
    await expect(s.ventana.locator('.git-panel .git-arbol-fila', { hasText: 'uno.txt' }).first()).toBeVisible({ timeout: 30_000 })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agentes) await borrarTemporal(agentes.raiz)
  })

  const abrir = (nombre: string) => (): Promise<void> => s.ventana.locator('.git-panel .git-arbol-fila', { hasText: nombre }).first().dblclick()

  test('con el plegado activo nunca se ve el archivo entero, y el texto entra con un solo fundido', async () => {
    await abrir('uno.txt')()
    await expect(s.ventana.locator('section[aria-label="Diff"]:not(.hidden) .diff-hidden-lines').first()).toBeAttached({ timeout: 15_000 })
    await s.ventana.waitForTimeout(500)
    const cuadros = await grabarDiff(s.ventana, abrir('dos.txt'))
    const enteros = cuadros.filter((c) => c.op > 0.02 && c.sinPlegar)
    expect(enteros, `cuadros con el archivo entero a la vista: ${JSON.stringify(enteros.slice(0, 8))}`).toHaveLength(0)
    expect(caidasDeOpacidad(cuadros), 'un solo fundido').toBe(0)
    expect(cuadros.at(-1)?.op, 'termina visible').toBe(1)
  })

  test('sin el plegado, el texto también entra con un solo fundido', async () => {
    await s.ventana.getByRole('button', { name: /Contraer los fragmentos sin cambios/ }).click()
    await s.ventana.waitForTimeout(500)
    const cuadros = await grabarDiff(s.ventana, abrir('tres.txt'))
    expect(caidasDeOpacidad(cuadros), 'un solo fundido').toBe(0)
    expect(cuadros.at(-1)?.op, 'termina visible').toBe(1)
  })
})
