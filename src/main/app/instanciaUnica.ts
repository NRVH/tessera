// =============================================================================
// Una sola Tessera viva, y que se VEA cuando vuelve: cerrojo de instancia única,
// atención a la segunda instancia (con sus rutas) y la escalera que trae la ventana
// al frente, sobre todo al arrancar tras una actualización.
// Depende de `electron`, de `primerPlanoPuro.ts` (decide cada empujón) y de `logUpdate`.
// Decisiones: docs/decisiones/app/arranque-relevo-e-instancia-unica.md,
//   docs/decisiones/app/ventana-arranque-y-recuperacion.md
// =============================================================================

import { app, BrowserWindow } from 'electron'
import { logUpdate } from '../update/logUpdate'
import { PRIMER_PLANO, decidirIntentoPrimerPlano } from './primerPlanoPuro'
import { FLAG_ACTUALIZADO, rutasDesdeArgv } from '../../shared/rutasDesdeArgv'
import { esMac } from '../../shared/plataforma'

// La bandera `--updated` que el instalador NSIS pasa tras un update vive en
// `shared/rutasDesdeArgv.ts`: allí hace falta para NO confundirla con una ruta que el
// Explorador entrega, y tenerla escrita dos veces era la forma más barata de que un
// renombrado futuro rompiera uno de los dos lados en silencio.

/** Cuántas veces se reintenta el cerrojo cuando nos lanzó el instalador (ver abajo). */
const REINTENTOS_TRAS_UPDATE = 3
/** Espera entre reintentos. 3 × 400 ms = 1,2 s en el peor caso, y sólo tras un update. */
const ESPERA_REINTENTO_MS = 400

/**
 * Espera BLOQUEANTE. Tiene que serlo: esto corre en la carga del módulo, antes de
 * `whenReady`, y no hay bucle de eventos al que ceder todavía.
 */
function esperarSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** ¿Este arranque lo hizo el instalador tras aplicar una actualización? */
export function esArranqueTrasActualizar(): boolean {
  return process.argv.includes(FLAG_ACTUALIZADO)
}

/**
 * Escalera de primer plano en marcha, o 0. Es un TOKEN y no un booleano porque las
 * limpiezas son cierres de su llamada: la de una escalera vieja (p. ej. el `closed`
 * de una ventana que ya no existe) no puede apagar la bandera de la que corre ahora.
 */
let escaleraEnMarcha = 0
let ultimaEscalera = 0
/**
 * Limpieza pendiente de la última escalera que SE RINDIÓ. Rendirse no suelta la
 * ventana del todo —deja el parpadeo, el `alwaysOnTop` y sus dos oyentes esperando a
 * que el usuario mire— pero sí libera el cerrojo, así que sin esta referencia la
 * siguiente llamada apilaba un segundo juego de oyentes y un segundo techo, y ese
 * techo huérfano podía apagar el `alwaysOnTop` en mitad de la escalera nueva: justo
 * el único mecanismo que Windows siempre concede.
 */
let soltarPendiente: (() => void) | null = null

/**
 * Trae la ventana al primer plano, insistiendo, y deja escrito cómo acabó.
 *
 * No es un empujón: es una escalera de reintentos con el `alwaysOnTop` ENCENDIDO
 * todo el rato (ver `primerPlanoPuro.ts`, que decide cada paso y está probado). Si
 * al agotar el presupuesto Windows sigue negando el foco, se admite y se pasa al
 * canal que el propio Windows ofrece para esto: `flashFrame`, que deja el botón de
 * la barra de tareas parpadeando hasta que el usuario mire.
 *
 * El `motivo` no es decorativo: es lo que hace que la línea del registro se pueda
 * leer meses después sin adivinar de qué arranque venía.
 */
export function traerAlFrente(win: BrowserWindow | null, motivo = 'sin motivo'): void {
  if (!win || win.isDestroyed()) return
  // Un `second-instance` a mitad de escalera no arranca una segunda: la que ya
  // corre hace exactamente el mismo trabajo, y su siguiente empujón (≤ 800 ms) ya
  // aprovechará los derechos que Windows acabe de conceder.
  if (escaleraEnMarcha !== 0) return
  // Una escalera anterior pudo rendirse y quedarse esperando el foco: se recoge su
  // estado ANTES de empezar, para no apilar oyentes ni techos (ver `soltarPendiente`).
  soltarPendiente?.()
  const idEscalera = ++ultimaEscalera
  escaleraEnMarcha = idEscalera

  const t0 = Date.now()
  let intento = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let techo: ReturnType<typeof setTimeout> | null = null

  const alEnfocar = (): void => {
    logUpdate(`primer plano (${motivo}): el usuario volvió a la ventana +${Date.now() - t0} ms después.`)
    soltarTodo()
  }

  /** Cierra la escalera. No toca el parpadeo: ese sigue vivo hasta que miren. */
  const cerrarEscalera = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (escaleraEnMarcha === idEscalera) escaleraEnMarcha = 0
  }

  /**
   * Devuelve la ventana a la normalidad. IDEMPOTENTE y por aquí pasan TODOS los
   * caminos de salida: sin esto, el riesgo del arreglo (una ventana clavada encima
   * de todo para siempre, o parpadeando sin fin) sería peor que el bug.
   */
  const soltarTodo = (): void => {
    cerrarEscalera()
    if (soltarPendiente === soltarTodo) soltarPendiente = null
    if (techo !== null) {
      clearTimeout(techo)
      techo = null
    }
    // Los dos oyentes se retiran SIEMPRE, también el `closed`: `traerAlFrente` se
    // llama una vez por cada intento de abrir Tessera, y un listener por llamada
    // acaba en el aviso de fuga de EventEmitter tras diez dobles clics.
    win.off('focus', alEnfocar)
    win.off('closed', soltarTodo)
    try {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(false)
        win.flashFrame(false)
      }
    } catch (err) {
      console.error('[tessera] no se pudo soltar el primer plano:', err)
    }
  }

  win.once('closed', soltarTodo)

  const paso = (): void => {
    timer = null
    const destruida = win.isDestroyed()
    const accion = decidirIntentoPrimerPlano({
      intento,
      transcurridoMs: Date.now() - t0,
      ventana: {
        visible: !destruida && win.isVisible(),
        enfocada: !destruida && win.isFocused(),
        minimizada: !destruida && win.isMinimized(),
        destruida
      },
      esperas: PRIMER_PLANO.ESPERAS_MS,
      presupuestoMs: PRIMER_PLANO.PRESUPUESTO_MS
    })

    if (accion.tipo === 'abandonar' || accion.tipo === 'conseguido') {
      logUpdate(`primer plano (${motivo}): ${accion.motivo}.`)
      soltarTodo()
      return
    }

    if (accion.tipo === 'rendirse') {
      logUpdate(
        `primer plano (${motivo}): DENEGADO por Windows, ${accion.motivo}; ` +
          `visible=${win.isVisible()} minimizada=${win.isMinimized()}. ` +
          'Se deja el botón de la barra de tareas parpadeando.'
      )
      // La escalera termina aquí, pero la ventana sigue esperando a que la miren:
      // se libera el cerrojo de la escalera y NO el resto. Lo que queda vivo (el
      // parpadeo, el techo y los dos oyentes) se deja anotado para que la siguiente
      // escalera lo recoja en vez de apilarse encima.
      cerrarEscalera()
      soltarPendiente = soltarTodo
      try {
        if (accion.parpadear) win.flashFrame(true)
      } catch (err) {
        console.error('[tessera] no se pudo hacer parpadear la ventana:', err)
      }
      win.once('focus', alEnfocar)
      // Techo del `alwaysOnTop`: pase lo que pase, la ventana deja de estar encima
      // de todo. Ver `TECHO_ENCIMA_MS`.
      techo = setTimeout(() => {
        techo = null
        try {
          if (!win.isDestroyed()) win.setAlwaysOnTop(false)
        } catch {
          /* la ventana se fue: no hay nada que soltar */
        }
      }, PRIMER_PLANO.TECHO_ENCIMA_MS)
      return
    }

    try {
      if (accion.restaurar) win.restore()
      if (accion.mostrar) win.show()
      // El nivel `'screen-saver'` sube por encima de OTRAS ventanas topmost (barras
      // de herramientas, overlays de Teams o del driver de vídeo). En Windows
      // degrada a topmost normal si el nivel no aplica; el coste es nulo porque
      // dura menos de tres segundos y se apaga con garantía.
      if (accion.fijarEncima) win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
      win.focus()
      // En macOS el primer plano SÍ se puede pedir: `app.focus({ steal: true })` trae la
      // APP al frente aunque otra lo esté. Es `@platform darwin`; en Windows no roba nada.
      // Va DESPUÉS de `win.focus()`, que solo enfoca la ventana dentro de la app: sin
      // esta, la ventana se enfoca y la app sigue detrás de las demás.
      if (esMac()) app.focus({ steal: true })
    } catch (err) {
      console.error('[tessera] no se pudo traer la ventana al frente:', err)
    }
    intento++
    timer = setTimeout(paso, accion.reintentarEnMs)
  }

  paso()
}

/**
 * Reclama el cerrojo de instancia única. Si otra Tessera ya lo tiene, ESTE proceso
 * muere aquí mismo y devuelve `false` (nunca llega a crear ventana ni a tocar
 * `userData`).
 *
 * Sale con `app.exit(0)`, NO con `app.quit()`, a propósito: `quit()` dispara nuestro
 * `before-quit` -> `iniciarCierre` (`cierre.ts`), que mata contenedores Docker y desmonta. Los de
 * la instancia BUENA. El duplicado tiene que evaporarse sin tocar nada.
 *
 * Debe llamarse en la carga del módulo, antes de `whenReady`.
 */
export function reclamarInstanciaUnica(): boolean {
  if (app.requestSingleInstanceLock()) return true

  // CARRERA CON EL PROCESO VIEJO, SÓLO TRAS UN UPDATE: el proceso viejo tarda en
  // soltar el cerrojo (su cierre no es rápido) y, si el instalador nos arranca antes,
  // rendirse aquí sería «actualizó y no se abrió». Se reintenta un poco. Acotado a
  // `--updated`: con un doble clic normal rendirse en el acto es lo correcto y esperar
  // haría que el clic se sintiera colgado. Cada intento fallido emite un
  // `second-instance` en la viva, que se trae al frente: inocuo y deseable.
  if (esArranqueTrasActualizar()) {
    for (let i = 1; i <= REINTENTOS_TRAS_UPDATE; i++) {
      esperarSync(ESPERA_REINTENTO_MS)
      if (app.requestSingleInstanceLock()) {
        logUpdate(`cerrojo obtenido al intento ${i} (la instancia vieja acababa de salir).`)
        return true
      }
    }
  }

  // AL REGISTRO Y NO SÓLO A LA CONSOLA: en la app empaquetada no hay consola, y
  // este `exit` es el camino más silencioso que existe —sin ventana, antes de
  // `whenReady`—. Si algún día vuelve a pasar que "actualizó y no se abrió", esta
  // línea es la diferencia entre saberlo y suponerlo.
  logUpdate(
    `ya hay una Tessera abierta; se le cede el turno y este proceso sale` +
      `${esArranqueTrasActualizar() ? ' (¡y este arranque venía de una actualización!)' : ''}.`
  )
  app.exit(0)
  return false
}

/**
 * Cuando alguien intenta abrir una segunda Tessera (doble clic en el icono, el
 * instalador tras un update, "Abrir con Tessera" desde el Explorador), esta instancia
 * se trae al frente. Sin esto el usuario pulsa el icono, no pasa NADA visible, y
 * concluye que la app está colgada.
 *
 * EL `argv` DE LA SEGUNDA INSTANCIA SE LEE. Es el único sitio
 * por el que puede llegar una ruta cuando Tessera YA está abierta —que es el caso
 * normal, no el raro—: sin esto, "Abrir con Tessera" sobre una carpeta se limitaría a
 * enfocar la ventana y la ruta se perdería sin dejar rastro.
 *
 * Las rutas se ENTREGAN, no se guardan aquí: la cola vive en `shell/aperturasPendientes`,
 * que es quien sabe si el renderer está listo para consumirlas. Este módulo tiene un
 * único trabajo —que haya una sola Tessera y que se vea— y mezclarle un almacén de
 * rutas lo convertiría en dos.
 */
export function atenderSegundaInstancia(
  getWin: () => BrowserWindow | null,
  alRecibirRutas?: (rutas: readonly string[]) => void
): void {
  app.on('second-instance', (_evento, argv) => {
    // ANTES de mirar la ventana: aunque estemos arrancando en frío y no haya ninguna,
    // la ruta no se puede perder. La cola la acepta en cualquier momento.
    const rutas = rutasDesdeArgv(argv)
    if (rutas.length > 0) {
      logUpdate(`la segunda instancia traía ${rutas.length} ruta(s) que abrir.`)
      alRecibirRutas?.(rutas)
    }
    const win = getWin()
    if (win === null) {
      // Todavía no hay ventana: estamos arrancando en frío. Se anota y la atiende
      // `atenderSegundaInstanciaPendiente` en cuanto la ventana pueda mostrarse.
      // Sin esta latch, el arranque en frío —que es JUSTO cuando el usuario vuelve
      // a pulsar el icono porque "no pasa nada"— se tragaba el aviso: el segundo
      // proceso moría y el primero no se enteraba.
      logUpdate('alguien intentó abrir Tessera mientras esta aún arrancaba; se atenderá al mostrar la ventana.')
      segundaInstanciaPendiente = true
      return
    }
    traerAlFrente(win, 'segunda instancia')
  })
}

/** ¿Alguien intentó abrir Tessera mientras esta aún no tenía ventana? */
let segundaInstanciaPendiente = false

/**
 * Atiende el intento de segunda instancia que llegó durante el arranque en frío.
 * Se llama desde `ready-to-show`, que es el primer momento en que traer la ventana
 * al frente significa algo. Consume la latch: sólo actúa una vez.
 */
export function atenderSegundaInstanciaPendiente(win: BrowserWindow | null): void {
  if (!segundaInstanciaPendiente) return
  segundaInstanciaPendiente = false
  // Se registra el CONSUMO de la latch, y no sólo el resultado: si la escalera del
  // arranque tras update ya está corriendo, `traerAlFrente` se autodescarta por la
  // guarda y no escribiría nada. Sin esta línea, "pulsé el icono tres veces y no pasó
  // nada" seguiría sin dejar rastro, que es la mitad del incidente que originó todo.
  logUpdate('se atiende el intento de abrir Tessera que llegó durante el arranque.')
  traerAlFrente(win, 'segunda instancia durante el arranque')
}
