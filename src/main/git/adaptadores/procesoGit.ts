// =============================================================================
// Proceso `git` del main: la ÚNICA cola de procesos, los techos de tiempo y la lista de verbos
// que escriben. Ejecuta con `execFile` y un array de argumentos, nunca por shell.
// Depende de `./colaGit`. Lo usan `NucleoGit` y las operaciones de git.
// Decisiones: docs/decisiones/git/main-cola-y-techos.md
// =============================================================================

import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { ColaGit, PRIORIDAD, esCancelado, type Prioridad } from './colaGit'

export { PRIORIDAD, esCancelado, type Prioridad }

const execFile = promisify(execFileCb)

/** maxBuffer holgado: `git log --all` de un repo grande puede pesar bastante. */
const MAX_BUFFER = 64 * 1024 * 1024

/** Techo de una lectura que el usuario pidió y está mirando. */
const TIMEOUT_INTERACTIVO_MS = 60_000
/** Techo de una lectura del abanico de fondo de `multiStatus`. */
const TIMEOUT_FONDO_MS = 20_000

/**
 * Subcomandos que MUTAN el repo (índice, árbol o refs) y por eso van sin techo de tiempo.
 * Lista explícita: un verbo nuevo que escriba tiene que entrar aquí antes de usarse.
 */
const ESCRITURAS = new Set([
  'add',
  'am',
  'apply',
  'branch',
  'checkout',
  'cherry-pick',
  'clean',
  'commit',
  'config',
  'gc',
  'merge',
  'mv',
  'notes',
  'rebase',
  'reset',
  'restore',
  'revert',
  'rm',
  'stash',
  'switch',
  'tag',
  'update-index',
  'update-ref',
  'worktree'
])

/** Cuántos `git` pueden estar vivos a la vez, en todo el proceso (medido: no se sube ni se baja). */
const TOPE_GIT = 16
/**
 * Cuántos de esos pueden ser relleno de FONDO (los repos que no se ven). Volver a una
 * contenedora con decenas de repos los pedía todos a la vez, compitiendo con lo visible.
 */
const TOPE_FONDO = 4
const colaGit = new ColaGit(TOPE_GIT, TOPE_FONDO)

/**
 * Lanza git en `cwd` por la cola global. `ambito` vacío = no cancelable; un ámbito (el
 * abanico de `multiStatus`) además usa el techo corto. Las escrituras no llevan techo.
 * Con `vigente`, si al llegar su turno ya no interesa, no se lanza (ver `ColaGit.correr`).
 */
export function ejecutarGit(
  args: string[],
  cwd: string,
  prioridad: Prioridad = PRIORIDAD.PRONTO,
  ambito = '',
  vigente?: () => boolean
): Promise<{ stdout: string; stderr: string }> {
  const escribe = ESCRITURAS.has(args[0] ?? '')
  // `--no-optional-locks` (bandera de `git`, va delante del subcomando) hace seguro matar una lectura.
  const argv = escribe ? args : ['--no-optional-locks', ...args]
  // El techo lo decide el ÁMBITO, no la prioridad: dentro del abanico también hay repos VISIBLE.
  const techo = ambito !== '' ? TIMEOUT_FONDO_MS : TIMEOUT_INTERACTIVO_MS
  return colaGit.correr(
    () =>
      execFile('git', argv, {
        cwd,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        timeout: escribe ? 0 : techo,
        killSignal: 'SIGKILL'
      }),
    prioridad,
    ambito,
    vigente
  )
}

/** Git FUERA de la cola y sin techo (solo `rev-parse --show-toplevel` del repo activo). */
export function gitSinCola(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFile('git', args, { cwd, maxBuffer: MAX_BUFFER })
}

/** Tira lo que quede EN COLA de un ámbito; devuelve cuántos trabajos tiró. */
export function cancelarAmbito(ambito: string): number {
  return colaGit.cancelarAmbito(ambito)
}

/** Vuelve a admitir un ámbito cancelado. */
export function reabrirAmbito(ambito: string): void {
  colaGit.reabrirAmbito(ambito)
}
