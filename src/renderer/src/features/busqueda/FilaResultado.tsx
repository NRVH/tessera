// =============================================================================
// Una fila de la lista de resultados: a la izquierda la línea con la coincidencia resaltada
// (o la ruta, si casó el nombre del archivo) y a la derecha el archivo con su línea.
// Clic simple selecciona y actualiza la previa; doble clic abre.
// =============================================================================
import type { CoincidenciaArchivo } from '../../../../shared/search-ipc'

interface FilaResultadoProps {
  coincidencia: CoincidenciaArchivo
  activa: boolean
  onSeleccionar: () => void
  onAbrir: () => void
}

/** Una fila de resultado. */
export function FilaResultado({
  coincidencia: c,
  activa,
  onSeleccionar,
  onAbrir
}: FilaResultadoProps): React.JSX.Element {
  const i = Math.max(0, c.columna - 1)
  const antes = c.texto.slice(0, i)
  const medio = c.texto.slice(i, i + c.longitud)
  const despues = c.texto.slice(i + c.longitud)

  return (
    <div
      className={`buscar-fila${activa ? ' activa' : ''}`}
      onClick={onSeleccionar}
      onDoubleClick={onAbrir}
      title={`${c.path}${c.linea > 0 ? `:${c.linea}` : ''}`}
      role="option"
      aria-selected={activa}
    >
      <span className="buscar-fila-texto">
        {antes}
        <mark className="buscar-fila-match">{medio}</mark>
        {despues}
      </span>
      {/* Solo nombre y línea: la ruta completa está en el `title` y en la cabecera de la previa. */}
      <span className="buscar-fila-meta">
        <span className="buscar-fila-nombre">{c.nombre}</span>
        <EtiquetaLinea c={c} />
      </span>
    </div>
  )
}

/** La línea, o una marca cuando no la hay: no se finge un número que no existe. */
function EtiquetaLinea({ c }: { c: CoincidenciaArchivo }): React.JSX.Element {
  if (c.linea > 0) return <span className="buscar-fila-linea">{c.linea}</span>
  if (c.origen === 'archivo') {
    return (
      <span className="buscar-fila-chip" title="El nombre del archivo coincide">
        archivo
      </span>
    )
  }
  return (
    <span
      className="buscar-fila-chip"
      title="Coincide en el nombre o en una constante de la clase compilada"
    >
      clase
    </span>
  )
}
