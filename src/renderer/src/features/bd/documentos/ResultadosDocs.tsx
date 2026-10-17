// =============================================================================
// Los resultados de la consola de MongoDB: la tira de la consola SQL (`TiraResultados`) con
// «Salida» y una pestaña por sentencia que devolvió algo que enseñar, que se fijan y se cierran
// igual. Los documentos van en la tabla de la pestaña de colección con el JSON del elegido al
// lado; un valor, en texto. Los paneles ocultos siguen montados. Solo pinta: el estado es del pane.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { memo } from 'react'
import type { IrAPosicion, AccionSalida, SalidaConsola as DatosSalida } from '../consola/salidaConsola'
import { cantidad } from '../consola/salidaConsola'
import { etiquetaAcorde } from '../../../util/atajos'
import { EstadoVacio } from '../../../comun/EstadoVacio'
import { IconoLimpiar } from '../iconosBd'
import { SalidaConsola } from '../SalidaConsola'
import { PlanExplain } from '../PlanExplain'
import type { DbConnection } from '../../../../../shared/db-ipc'
import { BotonExportarDocs } from './BotonExportarDocs'
import { ID_SALIDA, type AccionPestanaResultado, type PestanaResultado } from '../resultados/pestanasResultado'
import { TiraResultados } from '../resultados/TiraResultados'
import { metaResultadoDocs, type EstadoResultadosDocs, type ResultadoDocs } from './resultadosConsolaDocs'
import { TablaDocumentos } from './TablaDocumentos'
import { txConsolaDocs } from './textosConsolaDocs'

const ESTILO_PRE: React.CSSProperties = {
  margin: 0,
  padding: '6px 10px',
  overflow: 'auto',
  fontFamily: "var(--mono, ui-monospace, 'Cascadia Code', Consolas, monospace)",
  fontSize: 'max(9px, calc(var(--ui-font) - 1px))',
  userSelect: 'text',
  whiteSpace: 'pre'
}

/** Tooltip de una pestaña: su título, la primera línea de la sentencia y si está fijada. */
function tituloPestanaDocs(t: PestanaResultado, r: ResultadoDocs | undefined): string {
  const partes = [t.titulo]
  if (r) {
    const salto = /\r\n|\n|\r/.exec(r.sentencia)
    partes.push((salto ? r.sentencia.slice(0, salto.index) + ' …' : r.sentencia).trim())
  }
  if (t.fijada) partes.push(txConsolaDocs().fijada)
  return partes.join('\n')
}

function AccionesResultados({ p }: { p: PropsResultadosDocs }): React.JSX.Element | null {
  const activa = p.resultados.activa
  const t = txConsolaDocs()
  if (activa === ID_SALIDA) {
    const vacia = p.salida.entradas.length === 0
    return (
      <span className="btn-envoltura" title={vacia ? t.salidaVacia : t.limpiarSalida}>
        <button type="button" className="btn btn-icon" aria-label={t.limpiarSalida} disabled={vacia} onClick={p.onLimpiarSalida}>
          <IconoLimpiar />
        </button>
      </span>
    )
  }
  const v = p.resultados.resultados[activa]
  if (!v || v.tipo !== 'documentos') return null
  return (
    <>
      {v.lector && (
        <button type="button" className="btn" disabled={p.cargandoMas} onClick={p.onCargarMas}>
          {p.cargandoMas ? t.cargando : t.cargarMas}
        </button>
      )}
      <BotonExportarDocs
        origen={{ tipo: 'sentencia', conexionId: p.conexion.id, base: v.base, texto: v.sentencia }}
        motor={p.conexion.motor}
        nombreSugerido={v.coleccion ?? t.nombreResultado}
        motivo={null}
        titulo={t.exportarResultado}
      />
    </>
  )
}

function PanelSalida({ p, enSalida }: { p: PropsResultadosDocs; enSalida: boolean }): React.JSX.Element {
  if (p.salida.entradas.length === 0) {
    // El vacío propio: el de `SalidaConsola` nombra «Explicar plan», que aquí no existe.
    const t = txConsolaDocs()
    return (
      <EstadoVacio
        className="db-salida-vacia"
        titulo={t.sinSalida}
        pista={t.sinSalidaPista(etiquetaAcorde('ejecutar'), etiquetaAcorde('ejecutarTodo'))}
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

/** Lo que pinta el panel de un resultado; estable entre pintados para que `memo` no repinte los ocultos. */
interface PropsPanel {
  id: string
  altoFila: number
  onSeleccionar: (id: string, i: number) => void
}

function PanelDocumentos({ id, v, p }: { id: string; v: Extract<ResultadoDocs, { tipo: 'documentos' }>; p: PropsPanel }): React.JSX.Element {
  const t = txConsolaDocs()
  if (v.documentos.length === 0) {
    return <EstadoVacio className="db-salida-vacia" titulo={t.ningunDocumento} pista={t.consultaSinDocumentos} />
  }
  const doc = v.seleccionado !== null ? (v.documentos[v.seleccionado] ?? null) : null
  return (
    <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 62%', minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        <TablaDocumentos
          columnas={v.columnas}
          documentos={v.documentos}
          altoFila={p.altoFila}
          seleccionado={v.seleccionado}
          onSeleccionar={(i) => p.onSeleccionar(id, i)}
        />
      </div>
      <pre
        aria-label={t.documentoElegido}
        tabIndex={0}
        style={{
          ...ESTILO_PRE,
          flex: '0 0 38%',
          minWidth: 160,
          borderLeft: '1px solid var(--border-soft)',
          color: doc ? 'var(--fg)' : 'var(--fg-faint)'
        }}
      >
        {doc ? doc.texto : t.eligeDocumentoDeLaTabla}
      </pre>
    </div>
  )
}

/**
 * El panel de una pestaña. Memo: la consola repinta con cada línea de la Salida y el cronómetro,
 * y con varias pestañas cada una monta su tabla; solo se repinta la que cambia.
 */
const PanelResultado = memo(function PanelResultado({ v, ...p }: PropsPanel & { v: ResultadoDocs }): React.JSX.Element {
  if (v.tipo === 'documentos') return <PanelDocumentos id={p.id} v={v} p={p} />
  const t = txConsolaDocs()
  if (v.tipo === 'plan') return <PlanExplain plan={v.plan} titulo={t.plan} />
  return (
    <pre aria-label={t.valorDevuelto} tabIndex={0} style={{ ...ESTILO_PRE, flex: '1 1 auto' }}>
      {v.texto}
    </pre>
  )
})

interface PropsResultadosDocs {
  /** La conexión de la consola: a quién se vuelve a pedir lo que se exporta. */
  conexion: Pick<DbConnection, 'id' | 'motor'>
  alto: number
  altoFila: number
  visible: boolean
  resultados: EstadoResultadosDocs
  onPestana: (accion: AccionPestanaResultado, id: string) => void
  salida: DatosSalida
  loteMarcado: number | null
  /** Elige el documento `i` de la pestaña `id`. */
  onSeleccionar: (id: string, i: number) => void
  cargandoMas: boolean
  onCargarMas: () => void
  onIrA: (ir: IrAPosicion) => void
  onAccionSalida: (a: AccionSalida) => void
  onLimpiarSalida: () => void
}

/** La tira de resultados de la consola de MongoDB: «Salida» y una pestaña por resultado. */
export function ResultadosDocs(p: PropsResultadosDocs): React.JSX.Element {
  const { resultados } = p
  const activa = resultados.activa
  const enSalida = activa === ID_SALIDA
  const rActiva = enSalida ? undefined : resultados.resultados[activa]
  const t = txConsolaDocs()
  const meta = enSalida ? cantidad(p.salida.entradas.length, t.entrada, t.entradas) : rActiva ? metaResultadoDocs(rActiva) : ''
  return (
    <section className="db-consola-resultados" style={{ height: p.alto }} aria-label={t.resultadosAria}>
      <TiraResultados resultados={resultados} tituloDe={tituloPestanaDocs} onPestana={p.onPestana} meta={meta} acciones={<AccionesResultados p={p} />} />
      <div className="db-resultados-cuerpo">
        <div className={`db-resultados-panel${enSalida ? '' : ' oculto'}`}>
          <PanelSalida p={p} enSalida={enSalida} />
        </div>
        {resultados.pestanas.map((t) => {
          const r = resultados.resultados[t.id]
          if (!r) return null
          return (
            <div key={t.id} className={`db-resultados-panel${t.id === activa ? '' : ' oculto'}`}>
              <PanelResultado id={t.id} v={r} altoFila={p.altoFila} onSeleccionar={p.onSeleccionar} />
            </div>
          )
        })}
      </div>
    </section>
  )
}
