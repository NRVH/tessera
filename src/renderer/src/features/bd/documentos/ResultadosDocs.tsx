// =============================================================================
// Los resultados de la consola de MongoDB: la tira de la consola SQL (`db-resultados-*`) con
// «Salida» y, si la última sentencia devolvió algo que enseñar, «Resultado». Los documentos
// van en la tabla de la pestaña de colección con el JSON del elegido al lado; un valor, en
// texto. Solo pinta: el estado es del pane.
// =============================================================================

import type { IrAPosicion, AccionSalida, SalidaConsola as DatosSalida } from '../consola/salidaConsola'
import { etiquetaAcorde } from '../../../util/atajos'
import { EstadoVacio } from '../../../comun/EstadoVacio'
import { IconoLimpiar } from '../iconosBd'
import { SalidaConsola } from '../SalidaConsola'
import type { VistaResultado } from './useEstadoConsolaDocs'
import { TablaDocumentos } from './TablaDocumentos'

type IdPestana = 'salida' | 'resultado'

const ESTILO_PRE: React.CSSProperties = {
  margin: 0,
  padding: '6px 10px',
  overflow: 'auto',
  fontFamily: "var(--mono, ui-monospace, 'Cascadia Code', Consolas, monospace)",
  fontSize: 'max(9px, calc(var(--ui-font) - 1px))',
  userSelect: 'text',
  whiteSpace: 'pre'
}

function metaDe(v: VistaResultado | null, enSalida: boolean): string {
  if (enSalida || !v) return ''
  if (v.tipo !== 'documentos') return 'Valor'
  const n = v.documentos.length
  return `${n} ${n === 1 ? 'documento' : 'documentos'}${v.lector ? ' (hay más)' : ''}${v.coleccion ? ` · ${v.coleccion}` : ''}`
}

function PestanaTira({
  nombre,
  titulo,
  activa,
  onElegir
}: {
  nombre: string
  titulo: string
  activa: boolean
  onElegir: () => void
}): React.JSX.Element {
  return (
    <div
      className={`terminal-tab db-resultado-tab${activa ? ' active' : ''}`}
      role="tab"
      aria-selected={activa}
      tabIndex={0}
      onClick={onElegir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onElegir()
        }
      }}
      title={titulo}
    >
      <span className="terminal-tab-name">{nombre}</span>
    </div>
  )
}

function AccionesResultados({ p, enSalida }: { p: PropsResultadosDocs; enSalida: boolean }): React.JSX.Element {
  const v = p.vista
  const vacia = p.salida.entradas.length === 0
  return (
    <div className="panel-actions">
      {!enSalida && v && v.tipo === 'documentos' && v.lector && (
        <button type="button" className="btn" disabled={p.cargandoMas} onClick={p.onCargarMas}>
          {p.cargandoMas ? 'Cargando…' : 'Cargar más'}
        </button>
      )}
      {enSalida && (
        <span className="btn-envoltura" title={vacia ? 'La salida ya está vacía' : 'Limpiar la salida'}>
          <button type="button" className="btn btn-icon" aria-label="Limpiar la salida" disabled={vacia} onClick={p.onLimpiarSalida}>
            <IconoLimpiar />
          </button>
        </span>
      )}
    </div>
  )
}

function PanelSalida({ p, enSalida }: { p: PropsResultadosDocs; enSalida: boolean }): React.JSX.Element {
  if (p.salida.entradas.length === 0) {
    // El vacío propio: el de `SalidaConsola` nombra «Explicar plan», que aquí no existe.
    return (
      <EstadoVacio
        className="db-salida-vacia"
        titulo="Sin salida"
        pista={`${etiquetaAcorde('ejecutar')} ejecuta la sentencia del cursor; ${etiquetaAcorde('ejecutarTodo')}, todas. Separa las sentencias con «;» o con una línea en blanco.`}
      />
    )
  }
  return (
    <SalidaConsola
      salida={p.salida}
      loteMarcado={p.loteMarcado}
      loteActual={null}
      visible={p.visible && enSalida}
      onIrA={p.onIrA}
      onAccion={p.onAccionSalida}
    />
  )
}

function PanelDocumentos({ v, p }: { v: Extract<VistaResultado, { tipo: 'documentos' }>; p: PropsResultadosDocs }): React.JSX.Element {
  if (v.documentos.length === 0) {
    return <EstadoVacio className="db-salida-vacia" titulo="Ningún documento" pista="La consulta no devolvió documentos." />
  }
  const doc = p.seleccionado !== null ? (v.documentos[p.seleccionado] ?? null) : null
  return (
    <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 62%', minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        <TablaDocumentos
          columnas={v.columnas}
          documentos={v.documentos}
          altoFila={p.altoFila}
          seleccionado={p.seleccionado}
          onSeleccionar={p.onSeleccionar}
        />
      </div>
      <pre
        aria-label="Documento elegido"
        tabIndex={0}
        style={{
          ...ESTILO_PRE,
          flex: '0 0 38%',
          minWidth: 160,
          borderLeft: '1px solid var(--border-soft)',
          color: doc ? 'var(--fg)' : 'var(--fg-faint)'
        }}
      >
        {doc ? doc.texto : 'Elige un documento de la tabla para verlo entero.'}
      </pre>
    </div>
  )
}

function PanelResultado({ v, p }: { v: VistaResultado; p: PropsResultadosDocs }): React.JSX.Element {
  if (v.tipo === 'documentos') return <PanelDocumentos v={v} p={p} />
  return (
    <pre aria-label="Valor devuelto" tabIndex={0} style={{ ...ESTILO_PRE, flex: '1 1 auto' }}>
      {v.texto}
    </pre>
  )
}

interface PropsResultadosDocs {
  alto: number
  altoFila: number
  visible: boolean
  pestana: IdPestana
  onPestana: (t: IdPestana) => void
  salida: DatosSalida
  loteMarcado: number | null
  vista: VistaResultado | null
  seleccionado: number | null
  onSeleccionar: (i: number) => void
  cargandoMas: boolean
  onCargarMas: () => void
  onIrA: (ir: IrAPosicion) => void
  onAccionSalida: (a: AccionSalida) => void
  onLimpiarSalida: () => void
}

/** La tira de resultados de la consola de MongoDB: «Salida» y, si hay algo que enseñar, «Resultado». */
export function ResultadosDocs(p: PropsResultadosDocs): React.JSX.Element {
  const v = p.vista
  const enSalida = p.pestana === 'salida' || v === null
  const meta = metaDe(v, enSalida)
  return (
    <section className="db-consola-resultados" style={{ height: p.alto }} aria-label="Resultados de la consola">
      <div className="db-resultados-cabecera">
        <div className="db-resultados-tabs" role="tablist" aria-label="Salida y resultado">
          <PestanaTira nombre="Salida" titulo="Salida: lo que pasó en cada ejecución" activa={enSalida} onElegir={() => p.onPestana('salida')} />
          {v && (
            <PestanaTira nombre="Resultado" titulo="Lo que devolvió la última sentencia" activa={!enSalida} onElegir={() => p.onPestana('resultado')} />
          )}
        </div>
        {meta !== '' && <span className="db-resultados-meta">{meta}</span>}
        <AccionesResultados p={p} enSalida={enSalida} />
      </div>

      <div className="db-resultados-cuerpo">
        <div className={`db-resultados-panel${enSalida ? '' : ' oculto'}`}>
          <PanelSalida p={p} enSalida={enSalida} />
        </div>
        {v && (
          <div className={`db-resultados-panel${enSalida ? ' oculto' : ''}`}>
            <PanelResultado v={v} p={p} />
          </div>
        )}
      </div>
    </section>
  )
}
