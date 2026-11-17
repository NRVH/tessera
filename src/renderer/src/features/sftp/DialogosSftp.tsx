// =============================================================================
// Los diálogos del explorador SFTP: nueva carpeta y renombrar (un nombre, con el error del servidor
// dentro), eliminar (cuántos elementos y que las carpetas se van con todo su contenido, en tono de
// peligro) y reemplazar los nombres que ya existen al subir o bajar. Reutiliza los de `comun`.
// =============================================================================

import { DialogoConfirmar } from '../../comun/DialogoConfirmar'
import { DialogoPrompt } from '../../comun/DialogoPrompt'
import type { SftpPlan } from '../../../../shared/sftp-ipc'
import { mensajeBorrado, mensajeConflictos, tituloBorrado, tituloConflictos } from './operacionesSftp'
import { txSftp } from './textos.ts'
import type { AccionesSftp } from './useAccionesSftp'

export interface PropsDialogosSftp {
  acciones: AccionesSftp
  plan: SftpPlan | null
  onResolverPlan: (reemplazar: boolean) => void
}

export function DialogosSftp({ acciones, plan, onResolverPlan }: PropsDialogosSftp): React.JSX.Element | null {
  const { dialogo } = acciones
  const t = txSftp()
  if (plan !== null) {
    return (
      <DialogoConfirmar
        titulo={tituloConflictos(plan.conflictos.length)}
        mensaje={mensajeConflictos(plan.conflictos)}
        etiquetaConfirmar={t.reemplazar}
        peligro
        onConfirmar={() => onResolverPlan(true)}
        onCancelar={() => onResolverPlan(false)}
      />
    )
  }
  if (dialogo?.tipo === 'carpeta') {
    return (
      <DialogoPrompt
        titulo={t.nuevaCarpeta}
        etiqueta={t.nombreCarpeta}
        error={acciones.errorDialogo}
        onConfirmar={acciones.crearCarpeta}
        onCancelar={acciones.cerrarDialogo}
      />
    )
  }
  if (dialogo?.tipo === 'renombrar') {
    return (
      <DialogoPrompt
        titulo={t.renombrar}
        etiqueta={t.nombreNuevo}
        valorInicial={dialogo.nombre}
        etiquetaConfirmar={t.renombrar}
        seleccionarNombreBase
        error={acciones.errorDialogo}
        onConfirmar={acciones.renombrar}
        onCancelar={acciones.cerrarDialogo}
      />
    )
  }
  if (dialogo?.tipo === 'borrar') {
    return (
      <DialogoConfirmar
        titulo={tituloBorrado(dialogo.nombres.length)}
        mensaje={mensajeBorrado(dialogo.nombres, dialogo.hayCarpetas)}
        etiquetaConfirmar={t.eliminar}
        peligro
        onConfirmar={acciones.borrar}
        onCancelar={acciones.cerrarDialogo}
      />
    )
  }
  return null
}
