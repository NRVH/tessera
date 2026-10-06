// =============================================================================
// Los diálogos del explorador SFTP: nueva carpeta y renombrar (un nombre, con el error del servidor
// dentro), eliminar (cuántos elementos y que las carpetas se van con todo su contenido, en tono de
// peligro) y reemplazar los nombres que ya existen al subir o bajar. Reutiliza los de `comun`.
// =============================================================================

import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { PromptDialog } from '../../comun/PromptDialog'
import type { SftpPlan } from '../../../../shared/sftp-ipc'
import { mensajeBorrado, mensajeConflictos, tituloBorrado, tituloConflictos } from './operacionesSftp'
import type { AccionesSftp } from './useAccionesSftp'

export interface PropsDialogosSftp {
  acciones: AccionesSftp
  plan: SftpPlan | null
  onResolverPlan: (reemplazar: boolean) => void
}

export function DialogosSftp({ acciones, plan, onResolverPlan }: PropsDialogosSftp): React.JSX.Element | null {
  const { dialogo } = acciones
  if (plan !== null) {
    return (
      <ConfirmDialog
        title={tituloConflictos(plan.conflictos.length)}
        message={mensajeConflictos(plan.conflictos)}
        confirmLabel="Reemplazar"
        danger
        onConfirm={() => onResolverPlan(true)}
        onCancel={() => onResolverPlan(false)}
      />
    )
  }
  if (dialogo?.tipo === 'carpeta') {
    return (
      <PromptDialog
        title="Nueva carpeta"
        label="Nombre de la carpeta"
        error={acciones.errorDialogo}
        onConfirm={acciones.crearCarpeta}
        onCancel={acciones.cerrarDialogo}
      />
    )
  }
  if (dialogo?.tipo === 'renombrar') {
    return (
      <PromptDialog
        title="Renombrar"
        label="Nombre nuevo"
        initialValue={dialogo.nombre}
        confirmLabel="Renombrar"
        selectBasename
        error={acciones.errorDialogo}
        onConfirm={acciones.renombrar}
        onCancel={acciones.cerrarDialogo}
      />
    )
  }
  if (dialogo?.tipo === 'borrar') {
    return (
      <ConfirmDialog
        title={tituloBorrado(dialogo.nombres.length)}
        message={mensajeBorrado(dialogo.nombres, dialogo.hayCarpetas)}
        confirmLabel="Eliminar"
        danger
        onConfirm={acciones.borrar}
        onCancel={acciones.cerrarDialogo}
      />
    )
  }
  return null
}
