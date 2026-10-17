// =============================================================================
// El visor de audio y vídeo sobre la app empaquetada: un .wav abre en un <audio> que el
// Chromium de la app decodifica (lo que prueba también que la CSP deja pasar el Blob), y un
// .mp4 que no es vídeo enseña el aviso de formato no reproducible en vez de un reproductor mudo.
// El diálogo de carpeta se sustituye en el main, como en `atajos.spec.ts`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

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
    proyecto = mkdtempSync(join(tmpdir(), 'tessera-e2e-proy-'))
    writeFileSync(join(proyecto, 'aviso.wav'), wavDeSilencio())
    writeFileSync(join(proyecto, 'roto.mp4'), 'esto no es un vídeo', 'utf8')
    s = await abrirTessera()
    await s.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({
        canceled: false,
        filePaths: [dir]
      })
    }, proyecto)
    await s.win.locator('.project-tabs-empty-link').click()
  })
  test.afterAll(async () => {
    await s?.cerrar()
    if (proyecto) await borrarTemporal(proyecto)
  })

  test('un .wav se reproduce en su pestaña', async () => {
    await s.win.locator('.tree-row:visible').filter({ hasText: 'aviso.wav' }).first().click()
    const audio = s.win.locator('section[aria-label="Audio"]:not(.hidden) audio')
    await expect(audio).toHaveCount(1, { timeout: 30_000 })
    await expect
      .poll(() => audio.evaluate((el: HTMLAudioElement) => (el.error ? -1 : el.duration || 0)), {
        message: 'el navegador lee su duración: medio segundo'
      })
      .toBeCloseTo(0.5, 1)
  })

  test('un archivo que no se puede decodificar ofrece abrirlo con la app del sistema', async () => {
    await s.win.locator('.tree-row:visible').filter({ hasText: 'roto.mp4' }).first().click()
    const visor = s.win.locator('section[aria-label="Vídeo"]:not(.hidden)')
    await expect(visor.getByText('Este formato no se puede reproducir aquí', { exact: false })).toBeVisible({
      timeout: 30_000
    })
    await expect(visor.getByRole('button', { name: 'Abrir externamente' })).toBeVisible()
  })
})
