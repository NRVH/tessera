// =============================================================================
// DbEsquemasPopover: qué esquemas enseña el árbol de una conexión (el «N de M»), o qué
// bases con el nivel «Bases». Se abre desde la insignia de la fila de la conexión o
// desde su menú («Esquemas visibles…»). Enter o clic fuera aplican; Esc cancela. El
// estado vive en `consola/useEsquemasPopover.ts` y lo común de los popovers, en
// `comun/popoverFlotante.ts`; la casilla es la de git, con su CSS en `arbol.css`.
// Decisiones: docs/decisiones/bd/ui-consola-popovers.md
// =============================================================================

import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import './arbol.css'
import type { DbConnection } from '../../../../shared/db-ipc'
import type { DbEsquema } from '../../../../shared/db-explorador-ipc'
import { contarVisibles } from '../../../../shared/dbEsquemas'
import { fuentePopover, TEXTOS_POPOVER, type NivelPopover, type TextosPopover } from './nivelBasesBd'
import { Casilla } from '../git'
import { VirtualList } from '../../comun/VirtualList'
import { EstadoCargaPopover } from './consola/EstadoCargaPopover'
import { FILAS_MAX, HUECO, recolocar, teclaPopover, type AnclaPopover, type PosicionPopover } from '../../comun/popoverFlotante'
import { useCierreYFoco } from '../../comun/usePopoverFlotante'
import { useEsquemasPopover, type FilaPop } from './consola/useEsquemasPopover'

export type { AnclaPopover } from '../../comun/popoverFlotante'
// `BarraConsola` lo importa desde aquí: ver allí el porqué.
export { SelectorEsquemaConsola } from './consola/SelectorEsquemaConsola'

/** Ancho del popover en px. */
const ANCHO = 300

type EstadoPop = ReturnType<typeof useEsquemasPopover>

/** Esc cancela, Enter aplica, ↑/↓ mueven y Espacio marca la fila activa. */
function teclaEsquemas(e: React.KeyboardEvent, s: EstadoPop, onCerrar: () => void): void {
  teclaPopover(e, {
    total: s.filasNav.length,
    setActivo: s.setActivo,
    alEscape: onCerrar,
    alEnter: () => void s.aplicar(),
    alEspacio: () => {
      const f = s.filasNav[s.activo]
      if (f) s.alternarFila(f)
    }
  })
}

/** Lo que comparten las filas de la lista: el cursor, el alto y cómo se marcan. */
interface VistaFilas {
  s: EstadoPop
  idBase: string
  altoFila: number
}

/** Pulsar una fila la hace activa y la marca o desmarca. */
function pulsar(v: VistaFilas, f: FilaPop, i: number): void {
  v.s.setActivo(i)
  v.s.alternarFila(f)
}

/** Una de las dos filas fijas de arriba: «Todos» o «Por defecto (X)». */
function FilaFija({ v, f, i, texto }: { v: VistaFilas; f: FilaPop; i: number; texto: string }): React.JSX.Element {
  return (
    <div
      id={`${v.idBase}-e${i}`}
      role="option"
      // Lista multiselección: `aria-selected` es lo MARCADO; la fila activa ya la
      // nombra `aria-activedescendant`.
      aria-selected={v.s.casillaDe(f) === 'llena'}
      className={`db-pop-fila db-pop-fija${i === v.s.activo ? ' activa' : ''}`}
      style={{ height: v.altoFila }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pulsar(v, f, i)}
    >
      <Casilla estado={v.s.casillaDe(f)} etiqueta={texto} onAlternar={() => v.s.alternarFila(f)} />
      <span className="db-pop-nombre">{texto}</span>
    </div>
  )
}

/** Un esquema de la lista; los del sistema y los sinónimos públicos, atenuados. */
function FilaEsquema({
  v,
  x,
  indice,
  t
}: {
  v: VistaFilas
  x: DbEsquema
  indice: number
  t: TextosPopover
}): React.JSX.Element {
  const f: FilaPop = { tipo: 'esquema', esquema: x }
  const extra = x.pseudo ? ' (sinónimos públicos)' : x.nombre === v.s.porDefecto ? ' (por defecto)' : ''
  return (
    <div
      id={`${v.idBase}-e${indice}`}
      role="option"
      aria-selected={v.s.casillaDe(f) === 'llena'}
      className={`db-pop-fila${indice === v.s.activo ? ' activa' : ''}${x.sistema || x.pseudo ? ' atenuada' : ''}`}
      style={{ height: v.altoFila }}
      title={x.sistema ? `${x.nombre}: ${t.delSistema}` : x.nombre}
      // Sin robar el foco al filtro: se sigue tecleando tras marcar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pulsar(v, f, indice)}
    >
      <Casilla estado={v.s.casillaDe(f)} etiqueta={`Mostrar ${x.nombre}`} onAlternar={() => v.s.alternarFila(f)} />
      <span className="db-pop-nombre">{x.nombre}</span>
      {extra && <span className="db-pop-meta">{extra}</span>}
    </div>
  )
}

/** La lista: las fijas (sin filtro) y los esquemas filtrados, en lista virtual. */
function ListaEsquemas({ v, t }: { v: VistaFilas; t: TextosPopover }): React.JSX.Element {
  const s = v.s
  const fijas = s.filasNav.length - s.visiblesLista.length
  const altoLista = Math.min(s.visiblesLista.length, FILAS_MAX) * v.altoFila
  return (
    <div id={`${v.idBase}-lista`} role="listbox" aria-multiselectable="true" aria-label={t.lista}>
      {fijas > 0 && (
        <div className="db-pop-fijas">
          <FilaFija v={v} f={{ tipo: 'todos' }} i={0} texto={t.todos} />
          {fijas > 1 && <FilaFija v={v} f={{ tipo: 'porDefecto' }} i={1} texto={`Por defecto (${s.porDefecto})`} />}
        </div>
      )}
      {s.visiblesLista.length === 0 ? (
        <div className="db-pop-estado">{t.ninguno}</div>
      ) : (
        <VirtualList<DbEsquema>
          className="db-pop-lista"
          style={{ height: altoLista }}
          items={s.visiblesLista}
          itemHeight={v.altoFila}
          getKey={(x) => x.nombre}
          scrollToIndex={s.activo >= fijas ? s.activo - fijas : null}
          renderItem={(x, i) => <FilaEsquema v={v} x={x} indice={fijas + i} t={t} />}
        />
      )}
    </div>
  )
}

/** Lo que recibe el popover de esquemas (o bases) visibles. */
interface PropsEsquemasPopover {
  conexion: DbConnection
  ancla: AnclaPopover
  altoFila: number
  /** Las variables de densidad del árbol: el portal no las hereda del lateral. */
  varsDensidad?: CSSProperties
  /** Qué se elige: los ESQUEMAS visibles o las BASES del nivel «Bases» (otro canal). */
  nivel?: NivelPopover
  /** Con nivel «Bases», la base de cuya lista de esquemas se eligen los visibles. */
  base?: string
  onCerrar: () => void
}

/** El popover de esquemas (o bases) visibles de una conexión, por portal. */
export function DbEsquemasPopover(props: PropsEsquemasPopover): React.JSX.Element {
  const { conexion, ancla, altoFila, varsDensidad, nivel = 'esquemas', base, onCerrar } = props
  const idBase = useId()
  const raizRef = useRef<HTMLDivElement>(null)
  const filtroRef = useRef<HTMLInputElement>(null)
  const fuente = useMemo(() => fuentePopover(conexion.id, nivel, base), [conexion.id, nivel, base])
  const s = useEsquemasPopover(conexion, nivel, base, fuente, onCerrar)
  // Clic fuera = aplicar, como Enter: marcar varias y pinchar en el árbol es el gesto.
  useCierreYFoco(raizRef, filtroRef, s.aplicar)
  const [pos, setPos] = useState<PosicionPopover>({ left: ancla.left, top: ancla.bottom + HUECO })
  // Se vuelve a medir cuando cambia el contenido (llega la lista, se filtra).
  useLayoutEffect(
    () => recolocar(raizRef.current, () => ancla.left, ancla.top, ancla.bottom, setPos),
    [ancla.left, ancla.top, ancla.bottom, s.visiblesLista.length, s.resp, s.error]
  )

  const n = s.resp ? contarVisibles(s.borrador, s.todos.length, s.porDefecto, s.todos) : 0
  const t = TEXTOS_POPOVER[nivel]
  const v: VistaFilas = { s, idBase, altoFila }

  const contenido = (
    <div
      ref={raizRef}
      className="db-esquemas-pop"
      role="dialog"
      aria-label={`${t.visibles} de ${conexion.alias}`}
      style={{ ...varsDensidad, left: pos.left, top: pos.top, width: ANCHO }}
      onKeyDown={(e) => teclaEsquemas(e, s, onCerrar)}
    >
      <div className="db-pop-cabecera">
        {t.cabecera} <span className="db-pop-alias">{base ?? conexion.alias}</span>
      </div>
      <input
        ref={filtroRef}
        className="db-pop-filtro"
        value={s.filtro}
        placeholder={t.filtrar}
        spellCheck={false}
        role="combobox"
        aria-expanded="true"
        aria-controls={`${idBase}-lista`}
        aria-activedescendant={s.filasNav.length > 0 ? `${idBase}-e${s.activo}` : undefined}
        aria-label={t.filtrar}
        onChange={(e) => {
          s.setFiltro(e.target.value)
          s.setActivo(0)
        }}
      />

      <EstadoCargaPopover hayLista={s.resp !== null} errorCarga={s.errorCarga} cargando={t.cargando} onReintentar={s.reintentar} />

      {s.resp && <ListaEsquemas v={v} t={t} />}

      {s.error && (
        <div className="db-pop-error" role="alert">
          {s.error}
        </div>
      )}

      <div className="db-pop-pie">
        <span className="db-pop-cuenta">{s.resp ? `${n} de ${s.todos.length}` : ''}</span>
        <span className="db-pop-pista">{s.aplicando ? 'Aplicando…' : 'Enter aplica · Esc cancela'}</span>
      </div>
    </div>
  )

  return createPortal(contenido, document.body)
}
