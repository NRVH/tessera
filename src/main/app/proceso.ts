// =============================================================================
// Lo que el proceso hace al CARGAR `index.ts`, antes de `whenReady`: decidir si es el
// relevo de una actualización o Tessera, aislar el `userData` de desarrollo, tomar el
// cerrojo de instancia única y escuchar las aperturas del sistema (un `.tessera` va al importar
// de la configuración y no a «Abrir con Tessera»). Y el blindaje contra
// excepciones no capturadas.
// Decisiones: docs/decisiones/app/arranque-relevo-e-instancia-unica.md
// =============================================================================
import { app, type BrowserWindow } from 'electron'
import { rutaEncargoRelevo } from '../relevo'
import { aislarUserDataEnDesarrollo } from './devUserData'
import { atenderSegundaInstancia, reclamarInstanciaUnica } from './instanciaUnica'
import { logCrash } from './crashLog'
import { logUpdate } from '../update/logUpdate'
import { rutasDesdeArgv, separarCopias } from '../../shared/rutasDesdeArgv'
import { encolarAperturas, hayRelevoEnMarcha } from '../shell/aperturasPendientes'
import { encolarCopias } from '../configuracion/copiasPendientes'
import { ARCHIVO_DESKTOP } from '../shell/escritorioLinux'
import { esLinux } from '../../shared/plataforma'
import { pideVentanaAgente } from '../../shared/ventana-agente-ipc'

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
  // En Linux el identificador de la ventana en Wayland sale del nombre del `.desktop`: con el
  // mismo que instala `shell/escritorioLinux.ts`, el lanzador asocia la ventana a esa entrada.
  if (esLinux()) app.setDesktopName(ARCHIVO_DESKTOP)
  // Se mira antes del cerrojo: si ya hay una Tessera viva, la ruta viaja en su `second-instance`.
  const rutasDelExplorador = rutasDesdeArgv(process.argv)
  // Una ventana de agente pedida desde la Jump List arranca desde la carpeta de instalación igual que una ruta.
  if ((rutasDelExplorador.length > 0 || pideVentanaAgente(process.argv)) && hayRelevoEnMarcha()) {
    logUpdate(
      'llegó una apertura desde el sistema con una actualización en vuelo; ' +
        'este proceso sale para no bloquear la carpeta de instalación.'
    )
    app.exit(0)
  }
  // Si ya hay una Tessera viva, este proceso muere aquí y la viva se trae al frente.
  reclamarInstanciaUnica()
  repartirRutas(rutasDelExplorador)
  // Al cargar y no en `whenReady`: el usuario vuelve a pulsar el icono justo en el arranque en frío.
  atenderSegundaInstancia(ventana, repartirRutas)
  // macOS entrega las aperturas por Apple Event, y la del arranque en frío llega antes de `ready`.
  app.on('open-file', (event, ruta) => {
    event.preventDefault()
    repartirRutas([ruta])
  })
}

/** Un `.tessera` va al importar de la configuración; lo demás, a «Abrir con Tessera». */
function repartirRutas(rutas: readonly string[]): void {
  const { aperturas, copias } = separarCopias(rutas)
  if (aperturas.length > 0) encolarAperturas(aperturas)
  if (copias.length > 0) encolarCopias(copias)
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
