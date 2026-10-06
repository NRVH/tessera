// =============================================================================
// Adaptador de procesos de la terminal: único sitio que crea ptys (node-pty) y que mata un
// árbol de procesos (`taskkill` en Windows; señales a grupos en macOS, con el plan de
// `arbolProcesos.ts`). No importa nada del dominio.
// Lo usa `TerminalService`, que le pasa ya resueltos el archivo, los argumentos y el entorno.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================
import { spawn as ptySpawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { execFile } from 'node:child_process'
import { conTope, esperar } from '../../util/esperas.ts'
import { leerTablaPs, planMuerte, planRemate, type PlanMuerte, type ProcesoPs } from './arbolProcesos.ts'

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
  return ptySpawn(archivo, args, { name: PTY_NAME, ...opciones, useConptyDll: true })
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
 * `taskkill /PID <pid> /T /F`: mata el proceso y todos sus descendientes; solo Windows (lo
 * decide quien llama). Ignora los errores —el proceso puede haber muerto ya— y la espera tiene
 * doble tope: el `timeout` de `execFile` y una carrera con un temporizador.
 */
export function matarArbolWindows(pid: number): Promise<void> {
  const hecho = new Promise<void>((resolve) => {
    try {
      execFile(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: TASKKILL_TIMEOUT_MS },
        () => resolve()
      )
    } catch {
      resolve()
    }
  })
  return conTope(hecho, TASKKILL_TIMEOUT_MS + 500).then(() => undefined)
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
