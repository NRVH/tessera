// =============================================================================
// PlanExplain: la pestaña «Plan» de los resultados de la consola: el árbol de pasos plegable
// (Operación, Objeto, Coste, Filas, Bytes, Detalle) y un conmutador a «Texto», el plan como
// lo da el servidor o generado desde el árbol. Lo que se decide (anidar, filas visibles,
// teclado, números, qué se copia) está en `resultados/planResultado.ts`; aquí solo se pinta.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-resultados.md
// =============================================================================

import { memo, useId, useMemo, useState } from 'react'
import type { DbPlan } from '../../../../shared/db-explorador-ipc'
import { cantidad } from './consola/salidaConsola'
import { formatoDuracion } from './consola/marcasConsola'
import {
  arbolPlan,
  filasPlan,
  idsConHijos,
  numeroPlan,
  planComoTsv,
  resumenPlan,
  teclaPlan,
  textoDelPlan,
  textoDetalle,
  textoOperacion,
  type FilaPlan
} from './resultados/planResultado'
import { notifyError } from '../../comun/notifications'
import { esModPrincipal } from '../../util/atajos'
import { IconoCopiar } from '../../comun/iconosMenu'
import { IconoPlegarTodo } from './iconosBd'
import { IconoChevronPlan, IconoDesplegarTodo, IconoVistaTexto } from './iconosConsola'
import { txConsolaBd } from './textosConsolaBd.ts'

export interface PlanExplainProps {
  plan: DbPlan
  /** Título de la pestaña, para el nombre accesible. */
  titulo: string
}

/**
 * Los metadatos del plan para la CABECERA DE RESULTADOS («4 pasos · coste 6 · 12 ms»),
 * vía `metaResultado`: la barra del plan no los repite.
 */
export function metaPlan(plan: DbPlan): string {
  const t = txConsolaBd()
  const r = resumenPlan(plan)
  const partes = [cantidad(r.pasos, t.paso, t.pasos)]
  if (r.coste !== null) partes.push(t.coste(numeroPlan(r.coste)))
  partes.push(formatoDuracion(plan.tiempos.totalMs))
  return partes.join(' · ')
}

/** Desplegar y plegar todo: en la vista de texto, deshabilitados con su motivo. */
function BotonesPlegado(p: { enTexto: boolean; desplegar: () => void; plegar: () => void }): React.JSX.Element {
  const t = txConsolaBd()
  if (p.enTexto) {
    return (
      <>
        <span className="btn-envoltura" title={t.soloEnArbol}>
          <button type="button" className="btn btn-icon" aria-label={t.desplegarTodo} disabled>
            <IconoDesplegarTodo />
          </button>
        </span>
        <span className="btn-envoltura" title={t.soloEnArbol}>
          <button type="button" className="btn btn-icon" aria-label={t.plegarTodo} disabled>
            <IconoPlegarTodo />
          </button>
        </span>
      </>
    )
  }
  return (
    <>
      <button type="button" className="btn btn-icon" aria-label={t.desplegarTodo} title={t.desplegarTodo} onClick={p.desplegar}>
        <IconoDesplegarTodo />
      </button>
      <button type="button" className="btn btn-icon" aria-label={t.plegarTodo} title={t.plegarTodo} onClick={p.plegar}>
        <IconoPlegarTodo />
      </button>
    </>
  )
}

/** La barra: conmutador de vista, desplegar/plegar todo y copiar; solo iconos, a la derecha. */
function BarraPlan(p: {
  enTexto: boolean
  alternarVista: () => void
  desplegar: () => void
  plegar: () => void
  copiar: () => void
}): React.JSX.Element {
  const { enTexto } = p
  const t = txConsolaBd()
  return (
    <div className="db-plan-barra">
      <div className="panel-actions">
        <button
          type="button"
          className={`btn btn-icon db-plan-vista${enTexto ? ' btn-active' : ''}`}
          aria-pressed={enTexto}
          aria-label={t.verPlanComoTexto}
          title={enTexto ? t.vistaTexto : t.vistaArbol}
          onClick={p.alternarVista}
        >
          <IconoVistaTexto />
        </button>
        <span className="panel-actions-sep" aria-hidden="true" />
        <BotonesPlegado enTexto={enTexto} desplegar={p.desplegar} plegar={p.plegar} />
        <span className="panel-actions-sep" aria-hidden="true" />
        <button
          type="button"
          className="btn btn-icon db-plan-copiar"
          aria-label={t.copiarPlan}
          title={enTexto ? t.copiarPlanTexto : t.copiarArbolVisible}
          onClick={p.copiar}
        >
          <IconoCopiar />
        </button>
      </div>
    </div>
  )
}

interface FilaArbolPlanProps {
  f: FilaPlan
  id: string
  activa: boolean
  setActivo: (id: number) => void
  alternar: (id: number) => void
}

/** La celda de la operación, sangrada por nivel, con el chevrón si tiene hijos. */
function CeldaOperacion({ f, setActivo, alternar }: FilaArbolPlanProps): React.JSX.Element {
  const n = f.nodo
  return (
    <td role="gridcell" className="db-plan-col-op">
      <span className="db-plan-op" style={{ paddingLeft: f.nivel * 16 }}>
        {f.tieneHijos ? (
          <button
            type="button"
            className="db-plan-chevron"
            tabIndex={-1}
            aria-label={f.abierto ? txConsolaBd().plegar : txConsolaBd().desplegar}
            onClick={(e) => {
              e.stopPropagation()
              setActivo(n.id)
              alternar(n.id)
            }}
          >
            <IconoChevronPlan abierto={f.abierto} />
          </button>
        ) : (
          <span className="db-plan-chevron hueco" aria-hidden="true" />
        )}
        <span className="db-plan-op-texto">{textoOperacion(n)}</span>
      </span>
    </td>
  )
}

/** Una fila del árbol: operación sangrada con su chevrón, objeto, números y detalle. */
function FilaArbolPlan(p: FilaArbolPlanProps): React.JSX.Element {
  const { f, activa } = p
  const n = f.nodo
  return (
    <tr
      id={p.id}
      role="row"
      aria-level={f.nivel + 1}
      aria-expanded={f.tieneHijos ? f.abierto : undefined}
      aria-selected={activa}
      className={`db-plan-fila${activa ? ' activa' : ''}`}
      onClick={() => p.setActivo(n.id)}
      onDoubleClick={() => {
        if (f.tieneHijos) p.alternar(n.id)
      }}
    >
      <CeldaOperacion {...p} />
      <td role="gridcell" className="db-plan-objeto" title={n.objeto ?? ''}>
        {n.objeto ?? ''}
      </td>
      <td role="gridcell" className="num">
        {numeroPlan(n.coste)}
      </td>
      <td role="gridcell" className="num">
        {numeroPlan(n.filas)}
      </td>
      <td role="gridcell" className="num">
        {numeroPlan(n.bytes)}
      </td>
      <td role="gridcell" className="db-plan-detalle" title={(n.detalle ?? []).join('\n')}>
        {textoDetalle(n)}
      </td>
    </tr>
  )
}

/** Cabecera de columnas del árbol. */
function CabeceraArbolPlan(): React.JSX.Element {
  const t = txConsolaBd()
  return (
    <thead>
      <tr role="row">
        <th role="columnheader" className="db-plan-col-op">
          {t.colOperacion}
        </th>
        <th role="columnheader">{t.colObjeto}</th>
        <th role="columnheader" className="num">
          {t.colCoste}
        </th>
        <th role="columnheader" className="num">
          {t.colFilas}
        </th>
        <th role="columnheader" className="num">
          {t.colBytes}
        </th>
        <th role="columnheader">{t.colDetalle}</th>
      </tr>
    </thead>
  )
}

/** El árbol anidado, sus filas visibles según lo plegado y cómo plegar o desplegar un paso. */
function useArbolPlan(plan: DbPlan): {
  filas: FilaPlan[]
  conHijos: number[]
  setPlegados: (s: ReadonlySet<number>) => void
  alternar: (id: number) => void
} {
  const [plegados, setPlegados] = useState<ReadonlySet<number>>(() => new Set())
  const raices = useMemo(() => arbolPlan(plan.nodos), [plan.nodos])
  const filas = useMemo(() => filasPlan(raices, plegados), [raices, plegados])
  const conHijos = useMemo(() => idsConHijos(raices), [raices])
  const alternar = (id: number): void =>
    setPlegados((p) => {
      const s = new Set(p)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  return { filas, conHijos, setPlegados, alternar }
}

/** La tabla `treegrid`: el foco vive en ella y la fila activa se nombra con `aria-activedescendant`. */
function ArbolPlan(p: {
  titulo: string
  filas: readonly FilaPlan[]
  activoVisible: number | null
  idFila: (id: number) => string
  alTeclear: (e: React.KeyboardEvent) => void
  setActivo: (id: number) => void
  alternar: (id: number) => void
}): React.JSX.Element {
  const { filas, activoVisible, idFila } = p
  return (
    <div className="db-plan-cuerpo">
      <table
        className="db-plan-arbol"
        role="treegrid"
        aria-label={p.titulo}
        tabIndex={0}
        aria-activedescendant={activoVisible !== null ? idFila(activoVisible) : undefined}
        onKeyDown={p.alTeclear}
        onFocus={() => {
          if (activoVisible === null && filas.length > 0) p.setActivo(filas[0].nodo.id)
        }}
      >
        <CabeceraArbolPlan />
        <tbody>
          {filas.map((f) => (
            <FilaArbolPlan
              key={f.nodo.id}
              f={f}
              id={idFila(f.nodo.id)}
              activa={f.nodo.id === activoVisible}
              setActivo={p.setActivo}
              alternar={p.alternar}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlanExplainSinMemo({ plan, titulo }: PlanExplainProps): React.JSX.Element {
  const idBase = useId()
  const [vista, setVista] = useState<'arbol' | 'texto'>('arbol')
  const { filas, conHijos, setPlegados, alternar } = useArbolPlan(plan)
  const [activo, setActivo] = useState<number | null>(null)
  const texto = useMemo(() => textoDelPlan(plan), [plan])

  // Copia lo que se VE: el TSV del árbol visible o el texto.
  const copiar = (): void => {
    const contenido = vista === 'texto' ? texto : planComoTsv(filas)
    window.tessera.clipboard.write(contenido).catch((err: unknown) => notifyError(txConsolaBd().noSePudoCopiarPlan, err))
  }

  const idFila = (id: number): string => `${idBase}-n${id}`
  const activoVisible = activo !== null && filas.some((f) => f.nodo.id === activo) ? activo : null

  const alTeclear = (e: React.KeyboardEvent): void => {
    if (esModPrincipal(e, window.tessera.plataforma) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
      // Con texto seleccionado a mano en la vista de texto, lo copia el navegador.
      const sel = window.getSelection()
      if (vista === 'texto' && sel && sel.toString() !== '') return
      e.preventDefault()
      copiar()
      return
    }
    if (vista !== 'arbol') return
    const r = teclaPlan(filas, activoVisible, e.key)
    if (!r) return
    e.preventDefault()
    if (r.plegar !== undefined) alternar(r.plegar)
    if (r.desplegar !== undefined) alternar(r.desplegar)
    setActivo(r.activo)
    if (r.activo !== null) document.getElementById(idFila(r.activo))?.scrollIntoView({ block: 'nearest' })
  }

  const enTexto = vista === 'texto'

  return (
    <div className="db-plan">
      <BarraPlan
        enTexto={enTexto}
        alternarVista={() => setVista(enTexto ? 'arbol' : 'texto')}
        desplegar={() => setPlegados(new Set())}
        plegar={() => setPlegados(new Set(conHijos))}
        copiar={copiar}
      />

      {enTexto ? (
        <pre className="db-plan-texto" tabIndex={0} aria-label={txConsolaBd().planTexto(titulo)} onKeyDown={alTeclear}>
          {texto}
        </pre>
      ) : (
        <ArbolPlan
          titulo={titulo}
          filas={filas}
          activoVisible={activoVisible}
          idFila={idFila}
          alTeclear={alTeclear}
          setActivo={setActivo}
          alternar={alternar}
        />
      )}
    </div>
  )
}

/** Memo: la consola repinta con cada tecla y el cronómetro; el plan no cambia. */
export const PlanExplain = memo(PlanExplainSinMemo)
