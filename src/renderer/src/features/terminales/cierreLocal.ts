// =============================================================================
// Cerrar una terminal local sin dejar el panel en blanco: si era la que se veía y no queda otra local,
// pasa a verse la primera pestaña SSH del perfil, aunque viniera restaurada del arranque anterior.
// Una restaurada no se elige sola (se conectaría sin pedirlo), pero cerrar la de al lado es un gesto
// del usuario: sin esto el panel se quedaba sin nada elegido y la columna del agente se lo comía.
// Puro; lo usa la acción `cerrar` del store.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import { closeTerminal, type ShellTerminalsState } from './shellTerminalsModel.ts'
import { elegirSsh, perfilDeContexto, sshDePerfil, type SshTabsState } from './sshTabsModel.ts'

/** Cierra la local `id` del proyecto `key` (que es también su contexto) y, si hace falta, elige la SSH que queda. */
export function cerrarLocal(
  shell: ShellTerminalsState,
  ssh: SshTabsState,
  key: string,
  id: string
): { shell: ShellTerminalsState; ssh: SshTabsState } {
  const siguiente = closeTerminal(shell, key, id)
  // Se veía una SSH, o queda otra local que pasa a verse: nada que elegir.
  if (ssh.activaPorContexto[key] !== undefined || (siguiente[key]?.activeId ?? null) !== null) return { shell: siguiente, ssh }
  const perfilId = perfilDeContexto(key)
  const primera = sshDePerfil(ssh, perfilId)[0]
  return { shell: siguiente, ssh: primera ? elegirSsh(ssh, perfilId, key, primera.id) : ssh }
}
