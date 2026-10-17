// =============================================================================
// Los diálogos de las conexiones SSH que abre el store: el formulario de una conexión, la revisión de
// una importación de OpenSSH, el nombre de un grupo (crearlo, también con conexiones dentro, o renombrarlo),
// las confirmaciones de eliminar (una conexión, varias o un grupo) y de olvidar la huella guardada, mover varias y la actividad de los agentes. Se montan una sola vez en la capa de modales de la ventana. El error del main se enseña tal cual.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import { useState } from 'react'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { notify } from '../../comun/notifications'
import { PromptDialog } from '../../comun/PromptDialog'
import type { SshConexion, SshGrupo } from '../../../../shared/ssh-ipc'
import { DialogoActividadSsh } from './DialogoActividadSsh'
import { DialogoConexionSsh } from './DialogoConexionSsh'
import { DialogoImportarOpenSsh } from './DialogoImportarOpenSsh'
import { DialogoMoverSsh } from './DialogoMoverSsh'
import { mensajeDeErrorSsh } from './erroresSsh'
import { cuantasConexiones, mensajeEliminarVarias } from './seleccionListaSsh'
import { accionesSsh, useStoreSsh } from './store'
import { txSsh } from './textos.ts'
import { txFormularioSsh } from './textosFormulario.ts'

/** Pasa al grupo recién creado las conexiones que se soltaron en «Nuevo grupo…»; si no puede, lo dice (el grupo queda). */
async function moverAlNuevo(perfilId: string, grupoId: string, ids: readonly string[]): Promise<void> {
  try {
    await window.tessera.ssh.mover({ ids: [...ids], profileId: perfilId, grupoId })
  } catch (err) {
    notify('error', txSsh().grupoCreadoSinMover, mensajeDeErrorSsh(err))
  }
}

/** El título del cuadro del grupo: renombrar, crear, o crear con conexiones dentro. */
function tituloGrupo(grupo: SshGrupo | null, mover: readonly string[]): string {
  const t = txSsh()
  if (grupo !== null) return t.renombrarGrupo
  return mover.length > 0 ? t.nuevoGrupoCon(cuantasConexiones(mover.length)) : t.nuevoGrupo
}

/** Crear un grupo (con `mover`, y pasar esas conexiones a él) o renombrar uno: el nombre en un cuadro, con el error del main dentro. */
function DialogoGrupoSsh({ perfilId, grupo, mover = [] }: { perfilId: string; grupo: SshGrupo | null; mover?: readonly string[] }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const confirmar = async (nombre: string): Promise<void> => {
    if (ocupado) return
    setOcupado(true)
    setError(null)
    try {
      if (grupo === null) {
        const nuevo = await window.tessera.ssh.crearGrupo({ profileId: perfilId, nombre })
        if (mover.length > 0) await moverAlNuevo(perfilId, nuevo.id, mover)
      } else await window.tessera.ssh.renombrarGrupo({ id: grupo.id, profileId: perfilId, nombre })
      accionesSsh.cerrarDialogo()
    } catch (err) {
      setError(mensajeDeErrorSsh(err))
      setOcupado(false)
    }
  }
  return (
    <PromptDialog
      title={tituloGrupo(grupo, mover)}
      label={txSsh().nombreGrupo}
      initialValue={grupo?.nombre ?? ''}
      confirmLabel={grupo === null ? txSsh().crear : txSsh().guardar}
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
      notify('error', txSsh().noSePudoEliminarConexion, mensajeDeErrorSsh(err))
    }
  }
  const t = txSsh()
  return (
    <ConfirmDialog
      danger
      title={t.eliminarConexionTitulo}
      message={`${t.eliminarConexionMensaje(conexion.alias)}\n${t.pestanasSiguen}`}
      confirmLabel={t.eliminarBoton}
      onConfirm={() => void eliminar()}
      onCancel={accionesSsh.cerrarDialogo}
    />
  )
}

/** Confirmar que se olvida la huella guardada: la próxima conexión acepta y guarda la que presente el servidor. */
function ConfirmarOlvidarHuella({ conexion }: { conexion: SshConexion }): React.JSX.Element {
  const olvidar = async (): Promise<void> => {
    accionesSsh.cerrarDialogo()
    try {
      await window.tessera.ssh.olvidarHuella({ id: conexion.id })
      notify('success', txSsh().huellaOlvidada(conexion.alias))
    } catch (err) {
      notify('error', txSsh().noSePudoOlvidarHuella, mensajeDeErrorSsh(err))
    }
  }
  const t = txFormularioSsh()
  return (
    <ConfirmDialog
      danger
      title={t.olvidarHuellaTitulo}
      message={`${txSsh().olvidarHuellaPregunta(conexion.alias)}\n${t.olvidarHuellaMensaje1}\n${t.olvidarHuellaMensaje2}`}
      confirmLabel={txSsh().olvidarBoton}
      onConfirm={() => void olvidar()}
      onCancel={accionesSsh.cerrarDialogo}
    />
  )
}

/** Confirmar el borrado de las conexiones marcadas en el riel, con una sola confirmación y de una vez. */
function ConfirmarEliminarConexiones({ perfilId, conexiones }: { perfilId: string; conexiones: readonly SshConexion[] }): React.JSX.Element {
  const eliminar = async (): Promise<void> => {
    accionesSsh.cerrarDialogo()
    try {
      await window.tessera.ssh.borrarVarias({ ids: conexiones.map((c) => c.id), profileId: perfilId })
    } catch (err) {
      notify('error', txSsh().noSePudieronEliminar, mensajeDeErrorSsh(err))
    }
  }
  return (
    <ConfirmDialog
      danger
      title={txSsh().eliminarVariasTitulo(cuantasConexiones(conexiones.length))}
      message={mensajeEliminarVarias(conexiones.map((c) => c.alias))}
      confirmLabel={txSsh().eliminarBoton}
      onConfirm={() => void eliminar()}
      onCancel={accionesSsh.cerrarDialogo}
    />
  )
}

/** Lo que pasa con las conexiones de un grupo que se elimina. */
function textoConexionesDelGrupo(n: number): string {
  const t = txSsh()
  if (n === 0) return t.grupoSinConexiones
  return n === 1 ? t.grupoUnaConexion : t.grupoVariasConexiones(n)
}

/** Confirmar el borrado de un grupo: sus conexiones no se borran, pasan a «Sin grupo». */
function ConfirmarEliminarGrupo({ grupo, conexiones }: { grupo: SshGrupo; conexiones: number }): React.JSX.Element {
  const eliminar = async (): Promise<void> => {
    accionesSsh.cerrarDialogo()
    try {
      await window.tessera.ssh.borrarGrupo({ id: grupo.id, profileId: grupo.profileId })
    } catch (err) {
      notify('error', txSsh().noSePudoEliminarGrupo, mensajeDeErrorSsh(err))
    }
  }
  const t = txSsh()
  return (
    <ConfirmDialog
      danger
      title={t.eliminarGrupoTitulo}
      message={`${t.eliminarGrupoMensaje(grupo.nombre)}\n${textoConexionesDelGrupo(conexiones)}`}
      confirmLabel={t.eliminarBoton}
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
  if (dialogo.tipo === 'grupo') return <DialogoGrupoSsh key={dialogo.grupo?.id ?? 'nuevo'} perfilId={dialogo.perfilId} grupo={dialogo.grupo} mover={dialogo.mover} />
  if (dialogo.tipo === 'eliminarConexion') return <ConfirmarEliminarConexion conexion={dialogo.conexion} />
  if (dialogo.tipo === 'olvidarHuella') return <ConfirmarOlvidarHuella conexion={dialogo.conexion} />
  if (dialogo.tipo === 'eliminarConexiones') return <ConfirmarEliminarConexiones perfilId={dialogo.perfilId} conexiones={dialogo.conexiones} />
  if (dialogo.tipo === 'moverConexiones') return <DialogoMoverSsh perfilId={dialogo.perfilId} conexiones={dialogo.conexiones} />
  if (dialogo.tipo === 'actividad') return <DialogoActividadSsh perfilId={dialogo.perfilId} alias={dialogo.alias} />
  return <ConfirmarEliminarGrupo grupo={dialogo.grupo} conexiones={dialogo.conexiones} />
}
