// =============================================================================
// DialogosPerfil: los diálogos de la banda de perfiles (confirmar hibernación, cambio de red y
// eliminación, y red del contenedor). Sin estado propio: monta el que tenga abierto `useAccionesPerfil`.
// Las reglas para los agentes se editan en el contexto de los agentes, que tiene su propia capa.
// Dependen de comun/ConfirmDialog, del modal de red y de shared/nombresSistema.
// Decisiones: docs/decisiones/renderer/red-del-contenedor.md
// =============================================================================
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { AYUDA, BotonAyuda } from '../academy'
import { RedContenedorModal } from './RedContenedorModal'
import { ClavesAgenteModal } from './ClavesAgenteModal'
import { nombresSistema } from '../../../../shared/nombresSistema'
import type { Profile } from '../../../../main/profiles/types'
import { txPestanas } from './textos.ts'
import type { AccionesPerfil, HibernacionPendiente, RedPendiente } from './useAccionesPerfil'
import type { ConfirmacionHibernar } from './confirmaciones'

/** El mensaje de hibernar: el agente que se corta, las terminales que se cierran, o las dos cosas. */
function mensajeHibernar({ agente, terminales }: ConfirmacionHibernar): string {
  const t = txPestanas().dialogos
  const lineas: string[] = []
  if (agente) lineas.push(t.hibernarAgente)
  if (terminales?.tipo === 'en-marcha') lineas.push(t.hibernarEnMarcha(terminales.n))
  else if (terminales?.tipo === 'abiertas') lineas.push(t.hibernarAbiertas(terminales.n))
  else if (terminales?.tipo === 'sin-saber') lineas.push(t.hibernarTerminales)
  if (!agente) lineas.push(t.hibernarConversaciones)
  return lineas.join('\n')
}

/** Confirmación de hibernar un perfil con un agente trabajando o una terminal ejecutando algo. */
function ConfirmarHibernacion({
  hibernating,
  onConfirm,
  onCancel
}: {
  hibernating: HibernacionPendiente
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const t = txPestanas().dialogos
  return (
    <ConfirmDialog
      title={t.hibernarTitulo(hibernating.profile.nombre)}
      ayuda={<BotonAyuda destino={AYUDA.hibernarPerfil} />}
      message={mensajeHibernar(hibernating.confirmacion)}
      confirmLabel={t.hibernar(hibernating.profile.nombre)}
      cancelLabel={t.cancelar}
      // `danger` aunque no se borre nada: sin él ConfirmDialog enfoca CONFIRMAR, y este
      // diálogo sale justo tras teclear en una terminal, cuando un Enter suelto es más probable.
      danger
      severidad="advertencia"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

/** Confirmación de cambiar la red cuando corta algo: aplicarla reinicia el contenedor e hiberna el perfil. */
function ConfirmarCambioRed({
  pendiente,
  onConfirm,
  onCancel
}: {
  pendiente: RedPendiente
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const t = txPestanas().dialogos
  return (
    <ConfirmDialog
      title={t.redTitulo(pendiente.profile.nombre)}
      message={`${t.redMensaje}\n${mensajeHibernar(pendiente.confirmacion)}`}
      confirmLabel={t.redCambiar}
      cancelLabel={t.cancelar}
      // Como hibernar: se corta un turno, y el foco en «Cancelar» evita el Enter reflejo.
      danger
      severidad="advertencia"
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
  // En el renderer no hay `process`: la plataforma llega por el preload.
  const { papelera } = nombresSistema(window.tessera.plataforma)
  const t = txPestanas().dialogos
  return (
    <ConfirmDialog
      title={t.eliminarTitulo(profile.nombre)}
      message={t.eliminarMensaje(papelera)}
      confirmLabel={t.eliminar(profile.nombre)}
      cancelLabel={t.cancelar}
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
      {acciones.clavesSsh !== null && profiles.filter((perfil) => perfil.id === acciones.clavesSsh).map((perfil) => <ClavesAgenteModal key={perfil.id} perfil={perfil} alCerrar={acciones.cerrarClavesSsh} />)}
      {acciones.hibernating && (
        <ConfirmarHibernacion
          hibernating={acciones.hibernating}
          onConfirm={acciones.confirmarHibernacion}
          onCancel={acciones.cancelarHibernacion}
        />
      )}

      {acciones.cambiandoRed && (
        <ConfirmarCambioRed pendiente={acciones.cambiandoRed} onConfirm={acciones.confirmarRed} onCancel={acciones.cancelarRed} />
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
