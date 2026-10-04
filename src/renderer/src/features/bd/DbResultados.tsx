// =============================================================================
// DbResultados: la mitad de abajo de la consola SQL. Una tira de pestañas («Salida» fija y
// una por conjunto de filas o plan) con los metadatos del activo, y debajo la rejilla
// (`resultados/DbResultadosRejilla.tsx`), el plan (`PlanExplain`) o la Salida. Las rejillas
// ocultas siguen montadas; qué pestaña se sustituye lo decide `resultados/pestanasResultado.ts`.
// Decisiones: docs/decisiones/bd/ui-resultados-pestanas.md
// =============================================================================

import { memo, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { ID_SALIDA, puedeFijar, type EstadoResultados } from './resultados/pestanasResultado'
import { RejillaResultado, type DuenoRejillaResultado } from './resultados/DbResultadosRejilla'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { esBorrarPestanaEnfocada } from '../../util/atajos'
import { IconoCerrar } from '../../comun/iconosMenu'
import { IconoFijar, IconoLimpiar } from './iconosBd'
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

type OnPestana = DbResultadosProps['onPestana']

/** El menú contextual de una pestaña de resultado. */
function itemsMenuPestana(
  resultados: EstadoResultados<ResultadoConsola>,
  id: string,
  onPestana: OnPestana
): ContextMenuEntry[] {
  const pestana = resultados.pestanas.find((x) => x.id === id)
  if (!pestana) return []
  return [
    pestana.fijada
      ? { label: 'Desfijar', icon: <IconoFijar />, onClick: () => onPestana('desfijar', id) }
      : {
          label: 'Fijar',
          icon: <IconoFijar />,
          disabled: !puedeFijar(resultados),
          onClick: () => onPestana('fijar', id)
        },
    SEP,
    { label: 'Cerrar', icon: <IconoCerrar />, onClick: () => onPestana('cerrar', id) },
    { label: 'Cerrar las demás sin fijar', onClick: () => onPestana('cerrarOtras', id) },
    SEP,
    { label: 'Cerrar todos los resultados', onClick: () => onPestana('cerrarTodas', id) }
  ]
}

function teclaPestana(e: React.KeyboardEvent, id: string, onPestana: OnPestana): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    onPestana('activar', id)
  } else if (id !== ID_SALIDA && esBorrarPestanaEnfocada(e)) {
    // La ✕ va a tabIndex -1 (una parada de Tab por pestaña): el gesto de borrar de cada
    // plataforma (`Supr`, o `⌘⌫` en Mac) es su teclado.
    e.preventDefault()
    onPestana('cerrar', id)
  }
}

/** Una pestaña de resultado: chincheta si está fijada, título y ✕; clic central cierra. */
function PestanaResultado(p: {
  t: EstadoResultados<ResultadoConsola>['pestanas'][number]
  esActiva: boolean
  titulo: string
  onPestana: OnPestana
  abrirMenu: (x: number, y: number) => void
}): React.JSX.Element {
  const { t, esActiva, onPestana } = p
  return (
    <div
      className={`terminal-tab db-resultado-tab${esActiva ? ' active' : ''}${t.fijada ? ' fijada' : ''}`}
      role="tab"
      aria-selected={esActiva}
      tabIndex={0}
      onClick={() => onPestana('activar', t.id)}
      onMouseDown={(e) => {
        // Sin esto, el botón central arranca el autodesplazamiento de Chromium.
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onPestana('cerrar', t.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        p.abrirMenu(e.clientX, e.clientY)
      }}
      onKeyDown={(e) => teclaPestana(e, t.id, onPestana)}
      title={p.titulo}
    >
      {t.fijada && (
        <span className="db-resultado-chincheta" aria-label="Fijada">
          <IconoFijar />
        </span>
      )}
      <span className="terminal-tab-name">{t.titulo}</span>
      <button
        type="button"
        className="terminal-tab-kill"
        tabIndex={-1}
        title="Cerrar este resultado"
        aria-label={`Cerrar ${t.titulo}`}
        onClick={(e) => {
          e.stopPropagation()
          onPestana('cerrar', t.id)
        }}
      >
        <IconoCerrar />
      </button>
    </div>
  )
}

/** La cabecera: tira de pestañas, metadatos a la izquierda y «Limpiar la salida» a la derecha. */
function CabeceraResultados(p: {
  props: DbResultadosProps
  meta: string
  abrirMenu: (x: number, y: number, id: string) => void
}): React.JSX.Element {
  const { resultados, salida, onPestana } = p.props
  const activa = resultados.activa
  const enSalida = activa === ID_SALIDA
  const dialecto = dialectoDeMotor(p.props.motor)
  return (
    <div className="db-resultados-cabecera">
      <div className="db-resultados-tabs" role="tablist" aria-label="Salida y resultados">
        <div
          className={`terminal-tab db-resultado-tab${enSalida ? ' active' : ''}`}
          role="tab"
          aria-selected={enSalida}
          tabIndex={0}
          onClick={() => onPestana('activar', ID_SALIDA)}
          onKeyDown={(e) => teclaPestana(e, ID_SALIDA, onPestana)}
          title="Salida: lo que pasó en cada ejecución"
        >
          <span className="terminal-tab-name">Salida</span>
        </div>
        {resultados.pestanas.map((t) => (
          <PestanaResultado
            key={t.id}
            t={t}
            esActiva={t.id === activa}
            titulo={tituloPestana(t.titulo, t.fijada, resultados.resultados[t.id], dialecto)}
            onPestana={onPestana}
            abrirMenu={(x, y) => p.abrirMenu(x, y, t.id)}
          />
        ))}
      </div>
      {p.meta !== '' && <span className="db-resultados-meta">{p.meta}</span>}
      <div className="panel-actions">
        {enSalida && (
          <span className="btn-envoltura" title={salida.entradas.length === 0 ? 'La salida ya está vacía' : 'Limpiar la salida'}>
            <button
              type="button"
              className="btn btn-icon"
              aria-label="Limpiar la salida"
              disabled={salida.entradas.length === 0}
              onClick={p.props.onLimpiarSalida}
            >
              <IconoLimpiar />
            </button>
          </span>
        )}
      </div>
    </div>
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
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const activa = resultados.activa
  const enSalida = activa === ID_SALIDA
  const rActiva = enSalida ? null : resultados.resultados[activa]

  const meta = enSalida
    ? cantidad(salida.entradas.length, 'entrada', 'entradas')
    : rActiva
      ? metaResultado(rActiva, p.totales[activa])
      : ''

  return (
    <section className="db-consola-resultados" style={{ height: p.alto }} aria-label="Resultados de la consola">
      <CabeceraResultados props={p} meta={meta} abrirMenu={(x, y, id) => setMenu({ x, y, id })} />
      <CuerpoResultados p={p} />
      {menu &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={itemsMenuPestana(resultados, menu.id, p.onPestana)}
            onClose={() => setMenu(null)}
          />,
          document.body
        )}
    </section>
  )
}

/** Memo: la consola repinta con cada tecla y el cronómetro; esta mitad, solo con sus resultados. */
export const DbResultados = memo(DbResultadosSinMemo)
