// =============================================================================
// El cuerpo del modal de búsqueda: la lista de coincidencias, el divisor y la vista previa.
// Sin filas no se desmontan (lo cubre una capa por encima): desmontar la previa costaría un
// Monaco nuevo por pulsación de tecla.
// Decisiones: docs/decisiones/busqueda/vista-previa-monaco.md
// =============================================================================
import type { Dispatch, SetStateAction } from 'react'
import { VirtualList } from '../../comun/VirtualList'
import { Splitter } from '../../comun/Splitter'
import { FilaResultado } from './FilaResultado'
import { VistaPreviaBusqueda } from './VistaPreviaBusqueda'
import { seleccionar, type EstadoBusqueda } from './filasResultado'
import type { CoincidenciaArchivo } from '../../../../shared/search-ipc'
import type { OpcionesBusqueda } from '../../../../shared/textSearch'

/** Reparto vertical entre lista y previa. */
const PREVIA_MIN = 120
const PREVIA_MAX = 900

interface CuerpoResultadosProps {
  estado: EstadoBusqueda
  onEstado: Dispatch<SetStateAction<EstadoBusqueda>>
  altoDeFila: number
  altoPrevia: number
  onAltoPrevia: (alto: number) => void
  fila: CoincidenciaArchivo | null
  query: string
  opts: OpcionesBusqueda
  projectKey: string
  onAbrir: (c: CoincidenciaArchivo) => void
  /** El estado vacío que tapa lista y previa, o null si hay filas. */
  vacio: React.ReactNode
}

/** Lista de resultados, divisor y vista previa, con el estado vacío como capa. */
export function CuerpoResultados({
  estado,
  onEstado,
  altoDeFila,
  altoPrevia,
  onAltoPrevia,
  fila,
  query,
  opts,
  projectKey,
  onAbrir,
  vacio
}: CuerpoResultadosProps): React.JSX.Element {
  return (
    <div className="buscar-cuerpo">
      <VirtualList
        className="buscar-lista"
        ariaLabel="Resultados de la búsqueda"
        items={estado.filas}
        itemHeight={altoDeFila}
        // Lleva el índice porque un .class puede dar la misma cadena dos veces. El NUL va
        // como escape: un NUL crudo en el fuente hace que git y grep traten el archivo como binario.
        getKey={(f, i) => `${i}\u0000${f.path}`}
        scrollToIndex={estado.seleccion}
        renderItem={(f, i) => (
          <FilaResultado
            coincidencia={f}
            activa={i === estado.seleccion}
            onSeleccionar={() => onEstado((s) => seleccionar(s, i))}
            onAbrir={() => onAbrir(f)}
          />
        )}
      />

      <Splitter
        orientation="horizontal"
        size={altoPrevia}
        min={PREVIA_MIN}
        max={PREVIA_MAX}
        direction={-1}
        onResize={onAltoPrevia}
        label="Ajustar el alto de la vista previa"
      />

      <div className="buscar-previa-hueco" style={{ height: `${altoPrevia}px` }}>
        <VistaPreviaBusqueda fila={fila} query={query.trim()} opts={opts} projectKey={projectKey} />
      </div>

      {vacio !== null && <div className="buscar-cuerpo-tapa">{vacio}</div>}
    </div>
  )
}
