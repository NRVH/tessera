// =============================================================================
// «Importar desde OpenSSH…»: pide al main que abra el diálogo y lea el archivo (sin dar de alta nada) y
// decide qué se enseña. Con un solo `Host`, el formulario de alta relleno; con varios, la revisión de la
// importación; sin ninguno, un aviso con el motivo. Las altas las hace quien revisa. Depende de
// `window.tessera.ssh`, del store y de `importacionOpenSsh.ts` (lo puro).
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================
import { notify } from '../../comun/notifications'
import type { SshLecturaOpenSsh } from '../../../../shared/ssh-ipc'
import { mensajeDeErrorSsh } from './erroresSsh'
import { importacionEnFormulario, motivoSinCandidatas, type ImportacionEnFormulario } from './importacionOpenSsh'
import { accionesSsh, useStoreSsh } from './store'

/** Abre el diálogo del main y lee el archivo. `null` si se cancela o falla (y entonces se avisa). */
export async function leerOpenSsh(perfilId: string): Promise<SshLecturaOpenSsh | null> {
  try {
    return await window.tessera.ssh.leerOpenSsh({ profileId: perfilId })
  } catch (err) {
    notify('error', 'No se pudo leer el archivo de OpenSSH', mensajeDeErrorSsh(err))
    return null
  }
}

/**
 * Lo que sigue a una lectura. `enFormulario`: cómo rellenar el formulario con un solo `Host` (el del alta
 * ya abierto, o uno nuevo). Con varios, la revisión sustituye al diálogo que hubiera; sin ninguno, se avisa.
 */
export function seguirLectura(perfilId: string, l: SshLecturaOpenSsh, enFormulario: (i: ImportacionEnFormulario) => void): void {
  if (l.candidatas.length === 0) notify('warn', 'Nada que importar', motivoSinCandidatas(l))
  else if (l.candidatas.length === 1) enFormulario(importacionEnFormulario(l))
  else accionesSsh.revisarImportacion(perfilId, l)
}

/** Desde fuera del formulario (la cabecera del riel): con un solo `Host`, abre el alta ya rellena. */
export async function importarDesdeOpenSsh(perfilId: string): Promise<void> {
  const l = await leerOpenSsh(perfilId)
  if (l === null) return
  // Un diálogo abierto mientras se leía (las claves tardan) no se sustituye: lo escrito en él se perdería.
  if (useStoreSsh.getState().dialogo !== null) {
    notify('warn', 'No se importó', 'Hay un diálogo de conexiones abierto: ciérralo y vuelve a importar.')
    return
  }
  seguirLectura(perfilId, l, (i) => accionesSsh.nuevaConexion(perfilId, null, i))
}
