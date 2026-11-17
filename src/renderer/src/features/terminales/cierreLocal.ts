// =============================================================================
// Cerrar una terminal local sin dejar el panel en blanco: si era la que se veía y no queda otra local,
// pasa a verse la primera pestaña SSH del perfil, aunque viniera restaurada del arranque anterior.
// Una restaurada no se elige sola (se conectaría sin pedirlo), pero cerrar la de al lado es un gesto
// del usuario: sin esto el panel se quedaba sin nada elegido y la columna del agente se lo comía.
// Puro; lo usa `cerrarLocalEnTira` cuando la tira no tiene otra vecina a la que pasar.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import { cerrarTerminal, type EstadoTerminalesShell } from './modeloTerminalesShell.ts'
import { elegirSsh, perfilDeContexto, sshDePerfil, type EstadoPestanasSsh } from './modeloPestanasSsh.ts'

/** Cierra la local `id` del proyecto `key` (que es también su contexto) y, si hace falta, elige la SSH que queda. */
export function cerrarLocal(
  shell: EstadoTerminalesShell,
  ssh: EstadoPestanasSsh,
  clave: string,
  id: string
): { shell: EstadoTerminalesShell; ssh: EstadoPestanasSsh } {
  const siguiente = cerrarTerminal(shell, clave, id)
  // Se veía una SSH, o queda otra local que pasa a verse: nada que elegir.
  if (ssh.activaPorContexto[clave] !== undefined || (siguiente[clave]?.activoId ?? null) !== null) return { shell: siguiente, ssh }
  const perfilId = perfilDeContexto(clave)
  const primera = sshDePerfil(ssh, perfilId)[0]
  return { shell: siguiente, ssh: primera ? elegirSsh(ssh, perfilId, clave, primera.id) : ssh }
}
