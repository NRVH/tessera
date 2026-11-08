// =============================================================================
// Botón de icono de las barras de la vista de bases de datos, con su motivo de
// deshabilitado en el envoltorio (sobre un control deshabilitado no llegan eventos de
// ratón, y un motivo que no se puede leer no explica nada). Lo comparten las pestañas
// de datos (`DatosBarra.tsx`), fuente, colección, documento y clave.
// =============================================================================

import { useConfirmacionCopiar } from '../../../comun/useConfirmacionCopiar'
import { IconoCopiar } from '../../../comun/iconosMenu'
import { copiarTexto } from '../documentos/utilPanes'

/** Botón de icono de barra; con `motivo` va apagado y el motivo sale en el `title`. */
export function BotonBarraBd({
  etiqueta,
  titulo,
  motivo = null,
  onClick,
  children
}: {
  etiqueta: string
  titulo: string
  /** Por qué está deshabilitado; null = habilitado. */
  motivo?: string | null
  /** Con el evento: un botón que abre un menú lo ancla a su propia caja. */
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}): React.JSX.Element {
  const apagado = motivo !== null
  return (
    <span className="btn-envoltura" title={apagado ? motivo : undefined}>
      <button
        type="button"
        className="btn btn-icon"
        onClick={onClick}
        disabled={apagado}
        title={apagado ? undefined : titulo}
        aria-label={etiqueta}
      >
        {children}
      </button>
    </span>
  )
}

/** La palomita confirma únicamente una escritura completada en el portapapeles. */
export function BotonCopiarBd({ texto, etiqueta, titulo }: { texto: string; etiqueta: string; titulo: string }): React.JSX.Element {
  const { copiado, confirmar } = useConfirmacionCopiar()
  return <BotonBarraBd etiqueta={etiqueta} titulo={titulo} onClick={() => { void copiarTexto(texto, etiqueta).then((ok) => { if (ok) confirmar() }) }}>
    <IconoCopiar copiado={copiado} />
  </BotonBarraBd>
}
