// =============================================================================
// Los diálogos de las conexiones SSH que abre el store: el formulario de una conexión, la revisión de
// una importación de OpenSSH, el nombre de un grupo (crearlo o renombrarlo) y las dos confirmaciones de
// eliminar. Se montan una sola vez en la capa de modales de la ventana. El error del main se enseña tal cual.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import { useState } from 'react'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { notify } from '../../comun/notifications'
import { PromptDialog } from '../../comun/PromptDialog'
import type { SshConexion, SshGrupo } from '../../../../shared/ssh-ipc'
import { DialogoConexionSsh } from './DialogoConexionSsh'
import { DialogoImportarOpenSsh } from './DialogoImportarOpenSsh'
import { mensajeDeErrorSsh } from './erroresSsh'
import { accionesSsh, useStoreSsh } from './store'

/** Crear un grupo o renombrar uno: el nombre en un cuadro, con el error del main dentro. */
function DialogoGrupoSsh({ perfilId, grupo }: { perfilId: string; grupo: SshGrupo | null }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const confirmar = async (nombre: string): Promise<void> => {
    if (ocupado) return
    setOcupado(true)
    setError(null)
    try {
      if (grupo === null) await window.tessera.ssh.crearGrupo({ profileId: perfilId, nombre })
      else await window.tessera.ssh.renombrarGrupo({ id: grupo.id, profileId: perfilId, nombre })
      accionesSsh.cerrarDialogo()
    } catch (err) {
      setError(mensajeDeErrorSsh(err))
      setOcupado(false)
    }
  }
  return (
    <PromptDialog
      title={grupo === null ? 'Nuevo grupo' : 'Renombrar grupo'}
      label="Nombre del grupo"
      initialValue={grupo?.nombre ?? ''}
      confirmLabel={grupo === null ? 'Crear' : 'Guardar'}
      error={error}
      onConfirm={(nombre) => void confirmar(nombre)}
      onCancel={accionesSsh.cerrarDialogo}
    />
  )
}

/** Confirmar el borrado de una conexión: las pestañas que tenga abiertas siguen vivas. */
function ConfirmarEliminarConexion({ conexion }: { conexion: SshConexion }): React.JSX.Element {
  const eliminar = async (): Promise<void> => {
    accionesSsh.cerrarDialogo()
    try {
      await window.tessera.ssh.borrar({ id: conexion.id, profileId: conexion.profileId })
    } catch (err) {
      notify('error', 'No se pudo eliminar la conexión', mensajeDeErrorSsh(err))
    }
  }
  return (
    <ConfirmDialog
      danger
      title="Eliminar conexión"
      message={`¿Eliminar la conexión «${conexion.alias}»?\nLas pestañas que tenga abiertas siguen funcionando, pero ya no se podrán reconectar.`}
      confirmLabel="Eliminar"
      onConfirm={() => void eliminar()}
      onCancel={accionesSsh.cerrarDialogo}
    />
  )
}

/** Lo que pasa con las conexiones de un grupo que se elimina. */
function textoConexionesDelGrupo(n: number): string {
  if (n === 0) return 'No tiene conexiones.'
  return n === 1 ? 'Su conexión pasa a "Sin grupo".' : `Sus ${n} conexiones pasan a "Sin grupo".`
}

/** Confirmar el borrado de un grupo: sus conexiones no se borran, pasan a «Sin grupo». */
function ConfirmarEliminarGrupo({ grupo, conexiones }: { grupo: SshGrupo; conexiones: number }): React.JSX.Element {
  const eliminar = async (): Promise<void> => {
    accionesSsh.cerrarDialogo()
    try {
      await window.tessera.ssh.borrarGrupo({ id: grupo.id, profileId: grupo.profileId })
    } catch (err) {
      notify('error', 'No se pudo eliminar el grupo', mensajeDeErrorSsh(err))
    }
  }
  return (
    <ConfirmDialog
      danger
      title="Eliminar grupo"
      message={`¿Eliminar el grupo «${grupo.nombre}»?\n${textoConexionesDelGrupo(conexiones)}`}
      confirmLabel="Eliminar"
      onConfirm={() => void eliminar()}
      onCancel={accionesSsh.cerrarDialogo}
    />
  )
}

/** El diálogo que pide el store, si hay alguno. */
export function DialogosSsh(): React.JSX.Element | null {
  const dialogo = useStoreSsh((s) => s.dialogo)
  if (dialogo === null) return null
  if (dialogo.tipo === 'conexion') {
    return (
      <DialogoConexionSsh
        // Otra conexión (u otro alta) es otro formulario: no hereda lo escrito en el anterior.
        key={dialogo.conexion?.id ?? `alta-${dialogo.perfilId}-${dialogo.grupoId ?? ''}`}
        perfilId={dialogo.perfilId}
        conexion={dialogo.conexion}
        grupoInicial={dialogo.grupoId}
        enfocarGrupo={dialogo.enfocarGrupo}
        importada={dialogo.importada}
        onCerrar={accionesSsh.cerrarDialogo}
      />
    )
  }
  if (dialogo.tipo === 'importarOpenSsh') return <DialogoImportarOpenSsh perfilId={dialogo.perfilId} lectura={dialogo.lectura} onCerrar={accionesSsh.cerrarDialogo} />
  if (dialogo.tipo === 'grupo') return <DialogoGrupoSsh key={dialogo.grupo?.id ?? 'nuevo'} perfilId={dialogo.perfilId} grupo={dialogo.grupo} />
  if (dialogo.tipo === 'eliminarConexion') return <ConfirmarEliminarConexion conexion={dialogo.conexion} />
  return <ConfirmarEliminarGrupo grupo={dialogo.grupo} conexiones={dialogo.conexiones} />
}
