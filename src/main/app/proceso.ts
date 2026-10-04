// =============================================================================
// Lo que el proceso hace al CARGAR `index.ts`, antes de `whenReady`: decidir si es el
// relevo de una actualización o Tessera, aislar el `userData` de desarrollo, tomar el
// cerrojo de instancia única y escuchar las aperturas del sistema. Y el blindaje contra
// excepciones no capturadas.
// Decisiones: docs/decisiones/app/arranque-relevo-e-instancia-unica.md
// =============================================================================
import { app, type BrowserWindow } from 'electron'
import { rutaEncargoRelevo } from '../relevo'
import { aislarUserDataEnDesarrollo } from './devUserData'
import { atenderSegundaInstancia, reclamarInstanciaUnica } from './instanciaUnica'
import { logCrash } from './crashLog'
import { logUpdate } from '../update/logUpdate'
import { rutasDesdeArgv } from '../../shared/rutasDesdeArgv'
import { encolarAperturas, hayRelevoEnMarcha } from '../shell/aperturasPendientes'

/**
 * Prepara el proceso al cargar el módulo. Devuelve el encargo del relevo (o `null` si
 * este proceso es Tessera). `ventana` se lee al atender, no ahora: todavía no existe.
 */
export function prepararProceso(ventana: () => BrowserWindow | null): string | null {
  const encargoRelevo = rutaEncargoRelevo()
  // Antes del primer `getPath('userData')`: tras `ready` reapuntarlo ya no sirve.
  aislarUserDataEnDesarrollo()
  if (encargoRelevo !== null) {
    // Sin cerrojo y con su propio perfil de Chromium (ver la decisión).
    app.setPath('userData', `${app.getPath('userData')}-relevo`)
  } else {
    prepararTessera(ventana)
  }
  return encargoRelevo
}

function prepararTessera(ventana: () => BrowserWindow | null): void {
  // Tiene que ir antes de crear la ventana; `.dev` separa la de desarrollo en la barra de tareas.
  app.setAppUserModelId(app.isPackaged ? 'com.noe.tessera' : 'com.noe.tessera.dev')
  // Se mira antes del cerrojo: si ya hay una Tessera viva, la ruta viaja en su `second-instance`.
  const rutasDelExplorador = rutasDesdeArgv(process.argv)
  if (rutasDelExplorador.length > 0 && hayRelevoEnMarcha()) {
    logUpdate(
      'llegó una apertura desde el Explorador con una actualización en vuelo; ' +
        'este proceso sale para no bloquear la carpeta de instalación.'
    )
    app.exit(0)
  }
  // Si ya hay una Tessera viva, este proceso muere aquí y la viva se trae al frente.
  reclamarInstanciaUnica()
  if (rutasDelExplorador.length > 0) encolarAperturas(rutasDelExplorador)
  // Al cargar y no en `whenReady`: el usuario vuelve a pulsar el icono justo en el arranque en frío.
  atenderSegundaInstancia(ventana, encolarAperturas)
  // macOS entrega las aperturas por Apple Event, y la del arranque en frío llega antes de `ready`.
  app.on('open-file', (event, ruta) => {
    event.preventDefault()
    encolarAperturas([ruta])
  })
}

/**
 * Una excepción o una promesa sin capturar en el main no tumban la app: quedan en el
 * registro de fallos y la app sigue viva para guardar y cerrar en orden.
 */
export function blindarProceso(): void {
  process.on('uncaughtException', (err, origin) => {
    console.error(`[tessera] EXCEPCIÓN NO CAPTURADA (${origin}) — la app sigue viva:`, err)
    logCrash(`uncaughtException (${origin})`, err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[tessera] PROMESA RECHAZADA sin catch — la app sigue viva:', reason)
    logCrash('unhandledRejection', reason)
  })
}
