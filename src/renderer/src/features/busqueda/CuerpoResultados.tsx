// =============================================================================
// El cuerpo del modal de búsqueda: la lista de coincidencias, el divisor y la vista previa.
// Sin filas no se desmontan (lo cubre una capa por encima): desmontar la previa costaría un
// Monaco nuevo por pulsación de tecla.
// Decisiones: docs/decisiones/busqueda/vista-previa-monaco.md
// =============================================================================
import { type Dispatch, type SetStateAction } from 'react'
import { ListaVirtual } from '../../comun/ListaVirtual'
import { Cruce, Presente } from '../../comun/Presente'
import { useUltimoValor } from '../../comun/presencia'
import { Divisor } from '../../comun/Divisor'
import { FilaResultado } from './FilaResultado'
import { VistaPreviaBusqueda } from './VistaPreviaBusqueda'
import { txBusqueda } from './textos.ts'
import { seleccionar, type EstadoBusqueda } from './filasResultado'
import type { CoincidenciaArchivo } from '../../../../shared/busqueda-ipc'
import type { OpcionesBusqueda } from '../../../../shared/busquedaTexto'

/** Reparto vertical entre lista y previa. */
const PREVIA_MIN = 120
const PREVIA_MAX = 900

interface PropsCuerpoResultados {
  estado: EstadoBusqueda
  onEstado: Dispatch<SetStateAction<EstadoBusqueda>>
  altoDeFila: number
  altoPrevia: number
  onAltoPrevia: (alto: number) => void
  fila: CoincidenciaArchivo | null
  consulta: string
  opts: OpcionesBusqueda
  claveProyecto: string
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
  consulta,
  opts,
  claveProyecto,
  onAbrir,
  vacio
}: PropsCuerpoResultados): React.JSX.Element {
  const t = txBusqueda()
  const ultimoVacio = useUltimoValor(vacio)
  const claveTapa = estado.error !== null ? 'error' : consulta.trim() === '' ? 'sin-consulta' : estado.buscando ? 'buscando' : 'sin-resultados'
  const ultimaClave = useUltimoValor(vacio !== null ? claveTapa : null)
  return (
    <div className="buscar-cuerpo">
      <ListaVirtual
        className="buscar-lista"
        etiquetaAria={t.resultadosBusqueda}
        elementos={estado.filas}
        altoElemento={altoDeFila}
        // Lleva el índice porque un .class puede dar la misma cadena dos veces. El NUL va
        // como escape: un NUL crudo en el fuente hace que git y grep traten el archivo como binario.
        obtenerClave={(f, i) => `${i}\u0000${f.ruta}`}
        indiceARevelar={estado.seleccion}
        pintarElemento={(f, i) => (
          <FilaResultado
            coincidencia={f}
            activa={i === estado.seleccion}
            onSeleccionar={() => onEstado((s) => seleccionar(s, i))}
            onAbrir={() => onAbrir(f)}
          />
        )}
      />

      <Divisor
        orientacion="horizontal"
        tamano={altoPrevia}
        min={PREVIA_MIN}
        max={PREVIA_MAX}
        direccion={-1}
        onRedimensionar={onAltoPrevia}
        etiqueta={t.ajustarAltoPrevia}
      />

      <div className="buscar-previa-hueco" style={{ height: `${altoPrevia}px` }}>
        <VistaPreviaBusqueda fila={fila} consulta={consulta.trim()} opts={opts} claveProyecto={claveProyecto} />
      </div>

      <Presente visible={vacio !== null} className="buscar-cuerpo-tapa buscar-tapa-fundido">
        <Cruce className="buscar-tapa-contenido" clave={ultimaClave ?? claveTapa}>{ultimoVacio}</Cruce>
      </Presente>
    </div>
  )
}
