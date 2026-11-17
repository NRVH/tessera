// =============================================================================
// Lógica PURA de la liberación de la carpeta de instalación (sin electron ni child_process):
// decidir a QUIÉN matar. Separada de `bloqueoCarpetaInstalacion.ts` para probarla con `node` a secas en
// `test-actualizacion.mts`. El parseo de la tabla de procesos es de `procesosSistema.ts`.
// =============================================================================

/** Un proceso vivo, tal como lo devuelve la enumeración. */
export interface ProcesoEnEjecucion {
  pid: number
  nombre: string
  ruta: string
}

/**
 * ¿Hay que matar este proceso para liberar la carpeta de instalación? Mata todo lo
 * que corra DESDE `raizDeInstalacion` salvo:
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
export function debeMatarAuxiliar(
  proc: ProcesoEnEjecucion,
  opts: { raizDeInstalacion: string; pidPropio: number; nombreExePrincipal: string }
): boolean {
  if (!proc.ruta) return false
  if (proc.pid === opts.pidPropio) return false
  const under = normalizarRutaDeInstalacion(proc.ruta).startsWith(normalizarRutaDeInstalacion(conSeparador(opts.raizDeInstalacion)))
  if (!under) return false
  if (proc.nombre.toLowerCase() === opts.nombreExePrincipal.toLowerCase()) return false
  return true
}

export function normalizarRutaDeInstalacion(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase()
}

/** Garantiza una barra final para que el prefijo no case "…\TesseraOtra\". */
export function conSeparador(dir: string): string {
  return dir.endsWith('\\') ? dir : dir + '\\'
}
