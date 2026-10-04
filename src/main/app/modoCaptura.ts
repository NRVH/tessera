// =============================================================================
// Modo captura, solo de desarrollo (`TESSERA_SHOT=1`): recorre la UI real, guarda
// capturas en `TESSERA_SHOT_DIR` (o el cwd) y sale. Evidencia visual del layout, del
// editor, de la terminal y del zoom; no afecta a la app normal.
// =============================================================================
import { app, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { esperar } from '../util/esperas'
import { tramosDelHost } from '../sandbox/centinelaHost'

/** ¿Arrancó en modo captura? */
export const MODO_CAPTURA = process.env.TESSERA_SHOT === '1'

async function shoot(window: BrowserWindow, dir: string, name: string): Promise<void> {
  const img = await window.webContents.capturePage()
  const file = join(dir, name)
  writeFileSync(file, img.toPNG())
  console.log(`[shot] guardado ${file}`)
}

/** Teclea en el xterm enfocado como el usuario: cada tecla hace la ida y vuelta por IPC. */
async function type(window: BrowserWindow, text: string): Promise<void> {
  const wc = window.webContents
  for (const ch of text) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: ch })
    wc.sendInputEvent({ type: 'char', keyCode: ch })
    wc.sendInputEvent({ type: 'keyUp', keyCode: ch })
    await esperar(30)
  }
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  wc.sendInputEvent({ type: 'char', keyCode: '\r' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
}

/**
 * Lo que delata una ruta del host en el DOM: una letra de unidad, el montaje `/mnt/host/` o un
 * tramo de la ruta real de la app (o el usuario) pegado a una barra. Se calcula aquí, en el main.
 */
function patronRutaHost(): string {
  const escapar = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tramos = tramosDelHost(app.getAppPath(), ['tessera']).map(escapar)
  const partes = ['[A-Za-z]:\\\\', '/mnt/host/']
  if (tramos.length > 0) partes.push(`[\\\\/](?:${tramos.join('|')})`)
  return partes.join('|')
}

/** Comprueba en el renderer que nadie expone la ruta del host (ni el DOM ni `getRoot`). */
async function assertNoHostPath(window: BrowserWindow): Promise<void> {
  const report = (await window.webContents.executeJavaScript(`
      (async () => {
        const root = await window.tessera.files.getRoot()
        const domText = document.body.innerText
        const winPathRe = new RegExp(${JSON.stringify(patronRutaHost())}, 'i')
        return {
          rootKeys: Object.keys(root),
          rootName: root.name,
          domHasWinPath: winPathRe.test(domText)
        }
      })()
    `)) as { rootKeys: string[]; rootName: string; domHasWinPath: boolean }
  const rootClean = report.rootKeys.length === 1 && report.rootKeys[0] === 'name'
  console.log(`[shot] getRoot() -> keys=${JSON.stringify(report.rootKeys)} name="${report.rootName}"`)
  console.log(`[shot] (4) renderer NO recibe ruta de Windows: ` +
    `getRoot solo {name}=${rootClean ? 'PASS' : 'FAIL'}, ` +
    `DOM sin ruta host=${report.domHasWinPath ? 'FAIL' : 'PASS'}`)
}

/** Evidencia del EDITOR (lee el host, no depende de Docker). */
async function evidenciaEditor(window: BrowserWindow, dir: string): Promise<void> {
  await esperar(1200) // el sidebar pide getRoot+listDir por IPC (fs del host)
  await shoot(window, dir, 'ui-editor-closed.png') // (3) estado por defecto: sin hueco central
  await assertNoHostPath(window)

  // (1)+(2) Clic en package.json del explorador: Monaco con contenido y resaltado.
  const opened = await window.webContents.executeJavaScript(`
        (() => {
          const row = [...document.querySelectorAll('.tree-row')]
            .find(r => r.textContent.trim() === 'package.json')
          if (row) { row.click(); return true }
          return false
        })()
      `)
  console.log(`[shot] clic en package.json del explorador -> ${opened ? 'encontrado' : 'NO encontrado'}`)
  await esperar(1500) // read() por IPC + Monaco crea el modelo y tokeniza
  await shoot(window, dir, 'ui-editor-open.png') // (2) columna central de Monaco con contenido

  // (6) Zoom global con el editor abierto.
  window.webContents.setZoomFactor(1.5)
  await esperar(1000)
  await shoot(window, dir, 'ui-editor-zoom-150.png')
  window.webContents.setZoomFactor(1.0)
  await esperar(600)

  // (3) Cerrar el archivo: la columna central desaparece.
  await window.webContents.executeJavaScript(
    "document.querySelector('.editor .panel-actions .btn')?.click()"
  )
  await esperar(700)
  await shoot(window, dir, 'ui-editor-reclosed.png')
}

/** Evidencia de la TERMINAL (necesita Docker). */
async function evidenciaTerminal(window: BrowserWindow, dir: string): Promise<void> {
  await esperar(7000) // checkDocker+ensureContainer+addProject+createSession + prompt de bash -il
  await type(window, 'pwd')
  await esperar(500)
  await type(window, 'ls -la')
  await esperar(900)
  await shoot(window, dir, 'ui-layout-100.png')

  // (6) Zoom global: escala todo el webFrame de forma uniforme.
  window.webContents.setZoomFactor(1.5)
  await esperar(1200)
  await shoot(window, dir, 'ui-zoom-150.png')
  window.webContents.setZoomFactor(1.0)
  await esperar(600)

  // (4) Recargar con el mismo sessionId: el shell se relanza, la sesión de la UI se mantiene.
  await window.webContents.executeJavaScript(
    "document.querySelector('.panel-actions .btn').click()"
  )
  await esperar(3500)
  await type(window, 'pwd')
  await esperar(900)
  await shoot(window, dir, 'ui-reload.png')

  // (5) onExit: el usuario sale del shell y la UI lo refleja.
  await type(window, 'exit')
  await esperar(1800)
  await shoot(window, dir, 'ui-exit.png')
}

/** Recorre la UI al terminar de cargar, captura y sale. */
export function runShotMode(window: BrowserWindow): void {
  const dir = process.env.TESSERA_SHOT_DIR ?? process.cwd()
  window.webContents.once('did-finish-load', () => {
    void (async (): Promise<void> => {
      await evidenciaEditor(window, dir)
      await evidenciaTerminal(window, dir)
      console.log('[shot] listo; cerrando')
      app.quit()
    })().catch((err) => {
      console.error('[shot] error:', err)
      app.exit(1)
    })
  })
}
