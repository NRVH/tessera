// =============================================================================
// Arnés de las pruebas de interfaz: arranca la Tessera EMPAQUETADA (`dist/`) con un
// `userData` temporal, las cuentas de agente y los registros de versiones aislados, y
// expone `PLATAFORMA` para que cada spec salte o parametrice lo propio de un sistema.
// Lo que va aquí y no en un `test-*.mts` lo decide el ADR de reparto, en la misma carpeta.
// Depende de `@playwright/test` (`_electron`), de `shared/plataforma.ts` y de la marca del arnés
// (`ARG_ARNES_E2E`, en `main/ssh/binariosSsh.ts`).
// Decisiones: docs/decisiones/pruebas/arnes-e2e-sobre-la-app-empaquetada.md
// =============================================================================

import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { plataformaDe, type Plataforma } from '../src/shared/plataforma.ts'
import { ARG_ARNES_E2E } from '../src/main/ssh/binariosSsh.ts'

/**
 * La plataforma de las pruebas, que es también la del paquete que arrancan:
 * electron-builder no cruza de sistema, así que lo que hay en `dist/` es siempre de
 * esta máquina. Los specs la consultan para saltarse o parametrizar lo que sólo
 * tiene sentido en un sistema, y así `grep PLATAFORMA` lista todo lo bifurcado.
 */
export const PLATAFORMA: Plataforma = plataformaDe(process.platform)

/**
 * El ejecutable de la app EMPAQUETADA en cada plataforma, o `null` donde Tessera no
 * se empaqueta. En Windows lo produce `npm run pack:dir` (la carpeta `win-unpacked`,
 * sin instalador); en Mac, `npm run build:mac` o `npm run pack:mac:dir`.
 *
 * Se resuelve desde `process.cwd()` y no desde la carpeta del módulo: Playwright
 * transpila estos `.ts` a CommonJS (el `package.json` del repo no es `type: module`),
 * así que `import.meta` no existe aquí, y su `cwd` es siempre la raíz del proyecto.
 *
 * La plataforma entra por PARÁMETRO, con la actual por defecto (la plataforma es un parámetro).
 */
export function rutaAppEmpaquetada(plataforma: Plataforma = PLATAFORMA): string | null {
  const dist = resolve(process.cwd(), 'dist')
  if (plataforma === 'windows') return join(dist, 'win-unpacked', 'Tessera.exe')
  if (plataforma === 'mac') {
    return join(dist, 'mac-arm64', 'Tessera.app', 'Contents', 'MacOS', 'Tessera')
  }
  return null
}

/** El comando que genera ese paquete, para que el error diga qué hacer. */
function comandoParaEmpaquetar(plataforma: Plataforma): string {
  return plataforma === 'windows'
    ? '`npm run pack:dir`'
    : '`npm run build:mac` (o `npm run pack:mac:dir`, más rápido, si no hace falta el .dmg)'
}

/**
 * Borra un temporal de una prueba, reintentando mientras Windows lo tenga bloqueado.
 *
 * EN WINDOWS NO SE PUEDE BORRAR UNA CARPETA QUE ALGUIEN TIENE ABIERTA, y al cerrar la
 * app quedan unos instantes procesos que la usan como directorio de trabajo o la
 * vigilan (la shell de la terminal, `conpty`, el `fs.watch` del árbol). Un borrado a
 * pelo falla entonces con `EBUSY`, y ese error se le apunta a la ÚLTIMA prueba del
 * archivo, que no tiene culpa de nada: así cayeron tres en la primera pasada en Windows.
 * En Mac no pasa, porque allí se puede borrar lo que otro tiene abierto.
 *
 * Los reintentos son los de `fs.rm` (`maxRetries`), que sólo reintenta los errores de
 * BLOQUEO (EBUSY, EPERM, ENOTEMPTY…) con una espera que crece en cada intento (hasta
 * ~11 s en total): un error permanente sale a la primera en vez de quemar esa espera
 * en cada cierre. Si aun así sigue ocupada se deja estar, avisando: es un temporal del
 * sistema, y tapar con esto el resultado real de la prueba sería peor.
 */
export async function borrarTemporal(ruta: string): Promise<void> {
  try {
    await rm(ruta, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (err) {
    console.warn(`[e2e] no se pudo borrar el temporal ${ruta} (${String(err)}); se deja al sistema`)
  }
}

/**
 * Dónde pone `abrirTessera` las carpetas de configuración de los CLIs de esta prueba
 * (`CLAUDE_CONFIG_DIR` y `CODEX_HOME`): dentro del `userData` temporal, así que se
 * borran con él. Es función de `datos` para que `sembrar` pueda escribir en ellas
 * (transcripts que reanudar, por ejemplo) ANTES de arrancar.
 */
export function carpetasAgentes(datos: string): { claude: string; codex: string } {
  return { claude: join(datos, 'e2e-agentes', 'claude'), codex: join(datos, 'e2e-agentes', 'codex') }
}

/**
 * Base de los registros de versiones cuando el spec no trae los suyos. El puerto 9
 * (`discard`) está en la lista de puertos vetados de Chromium: `net.fetch` falla al
 * instante sin salir del equipo, y aunque dejara de estarlo, en `127.0.0.1` no escucha
 * nadie. Para el botón de los agentes es «sin red»: sin punto y sin avisos.
 */
export const REGISTRO_INALCANZABLE = 'http://127.0.0.1:9'

/**
 * A partir de cuánto un cierre se considera lento y `cerrar` imprime el `cierre.log`
 * de la app antes de borrar el temporal. Son los 5 s del tope que el cierre pone a sus
 * esperas de disco (`TOPE_VACIAR_CONSOLAS_MS` y `TOPE_WORKSPACE_MS`, en
 * `main/util/registroCierre.ts`): un cierre sano de una
 * prueba sin contenedores no llega ni a eso.
 */
const UMBRAL_CIERRE_LENTO_MS = 5_000

/**
 * Tope del cierre de una prueba, por DEBAJO de los 120 s del hook que lo llama. Sin él, un
 * cierre colgado (pasó dos veces en `capturas-app`) agotaba el plazo del `afterAll` dentro de
 * `app.close()`: Playwright abandonaba el hook antes de llegar a imprimir el `cierre.log`, y el
 * único rastro de en qué etapa se quedó se borraba con el temporal. Ninguna prueba usa
 * contenedores; aun así el cierre pasa por Docker (`docker ps`, el desmontaje y la
 * verificación), y cada llamada a `docker` puede esperar hasta 120 s si el motor no responde.
 */
const PLAZO_CIERRE_MS = 90_000

/**
 * `app.close()` con tope. Si vence, mata el árbol de procesos de la app (para que el temporal
 * se pueda borrar y la prueba siguiente no herede nada) y devuelve `true`.
 */
async function cerrarConTope(app: ElectronApplication): Promise<boolean> {
  const cerrada = app.close().then(
    () => false,
    () => false
  )
  let reloj: ReturnType<typeof setTimeout> | undefined
  const vencida = new Promise<boolean>((r) => {
    reloj = setTimeout(() => r(true), PLAZO_CIERRE_MS)
  })
  const colgado = await Promise.race([cerrada, vencida])
  clearTimeout(reloj)
  if (!colgado) return false
  const pid = app.process().pid
  try {
    if (pid !== undefined && PLATAFORMA === 'windows') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 15_000 })
    } else {
      app.process().kill('SIGKILL')
    }
  } catch (err) {
    console.warn(`[e2e] no se pudo matar la app colgada (pid ${pid}): ${String(err)}`)
  }
  // Con su propio tope: si ni muerta suelta Playwright el `close`, se sigue igual.
  await Promise.race([cerrada, new Promise((r) => setTimeout(r, 15_000))])
  return true
}

/**
 * UN CIERRE LENTO SE EXPLICA ANTES DE BORRAR SU EXPLICACIÓN. `beginShutdown` deja cada etapa
 * con su duración en `logs/cierre.log` (`util/registroCierre.ts`), y ese archivo vive DENTRO
 * del temporal que se borra justo después: sin esto, el único rastro de un cierre colgado
 * (pasó: 60 s parado tras `cerrarTodo`) se perdía con él. Se imprime sólo si el cierre pasa
 * del umbral, que es el tope que el propio cierre pone a sus esperas de disco: por debajo, no
 * hay nada que contar. Si además hubo que matar la app, la prueba queda en rojo.
 */
function explicarCierreLento(datos: string, ms: number, colgado: boolean): void {
  if (ms <= UMBRAL_CIERRE_LENTO_MS) return
  let log: string
  try {
    log = readFileSync(join(datos, 'logs', 'cierre.log'), 'utf8')
  } catch (err) {
    log = `(sin cierre.log: ${String(err)})`
  }
  console.warn(`[e2e] el cierre tardó ${ms} ms; logs/cierre.log de la app:\n${log}`)
  // `soft`: el rojo queda en el hook, pero el resto de su limpieza (el PostgreSQL de la
  // prueba, el temporal del agente falso) sigue corriendo.
  expect
    .soft(colgado, `el cierre no terminó en ${PLAZO_CIERRE_MS / 1000} s y se mató la app; logs/cierre.log:\n${log}`)
    .toBe(false)
}

export interface SesionTessera {
  app: ElectronApplication
  win: Page
  /** Carpeta temporal con el `userData` de esta prueba. */
  datos: string
  /** `CLAUDE_CONFIG_DIR` y `CODEX_HOME` de esta prueba (ver `carpetasAgentes`). */
  agentes: { claude: string; codex: string }
  cerrar: () => Promise<void>
}

export interface OpcionesArranque {
  /**
   * Argumentos EXTRA, detrás de `--user-data-dir`. El uso previsto es una RUTA DE
   * PROYECTO: es el camino de «Abrir con Tessera», y en macOS el `argv` lo trae cuando
   * se lanza el binario a mano (el Finder usa `open-file`, que Playwright no puede
   * disparar). Es la única forma de abrir un proyecto en una prueba sin diálogo nativo.
   */
  args?: string[]
  /**
   * Se llama con el `userData` recién creado y ANTES de arrancar la app. Para sembrar
   * `profiles.json` o un `workspace-state.json` de partida.
   */
  sembrar?: (datos: string) => void
}

/**
 * Arranca la app empaquetada con datos limpios y devuelve su ventana principal.
 *
 * @param env   Variables extra para el proceso (p. ej. `TESSERA_FAKE_UPDATE`).
 * @param opts  Argumentos extra y siembra del `userData` (ver `OpcionesArranque`).
 *
 * SE ESPERA A `domcontentloaded` Y NO A `load`: la ventana se muestra con
 * `ready-to-show` y el `load` completo depende de los workers de Monaco, que tardan
 * y no hacen falta para nada de lo que se comprueba aquí.
 */
export async function abrirTessera(
  env: Record<string, string> = {},
  opts: OpcionesArranque = {}
): Promise<SesionTessera> {
  const ruta = rutaAppEmpaquetada()
  if (ruta === null) {
    throw new Error(`Tessera no se empaqueta para esta plataforma (${process.platform}).`)
  }
  if (!existsSync(ruta)) {
    // Sin esto, Playwright falla con un ENOENT del `spawn` que no dice qué falta.
    throw new Error(
      `No existe la app empaquetada en ${ruta}. Estas pruebas corren contra el ` +
        `artefacto que se distribuye: genera uno con ${comandoParaEmpaquetar(PLATAFORMA)}.`
    )
  }
  const datos = mkdtempSync(join(tmpdir(), 'tessera-e2e-'))
  // Cuentas de los agentes aisladas (ver la cabecera). Claude, «instalado con su
  // instalador»: es lo que decide cómo se actualiza, y así ninguna prueba depende de
  // cómo lo tenga instalado quien las corre.
  const agentes = carpetasAgentes(datos)
  mkdirSync(agentes.claude, { recursive: true })
  mkdirSync(agentes.codex, { recursive: true })
  writeFileSync(join(agentes.claude, '.claude.json'), JSON.stringify({ installMethod: 'native' }))
  opts.sembrar?.(datos)
  // `ELECTRON_RUN_AS_NODE` FUERA, venga de donde venga. Si se cuela en el entorno de
  // quien lanza las pruebas (lo usan `tdb` y sus atajos), el ejecutable arranca como
  // Node y no como app: la prueba muere esperando una ventana que nunca llega, con un
  // timeout que no dice por qué.
  // Lo aislado va ANTES de `env`: un spec que traiga su registro o sus cuentas manda.
  // La hibernación por inactividad va APAGADA: con sus 5 minutos de fábrica, una prueba
  // larga perdería un agente oculto y pintaría un aviso encima de lo que mide. La enciende,
  // con un umbral corto, solo el spec que la prueba (`autohibernacion.spec.ts`).
  const entorno = {
    ...process.env,
    CLAUDE_CONFIG_DIR: agentes.claude,
    CODEX_HOME: agentes.codex,
    TESSERA_REGISTRO_NPM: `${REGISTRO_INALCANZABLE}/npm`,
    TESSERA_RELEASES_CLAUDE: `${REGISTRO_INALCANZABLE}/claude`,
    TESSERA_API_BREW: `${REGISTRO_INALCANZABLE}/brew`,
    TESSERA_AGENTE_INACTIVIDAD_MS: 'nunca',
    // El chequeo de actualizaciones de la PROPIA app, a un día: a los 8 s de fábrica fallaba
    // (el paquete de `pack:dir` no lleva `app-update.yml`) y el botón de la barra cambiaba de
    // icono a mitad de un spec, así que una captura dependía de lo rápida que fuera la máquina.
    // `actualizacion.spec.ts`, que sí lo prueba, lanza la app con su propio entorno.
    TESSERA_PRIMER_CHEQUEO_MS: String(24 * 60 * 60_000),
    // La PowerShell interactiva de la terminal nativa, sin perfil del usuario y sin escribir
    // en su historial real de PSReadLine (ver `shellNativoPara`). En Mac no hace nada.
    TESSERA_SHELL_AISLADA: '1',
    ...env
  } as Record<string, string>
  delete entorno.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: ruta,
    args: [`--user-data-dir=${datos}`, ARG_ARNES_E2E, ...(opts.args ?? [])], // sin la marca, nada de ssh falso
    env: entorno,
    timeout: 90_000
  })
  const win = await app.firstWindow({ timeout: 90_000 })
  await win.waitForLoadState('domcontentloaded')
  // La barra de título es lo primero que pinta el renderer; sin esperarla, una
  // prueba rápida puede consultar el DOM antes de que exista nada que consultar.
  await win.waitForSelector('.titlebar', { timeout: 30_000 })

  const cerrar = async (): Promise<void> => {
    // RED DEL CIERRE, para TODA la suite. Cerrar pasa por el
    // diálogo NATIVO de salida del explorador de BD, que pregunta si hay transacciones
    // pendientes o cambios de la rejilla sin enviar. Una prueba que falle a medias deja
    // uno de los dos, y el diálogo real, que nadie pulsa, colgaba el cierre hasta el
    // plazo del hook (120 s) sin parar su PostgreSQL ni borrar el temporal. Antes de
    // cerrar se sustituye por uno que elige SALIR sin escribir nada (por el texto del
    // botón). Las pruebas que miden ese diálogo ponen el suyo y cierran por su cuenta:
    // cuando llegan aquí la app ya se cerró, y el `evaluate` falla sin más.
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBox = (async (...args: unknown[]) => {
          const o = args[args.length - 1] as { buttons?: string[] }
          const salir = (o.buttons ?? []).findIndex(
            (b) => b === 'Descartar y salir' || b === 'Revertir y salir' || b === 'Salir revirtiendo'
          )
          return { response: salir >= 0 ? salir : 0, checkboxChecked: false }
        }) as unknown as typeof dialog.showMessageBox
      })
      .catch(() => {})
    // `close()` y no `app.quit()`: el cierre normal de Tessera pasa por
    // `beginShutdown`, que apaga contenedores y puede tardar; estas pruebas no
    // levantan ninguno, pero el temporizador de cortesía sigue ahí.
    const t0 = Date.now()
    const colgado = await cerrarConTope(app)
    explicarCierreLento(datos, Date.now() - t0, colgado)
    await borrarTemporal(datos)
  }

  return { app, win, datos, agentes, cerrar }
}

/**
 * El modificador principal de esta plataforma para `page.keyboard`. En Mac es
 * `Meta` (⌘) y en el resto `Control`, que es la misma regla que `esModPrincipal`
 * aplica en el renderer — escrita aquí otra vez a propósito: si las dos se
 * desincronizan, la prueba falla, que es justo lo que tiene que pasar.
 */
export const MOD = PLATAFORMA === 'mac' ? 'Meta' : 'Control'

/** Nivel de zoom DISCRETO actual (el que persiste `workspace-state.json`). */
export async function zoomDe(win: Page): Promise<number> {
  return win.evaluate(() => window.tessera.zoom.getLevel())
}

/**
 * Fija el nivel de zoom por la MISMA vía que el usuario (la API del renderer, que es
 * lo que hay detrás de ⌘+/− y de la fila de Configuración) y espera un fotograma
 * para que el CSS y el semáforo se hayan recolocado antes de medir.
 */
export async function fijarZoom(win: Page, nivel: number): Promise<void> {
  await win.evaluate((n) => window.tessera.zoom.setLevel(n), nivel)
  await win.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  )
}

/**
 * Pone o quita la pantalla completa NATIVA de la ventana (la de F11 / el botón verde,
 * no la del API `requestFullscreen` del DOM) y espera a que el sistema acabe la
 * transición: en macOS es una animación a otro Space, y hasta el
 * `enter-full-screen`/`leave-full-screen` la ventana no tiene su tamaño final.
 * Devuelve el estado en que quedó.
 *
 * CON TIEMPO LÍMITE, y no por prudencia genérica: si el evento no llega (una transición
 * que macOS no completa, con la pantalla bloqueada o un Space a medio cambiar), una
 * promesa sin límite colgaría la prueba hasta su timeout, y Playwright ABANDONA la
 * función sin correr su `finally`. La ventana se quedaría en pantalla completa y las
 * pruebas siguientes que la comparten fallarían por un motivo que no es el suyo. Con
 * límite, la función vuelve con el estado real y el `finally` de quien la llama corre.
 */
export async function pantallaCompleta(
  app: ElectronApplication,
  activar: boolean,
  msMax = 10_000
): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }, { activar, msMax }) =>
      new Promise<boolean>((listo) => {
        const w = BrowserWindow.getAllWindows()[0]
        if (w.isFullScreen() === activar) return listo(activar)
        const fin = (): void => {
          clearTimeout(reloj)
          listo(w.isFullScreen())
        }
        const reloj = setTimeout(fin, msMax)
        // Dos `once` y no uno con el nombre en un ternario: los tipos de Electron
        // declaran un overload por evento y la unión no casa con ninguno.
        if (activar) w.once('enter-full-screen', fin)
        else w.once('leave-full-screen', fin)
        w.setFullScreen(activar)
      }),
    { activar, msMax }
  )
}

/**
 * Un perfil mínimo en modo host (sin sandbox), para las pruebas que necesitan un
 * proyecto abierto pero no Docker. Se escribe como `profiles.json` desde `sembrar`.
 */
export const PERFILES_SIN_SANDBOX = JSON.stringify([
  {
    id: 'personal',
    nombre: 'Personal',
    color: '#9814c8',
    agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }],
    sandbox: { habilitado: false }
  }
])
