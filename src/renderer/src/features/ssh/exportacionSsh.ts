// =============================================================================
// «Exportar a OpenSSH…»: pide al main que abra el diálogo de guardar y escriba el `config` con las conexiones
// del perfil (o las marcadas) y sus claves, y cuenta lo que hizo y lo que no pudo llevarse (las contraseñas).
// Depende de `window.tessera.ssh` y de las notificaciones.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================
import { notify } from '../../comun/notifications'
import type { SshExportacionOpenSsh } from '../../../../shared/ssh-ipc'
import { mensajeDeErrorSsh } from './erroresSsh'

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`

/** El detalle del aviso: dónde van las claves, lo que no va y cómo usarlo. */
export function detalleExportacion(r: SshExportacionOpenSsh): string {
  const partes: string[] = []
  if (r.bastiones > 0) partes.push(`Se añadieron ${plural(r.bastiones, 'bastión', 'bastiones')} por los que saltan.`)
  if (r.carpetaClaves !== null) partes.push(`Las claves van en la carpeta «${r.carpetaClaves}», junto al archivo.`)
  if (r.sinClave > 0) partes.push(`${plural(r.sinClave, 'conexión no tenía', 'conexiones no tenían')} su archivo de clave y va${r.sinClave === 1 ? '' : 'n'} sin él.`)
  if (r.conSecreto > 0) partes.push(`Las contraseñas no se exportan (OpenSSH no las guarda): ssh las pedirá al conectar en ${plural(r.conSecreto, 'conexión', 'conexiones')}.`)
  if (r.renombradas > 0) partes.push(`${plural(r.renombradas, 'nombre llevaba', 'nombres llevaban')} espacios o signos que OpenSSH no admite: el nombre original va en un comentario.`)
  if (r.incluible) partes.push(`Para usarlas con ssh, añade «Include ${r.archivo}» al principio de tu archivo config (si ya tienes en él un Host con el mismo nombre, manda el exportado).`)
  return partes.join(' ')
}

/** Exporta las conexiones del perfil (`ids`, o todas) y avisa del resultado; cancelar no avisa de nada. */
export async function exportarAOpenSsh(perfilId: string, ids?: readonly string[]): Promise<void> {
  try {
    const r = await window.tessera.ssh.exportarOpenSsh({ profileId: perfilId, ...(ids === undefined ? {} : { ids: [...ids] }) })
    if (r === null) return
    notify('success', `Se ${r.conexiones === 1 ? 'exportó 1 conexión' : `exportaron ${r.conexiones} conexiones`} a «${r.archivo}»`, detalleExportacion(r) || undefined)
  } catch (err) {
    notify('error', 'No se pudo exportar a OpenSSH', mensajeDeErrorSsh(err))
  }
}
