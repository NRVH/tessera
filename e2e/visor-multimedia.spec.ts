// =============================================================================
// El visor de audio y vídeo sobre la app empaquetada: un .wav abre en un <audio> que el
// Chromium de la app decodifica (lo que prueba también que la CSP deja pasar el Blob), y un
// .mp4 que no es vídeo enseña el aviso de formato no reproducible en vez de un reproductor mudo.
// La cabecera de los visores conserva sus botones con un aviso largo y el divisor al tope.
// El diálogo de carpeta se sustituye en el main, como en `atajos.spec.ts`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { crearTemporal } from './temporales'
import { expect, test, type Locator } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

const ERROR_APERTURA = 'El sistema rechazó la apertura del archivo. '.repeat(12).trimEnd()
const AVISO_APERTURA = `No se pudo abrir con la aplicación predeterminada del sistema: ${ERROR_APERTURA}`

async function comprobarCabecera(cabecera: Locator): Promise<number[]> {
  await expect(cabecera).toBeVisible()
  const geometria = await cabecera.evaluate((nodo) => {
    const cabecera = nodo.getBoundingClientRect()
    const botones = Array.from(nodo.querySelectorAll('button'), (boton) => boton.getBoundingClientRect())
    return {
      desborde: nodo.scrollWidth - nodo.clientWidth,
      todosDentro: botones.every((boton) => boton.left >= cabecera.left && boton.right <= cabecera.right &&
        boton.top >= cabecera.top && boton.bottom <= cabecera.bottom),
      anchos: botones.map((boton) => boton.width)
    }
  })
  expect(geometria.desborde).toBe(0)
  expect(geometria.todosDentro).toBe(true)
  expect(geometria.anchos.length).toBeGreaterThanOrEqual(3)
  return geometria.anchos
}

/** Un WAV PCM de 16 bits, mono, a 8 kHz y medio segundo de silencio. */
function wavDeSilencio(): Buffer {
  const muestras = 4000
  const datos = muestras * 2
  const b = Buffer.alloc(44 + datos)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + datos, 4)
  b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(1, 22) // mono
  b.writeUInt32LE(8000, 24)
  b.writeUInt32LE(8000 * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(datos, 40)
  return b
}

test.describe('visor de audio y vídeo', () => {
  let s: SesionTessera
  let proyecto: string

  test.beforeAll(async () => {
    proyecto = crearTemporal(join(tmpdir(), 'tessera-e2e-proy-'))
    writeFileSync(join(proyecto, 'aviso.wav'), wavDeSilencio())
    writeFileSync(join(proyecto, 'roto.mp4'), 'esto no es un vídeo', 'utf8')
    writeFileSync(join(proyecto, 'figura.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>')
    s = await abrirTessera({ TESSERA_E2E_ERROR_APERTURA: ERROR_APERTURA })
    await s.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({
        canceled: false,
        filePaths: [dir]
      })
    }, proyecto)
    await s.ventana.locator('.project-tabs-empty-link').click()
  })
  test.afterAll(async () => {
    await s?.cerrar()
    if (proyecto) await borrarTemporal(proyecto)
  })

  test('un .wav se reproduce en su pestaña', async () => {
    await s.ventana.locator('.tree-row:visible').filter({ hasText: 'aviso.wav' }).first().click()
    const audio = s.ventana.locator('section[aria-label="Audio"]:not(.hidden) audio')
    await expect(audio).toHaveCount(1, { timeout: 30_000 })
    await expect
      .poll(() => audio.evaluate((el: HTMLAudioElement) => (el.error ? -1 : el.duration || 0)), {
        message: 'el navegador lee su duración: medio segundo'
      })
      .toBeCloseTo(0.5, 1)
  })

  test('un archivo que no se puede decodificar ofrece abrirlo con la app del sistema', async () => {
    await s.ventana.locator('.tree-row:visible').filter({ hasText: 'roto.mp4' }).first().click()
    const visor = s.ventana.locator('section[aria-label="Vídeo"]:not(.hidden)')
    await expect(visor.getByText('Este formato no se puede reproducir aquí', { exact: false })).toBeVisible({
      timeout: 30_000
    })
    await expect(visor.getByRole('button', { name: 'Abrir externamente' })).toBeVisible()
  })

  test('el aviso cede a los botones en la ventana y el editor estrechos', async () => {
    const ventana = s.ventana
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize())
    await expect.poll(() => s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false)
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 700))

    const casos = [
      { nombre: 'aviso.wav', selector: 'section[aria-label="Audio"]:not(.hidden)' },
      { nombre: 'figura.svg', selector: 'section.image-viewer:not(.hidden)' }
    ]
    const abrir = async (nombre: string): Promise<void> => {
      await ventana.locator('.tree-row:visible').filter({ hasText: nombre }).first().click()
    }
    const anchos: number[][] = []
    for (const { nombre, selector } of casos) {
      await abrir(nombre)
      const cabecera = ventana.locator(selector).locator('.editor-header')
      await cabecera.getByRole('button', { name: 'Abrir externamente' }).click()
      await expect(cabecera.locator('.editor-notice')).toHaveAttribute('title', AVISO_APERTURA)
      anchos.push(await comprobarCabecera(cabecera))
    }

    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620))
    await expect.poll(() => s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())).toEqual([900, 620])
    const divisor = ventana.locator('.splitter-agente:visible')
    await expect(divisor).toBeVisible()
    await expect
      .poll(
        async () => {
          const [actual, maximo] = await divisor.evaluate((el) => [
            el.getAttribute('aria-valuenow'),
            el.getAttribute('aria-valuemax')
          ])
          if (actual !== null && maximo !== null && actual === maximo) return true
          await divisor.press('ArrowLeft')
          return false
        },
        { intervals: [50], timeout: 15_000 }
      )
      .toBe(true)

    for (const [indice, { nombre, selector }] of casos.entries()) {
      await abrir(nombre)
      const cabecera = ventana.locator(selector).locator('.editor-header')
      const aviso = cabecera.locator('.editor-notice')
      await expect(aviso).toHaveAttribute('title', AVISO_APERTURA)
      expect(await aviso.evaluate((nodo) => nodo.scrollWidth > nodo.clientWidth)).toBe(true)
      expect(await comprobarCabecera(cabecera)).toEqual(anchos[indice])
    }
  })
})
