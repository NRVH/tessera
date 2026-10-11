// =============================================================================
// DbResultados: la mitad de abajo de la consola SQL. Una tira de pestañas («Salida» fija y
// una por conjunto de filas o plan) con los metadatos del activo, y debajo la rejilla
// (`resultados/DbResultadosRejilla.tsx`), el plan (`PlanExplain`) o la Salida. Las rejillas
// ocultas siguen montadas; qué pestaña se sustituye lo decide `resultados/pestanasResultado.ts`.
// Decisiones: docs/decisiones/bd/ui-resultados-pestanas.md
// =============================================================================

import { memo } from 'react'
import { dialectoDeMotor, type DialectoSql } from '../../../../shared/sql/dialectosSql'
import type { AccionPestana, ResultadoConsola } from './consola/estadoConsola'
import { formatoDuracion } from './consola/marcasConsola'
import { resumenBinds } from './consola/parametrosConsola'
import {
  cantidad,
  type AccionSalida,
  type IrAPosicion,
  type SalidaConsola as DatosSalida
} from './consola/salidaConsola'
import { formatoEntero } from './rejilla/celdasRejilla'
import { ID_SALIDA, type EstadoResultados } from './resultados/pestanasResultado'
import { TiraResultados } from './resultados/TiraResultados'
import { RejillaResultado, type DuenoRejillaResultado } from './resultados/DbResultadosRejilla'
import { IconoLimpiar } from './iconosBd'
import { PlanExplain, metaPlan } from './PlanExplain'
import { SalidaConsola } from './SalidaConsola'

export interface DbResultadosProps extends DuenoRejillaResultado {
  resultados: EstadoResultados<ResultadoConsola>
  salida: DatosSalida
  loteMarcado: number | null
  loteActual: number | null
  /** Alto del bloque (lo reparte el divisor de la consola). */
  alto: number
  visible: boolean
  onPestana: (accion: AccionPestana, id: string) => void
  onIrA: (ir: IrAPosicion) => void
  onAccionSalida: (a: AccionSalida) => void
  onLimpiarSalida: () => void
}

/** «40 filas · 671 ms», «500+ filas · 2 s 270 ms», «12 345 filas» (contadas). Un plan: «4 pasos · coste 6 · 12 ms». */
function metaResultado(r: ResultadoConsola, total: number | undefined): string {
  if (r.plan) return metaPlan(r.plan)
  const cargadas = r.datos ? r.datos.filas.length : r.filasPrimeraPagina
  const hayMas = r.datos ? r.datos.hayMas : false
  const filas =
    total !== undefined
      ? cantidad(total, 'fila', 'filas')
      : hayMas
        ? `${formatoEntero(cargadas)}+ filas`
        : cantidad(cargadas, 'fila', 'filas')
  const partes = [filas]
  if (r.afectadas !== null) partes.push(cantidad(r.afectadas, 'afectada', 'afectadas'))
  partes.push(formatoDuracion(r.tiempos.totalMs))
  return partes.join(' · ')
}

function primeraLinea(sql: string): string {
  const m = /\r\n|\n|\r/.exec(sql)
  return (m ? sql.slice(0, m.index) + ' …' : sql).trim()
}

/**
 * Tooltip de una pestaña de resultado: su título, la primera línea del SQL y, si llevaba
 * parámetros, con qué valores se ejecutó: dos pestañas fijadas de la MISMA consulta con
 * `:id` distinto solo se distinguen por eso.
 */
function tituloPestana(titulo: string, fijada: boolean, r: ResultadoConsola | undefined, d: DialectoSql): string {
  const partes = [titulo]
  if (r) partes.push(primeraLinea(r.sql))
  const binds = r ? resumenBinds(r.binds, d) : ''
  if (binds) partes.push(`Parámetros: ${binds}`)
  if (r?.plan) partes.push('Plan de ejecución: la sentencia no se ejecutó')
  if (fijada) partes.push('Fijada: la próxima ejecución no la sustituye')
  return partes.join('\n')
}

/** Lo de la derecha de la cabecera: «Limpiar la salida», con la Salida a la vista. */
function AccionesResultados({ p }: { p: DbResultadosProps }): React.JSX.Element | null {
  if (p.resultados.activa !== ID_SALIDA) return null
  const vacia = p.salida.entradas.length === 0
  return (
    <span className="btn-envoltura" title={vacia ? 'La salida ya está vacía' : 'Limpiar la salida'}>
      <button type="button" className="btn btn-icon" aria-label="Limpiar la salida" disabled={vacia} onClick={p.onLimpiarSalida}>
        <IconoLimpiar />
      </button>
    </span>
  )
}

/** El cuerpo: la Salida y un panel por resultado; los ocultos siguen montados. */
function CuerpoResultados({ p }: { p: DbResultadosProps }): React.JSX.Element {
  const { resultados, salida } = p
  const activa = resultados.activa
  const enSalida = activa === ID_SALIDA
  return (
    <div className="db-resultados-cuerpo">
      <div className={`db-resultados-panel${enSalida ? '' : ' oculto'}`}>
        <SalidaConsola
          salida={salida}
          loteMarcado={p.loteMarcado}
          loteActual={p.loteActual}
          visible={p.visible && enSalida}
          onIrA={p.onIrA}
          onAccion={p.onAccionSalida}
        />
      </div>
      {resultados.pestanas.map((t) => {
        const r = resultados.resultados[t.id]
        if (!r) return null
        const esActiva = t.id === activa
        return (
          <div key={t.id} className={`db-resultados-panel${esActiva ? '' : ' oculto'}`}>
            {r.errorDatos !== null && (
              <div className="db-resultados-error" role="alert">
                No se pudieron leer las filas: {r.errorDatos}
              </div>
            )}
            {r.plan ? (
              <PlanExplain plan={r.plan} titulo={t.titulo} />
            ) : (
              <RejillaResultado id={t.id} titulo={t.titulo} r={r} visible={p.visible && esActiva} p={p} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function DbResultadosSinMemo(p: DbResultadosProps): React.JSX.Element {
  const { resultados, salida } = p
  const activa = resultados.activa
  const enSalida = activa === ID_SALIDA
  const rActiva = enSalida ? null : resultados.resultados[activa]
  const dialecto = dialectoDeMotor(p.motor)

  const meta = enSalida
    ? cantidad(salida.entradas.length, 'entrada', 'entradas')
    : rActiva
      ? metaResultado(rActiva, p.totales[activa])
      : ''

  return (
    <section className="db-consola-resultados" style={{ height: p.alto }} aria-label="Resultados de la consola">
      <TiraResultados
        resultados={resultados}
        tituloDe={(t, r) => tituloPestana(t.titulo, t.fijada, r, dialecto)}
        onPestana={p.onPestana}
        meta={meta}
        acciones={<AccionesResultados p={p} />}
      />
      <CuerpoResultados p={p} />
    </section>
  )
}

/** Memo: la consola repinta con cada tecla y el cronómetro; esta mitad, solo con sus resultados. */
export const DbResultados = memo(DbResultadosSinMemo)
