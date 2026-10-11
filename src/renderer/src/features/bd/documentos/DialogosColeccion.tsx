// =============================================================================
// Los diálogos y el menú de la pestaña de colección: el menú contextual, «Descartar N
// cambios», la vista previa de «Enviar» (`DialogoEnvio`, con las órdenes del shell) y sus
// confirmaciones (producción y servidor sin transacciones). Van
// por portal a `document.body`: uno dentro de la pestaña oculta dejaría su promesa colgada.
// =============================================================================

import { createPortal } from 'react-dom'
import type { DbConnection } from '../../../../../shared/db-ipc'
import { TEXTO_SIN_TRANSACCION, textoCambiosDocs } from './coleccionDocs'
import type { EstadoEdicion } from './useEdicionColeccion'
import { ConfirmDialog } from '../../../comun/ConfirmDialog'
import { ContextMenu } from '../../../comun/ContextMenu'
import { DialogoEnvio } from '../DialogoEnvio'

export interface DatosDialogos {
  conexion: DbConnection
  base: string
  coleccion: string
  ed: EstadoEdicion
  /** Los cambios que se perderían, mientras se pregunta si descartarlos. */
  descarte: { n: number } | null
  onResponderDescarte: (ok: boolean) => void
  onResponderConfirmacion: (ok: boolean) => void
  onAceptarVistaPrevia: () => void
}

/** Lo que se dice tras el resumen: MongoDB solo va todo o nada si el servidor admite transacciones. */
const MENSAJE_VISTA_PREVIA = 'en UNA transacción si el servidor las admite: si uno falla, no se aplica ninguno.'

function vistaPreviaEnvio(d: DatosDialogos): React.JSX.Element | null {
  const v = d.ed.vistaPrevia
  if (!v) return null
  return (
    <DialogoEnvio
      alias={d.conexion.alias}
      entorno={d.conexion.entorno}
      tabla={`${d.base}.${d.coleccion}`}
      resumen={v.resumen}
      lineas={v.lineas}
      estado={{ tipo: 'listo' }}
      lenguaje="shell"
      mensaje={MENSAJE_VISTA_PREVIA}
      onEnviar={d.onAceptarVistaPrevia}
      onCerrar={() => d.ed.setVistaPrevia(null)}
    />
  )
}

function confirmacionEnvio(d: DatosDialogos): React.JSX.Element | null {
  const { confirmacion, pendientes } = d.ed
  if (!confirmacion) return null
  const destino = `${d.base}.${d.coleccion}`
  return confirmacion.tipo === 'produccion' ? (
    <ConfirmDialog
      title={`PRODUCCIÓN · ${d.conexion.alias}`}
      message={`Vas a enviar ${textoCambiosDocs(pendientes)} a ${destino}, en una conexión de PRODUCCIÓN.`}
      confirmLabel="Ejecutar en producción"
      danger
      onConfirm={() => d.onResponderConfirmacion(true)}
      onCancel={() => d.onResponderConfirmacion(false)}
    />
  ) : (
    <ConfirmDialog
      title="Sin transacciones"
      message={`${TEXTO_SIN_TRANSACCION}\n\n¿Enviar ${textoCambiosDocs(pendientes)} de todas formas?`}
      confirmLabel="Enviar sin transacción"
      danger
      onConfirm={() => d.onResponderConfirmacion(true)}
      onCancel={() => d.onResponderConfirmacion(false)}
    />
  )
}

/** Los portales: menú, descartar, vista previa de «Enviar» y confirmación de envío. */
export function dialogosColeccion(d: DatosDialogos): React.JSX.Element {
  const { menu, setMenu } = d.ed
  const envio = confirmacionEnvio(d)
  const previa = vistaPreviaEnvio(d)
  return (
    <>
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />, document.body)}
      {d.descarte &&
        createPortal(
          <ConfirmDialog
            title={`Descartar ${textoCambiosDocs(d.descarte.n)} sin enviar`}
            message={`${d.base}.${d.coleccion} tiene ${textoCambiosDocs(d.descarte.n)} que no se han enviado. Si los descartas, se pierden.`}
            confirmLabel="Descartar"
            danger
            onConfirm={() => d.onResponderDescarte(true)}
            onCancel={() => d.onResponderDescarte(false)}
          />,
          document.body
        )}
      {previa && createPortal(previa, document.body)}
      {envio && createPortal(envio, document.body)}
    </>
  )
}
