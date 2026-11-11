// =============================================================================
// El inicio de sesión de una cuenta de Codex con el `codex login` real de su contenedor: enseña en qué punto va, el
// reloj avanza, la ayuda sale al minuto, la terminal se pliega sin perder su contenido y nada desborda en la ventana
// mínima ni en una grande. `TESSERA_E2E_CAPTURAS=<carpeta>` guarda una captura de cada una.
// =============================================================================

import { expect, test, type Locator } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirLogin, dockerMontaProyectos, sembrarLogin } from './loginCuenta'
import { abrirTessera, borrarTemporal, PLATAFORMA, type SesionTessera } from './tessera'

const TEXTOS = {
  es: { autorice: 'Autorice el acceso en su navegador', ayuda: '¿No se abrió el navegador?', mostrar: 'Mostrar la terminal', ocultar: 'Ocultar la terminal' },
  en: { autorice: 'Authorize access in your browser', ayuda: 'Did the browser not open?', mostrar: 'Show terminal', ocultar: 'Hide terminal' }
}

async function sinDesbordes(modal: Locator): Promise<void> {
  const fallos = await modal.evaluate((raiz) => {
    const caja = raiz.getBoundingClientRect()
    return Array.from(raiz.querySelectorAll<HTMLElement>('.cuentas-login-cuerpo, .cuentas-login-centro, .cuentas-login-estado, .cuentas-login-titulo, .cuentas-login-detalle, .cuentas-login-ayuda, .modal-cuerpo')).flatMap((el) => {
      const r = el.getBoundingClientRect()
      const fuera = r.right > caja.right + 1 || r.bottom > caja.bottom + 1
      return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 || fuera ? [`${el.className}: ${el.scrollWidth}/${el.clientWidth} ${el.scrollHeight}/${el.clientHeight}`] : []
    })
  })
  expect(fallos).toEqual([])
}

for (const idioma of ['es', 'en'] as const) {
  test.describe.serial(`inicio de sesión de una cuenta (${idioma})`, () => {
    test.skip(!dockerMontaProyectos(), 'Docker no responde o no ve las carpetas de este sistema')
    test.setTimeout(300_000)
    const t = TEXTOS[idioma]
    const carpetaCapturas = process.env.TESSERA_E2E_CAPTURAS
    let agente: AgenteFalso
    let s: SesionTessera
    let modal: Locator
    let temporal = ''

    const capturar = async (nombre: string): Promise<void> => {
      if (!carpetaCapturas) return
      mkdirSync(carpetaCapturas, { recursive: true })
      await modal.screenshot({ path: join(carpetaCapturas, `login-${idioma}-${nombre}.png`), animations: 'disabled' })
    }

    test.beforeAll(async () => {
      // Aquí y no al cargar el archivo, que también se carga solo para listar los casos y dejaría la carpeta. Docker
      // Desktop para Mac no comparte el temporal del sistema: el proyecto que se monta, bajo `/Users`.
      temporal = mkdtempSync(join(PLATAFORMA === 'mac' ? homedir() : tmpdir(), 'tessera-login-e2e-'))
      agente = montarAgenteFalso()
      s = await abrirTessera({ ...agente.env, TESSERA_FORZAR_IDIOMA: idioma }, { sembrar: (datos) => sembrarLogin(datos, join(temporal, 'proyecto')) })
      await s.win.clock.install()
      modal = await abrirLogin(s.win)
    })

    test.afterAll(async () => {
      await s?.cerrar()
      if (agente) await borrarTemporal(agente.raiz)
      if (temporal) rmSync(temporal, { recursive: true, force: true })
    })

    test('enseña qué hacer con el reloj en marcha y la terminal plegada', async () => {
      await expect(modal.locator('.cuentas-login-titulo')).toHaveText(t.autorice)
      await expect(modal.locator('.cuentas-login-ayuda')).toHaveCount(0)
      expect((await modal.locator('.cuentas-login-plegable').boundingBox())?.height ?? 0, 'plegada').toBeLessThan(1)
      await expect(modal.locator('li[data-paso="activo"]')).toHaveCount(1)
      const antes = await modal.locator('.cuentas-login-reloj').textContent()
      await s.win.clock.fastForward(3000)
      await expect(modal.locator('.cuentas-login-reloj')).not.toHaveText(antes ?? '')
    })

    test('a la ventana mínima y en una grande, nada desborda', async () => {
      for (const [ancho, alto, nombre] of [[900, 620, 'minima'], [1600, 1000, 'grande']] as const) {
        await s.app.evaluate(({ BrowserWindow }, [a, h]) => BrowserWindow.getAllWindows()[0].setSize(a, h), [ancho, alto])
        await s.win.waitForTimeout(400)
        await sinDesbordes(modal)
        await capturar(nombre)
      }
      await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620))
      await s.win.waitForTimeout(400)
    })

    test('al minuto ofrece la ayuda, sin mover lo demás de sitio', async () => {
      const titulo = await modal.locator('.cuentas-login-titulo').boundingBox()
      await s.win.clock.fastForward(61_000)
      await expect(modal.locator('.cuentas-login-ayuda')).toContainText(t.ayuda)
      await s.win.waitForTimeout(400)
      expect((await modal.locator('.cuentas-login-titulo').boundingBox())?.y, 'la ayuda tenía su sitio reservado').toBeCloseTo(titulo?.y ?? 0, 0)
      await sinDesbordes(modal)
      await capturar('ayuda')
    })

    test('la terminal se muestra con su enlace y se vuelve a plegar; en la ventana mínima también cabe', async () => {
      await modal.getByRole('button', { name: t.mostrar }).click()
      await s.win.waitForTimeout(500)
      expect((await modal.locator('.cuentas-login-plegable').boundingBox())?.height ?? 0, 'desplegada').toBeGreaterThan(100)
      await expect(modal.locator('.cuentas-login-ayuda'), 'con la terminal a la vista la ayuda sobra').toHaveCount(0)
      await sinDesbordes(modal)
      await capturar('terminal')
      await modal.getByRole('button', { name: t.ocultar }).click()
      await s.win.waitForTimeout(500)
      expect((await modal.locator('.cuentas-login-plegable').boundingBox())?.height ?? 0, 'plegada otra vez').toBeLessThan(1)
    })
  })
}
