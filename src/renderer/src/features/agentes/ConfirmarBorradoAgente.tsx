// =============================================================================
// Confirmación de eliminar un agente definido a mano: dice de dónde desaparece (todos los
// proyectos nativos, o los Docker del perfil) y qué se borra con él. La usan el selector de la
// cabecera y Configuración › Agentes.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================
import { DialogoConfirmar } from '../../comun/DialogoConfirmar'
import { notifyError } from '../../comun/notificaciones'
import type { DefinicionAgente } from '../../../../shared/agentesManuales'
import { eliminarAgenteManual } from './store'
import { txPane } from './textosPane.ts'

export function ConfirmarBorradoAgente({
  d,
  perfilId: profileId,
  nativo,
  onCerrar
}: {
  d: DefinicionAgente
  perfilId: string
  nativo: boolean
  onCerrar: () => void
}): React.JSX.Element {
  const t = txPane().pestanas
  return (
    <DialogoConfirmar
      peligro
      titulo={t.eliminarTitulo(d.nombre)}
      mensaje={t.eliminarMensaje(nativo)}
      etiquetaConfirmar={t.eliminar}
      onConfirmar={() => {
        eliminarAgenteManual(nativo ? { nativo: true } : { nativo: false, perfilId: profileId }, d.id)
        // En Docker sus cuentas y su carpeta son del perfil: si se quedaran, un agente nuevo con el mismo nombre las heredaría.
        if (!nativo) {
          window.tessera.cuentasAgente
            .olvidarAgenteManual({ profileId, agente: d.id })
            .catch((err: unknown) => notifyError(t.noSeBorraronCuentas, err))
        }
        onCerrar()
      }}
      onCancelar={onCerrar}
    />
  )
}
