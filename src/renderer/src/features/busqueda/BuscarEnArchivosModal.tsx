// =============================================================================
// «Buscar en archivos» (Ctrl+Shift+F): recuadro de consulta arriba, lista plana de coincidencias
// en medio y el archivo abierto en vista dividida debajo. Busca con retardo al teclear y siempre
// en el proyecto activo; el ámbito es todo el proyecto o una carpeta suya.
// El estado y los efectos viven en `useBusquedaEnArchivos`; aquí solo se pinta.
// Decisiones: docs/decisiones/busqueda/busqueda-en-archivos.md
// =============================================================================
import { AmbitoBusqueda } from './AmbitoBusqueda'
import { CuerpoResultados } from './CuerpoResultados'
import { EstadoVacioBusqueda } from './EstadoVacioBusqueda'
import { ManijasRedimension } from './ManijasRedimension'
import { CabeceraBusqueda, CampoBusqueda, PieBusqueda } from './MarcoBusqueda'
import { useBusquedaEnArchivos, type PropsBuscarEnArchivos } from './useBusquedaEnArchivos'

/** Modal de búsqueda de texto en los archivos del proyecto activo. */
export function BuscarEnArchivosModal(props: PropsBuscarEnArchivos): React.JSX.Element {
  const b = useBusquedaEnArchivos(props)
  const { m, set, estado } = b
  const { projectName, proyectos, raizActiva, projectKey, onClose } = props
  const vacio =
    estado.filas.length === 0 ? (
      <EstadoVacioBusqueda
        {...{ estado, proyectos, projectName }}
        {...{ modoAmbito: m.modoAmbito, carpeta: m.carpeta, opts: m.opts }}
        hayConsulta={b.hayConsulta}
      />
    ) : null

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onClose}>
      <div
        ref={b.dialogo}
        className="buscar-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Buscar en archivos"
        onKeyDown={b.alPulsar}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ...b.vars, width: `${m.ancho}px`, height: `${m.alto}px` }}
      >
        <ManijasRedimension ancho={m.ancho} alto={m.alto} onResize={set.tam} />
        <CabeceraBusqueda projectName={projectName} onClose={onClose} />
        <CampoBusqueda
          inputRef={b.inputRef}
          query={m.query}
          onQuery={set.query}
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
          {...{ estado, projectKey, vacio, opts: m.opts, query: m.query, fila: b.fila }}
          onEstado={b.setEstado}
          altoDeFila={b.altoDeFila}
          altoPrevia={m.altoPrevia}
          onAltoPrevia={set.altoPrevia}
          onAbrir={b.abrir}
        />
        <PieBusqueda fila={b.fila} onAbrir={b.abrir} />
      </div>
    </div>
  )
}
