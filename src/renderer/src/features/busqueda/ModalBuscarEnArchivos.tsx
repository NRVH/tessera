// =============================================================================
// «Buscar en archivos» (Ctrl+Shift+F): recuadro de consulta arriba, lista plana de coincidencias
// en medio y el archivo abierto en vista dividida debajo. Busca con retardo al teclear y siempre
// en el proyecto activo; el ámbito es todo el proyecto o una carpeta suya.
// El estado y los efectos viven en `useBusquedaEnArchivos`; aquí solo se pinta.
// Decisiones: docs/decisiones/busqueda/busqueda-en-archivos.md
// =============================================================================
import { createPortal } from 'react-dom'
import { ID_CAPA_DIALOGOS } from '../../comun/Modal'
import { useAbriendo } from '../../comun/presencia'
import { AmbitoBusqueda } from './AmbitoBusqueda'
import { CuerpoResultados } from './CuerpoResultados'
import { EstadoVacioBusqueda } from './EstadoVacioBusqueda'
import { ManijasRedimension } from './ManijasRedimension'
import { txBusqueda } from './textos.ts'
import { CabeceraBusqueda, CampoBusqueda, PieBusqueda } from './MarcoBusqueda'
import { useBusquedaEnArchivos, type PropsBuscarEnArchivos } from './useBusquedaEnArchivos'

/** Modal de búsqueda de texto en los archivos del proyecto activo. */
export function ModalBuscarEnArchivos(props: PropsBuscarEnArchivos): React.JSX.Element {
  const b = useBusquedaEnArchivos(props)
  const abriendo = useAbriendo()
  const { m, set, estado } = b
  const { nombreProyecto, proyectos, raizActiva, claveProyecto, onCerrar } = props
  const vacio =
    estado.filas.length === 0 ? (
      <EstadoVacioBusqueda
        {...{ estado, proyectos, nombreProyecto }}
        {...{ modoAmbito: m.modoAmbito, carpeta: m.carpeta, opts: m.opts }}
        hayConsulta={b.hayConsulta}
      />
    ) : null

  // En la capa de los diálogos, como `Modal`: abierta con su atajo sobre otro diálogo, queda encima de él.
  return createPortal(
    <div className="modal-overlay" role="presentation" onMouseDown={onCerrar}>
      <div
        ref={b.dialogo}
        className="buscar-modal"
        role="dialog"
        aria-modal="true"
        aria-label={txBusqueda().buscarEnArchivos}
        onKeyDown={b.alPulsar}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ...b.variables, width: `${m.ancho}px`, height: `${m.alto}px` }}
        {...abriendo}
      >
        <ManijasRedimension ancho={m.ancho} alto={m.alto} onRedimensionar={set.tam} />
        <CabeceraBusqueda nombreProyecto={nombreProyecto} onCerrar={onCerrar} />
        <CampoBusqueda
          campoRef={b.campoRef}
          consulta={m.consulta}
          onConsulta={set.consulta}
          opts={m.opts}
          onOpts={set.opts}
          contador={b.contador}
        >
          <AmbitoBusqueda
            modo={m.modoAmbito}
            onModo={set.modoAmbito}
            seleccion={m.carpeta}
            onSeleccion={set.carpeta}
            proyectos={proyectos}
            raizActiva={raizActiva}
          />
        </CampoBusqueda>
        <CuerpoResultados
          {...{ estado, claveProyecto, vacio, opts: m.opts, consulta: m.consulta, fila: b.fila }}
          onEstado={b.setEstado}
          altoDeFila={b.altoDeFila}
          altoPrevia={m.altoPrevia}
          onAltoPrevia={set.altoPrevia}
          onAbrir={b.abrir}
        />
        <PieBusqueda fila={b.fila} onAbrir={b.abrir} />
      </div>
    </div>,
    document.getElementById(ID_CAPA_DIALOGOS) ?? document.body
  )
}
