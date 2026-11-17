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

async function shoot(ventana: BrowserWindow, dir: string, nombre: string): Promise<void> {
  const imagen = await ventana.webContents.capturePage()
  const archivo = join(dir, nombre)
  writeFileSync(archivo, imagen.toPNG())
  console.log(`[shot] guardado ${archivo}`)
}

/** Teclea en el xterm enfocado como el usuario: cada tecla hace la ida y vuelta por IPC. */
async function escribirTexto(ventana: BrowserWindow, texto: string): Promise<void> {
  const wc = ventana.webContents
  for (const ch of texto) {
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

/** Comprueba en el renderer que nadie expone la ruta del host (ni el DOM ni `obtenerRaiz`). */
async function verificarSinRutaHost(ventana: BrowserWindow): Promise<void> {
  const informe = (await ventana.webContents.executeJavaScript(`
      (async () => {
        const root = await window.tessera.files.obtenerRaiz()
        const domText = document.body.innerText
        const winPathRe = new RegExp(${JSON.stringify(patronRutaHost())}, 'i')
        return {
          rootKeys: Object.keys(root),
          rootName: root.nombre,
          domHasWinPath: winPathRe.test(domText)
        }
      })()
    `)) as { rootKeys: string[]; rootName: string; domHasWinPath: boolean }
  const raizLimpia = informe.rootKeys.length === 1 && informe.rootKeys[0] === 'nombre'
  console.log(`[shot] obtenerRaiz() -> keys=${JSON.stringify(informe.rootKeys)} nombre="${informe.rootName}"`)
  console.log(`[shot] (4) renderer NO recibe ruta de Windows: ` +
    `obtenerRaiz solo {nombre}=${raizLimpia ? 'PASS' : 'FAIL'}, ` +
    `DOM sin ruta host=${informe.domHasWinPath ? 'FAIL' : 'PASS'}`)
}

/** Evidencia del EDITOR (lee el host, no depende de Docker). */
async function evidenciaEditor(ventana: BrowserWindow, dir: string): Promise<void> {
  await esperar(1200) // el sidebar pide obtenerRaiz+listarDirectorio por IPC (fs del host)
  await shoot(ventana, dir, 'ui-editor-closed.png') // (3) estado por defecto: sin hueco central
  await verificarSinRutaHost(ventana)

  // (1)+(2) Clic en package.json del explorador: Monaco con contenido y resaltado.
  const abierto = await ventana.webContents.executeJavaScript(`
        (() => {
          const row = [...document.querySelectorAll('.tree-row')]
            .find(r => r.textContent.trim() === 'package.json')
          if (row) { row.click(); return true }
          return false
        })()
      `)
  console.log(`[shot] clic en package.json del explorador -> ${abierto ? 'encontrado' : 'NO encontrado'}`)
  await esperar(1500) // read() por IPC + Monaco crea el modelo y tokeniza
  await shoot(ventana, dir, 'ui-editor-open.png') // (2) columna central de Monaco con contenido

  // (6) Zoom global con el editor abierto.
  ventana.webContents.setZoomFactor(1.5)
  await esperar(1000)
  await shoot(ventana, dir, 'ui-editor-zoom-150.png')
  ventana.webContents.setZoomFactor(1.0)
  await esperar(600)

  // (3) Cerrar el archivo: la columna central desaparece.
  await ventana.webContents.executeJavaScript(
    "document.querySelector('.editor .panel-actions .btn')?.click()"
  )
  await esperar(700)
  await shoot(ventana, dir, 'ui-editor-reclosed.png')
}

/** Evidencia de la TERMINAL (necesita Docker). */
async function evidenciaTerminal(ventana: BrowserWindow, dir: string): Promise<void> {
  await esperar(7000) // checkDocker+ensureContainer+addProject+crearSesion + prompt de bash -il
  await escribirTexto(ventana, 'pwd')
  await esperar(500)
  await escribirTexto(ventana, 'ls -la')
  await esperar(900)
  await shoot(ventana, dir, 'ui-layout-100.png')

  // (6) Zoom global: escala todo el webFrame de forma uniforme.
  ventana.webContents.setZoomFactor(1.5)
  await esperar(1200)
  await shoot(ventana, dir, 'ui-zoom-150.png')
  ventana.webContents.setZoomFactor(1.0)
  await esperar(600)

  // (4) Recargar con el mismo sessionId: el shell se relanza, la sesión de la UI se mantiene.
  await ventana.webContents.executeJavaScript(
    "document.querySelector('.panel-actions .btn').click()"
  )
  await esperar(3500)
  await escribirTexto(ventana, 'pwd')
  await esperar(900)
  await shoot(ventana, dir, 'ui-reload.png')

  // (5) onExit: el usuario sale del shell y la UI lo refleja.
  await escribirTexto(ventana, 'exit')
  await esperar(1800)
  await shoot(ventana, dir, 'ui-exit.png')
}

/** Recorre la UI al terminar de cargar, captura y sale. */
export function ejecutarModoCaptura(ventana: BrowserWindow): void {
  const dir = process.env.TESSERA_SHOT_DIR ?? process.cwd()
  ventana.webContents.once('did-finish-load', () => {
    void (async (): Promise<void> => {
      await evidenciaEditor(ventana, dir)
      await evidenciaTerminal(ventana, dir)
      console.log('[shot] listo; cerrando')
      app.quit()
    })().catch((err) => {
      console.error('[shot] error:', err)
      app.exit(1)
    })
  })
}
