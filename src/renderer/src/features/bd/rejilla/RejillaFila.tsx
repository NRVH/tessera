// =============================================================================
// Una fila visible de la rejilla de datos, memorizada: al desplazar solo se pintan las
// filas que ENTRAN en la ventana. Pinta lo pendiente (celda cambiada, fila borrada o
// nueva) y dice en el `title` por qué una celda no se edita.
// La monta `DbRejilla.tsx` por `RejillaCuerpo.tsx`.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { memo } from 'react'
import type { DbCelda, DbColumnaResultado } from '../../../../../shared/db-explorador-ipc'
import { motivoBorrada, motivoRecortada, type FilaEditada, type FilaNueva } from './cambiosRejilla'
import { formatoEntero, TEXTO_NULO, textoCelda, type TextoCelda } from './celdasRejilla'
import { txRejilla } from './textosRejilla.ts'

/** Tope del tooltip de una celda: un CLOB de 64 KiB en un `title` bloquea el hilo. */
const TOPE_TOOLTIP = 2000
/** Tope del «Valor original» en el `title` de una celda cambiada. */
const TOPE_ORIGINAL = 300
/** Lo que se pinta en una celda de una fila nueva que va con su DEFAULT. */
const TEXTO_DEFECTO = '<default>'

const TEXTO_CELDA_DEFECTO: TextoCelda = { texto: TEXTO_DEFECTO, clase: 'nulo', truncado: false, incompleto: false }

export interface FilaProps {
  f: number
  fila: readonly DbCelda[]
  columnas: readonly DbColumnaResultado[]
  recortesFila: ReadonlyMap<number, number> | undefined
  c0: number
  c1: number
  pref: Float64Array
  anchoFijo: number
  anchoLienzo: number
  altoFila: number
  /** Columnas seleccionadas en esta fila (inclusivas), o -1 si la fila no está. */
  selC0: number
  selC1: number
  /** Columna de la celda activa si está en esta fila, o -1. */
  focoC: number
  idBase: string
  // Lo de la edición: todas estables por referencia si la fila no cambió.
  /** Número que se enseña (el de la fila en el SERVIDOR), o null en una fila nueva. */
  numero: number | null
  /** Hay edición: las celdas no editables dicen por qué en su `title`. */
  enEdicion: boolean
  motivos?: readonly (string | null)[]
  editada?: FilaEditada
  nueva?: FilaNueva
  /** La fila como la leyó el servidor, para el «Valor original» de una celda cambiada. */
  original?: readonly DbCelda[]
  error?: string
}

function tooltipCelda(v: DbCelda, largo: number | undefined): string | undefined {
  if (typeof v !== 'string') return undefined
  const cuerpo = v.length > TOPE_TOOLTIP ? v.slice(0, TOPE_TOOLTIP) + '…' : v
  return largo !== undefined ? txRejilla().valorRecortado(cuerpo, formatoEntero(largo)) : cuerpo
}

function resumenOriginal(v: DbCelda | undefined): string {
  if (v === null || v === undefined) return TEXTO_NULO
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return v.length > TOPE_ORIGINAL ? v.slice(0, TOPE_ORIGINAL) + '…' : v
}

interface EstadoCelda {
  borrada: boolean
  largo: number | undefined
  cambiada: boolean
  porDefecto: boolean
}

/** El `title` de una celda con edición, y si se puede editar. */
function tituloEnEdicion(
  p: FilaProps,
  c: number,
  base: string | undefined,
  e: EstadoCelda
): { titulo: string | undefined; noEditable: boolean } {
  const t = txRejilla()
  const motivo = p.motivos?.[c] ?? (e.borrada ? motivoBorrada() : e.largo !== undefined ? motivoRecortada() : null)
  if (motivo) return { titulo: (base ? base + '\n' : '') + t.noEditable(motivo), noEditable: true }
  if (e.cambiada && p.original) {
    return { titulo: (base ? base + '\n' : '') + t.valorOriginal(resumenOriginal(p.original[c])), noEditable: false }
  }
  if (e.porDefecto) return { titulo: t.sinEscribir, noEditable: false }
  return { titulo: base, noEditable: false }
}

function claseCelda(clase: string, porDefecto: boolean, cambiada: boolean, seleccionada: boolean, foco: boolean): string {
  return `db-celda db-celda-${clase}${porDefecto ? ' por-defecto' : ''}${cambiada ? ' cambiada' : ''}${
    seleccionada ? ' sel' : ''
  }${foco ? ' foco' : ''}`
}

function celdaDeFila(p: FilaProps, c: number, borrada: boolean): React.JSX.Element {
  const col = p.columnas[c]
  const v = c < p.fila.length ? p.fila[c] : null
  const largo = p.nueva ? undefined : p.recortesFila?.get(c)
  const porDefecto = p.nueva !== undefined && !p.nueva.valores.has(c)
  const cambiada = p.nueva ? p.nueva.valores.has(c) : p.editada?.valores.has(c) === true
  const t = porDefecto
    ? TEXTO_CELDA_DEFECTO
    : textoCelda(v, col.tipoLogico, { longitudOriginal: largo, tipoMotor: col.tipoMotor })
  const seleccionada = c >= p.selC0 && c <= p.selC1
  const foco = c === p.focoC
  const base = t.truncado ? tooltipCelda(v, largo) : undefined
  const { titulo, noEditable } = p.enEdicion
    ? tituloEnEdicion(p, c, base, { borrada, largo, cambiada, porDefecto })
    : { titulo: base, noEditable: false }
  return (
    <div
      key={c}
      id={foco ? `${p.idBase}-${p.f}-${c}` : undefined}
      role="gridcell"
      aria-colindex={c + 2}
      aria-selected={seleccionada}
      aria-readonly={p.enEdicion ? noEditable : undefined}
      className={claseCelda(t.clase, porDefecto, cambiada, seleccionada, foco)}
      style={{ left: p.anchoFijo + p.pref[c], width: p.pref[c + 1] - p.pref[c] }}
      title={titulo}
    >
      {t.texto}
    </div>
  )
}

function tituloNumero(p: FilaProps, borrada: boolean): string | undefined {
  const t = txRejilla()
  if (p.error) return t.noSeAplico(p.error)
  if (p.nueva) return t.filaNueva
  return borrada ? t.marcadaBorrar : undefined
}

/** Una fila visible; las que siguen dentro de la ventana conservan props idénticas. */
export const FilaRejilla = memo(function FilaRejilla(p: FilaProps): React.JSX.Element {
  const borrada = p.editada?.borrada === true
  const celdas: React.JSX.Element[] = []
  for (let c = p.c0; c < p.c1; c++) celdas.push(celdaDeFila(p, c, borrada))
  const clases = `db-rejilla-fila${p.nueva ? ' nueva' : ''}${borrada ? ' borrada' : ''}${p.error ? ' con-error' : ''}`
  return (
    <div
      role="row"
      aria-rowindex={p.f + 2}
      className={clases}
      style={{ transform: `translateY(${p.f * p.altoFila}px)`, height: p.altoFila, width: p.anchoLienzo }}
    >
      <div
        role="rowheader"
        className={`db-rejilla-num${p.selC0 >= 0 ? ' sel' : ''}`}
        style={{ width: p.anchoFijo }}
        title={tituloNumero(p, borrada)}
        aria-label={p.nueva ? 'Fila nueva' : undefined}
      >
        {p.numero === null ? '+' : p.numero}
      </div>
      {celdas}
    </div>
  )
})
