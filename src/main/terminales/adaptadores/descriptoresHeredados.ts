// =============================================================================
// En Linux el proceso de un pty nace con un `fork` + `exec` que no cierra nada, así que hereda
// todos los descriptores del main que Chromium abrió sin cierre al ejecutar (sus `.pak`, memoria
// compartida, tuberías y sockets de su IPC). Las terminales y los agentes los pasarían a sus hijos,
// y uno suelto (un servidor MCP) los retendría con Tessera ya cerrada. Aquí se arma la envoltura
// que los cierra antes de ejecutar la shell, sin que el `BASH_ENV` del usuario corra en ella.
// Puro: la plataforma, si hay bash y el entorno entran por parámetro.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================
import type { Plataforma } from '../../../shared/plataforma.ts'

/** La shell que hace de envoltura: cierra por número cualquier descriptor, cosa que `sh` (dash) no sabe por encima del 9. */
export const BASH = '/bin/bash'

/**
 * Variable en la que viaja el `BASH_ENV` del usuario a través de la envoltura: un `bash -c` no
 * interactivo ejecuta ese guion al arrancar, y correría antes de cada terminal y cada agente.
 */
export const VARIABLE_BASH_ENV_APARTADO = 'TESSERA_BASH_ENV_APARTADO'

/**
 * Devuelve el `BASH_ENV` apartado a su sitio, cierra todo descriptor que no sea 0, 1 o 2 y ejecuta
 * en su lugar el programa (`$0`) con sus argumentos: el pid, la sesión y el terminal de control que
 * preparó node-pty se conservan. SIN redirigir el bucle: bash guardaría el 2 en un descriptor alto
 * para restaurarlo, el bucle cerraría esa copia, y la shell nacería con stderr en `/dev/null`.
 * Cerrar uno ya cerrado no es un error.
 */
export const GUION_CERRAR_DESCRIPTORES =
  `if [ -n "\${${VARIABLE_BASH_ENV_APARTADO}+x}" ]; then export BASH_ENV="$${VARIABLE_BASH_ENV_APARTADO}"; unset ${VARIABLE_BASH_ENV_APARTADO}; fi; ` +
  'for f in /proc/$$/fd/*; do n=${f##*/}; case $n in 0|1|2) ;; *) exec {n}>&- ;; esac; done; exec "$0" "$@"'

/**
 * El archivo, los argumentos y el entorno con los que lanzar un pty. En Linux, envueltos para que
 * el proceso no herede nada del main (si no hay bash, sin envoltura: mejor una terminal que
 * ninguna), con el `BASH_ENV` apartado mientras corre la envoltura. En macOS no hace falta:
 * node-pty arranca allí con `posix_spawn` y cierra lo heredado. En Windows ConPTY no hereda descriptores.
 */
export function lanzamientoSinHerencia(
  archivo: string,
  args: string[],
  plataforma: Plataforma,
  hayBash: boolean,
  env: Record<string, string>
): { archivo: string; args: string[]; env: Record<string, string> } {
  if (plataforma !== 'linux' || !hayBash) return { archivo, args, env }
  const envEnvoltura = { ...env }
  delete envEnvoltura[VARIABLE_BASH_ENV_APARTADO]
  if ('BASH_ENV' in envEnvoltura) {
    envEnvoltura[VARIABLE_BASH_ENV_APARTADO] = envEnvoltura.BASH_ENV
    delete envEnvoltura.BASH_ENV
  }
  return { archivo: BASH, args: ['-c', GUION_CERRAR_DESCRIPTORES, archivo, ...args], env: envEnvoltura }
}
