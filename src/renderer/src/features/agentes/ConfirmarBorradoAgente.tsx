// =============================================================================
// Confirmación de eliminar un agente definido a mano: dice de dónde desaparece (todos los
// proyectos nativos, o los Docker del perfil) y qué se borra con él. La usan el selector de la
// cabecera y Configuración › Agentes.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { notifyError } from '../../comun/notifications'
import type { DefinicionAgente } from '../../../../shared/agentesManuales'
import { eliminarAgenteManual } from './store'
import { txPane } from './textosPane.ts'

export function ConfirmarBorradoAgente({
  d,
  profileId,
  nativo,
  onCerrar
}: {
  d: DefinicionAgente
  profileId: string
  nativo: boolean
  onCerrar: () => void
}): React.JSX.Element {
  const t = txPane().pestanas
  return (
    <ConfirmDialog
      danger
      title={t.eliminarTitulo(d.nombre)}
      message={t.eliminarMensaje(nativo)}
      confirmLabel={t.eliminar}
      onConfirm={() => {
        eliminarAgenteManual(nativo ? { nativo: true } : { nativo: false, profileId }, d.id)
        // En Docker sus cuentas y su carpeta son del perfil: si se quedaran, un agente nuevo con el mismo nombre las heredaría.
        if (!nativo) {
          window.tessera.agentAccounts
            .olvidarAgenteManual({ profileId, agente: d.id })
            .catch((err: unknown) => notifyError(t.noSeBorraronCuentas, err))
        }
        onCerrar()
      }}
      onCancel={onCerrar}
    />
  )
}
