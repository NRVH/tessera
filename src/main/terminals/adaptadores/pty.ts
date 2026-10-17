// =============================================================================
// Adaptador de procesos de la terminal: único sitio que crea ptys (node-pty) y que mata un
// árbol de procesos (`taskkill` en Windows; señales a grupos en macOS y Linux, con el plan de
// `arbolProcesos.ts`). En Linux el pty nace sin lo heredado del main (`descriptoresHeredados.ts`).
// Cada pty queda en el registro del proceso (`registroPtys.ts`) hasta su salida, para que el cierre
// remate lo que cualquier camino dejara suelto. No importa nada del dominio.
// Lo usa `TerminalService`, que le pasa ya resueltos el archivo, los argumentos y el entorno.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================
import { spawn as ptySpawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { esWindows, plataformaActual } from '../../../shared/plataforma.ts'
import { conTope, esperar } from '../../util/esperas.ts'
import { BASH, lanzamientoSinHerencia } from './descriptoresHeredados.ts'
import { leerTablaPs, planMuerte, planRemate, type PlanMuerte, type ProcesoPs } from './arbolProcesos.ts'
import { crearRegistroPtys, type PtyPendiente, type Remate } from './registroPtys.ts'
import { clasificarTaskkill, type ErrorEjecucion, type ResultadoTaskkill } from './taskkill.ts'

/** Nombre del pty "type" que se anuncia al shell (TERM). */
const PTY_NAME = 'xterm-256color'

/**
 * Tope de `taskkill`. Suele tardar decenas de milisegundos; el tope evita que uno que no
 * vuelva cuelgue la parada entera (y con ella el reinicio masivo).
 */
const TASKKILL_TIMEOUT_MS = 3000

/** Lo que hace falta para lanzar un pty. */
export interface OpcionesPty {
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

/**
 * Lanza un pty. `useConptyDll: true` usa la conpty.dll de node-pty y no la de Windows: su
 * `kill()` no hace el `fork` que lanza "AttachConsole failed" y, bajo la ráfaga de crear y
 * matar terminales al cambiar de perfil, segfaultea el proceso. Sigue siendo ConPTY; fuera de
 * Windows no hace nada. Ninguna llamada a este módulo debe quitarlo.
 */
export function lanzarPty(archivo: string, args: string[], opciones: OpcionesPty): IPty {
  const lanzamiento = lanzamientoSinHerencia(archivo, args, plataformaActual(), existsSync(BASH), opciones.env)
  const pty = ptySpawn(lanzamiento.archivo, lanzamiento.args, { name: PTY_NAME, ...opciones, env: lanzamiento.env, useConptyDll: true })
  registro.alta(pty, path.basename(archivo))
  pty.onExit(() => registro.avisoDeSalida(pty))
  // Cualquier `kill()` pasa por el registro, lo llame quien lo llame: en Windows un segundo cerraría otra
  // vez la pseudoconsola y tumba el proceso, así que allí va una sola vez; fuera, cada señal se manda
  // y solo se anota que el pty ya la tuvo.
  const killDeNodePty = pty.kill.bind(pty)
  killOriginal.set(pty, killDeNodePty)
  pty.kill = (senal?: string): void => {
    if (esWindows()) {
      registro.matar(pty)
      return
    }
    registro.anotarMatado(pty)
    killDeNodePty(senal)
  }
  return pty
}

/** El `kill` de node-pty de cada pty, antes de pasar por el registro. */
const killOriginal = new WeakMap<IPty, (senal?: string) => void>()

/**
 * Los ptys de este proceso cuya raíz puede seguir viva. Una raíz viva al salir cuelga la app: al
 * desmontar Node, node-pty une el hilo que espera su fin.
 */
const registro = crearRegistroPtys<IPty>({
  matar: (pty) => matarSinAplazar(pty),
  senalar: esWindows() ? null : (pid) => process.kill(pid, 'SIGKILL'),
  terminado: (pty, avisoDeSalida) => (esWindows() ? raizTerminadaWindows(pty) : avisoDeSalida)
})

/**
 * En Windows, `onExit` llega al cerrarse la tubería de salida, que puede cerrarse con la raíz viva
 * (un proceso que no usa la consola). El fin de la raíz lo marca el aviso nativo, que deja el código
 * en el agente de node-pty.
 */
function raizTerminadaWindows(pty: IPty): boolean {
  return typeof (pty as unknown as { _agent?: { exitCode?: unknown } })._agent?.exitCode === 'number'
}

/**
 * `kill()` de node-pty sin esperar a su primer byte. En Windows node-pty aplaza `kill()` hasta que el
 * pty escribe algo: una raíz que no escribe nunca no lo recibiría y seguiría viva, y con ella el hilo
 * que la espera colgaría la salida de la app. Antes de ese byte se llama al `kill` de su agente, que es
 * lo que el aplazado haría (cierra la pseudoconsola y termina la raíz con su handle); así no queda
 * ninguno en cola que lo repita después. Los `resize`/`write` aplazados se descartan: correrían con el
 * primer byte sobre una pseudoconsola ya cerrada.
 */
function matarSinAplazar(pty: IPty): void {
  const interno = pty as unknown as { _isReady?: boolean; _deferreds?: unknown; _agent?: { kill?: () => void } }
  if (esWindows() && interno._isReady === false && typeof interno._agent?.kill === 'function') {
    interno._agent.kill()
    if (Array.isArray(interno._deferreds)) interno._deferreds = []
    return
  }
  killOriginal.get(pty)?.()
}

/** `kill()` de un pty, una sola vez: un segundo cerraría otra vez su pseudoconsola. Devuelve si lo mandó. */
export function matarPty(pty: IPty): boolean {
  return registro.matar(pty)
}

/**
 * Para quien suelta un pty (cerrar, reiniciar, hibernar): si su raíz no consta como terminada,
 * `kill()` si nadie se lo mandó y, fuera de Windows, SIGKILL a la raíz si ya lo tuvo.
 */
export function rematarPty(pty: IPty): Remate {
  return registro.rematar(pty)
}

/** Si la raíz de `pty` no consta como terminada: solo entonces hay algo que rematar. */
export function raizViva(pty: IPty): boolean {
  return registro.pendiente(pty)
}

/** Los ptys cuya raíz no consta como terminada, para dejarlos escritos. */
export function ptysPendientes(): PtyPendiente[] {
  return registro.pendientes()
}

/** Lo que dejó `rematarPtysSueltos`: a cuántos mandó `kill()` y cuáles siguen con la raíz viva. */
export interface ResumenRemate {
  rematados: number
  quedan: PtyPendiente[]
}

/**
 * Final del cierre: remata TODO pty cuya raíz no consta como terminada, también los que ya no están
 * en el mapa de ninguna sesión. Fuera de Windows, tras `espera`, SIGKILL a los que el `kill()` no tumbó; en Windows `kill()`
 * ya termina la raíz con `TerminateProcess` y no se espera.
 */
export async function rematarPtysSueltos(esperaMs = 500): Promise<ResumenRemate> {
  const cuenta = registro.rematarTodos()
  if (!esWindows() && registro.pendientes().length > 0) {
    await esperar(esperaMs)
    registro.rematarTodos()
  }
  return { rematados: cuenta.kill, quedan: registro.pendientes() }
}

/**
 * Suelta lo que un pty de Windows retiene en este proceso cuando ya no se usa. node-pty crea un hilo
 * (worker) por pty para leer su salida y, con `useConptyDll`, solo lo termina desde `kill()` y aun así
 * únicamente si después llega salida: un proceso que sale solo, o al que mata `taskkill`, deja el hilo
 * vivo con varios MB nativos hasta cerrar la app. `dispose()` drena la salida pendiente un segundo y
 * termina el hilo; repetirlo no hace nada nuevo. Fuera de Windows el pty no tiene ese hilo. Nunca lanza.
 */
export function liberarPty(pty: IPty | undefined): void {
  try {
    const agente = (pty as unknown as { _agent?: { _conoutSocketWorker?: { dispose?: () => void } } } | undefined)?._agent
    agente?._conoutSocketWorker?.dispose?.()
  } catch {
    /* el pty ya está destruido: no queda nada que soltar */
  }
}

/** Cada cuánto se mira si ConPTY ya tiene el código que no trajo `onExit`. */
const SONDEO_CODIGO_MS = 10

/**
 * El código de salida que `onExit` no trajo. Con ConPTY (`useConptyDll`), node-pty emite la salida
 * al cerrarse la tubería de salida y lee el código que le dejó el aviso nativo de fin de proceso;
 * si la tubería se cierra antes, llega `onExit({})` y el código aparece en su agente unos
 * milisegundos después (medido: 8 de 40 con un proceso que sale al instante, todos recuperados en
 * menos de 60 ms). Se sondea ese campo interno hasta `topeMs`; `null` si no aparece. Fuera de
 * Windows node-pty siempre trae el código y esto devuelve `null` enseguida.
 */
export async function codigoDeSalidaTardio(pty: IPty, topeMs: number): Promise<number | null> {
  const agente = (pty as unknown as { _agent?: { exitCode?: unknown } })._agent
  if (agente === undefined) return null
  const limite = Date.now() + topeMs
  for (;;) {
    const codigo = agente.exitCode
    if (typeof codigo === 'number') return codigo
    if (Date.now() >= limite) return null
    await esperar(SONDEO_CODIGO_MS)
  }
}

/**
 * `taskkill /PID <pid>… /T /F`: mata los procesos y todos sus descendientes, varios en una sola
 * llamada; solo Windows (lo decide quien llama). Nunca lanza: devuelve cómo acabó, para que quien
 * llama anote un fallo o un tope (con el tope, `execFile` corta `taskkill` a medias y parte del
 * árbol puede seguir vivo). La espera tiene doble tope: el `timeout` de `execFile` y una carrera.
 */
export async function matarArbolWindows(pids: number | readonly number[]): Promise<ResultadoTaskkill> {
  const lista = typeof pids === 'number' ? [pids] : pids
  if (lista.length === 0) return { estado: 'ok' }
  const hecho = new Promise<ResultadoTaskkill>((resolve) => {
    try {
      execFile(
        'taskkill',
        [...lista.flatMap((pid) => ['/PID', String(pid)]), '/T', '/F'],
        { windowsHide: true, timeout: TASKKILL_TIMEOUT_MS },
        (err, _stdout, stderr) => resolve(clasificarTaskkill(err as ErrorEjecucion | null, String(stderr ?? '')))
      )
    } catch (e) {
      resolve({ estado: 'fallo', detalle: String(e) })
    }
  })
  return (await conTope(hecho, TASKKILL_TIMEOUT_MS + 500)) === 'tope' ? { estado: 'tope' } : hecho
}

/** Tope de `ps`: es instantáneo, y uno que no vuelva no puede colgar el cierre. */
const PS_TIMEOUT_MS = 2000
/** Lo que se deja a los procesos para salir con SIGTERM antes del SIGKILL. */
const GRACIA_TERM_MS = 500

/** La tabla de procesos del sistema; vacía si `ps` falla (y entonces no se señala nada). */
function tablaDeProcesos(): Promise<ProcesoPs[]> {
  return new Promise<ProcesoPs[]>((resolve) => {
    try {
      // Ruta absoluta: el PATH heredado puede traer otro `ps` por delante.
      execFile('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid='], { timeout: PS_TIMEOUT_MS }, (err, stdout) =>
        resolve(err ? [] : leerTablaPs(String(stdout)))
      )
    } catch {
      resolve([])
    }
  })
}

function senalar(plan: Pick<PlanMuerte, 'grupos' | 'pids'>, senal: NodeJS.Signals): void {
  for (const objetivo of [...plan.grupos.map((g) => -g), ...plan.pids]) {
    try {
      process.kill(objetivo, senal)
    } catch {
      /* ya no existe, o no es nuestro: nada que hacer */
    }
  }
}

/**
 * Mata el árbol que cuelga de un pty en POSIX (macOS): SIGTERM a los grupos y procesos que
 * decide `planMuerte`, una gracia corta y SIGKILL a lo que siga vivo. Solo fuera de Windows
 * (lo decide quien llama). Nunca lanza; sin tabla de procesos no señala nada.
 */
export async function matarArbolPosix(pid: number): Promise<void> {
  const plan = planMuerte(await tablaDeProcesos(), pid, process.pid)
  if (plan.miembros.length === 0) return
  senalar(plan, 'SIGTERM')
  await esperar(GRACIA_TERM_MS)
  senalar(planRemate(plan, await tablaDeProcesos()), 'SIGKILL')
}
