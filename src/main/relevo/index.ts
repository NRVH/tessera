// =============================================================================
// Modo relevo: el mismo binario de Tessera arrancado desde una COPIA en `%LOCALAPPDATA%` con el
// encargo en el argv, para aplicar la actualización cuando la Tessera de verdad ya no existe
// (un solo empaquetado que mantener, y la ventana con la paleta de la app). Raíz de composición
// propia: abre el registro, consume el encargo, pinta la ventana (`relevoUi.ts`) y ejecuta el
// supervisor (`supervisor.ts`). No arranca nada de la app: este proceso es su enterrador.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// Decisiones: docs/decisiones/app/arranque-relevo-e-instancia-unica.md
// =============================================================================

import { app, BrowserWindow, clipboard } from 'electron'
import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { encargoValido, rutaEncargoDesdeArgv, type EncargoRelevo } from '../../shared/relevo'
import { MARCA_ABRIR, MARCA_COPIAR, paginaRelevo, type EstadoRelevo } from './relevoUi'
import { crearLog, ejecutarRelevo } from './supervisor'

/** ¿Nos han arrancado como relevo? Devuelve la ruta del encargo, o null. */
export function rutaEncargoRelevo(): string | null {
  return rutaEncargoDesdeArgv(process.argv)
}

/**
 * Arranca la ventana del relevo y ejecuta el encargo. Solo devuelve el control
 * cuando el usuario cierra: a partir de aquí este proceso no hace nada más.
 */
export async function arrancarRelevo(rutaEncargo: string): Promise<void> {
  // EL REGISTRO SE ABRE ANTES DE LEER EL ENCARGO, y no después. Su ruta va DENTRO
  // del encargo, así que un encargo ilegible dejaba al relevo sin log — y ese es
  // justo el caso que hay que poder explicar: para cuando esto corre, la Tessera
  // que lo lanzó ya selló un intento contra el tope anti-bucle y se murió. "No se
  // instaló, se gastó un intento y no hay una sola línea en ningún sitio" es
  // literalmente el fallo mudo que este archivo vino a eliminar. La ruta se deriva
  // de la del encargo, que sí conocemos siempre.
  const log = crearLog(path.join(path.dirname(path.dirname(rutaEncargo)), 'relevo.log'))

  let encargo: EncargoRelevo | null = null
  try {
    const raw: unknown = JSON.parse(readFileSync(rutaEncargo, 'utf8'))
    if (encargoValido(raw)) encargo = raw
    else log(`el encargo ${rutaEncargo} no tiene la forma esperada; el relevo no puede seguir`)
  } catch (err) {
    log(`no se pudo leer el encargo ${rutaEncargo}: ${String(err)}`)
    encargo = null
  }
  if (encargo === null) {
    // Sin encargo no hay nada que supervisar. Se sale sin ventana (no sabríamos ni
    // qué versiones anunciar), pero ya NO en silencio: la línea de arriba queda
    // escrita. Tessera sigue instalada; su camino de respaldo se encarga.
    app.exit(0)
    return
  }

  log(`relevo arranca; ${encargo.versionActual} -> ${encargo.versionNueva}; padre=${encargo.pidPadre}`)
  // EL ENCARGO SE CONSUME. Mientras exista en disco, cualquier arranque que llegue a
  // este código lo tomaría por trabajo pendiente y volvería a instalar. Se borra en
  // cuanto está leído y validado: a partir de aquí vive en memoria.
  try {
    rmSync(rutaEncargo, { force: true })
  } catch {
    /* si no se puede borrar, el próximo `lanzarRelevo` lo pisa al escribir el suyo */
  }

  await app.whenReady()
  const win = new BrowserWindow({
    width: 520,
    // Alto pensado para el caso PEOR (fallo: título + explicación de tres líneas +
    // registro desplegado + botones), que es cuando la ventana de verdad tiene que
    // servir. Con 340 el registro no cabía y se recortaba a dos renglones.
    height: 440,
    resizable: false,
    minimizable: false,
    maximizable: false,
    // Sin menú y sin barra propia: es un diálogo, no una ventana de trabajo.
    autoHideMenuBar: true,
    backgroundColor: '#1b1d23',
    show: false,
    title: 'Actualizando Tessera',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  win.setMenu(null)
  win.once('ready-to-show', () => win.show())
  await win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(paginaRelevo(encargo.versionActual, encargo.versionNueva))
  )

  const lineas: string[] = []
  // Los pintados van ENCOLADOS. Cada uno es un `executeJavaScript` asíncrono, y
  // lanzarlos sueltos los dejaba competir: se vio en la primera prueba, con la
  // ventana enseñando dos renglones de registro mientras el archivo ya tenía seis —
  // un pintado anterior ganando la carrera al último. Como aquí lo que se promete es
  // justamente que la pantalla y el archivo digan LO MISMO, encolar no es pulcritud.
  let cola: Promise<unknown> = Promise.resolve()
  const pintar = (e: EstadoRelevo): void => {
    if (win.isDestroyed()) return
    const carga = JSON.stringify(e)
    cola = cola.then(() =>
      win.isDestroyed()
        ? undefined
        : win.webContents.executeJavaScript(`window.relevo.estado(${carga})`).catch(() => undefined)
    )
  }
  const avisar = (titulo: string, detalle: string, linea?: string): void => {
    if (linea) lineas.push(linea)
    pintar({ fase: 'instalando', titulo, detalle, log: lineas })
  }
  // El log de pantalla es el MISMO que el de disco: si el usuario nos lee un
  // renglón por teléfono, tiene que casar con el archivo, no ser un resumen aparte.
  const logDoble = (m: string): void => {
    log(m)
    lineas.push(m)
    if (!win.isDestroyed()) pintar({ fase: 'instalando', titulo: tituloActual, detalle: detalleActual, log: lineas })
  }
  let tituloActual = 'Cerrando Tessera…'
  let detalleActual = 'Esperando a que la aplicación termine de cerrarse.'
  const avisarYRecordar = (t: string, d: string): void => {
    tituloActual = t
    detalleActual = d
    avisar(t, d)
  }

  /**
   * Abre Tessera y se muere. El orden importa y la primera versión lo tenía mal:
   * llamaba a `shell.openPath` (que es ASÍNCRONO) y hacía `app.exit(0)` en la línea
   * siguiente, matando el proceso antes de que el lanzamiento llegara a ocurrir. El
   * botón "Abrir Tessera" cerraba la ventana y no abría nada — el mismo desenlace
   * que veníamos a arreglar, ahora con un botón de por medio.
   *
   * Se usa `spawn` en vez de `shell.openPath` porque hace falta control sobre el
   * proceso hijo: `detached` para que sobreviva a nuestra muerte, y `cwd` fuera de
   * la carpeta de instalación.
   */
  const abrirTessera = (): void => {
    log('el usuario pulsó Abrir Tessera')
    try {
      const hijo = spawn(encargo.exeApp, [], {
        detached: true,
        stdio: 'ignore',
        cwd: path.dirname(encargo.exeApp)
      })
      hijo.unref()
      log(`Tessera lanzada (pid ${hijo.pid ?? '?'})`)
    } catch (err) {
      // No se sale: si no arrancó, cerrar la ventana dejaría al usuario sin nada.
      // Se le dice, y el icono del escritorio sigue estando.
      log(`no se pudo lanzar Tessera: ${String(err)}`)
      lineas.push(`no se pudo abrir Tessera automáticamente: ${String(err)}`)
      pintar({
        fase: 'error',
        titulo: 'No se pudo abrir Tessera',
        detalle: 'Ábrela desde el icono del escritorio o el menú de inicio.',
        log: lineas
      })
      return
    }
    app.exit(0)
  }

  // Los dos botones avisan por consola (`location.hash` no funciona en una URL `data:`;
  // ver el ADR del relevo de Windows). El mensaje se lee del OBJETO del
  // evento: los argumentos posicionales (nivel, mensaje…) están deprecados desde
  // Electron 35, y el día que los retiren estos dos botones dejarían de hacer nada sin
  // dar ningún error, justo en la ventana que sólo se ve durante una actualización.
  win.webContents.on('console-message', (e) => {
    if (e.message === MARCA_ABRIR) abrirTessera()
    else if (e.message === MARCA_COPIAR) clipboard.writeText(lineas.join('\n'))
  })

  const veredicto = await ejecutarRelevo(encargo, avisarYRecordar, logDoble)
  // A `lineas` y a disco, pero SIN pintar aquí: el pintado definitivo va justo
  // debajo y ya lleva el registro completo. Iba solo a disco, de modo que la última
  // línea —la que dice cómo acabó— era la única que el usuario no podía leer.
  const resumen = `veredicto: ${veredicto.ok ? 'OK' : 'FALLO'} — ${veredicto.titulo}`
  log(resumen)
  lineas.push(resumen)
  pintar({
    fase: veredicto.ok ? 'ok' : 'error',
    titulo: veredicto.titulo,
    detalle: veredicto.detalle || 'Ya puedes abrir Tessera.',
    log: lineas
  })
  // A partir de aquí manda el usuario: el proceso vive hasta que pulse Abrir o
  // cierre la ventana. Es lo que convierte un fallo mudo en un fallo que se lee.
}
