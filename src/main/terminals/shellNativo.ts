// =============================================================================
// Qué shell lanza el modo nativo de la terminal en cada sistema: PowerShell en Windows y el shell
// de login del usuario (`$SHELL`) en macOS.
// En macOS los argumentos llevan siempre `-il` (`-ilc` con agente): una app lanzada por `launchd`
// no hereda el PATH del usuario y `-lc` no lee `~/.zshrc`.
// Puro y sin `node-pty`; la plataforma es el último parámetro y vale la actual por defecto.
// Decisiones: docs/decisiones/terminales/pty-shell-nativo-y-entorno.md
// =============================================================================

import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/** Variable de entorno de pruebas que pide la PowerShell aislada (ver `shellNativoPara`). */
export const VAR_SHELL_AISLADA = 'TESSERA_SHELL_AISLADA'

/** Qué lanzar: el ejecutable y sus argumentos, listos para `ptySpawn`. */
export interface ShellNativo {
  /** Ejecutable a lanzar (se resuelve por PATH). */
  archivo: string
  /** Argumentos, ya en el orden correcto. */
  args: string[]
}

/**
 * El shell de login por defecto de macOS desde Catalina. Sólo se usa si `$SHELL` no
 * viene en el entorno, que es raro pero posible: un `launchd` muy recortado, o un
 * usuario cuyo `NSHomeDirectory` no tiene shell asignado. Preferir un valor conocido a
 * fallar es lo correcto aquí — una terminal en `zsh` cuando el usuario quería `fish` es
 * un inconveniente; una terminal que no abre es un fallo.
 */
const SHELL_MAC_POR_DEFECTO = '/bin/zsh'

/**
 * Decide shell y argumentos para el modo nativo.
 *
 * @param launch      Comando del AGENTE, si lo hay. Sin él, shell interactivo.
 * @param shellEnv    Valor de `$SHELL` (sólo se mira en macOS). Inyectado para el test.
 * @param plataforma  Dónde corre; la actual por defecto. Explícita en el test para
 *                    poder probar las dos desde una.
 * @param aislada     Solo para pruebas (`TESSERA_SHELL_AISLADA=1`): la PowerShell interactiva
 *                    arranca sin perfil y sin guardar historial de PSReadLine. En macOS no
 *                    hace nada: allí el arnés ya aísla el shell con `SHELL`.
 */
export function shellNativoPara(
  launch: string | undefined,
  shellEnv: string | undefined,
  plataforma: Plataforma = plataformaActual(),
  aislada = false
): ShellNativo {
  if (plataforma === 'windows') {
    if (aislada && !launch) {
      // `-NoExit` mantiene la sesión interactiva tras el comando. PSReadLine escribe su
      // historial en una carpeta que `%APPDATA%` no desvía (sale de la API de carpetas
      // conocidas), por eso se apaga el guardado en vez de redirigirlo.
      return {
        archivo: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-NoExit', '-Command', 'Set-PSReadLineOption -HistorySaveStyle SaveNothing']
      }
    }
    // Con `launch`: el agente es el proceso en primer plano; al salir, sale la
    // PowerShell y muere el pty (patrón "Reiniciar"). Sin él: PowerShell interactiva
    // con el perfil del usuario, su entorno de siempre.
    return {
      archivo: 'powershell.exe',
      args: launch ? ['-NoLogo', '-NoProfile', '-Command', launch] : ['-NoLogo']
    }
  }

  // macOS (y cualquier POSIX). `$SHELL` es el shell que el usuario eligió: respetarlo hace que
  // su `.zshrc`, sus alias y su prompt aparezcan aquí como en cualquier otra terminal.
  const archivo = shellEnv?.trim() || SHELL_MAC_POR_DEFECTO
  return {
    archivo,
    // `-il` en los dos casos (`-l` trae el PATH de `.zprofile` e `-i` el de `.zshrc`):
    // con launch, `-ilc <cmd>` (el agente en primer plano); sin él, `-il`.
    args: launch ? ['-ilc', launch] : ['-il']
  }
}
