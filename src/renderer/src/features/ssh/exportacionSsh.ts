// =============================================================================
// «Exportar a OpenSSH…»: pide al main que abra el diálogo de guardar y escriba el `config` con las conexiones
// del perfil (o las marcadas) y sus claves, y cuenta lo que hizo y lo que no pudo llevarse (las contraseñas).
// Depende de `window.tessera.ssh` y de las notificaciones.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================
import { notify } from '../../comun/notifications'
import type { SshExportacionOpenSsh } from '../../../../shared/ssh-ipc'
import { mensajeDeErrorSsh } from './erroresSsh'
import { txSsh } from './textos.ts'

/** El detalle del aviso: dónde van las claves, lo que no va y cómo usarlo. */
export function detalleExportacion(r: SshExportacionOpenSsh): string {
  const t = txSsh()
  const partes: string[] = []
  if (r.bastiones > 0) partes.push(t.expBastiones(r.bastiones))
  if (r.carpetaClaves !== null) partes.push(t.expCarpetaClaves(r.carpetaClaves))
  if (r.sinClave > 0) partes.push(t.expSinClave(r.sinClave))
  if (r.conSecreto > 0) partes.push(t.expConSecreto(r.conSecreto))
  if (r.renombradas > 0) partes.push(t.expRenombradas(r.renombradas))
  if (r.incluible) partes.push(t.expInclude(r.archivo))
  return partes.join(' ')
}

/** Exporta las conexiones del perfil (`ids`, o todas) y avisa del resultado; cancelar no avisa de nada. */
export async function exportarAOpenSsh(perfilId: string, ids?: readonly string[]): Promise<void> {
  try {
    const r = await window.tessera.ssh.exportarOpenSsh({ profileId: perfilId, ...(ids === undefined ? {} : { ids: [...ids] }) })
    if (r === null) return
    notify('success', txSsh().exportadas(r.conexiones, r.archivo), detalleExportacion(r) || undefined)
  } catch (err) {
    notify('error', txSsh().noSePudoExportar, mensajeDeErrorSsh(err))
  }
}
