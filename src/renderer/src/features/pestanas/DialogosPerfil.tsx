// =============================================================================
// DialogosPerfil: los tres diálogos de la banda de perfiles (confirmar hibernación,
// confirmar eliminación y red del contenedor). Sin estado propio: monta el que tenga abierto
// `useAccionesPerfil`. Dependen de comun/ConfirmDialog y del modal de red.
// Decisiones: docs/decisiones/renderer/red-del-contenedor.md
// =============================================================================
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { RedContenedorModal } from './RedContenedorModal'
import type { Profile } from '../../../../main/profiles/types'
import type { AccionesPerfil, HibernacionPendiente } from './useAccionesPerfil'

/** Confirmación de hibernar un perfil con un agente trabajando. */
function ConfirmarHibernacion({
  hibernating,
  onConfirm,
  onCancel
}: {
  hibernating: HibernacionPendiente
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <ConfirmDialog
      title={`Hibernar el perfil "${hibernating.profile.nombre}"`}
      message={
        'Hay un agente TRABAJANDO en este perfil. Al hibernar se cierra su sesión\n' +
        'y el turno en curso se pierde (la conversación no: al volver, se reanuda).\n\n' +
        'También se cierran las terminales de este perfil, con lo que estén\n' +
        'ejecutando: Tessera no puede saber si hay algo corriendo en ellas.'
      }
      confirmLabel="Hibernar"
      cancelLabel="Cancelar"
      // `danger` aunque no se borre nada: sin él ConfirmDialog enfoca CONFIRMAR, y este
      // diálogo sale justo tras teclear en una terminal, cuando un Enter suelto es más probable.
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

/** Confirmación de eliminar un perfil. */
function ConfirmarEliminarPerfil({
  profile,
  onConfirm,
  onCancel
}: {
  profile: Profile
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <ConfirmDialog
      title={`Eliminar el perfil "${profile.nombre}"`}
      message={
        'Se cerrarán sus sesiones y se detendrá su contenedor.\n' +
        'No se borran sus credenciales del disco: si lo recreas, las reencuentra.'
      }
      confirmLabel="Eliminar"
      cancelLabel="Cancelar"
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

/** Diálogo de red del contenedor del perfil `profileId` (nada si ya no existe). */
function ModalRedPerfil({
  profiles,
  profileId,
  onCancel,
  onAplicar
}: {
  profiles: Profile[]
  profileId: string
  onCancel: () => void
  onAplicar: (profile: Profile, redHost: boolean) => void
}): React.JSX.Element | null {
  const p = profiles.find((x) => x.id === profileId)
  if (!p) return null
  return (
    <RedContenedorModal profile={p} onCancel={onCancel} onAplicar={(redHost) => onAplicar(p, redHost)} />
  )
}

/** Los diálogos de la banda: se monta el que `acciones` tenga abierto. */
export function DialogosPerfil({
  profiles,
  acciones
}: {
  profiles: Profile[]
  acciones: AccionesPerfil
}): React.JSX.Element {
  return (
    <>
      {acciones.hibernating && (
        <ConfirmarHibernacion
          hibernating={acciones.hibernating}
          onConfirm={acciones.confirmarHibernacion}
          onCancel={acciones.cancelarHibernacion}
        />
      )}

      {acciones.deleting && (
        <ConfirmarEliminarPerfil
          profile={acciones.deleting}
          onConfirm={acciones.confirmarEliminar}
          onCancel={acciones.cancelarEliminar}
        />
      )}

      {acciones.redModal !== null && (
        <ModalRedPerfil
          profiles={profiles}
          profileId={acciones.redModal}
          onCancel={acciones.cerrarRed}
          onAplicar={acciones.aplicarRed}
        />
      )}
    </>
  )
}
