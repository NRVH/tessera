// =============================================================================
// Lógica PURA de la liberación de la carpeta de instalación (sin electron ni child_process):
// decidir a QUIÉN matar. Separada de `installDirLock.ts` para probarla con `node` a secas en
// `test-update.mts`. El parseo de la tabla de procesos es de `procesosSistema.ts`.
// =============================================================================

/** Un proceso vivo, tal como lo devuelve la enumeración. */
export interface RunningProcess {
  pid: number
  name: string
  path: string
}

/**
 * ¿Hay que matar este proceso para liberar la carpeta de instalación? Mata todo lo
 * que corra DESDE `installRoot` salvo:
 *   - la propia app (mismo nombre de ejecutable que el main: main + helpers de
 *     Electron se llaman todos igual, p.ej. "Tessera.exe"); esos mueren solos al
 *     salir la app y matarlos a mano la crasharía antes del handoff, y
 *   - nuestro propio proceso (por PID), por si acaso.
 *
 * Lo que SÍ cae: los helpers nativos empaquetados con OTRO nombre y ruta bajo la
 * carpeta de instalación — sobre todo `OpenConsole.exe` (ConPTY) y `winpty-agent.exe`.
 * El `conhost.exe` del sistema vive en System32, NO bajo la carpeta de instalación,
 * así que el filtro por ruta jamás lo toca (ni el de otras aplicaciones de terminal).
 */
export function shouldKillHelper(
  proc: RunningProcess,
  opts: { installRoot: string; ownPid: number; mainExeName: string }
): boolean {
  if (!proc.path) return false
  if (proc.pid === opts.ownPid) return false
  const under = normalizePath(proc.path).startsWith(normalizePath(withSep(opts.installRoot)))
  if (!under) return false
  if (proc.name.toLowerCase() === opts.mainExeName.toLowerCase()) return false
  return true
}

export function normalizePath(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase()
}

/** Garantiza una barra final para que el prefijo no case "…\TesseraOtra\". */
export function withSep(dir: string): string {
  return dir.endsWith('\\') ? dir : dir + '\\'
}
