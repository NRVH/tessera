// =============================================================================
// El botón que actualiza todos los agentes, con la sección de Docker: novedades, Docker apagado, confirmar lo que se
// detiene y el resultado, en la ventana mínima y en una grande. El estado y la ejecución de Docker se sustituyen en el
// main: reconstruir la imagen de verdad tarda minutos y detendría los contenedores de quien corre la prueba.
// `TESSERA_E2E_CAPTURAS=<carpeta>` guarda las capturas.
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================

import { expect, test, type Locator } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentsUpdateResult, EstadoAgentesDocker } from '../src/shared/agents-update-ipc.ts'
import { abrirRegistroFalso, montarAgenteFalso, type AgenteFalso, type RegistroFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

const TEXTOS = {
  es: { titulo: 'Agentes en Docker', actualizar: 'Actualizar Docker', iniciar: 'Iniciar Docker y actualizar', todo: 'Actualizar todo', todoIniciando: 'Actualizar todo e iniciar Docker', detener: 'Detener 2 agentes y 1 tarea, y actualizar', cancelar: 'Cancelar', detenido: 'Docker detenido', error: 'sin espacio', reintentar: 'Reintentar', descartar: 'Descartar', listo: 'Actualizado' },
  en: { titulo: 'Agents in Docker', actualizar: 'Update Docker', iniciar: 'Start Docker and update', todo: 'Update all', todoIniciando: 'Update all and start Docker', detener: 'Stop 2 agents and 1 task, and update', cancelar: 'Cancel', detenido: 'Docker stopped', error: 'sin espacio', reintentar: 'Retry', descartar: 'Discard', listo: 'Updated' }
}
const nueva = { instalada: '2.1.318', ultima: '2.1.321', hayNueva: true }
const alDia = { instalada: '0.156.1', ultima: '0.156.1', hayNueva: false }
const BASE: EstadoAgentesDocker = { cuentas: 3, perfiles: 2, dockerActivo: true, claude: nueva, codex: alDia, leidoEn: 1, sesiones: [], tareas: [], conCapas: false, extrasVetados: false }
const sesion = (i: number, trabajando: boolean): EstadoAgentesDocker['sesiones'][number] => ({ sessionId: `s${i}`, profileId: 'personal', projectHostPath: `/proyectos/proyecto-con-nombre-largo-${i}`, nombreAgente: 'Codex', trabajando, esperandoRespuesta: false })
const tarea = { id: 't1', cuenta: 'Cuenta', resumen: 'Revisar el módulo de pagos con una descripción bastante más larga de lo normal' }

declare global {
  // Lo que las sustituciones del main leen y apuntan.
  var e2eDocker: { estado: EstadoAgentesDocker; resultado: AgentsUpdateResult; corridas: number }
}

function sembrar(datos: string, proyecto: string): void {
  mkdirSync(proyecto, { recursive: true })
  writeFileSync(join(datos, 'profiles.json'), JSON.stringify([{ id: 'personal', nombre: 'Personal', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }, { tipo: 'codex', configDir: './.tessera/perfiles/personal/codex' }], sandbox: { habilitado: false } }]))
  writeFileSync(join(datos, 'workspace-state.json'), JSON.stringify({ version: 1, activeProfileId: 'personal', byProfile: { personal: { openProjects: [{ projectHostPath: proyecto, name: 'proyecto', estado: 'active' }], activePath: proyecto } }, settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`], menuWindowsAvisado: true } }))
}

async function sinDesbordes(pop: Locator): Promise<void> {
  const fallos = await pop.evaluate((raiz) => {
    const caja = raiz.getBoundingClientRect()
    return Array.from(raiz.querySelectorAll<HTMLElement>('section, .btn, .agentes-docker-titulo, .actualizacion-pop-msg')).concat(raiz as HTMLElement).flatMap((el) => {
      const r = el.getBoundingClientRect()
      return el.scrollWidth > el.clientWidth + 1 || r.right > caja.right + 1 || r.left < caja.left - 1 ? [`${el.className}: ${el.scrollWidth}/${el.clientWidth}`] : []
    })
  })
  expect(fallos).toEqual([])
  const r = await pop.boundingBox()
  const alto = await pop.evaluate(() => window.innerHeight)
  expect((r?.y ?? 0) + (r?.height ?? 0), 'el popover cabe en la ventana').toBeLessThanOrEqual(alto)
}

for (const idioma of ['es', 'en'] as const) {
  test.describe.serial(`actualizar todos los agentes (${idioma})`, () => {
    test.setTimeout(180_000)
    const t = TEXTOS[idioma]
    let agente: AgenteFalso
    let registro: RegistroFalso
    let s: SesionTessera

    const fijar = (cambios: Partial<EstadoAgentesDocker>, resultado: AgentsUpdateResult = { ok: true, codex: 'a', claude: 'b' }): Promise<void> =>
      s.app.evaluate((_, datos) => {
        globalThis.e2eDocker.estado = datos.estado
        globalThis.e2eDocker.resultado = datos.resultado
      }, { estado: { ...BASE, ...cambios }, resultado })
    const corridas = (): Promise<number> => s.app.evaluate(() => globalThis.e2eDocker.corridas)
    const capturar = async (pop: Locator, nombre: string): Promise<void> => {
      const dir = process.env.TESSERA_E2E_CAPTURAS
      if (!dir) return
      mkdirSync(dir, { recursive: true })
      await s.win.waitForTimeout(350)
      await pop.screenshot({ path: join(dir, `actualizar-${idioma}-${nombre}.png`), animations: 'disabled' })
    }
    const abrir = async (): Promise<Locator> => {
      if ((await s.win.locator('.agentes-nativos-pop').count()) > 0) {
        await s.win.keyboard.press('Escape')
        await expect(s.win.locator('.agentes-nativos-pop')).toHaveCount(0)
      }
      await s.win.locator('.agentes-nativos-boton').click()
      const pop = s.win.locator('.agentes-nativos-pop')
      await expect(pop.getByText(t.titulo, { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(pop.locator('.actualizacion-pop-pie button')).toBeEnabled({ timeout: 60_000 })
      return pop
    }

    test.beforeAll(async () => {
      agente = montarAgenteFalso({ versiones: { claude: '2.1.281', codex: '0.156.0' } })
      registro = await abrirRegistroFalso({ codex: '0.156.1', claude: '2.1.281' })
      s = await abrirTessera({ ...agente.env, ...registro.env, TESSERA_FORZAR_IDIOMA: idioma }, { sembrar: (datos) => sembrar(datos, join(agente.raiz, 'proyecto')) })
      await s.app.evaluate(({ ipcMain, BrowserWindow }, base) => {
        globalThis.e2eDocker = { estado: base, resultado: { ok: true, codex: 'a', claude: 'b' }, corridas: 0 }
        ipcMain.removeHandler('agentsUpdate:estado')
        ipcMain.handle('agentsUpdate:estado', () => globalThis.e2eDocker.estado)
        ipcMain.removeHandler('agentsUpdate:run')
        ipcMain.handle('agentsUpdate:run', async () => {
          globalThis.e2eDocker.corridas++
          for (const w of BrowserWindow.getAllWindows()) w.webContents.send('agentsUpdate:progress', { line: 'Reconstruyendo' })
          await new Promise((r) => setTimeout(r, 300))
          return globalThis.e2eDocker.resultado
        })
      }, BASE)
    })

    test.afterAll(async () => {
      await s?.cerrar()
      await registro?.cerrar()
      await borrarTemporal(agente.raiz)
    })

    test('con novedades en las dos secciones ofrece actualizar todo, y cada sección solo con contorno', async () => {
      const pop = await abrir()
      const seccion = pop.getByRole('button', { name: t.actualizar, exact: true })
      const todo = pop.getByRole('button', { name: t.todo, exact: true })
      await expect(seccion).toBeVisible()
      await expect(todo).toBeVisible()
      const fondo = (b: Locator): Promise<string> => b.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(await fondo(seccion), 'sin relleno').toBe('rgba(0, 0, 0, 0)')
      expect(await seccion.evaluate((el) => getComputedStyle(el).boxShadow), 'con el contorno dibujado').toMatch(/inset/)
      expect(await fondo(todo), 'con relleno').not.toBe('rgba(0, 0, 0, 0)')
      const [cajaTodo, cajaPop] = [await todo.boundingBox(), await pop.boundingBox()]
      const centroTodo = (cajaTodo?.x ?? 0) + (cajaTodo?.width ?? 0) / 2
      expect(Math.abs(centroTodo - ((cajaPop?.x ?? 0) + (cajaPop?.width ?? 0) / 2)), 'centrado en el popover').toBeLessThan(2)
      expect((cajaTodo?.width ?? 0) / (cajaPop?.width ?? 1), 'no ocupa todo el ancho').toBeLessThan(0.85)
      expect(await todo.evaluate((el) => getComputedStyle(el).justifyContent), 'texto centrado').toBe('center')
      expect(cajaTodo?.height ?? 0, 'con aire alrededor del texto').toBeGreaterThanOrEqual(30)
      await capturar(pop, 'novedades')
    })

    test('con Docker apagado dice que lo iniciará, en cada acción', async () => {
      await fijar({ dockerActivo: false })
      const pop = await abrir()
      await expect(pop.getByText(t.detenido, { exact: true })).toBeVisible()
      await expect(pop.getByRole('button', { name: t.iniciar, exact: true })).toBeVisible()
      await expect(pop.getByRole('button', { name: t.todoIniciando, exact: true })).toBeVisible()
    })

    test('lo que está en curso se confirma en el mismo botón y cancelar no detiene nada', async () => {
      await fijar({ sesiones: [sesion(1, true), sesion(2, false)], tareas: [tarea] })
      const pop = await abrir()
      await pop.getByRole('button', { name: t.actualizar, exact: true }).click()
      const confirmar = pop.getByRole('button', { name: t.detener, exact: true })
      await expect(confirmar).toBeVisible()
      await capturar(pop, 'confirmar')
      expect(await corridas(), 'pedir confirmación no lanza nada').toBe(0)
      await pop.getByRole('button', { name: t.cancelar, exact: true }).click()
      await expect(confirmar).toHaveCount(0)
      expect(await corridas()).toBe(0)
      await pop.getByRole('button', { name: t.actualizar, exact: true }).click()
      await confirmar.click()
      await expect.poll(corridas, { message: 'confirmar sí lanza la actualización' }).toBe(1)
      await expect(pop.locator('.agentes-docker-ok')).toContainText(t.listo)
    })

    test('un fallo se queda a la vista y se puede reintentar', async () => {
      await fijar({}, { ok: false, codex: '?', claude: '?', error: t.error })
      const pop = await abrir()
      await pop.getByRole('button', { name: t.actualizar, exact: true }).click()
      await expect.poll(corridas).toBe(2)
      await expect(pop.getByText(t.error)).toBeVisible()
      await pop.getByRole('button', { name: t.reintentar, exact: true }).click()
      await expect.poll(corridas).toBe(3)
      await expect(pop.getByText(t.error)).toBeVisible()
      await s.win.keyboard.press('Escape')
      await expect(s.win.locator('.agentes-nativos-boton.tono-rojo'), 'el punto queda en rojo al cerrar').toHaveCount(1)
      const otra = await abrir()
      await expect(otra.getByText(t.error), 'el fallo sigue a la vista').toBeVisible()
      await otra.getByRole('button', { name: t.descartar, exact: true }).click()
      await expect(otra.getByRole('button', { name: t.actualizar, exact: true })).toBeVisible()
    })

    test('en la ventana mínima y en una grande, con muchos agentes, nada desborda', async () => {
      const muchas = Array.from({ length: 30 }, (_, i) => sesion(i, i === 0))
      await fijar({ sesiones: muchas, tareas: [tarea] })
      for (const [ancho, alto] of [[900, 620], [1600, 1000]] as const) {
        await s.app.evaluate(({ BrowserWindow }, [a, h]) => BrowserWindow.getAllWindows()[0].setSize(a, h), [ancho, alto])
        await s.win.waitForTimeout(300)
        const pop = await abrir()
        await s.win.waitForTimeout(400)
        await sinDesbordes(pop)
        const lista = pop.locator('.agentes-docker-lista')
        if (await lista.count()) expect((await lista.boundingBox())?.height ?? 999, 'la lista se desplaza en su sitio').toBeLessThanOrEqual(107)
      }
    })
  })
}
