// =============================================================================
// Los diálogos y el menú de la pestaña de colección: el menú contextual, «Descartar N
// cambios», la vista previa de «Enviar» (`DialogoEnvio`, con las órdenes del shell) y sus
// confirmaciones (producción y servidor sin transacciones). Van
// por portal a `document.body`: uno dentro de la pestaña oculta dejaría su promesa colgada.
// =============================================================================

import { createPortal } from 'react-dom'
import type { ConexionBd } from '../../../../../shared/db-ipc'
import { textoSinTransaccion, textoCambiosDocs } from './coleccionDocs'
import { txColeccionDocs } from './textosColeccionDocs'
import type { EstadoEdicion } from './useEdicionColeccion'
import { DialogoConfirmar } from '../../../comun/DialogoConfirmar'
import { MenuContextual } from '../../../comun/MenuContextual'
import { DialogoEnvio } from '../DialogoEnvio'

export interface DatosDialogos {
  conexion: ConexionBd
  base: string
  coleccion: string
  estadoEdicion: EstadoEdicion
  /** Los cambios que se perderían, mientras se pregunta si descartarlos. */
  descarte: { n: number } | null
  onResponderDescarte: (ok: boolean) => void
  onResponderConfirmacion: (ok: boolean) => void
  onAceptarVistaPrevia: () => void
}


function vistaPreviaEnvio(d: DatosDialogos): React.JSX.Element | null {
  const v = d.estadoEdicion.vistaPrevia
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
      // Lo que se dice tras el resumen: MongoDB solo va todo o nada si el servidor admite transacciones.
      mensaje={txColeccionDocs().vistaPrevia}
      onEnviar={d.onAceptarVistaPrevia}
      onCerrar={() => d.estadoEdicion.setVistaPrevia(null)}
    />
  )
}

function confirmacionEnvio(d: DatosDialogos): React.JSX.Element | null {
  const { confirmacion, pendientes } = d.estadoEdicion
  if (!confirmacion) return null
  const destino = `${d.base}.${d.coleccion}`
  const t = txColeccionDocs()
  return confirmacion.tipo === 'produccion' ? (
    <DialogoConfirmar
      titulo={t.produccionTitulo(d.conexion.alias)}
      mensaje={t.produccionMensaje(textoCambiosDocs(pendientes), destino)}
      etiquetaConfirmar={t.ejecutarEnProduccion}
      peligro
      severidad="advertencia"
      onConfirmar={() => d.onResponderConfirmacion(true)}
      onCancelar={() => d.onResponderConfirmacion(false)}
    />
  ) : (
    <DialogoConfirmar
      titulo={t.sinTransaccionTitulo(textoCambiosDocs(pendientes))}
      mensaje={textoSinTransaccion()}
      etiquetaConfirmar={t.enviarSinTransaccion}
      peligro
      severidad="advertencia"
      onConfirmar={() => d.onResponderConfirmacion(true)}
      onCancelar={() => d.onResponderConfirmacion(false)}
    />
  )
}

/** Los portales: menú, descartar, vista previa de «Enviar» y confirmación de envío. */
export function dialogosColeccion(d: DatosDialogos): React.JSX.Element {
  const { menu, setMenu } = d.estadoEdicion
  const envio = confirmacionEnvio(d)
  const previa = vistaPreviaEnvio(d)
  const t = txColeccionDocs()
  return (
    <>
      {menu && createPortal(<MenuContextual x={menu.x} y={menu.y} items={menu.items} onCerrar={() => setMenu(null)} />, document.body)}
      {d.descarte &&
        createPortal(
          <DialogoConfirmar
            titulo={t.descartarTitulo(textoCambiosDocs(d.descarte.n))}
            mensaje={t.descartarMensaje(`${d.base}.${d.coleccion}`, textoCambiosDocs(d.descarte.n))}
            etiquetaConfirmar={t.descartar}
            peligro
            onConfirmar={() => d.onResponderDescarte(true)}
            onCancelar={() => d.onResponderDescarte(false)}
          />,
          document.body
        )}
      {previa && createPortal(previa, document.body)}
      {envio && createPortal(envio, document.body)}
    </>
  )
}
