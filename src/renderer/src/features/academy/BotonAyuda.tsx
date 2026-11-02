// =============================================================================
// El botón ⓘ del encabezado de un diálogo o popover: abre el lector de Tessera Academy en la
// sección que lo explica, encima de lo que haya. Los destinos viven en `ayudas.ts`. No propaga el clic para que
// el popover que lo contiene no lo tome por un clic suyo.
// =============================================================================

import type { DestinoAyuda } from './ayudas'
import { IconoInfo } from './iconosAcademy'
import { tituloDe } from './indice'
import { partirDestino } from './modelo'
import { abrirAcademy } from './store'
import { txAcademy } from './textos'
import type { ArticuloId } from './indice'
import './academy.css'

export function BotonAyuda({
  destino,
  className,
  alAbrir
}: {
  destino: DestinoAyuda
  className?: string
  /** Lo que hace el anfitrión al abrirse la Academy: un popover se cierra; un diálogo se queda debajo. */
  alAbrir?: () => void
}): React.JSX.Element {
  const t = txAcademy()
  const titulo = tituloDe(partirDestino(destino).articulo as ArticuloId)
  return (
    <button
      type="button"
      className={`boton-ayuda${className ? ` ${className}` : ''}`}
      title={t.ayudaTitulo(titulo)}
      aria-label={t.ayudaAria(titulo)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        alAbrir?.()
        abrirAcademy(destino)
      }}
    >
      <IconoInfo />
    </button>
  )
}
