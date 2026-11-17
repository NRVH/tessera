// =============================================================================
// DialogosPerfil: los diálogos de la banda de perfiles (confirmar hibernación, cambio de red y
// eliminación, y red del contenedor). Sin estado propio: monta el que tenga abierto `useAccionesPerfil`.
// Las reglas para los agentes se editan en el contexto de los agentes, que tiene su propia capa.
// Dependen de comun/DialogoConfirmar, del modal de red y de shared/nombresSistema.
// Decisiones: docs/decisiones/renderer/red-del-contenedor.md
// =============================================================================
import { DialogoConfirmar } from '../../comun/DialogoConfirmar'
import { AYUDA, BotonAyuda } from '../academy'
import { ModalRedContenedor } from './ModalRedContenedor'
import { ModalClavesAgente } from './ModalClavesAgente'
import { nombresSistema } from '../../../../shared/nombresSistema'
import type { Perfil } from '../../../../main/perfiles/types'
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
  pendiente,
  onConfirmar,
  onCancelar
}: {
  pendiente: HibernacionPendiente
  onConfirmar: () => void
  onCancelar: () => void
}): React.JSX.Element {
  const t = txPestanas().dialogos
  return (
    <DialogoConfirmar
      titulo={t.hibernarTitulo(pendiente.perfil.nombre)}
      ayuda={<BotonAyuda destino={AYUDA.hibernarPerfil} />}
      mensaje={mensajeHibernar(pendiente.confirmacion)}
      etiquetaConfirmar={t.hibernar(pendiente.perfil.nombre)}
      etiquetaCancelar={t.cancelar}
      // `danger` aunque no se borre nada: sin él DialogoConfirmar enfoca CONFIRMAR, y este
      // diálogo sale justo tras teclear en una terminal, cuando un Enter suelto es más probable.
      peligro
      severidad="advertencia"
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
    />
  )
}

/** Confirmación de cambiar la red cuando corta algo: aplicarla reinicia el contenedor e hiberna el perfil. */
function ConfirmarCambioRed({
  pendiente,
  onConfirmar,
  onCancelar
}: {
  pendiente: RedPendiente
  onConfirmar: () => void
  onCancelar: () => void
}): React.JSX.Element {
  const t = txPestanas().dialogos
  return (
    <DialogoConfirmar
      titulo={t.redTitulo(pendiente.perfil.nombre)}
      mensaje={`${t.redMensaje}\n${mensajeHibernar(pendiente.confirmacion)}`}
      etiquetaConfirmar={t.redCambiar}
      etiquetaCancelar={t.cancelar}
      // Como hibernar: se corta un turno, y el foco en «Cancelar» evita el Enter reflejo.
      peligro
      severidad="advertencia"
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
    />
  )
}

/** Confirmación de eliminar un perfil. */
function ConfirmarEliminarPerfil({
  perfil,
  onConfirmar,
  onCancelar
}: {
  perfil: Perfil
  onConfirmar: () => void
  onCancelar: () => void
}): React.JSX.Element {
  // En el renderer no hay `process`: la plataforma llega por el preload.
  const { papelera } = nombresSistema(window.tessera.plataforma)
  const t = txPestanas().dialogos
  return (
    <DialogoConfirmar
      titulo={t.eliminarTitulo(perfil.nombre)}
      mensaje={t.eliminarMensaje(papelera)}
      etiquetaConfirmar={t.eliminar(perfil.nombre)}
      etiquetaCancelar={t.cancelar}
      peligro
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
    />
  )
}

/** Diálogo de red del contenedor del perfil `profileId` (nada si ya no existe). */
function ModalRedPerfil({
  perfiles,
  perfilId,
  onCancelar,
  onAplicar
}: {
  perfiles: Perfil[]
  perfilId: string
  onCancelar: () => void
  onAplicar: (perfil: Perfil, redHost: boolean) => void
}): React.JSX.Element | null {
  const p = perfiles.find((x) => x.id === perfilId)
  if (!p) return null
  return (
    <ModalRedContenedor perfil={p} onCancelar={onCancelar} onAplicar={(redHost) => onAplicar(p, redHost)} />
  )
}

/** Los diálogos de la banda: se monta el que `acciones` tenga abierto. */
export function DialogosPerfil({
  perfiles,
  acciones
}: {
  perfiles: Perfil[]
  acciones: AccionesPerfil
}): React.JSX.Element {
  return (
    <>
      {acciones.clavesSsh !== null && perfiles.filter((perfil) => perfil.id === acciones.clavesSsh).map((perfil) => <ModalClavesAgente key={perfil.id} perfil={perfil} alCerrar={acciones.cerrarClavesSsh} />)}
      {acciones.hibernacionPendiente && (
        <ConfirmarHibernacion
          pendiente={acciones.hibernacionPendiente}
          onConfirmar={acciones.confirmarHibernacion}
          onCancelar={acciones.cancelarHibernacion}
        />
      )}

      {acciones.cambiandoRed && (
        <ConfirmarCambioRed pendiente={acciones.cambiandoRed} onConfirmar={acciones.confirmarRed} onCancelar={acciones.cancelarRed} />
      )}

      {acciones.eliminacionPendiente && (
        <ConfirmarEliminarPerfil
          perfil={acciones.eliminacionPendiente}
          onConfirmar={acciones.confirmarEliminar}
          onCancelar={acciones.cancelarEliminar}
        />
      )}

      {acciones.redModal !== null && (
        <ModalRedPerfil
          perfiles={perfiles}
          perfilId={acciones.redModal}
          onCancelar={acciones.cerrarRed}
          onAplicar={acciones.aplicarRed}
        />
      )}
    </>
  )
}
