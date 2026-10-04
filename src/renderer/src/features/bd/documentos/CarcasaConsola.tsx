// =============================================================================
// La carcasa de una consola de MongoDB o de Redis: la sección que recibe Detener con el foco
// fuera del editor y la pregunta pendiente. La pregunta va por portal a `document.body`: la
// carcasa puede pedir cerrar una consola OCULTA y un diálogo dentro de un `display:none`
// dejaría su promesa colgada.
// =============================================================================

import { createPortal } from 'react-dom'
import { esDetener } from '../../../util/atajos'
import { ConfirmDialog } from '../../../comun/ConfirmDialog'
import type { Dialogo } from './consolaComun'

/** La sección de la consola con Detener fuera del editor y su diálogo por portal. */
export function CarcasaConsola({
  colRef,
  visible,
  nombre,
  dialogo,
  onDetener,
  children
}: {
  colRef: (node: HTMLElement | null) => void
  visible: boolean
  nombre: string
  dialogo: Dialogo | null
  onDetener: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      ref={colRef}
      className={`db-consola${visible ? '' : ' hidden'}`}
      aria-label={`Consola ${nombre}`}
      aria-hidden={!visible}
      onKeyDown={(e) => {
        // Detener con el foco FUERA del editor; dentro lo consume su `addAction`.
        // Nunca a través de un diálogo ni desde un portal.
        if (dialogo !== null) return
        if (!(e.target instanceof Node && e.currentTarget.contains(e.target))) return
        if (!esDetener(e, window.tessera.plataforma)) return
        e.preventDefault()
        onDetener()
      }}
    >
      {children}
      {dialogo &&
        createPortal(
          <ConfirmDialog
            title={dialogo.titulo}
            message={dialogo.mensaje}
            confirmLabel={dialogo.confirmar}
            danger={dialogo.peligro}
            onConfirm={() => dialogo.resolver(true)}
            onCancel={() => dialogo.resolver(false)}
          />,
          document.body
        )}
    </section>
  )
}

/** El aviso de que el archivo cambió fuera de Tessera, con sus dos salidas. */
export function AvisoConflicto({
  onCargarDelDisco,
  onConservarLaMia
}: {
  onCargarDelDisco: () => void
  onConservarLaMia: () => void
}): React.JSX.Element {
  return (
    <div className="db-consola-conflicto" role="alert">
      <span className="db-consola-conflicto-texto">El archivo cambió fuera de Tessera</span>
      <button type="button" className="btn" onClick={onCargarDelDisco}>
        Cargar la del disco
      </button>
      <button type="button" className="btn" onClick={onConservarLaMia}>
        Conservar la mía
      </button>
    </div>
  )
}
