// =============================================================================
// SelectorEsquemaConsola: el ESQUEMA ACTUAL de una consola SQL (o su BASE, con el
// nivel «Bases»). Es el mismo popover que el de esquemas visibles (portal, filtro
// combobox, lista virtual, clases `.db-pop-*`) con otra semántica: elegir UNO. Enter o
// clic eligen y cierran; Esc y el clic fuera cancelan. Las opciones y cuál es la
// vigente salen de `esquemaConsola.ts`; los textos, de `nivelBasesBd.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-popovers.md
// =============================================================================

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DbConnection } from '../../../../../shared/db-ipc'
import { VirtualList } from '../../../comun/VirtualList'
import { IconoCommit } from '../iconosBd'
import { fuentePopover, textosSelectorConsola, type NivelSelectorConsola } from '../nivelBasesBd'
import { EstadoCargaPopover } from './EstadoCargaPopover'
import { indiceInicialEsquema, opcionesEsquemaConsola, type OpcionEsquemaConsola } from './esquemaConsola'
import { FILAS_MAX, HUECO, MARGEN, recolocar, teclaPopover, type AnclaDerecha, type PosicionPopover } from './popoverFlotante'
import { useCierreYFoco } from './usePopoverFlotante'
import { useListaCatalogo } from './useListaCatalogo'

/** Ancho del selector de esquema de la consola. */
const ANCHO_SELECTOR = 280

/** Lo que recibe el selector de esquema de la consola. */
export interface PropsSelectorEsquema {
  conexion: DbConnection
  /** Lo elegido en el selector (`DbConsolaInfo.esquema`); null = el de la conexión. */
  elegido: string | null
  /** El esquema en el que está la consola ahora (`esquemaEfectivo`). */
  efectivo: string | null
  /** Rectángulo del botón: el popover se alinea con su borde DERECHO. */
  ancla: AnclaDerecha
  altoFila: number
  /** 'base': se elige la BASE de la consola (nivel «Bases»); ver `nivelBasesBd.ts`. */
  nivel?: NivelSelectorConsola
  onElegir: (esquema: string | null) => void
  onCerrar: () => void
}

/** Lista, opciones y cursor del selector; elegir la vigente solo cierra. */
function useSelectorEsquema(p: PropsSelectorEsquema) {
  const { conexion, elegido, efectivo, nivel = 'esquema', onElegir, onCerrar } = p
  const [filtro, setFiltro] = useState('')
  const deBases = nivel === 'base'
  const fuente = useMemo(() => fuentePopover(conexion.id, deBases ? 'bases' : 'esquemas'), [conexion.id, deBases])
  const t = textosSelectorConsola(nivel)
  const { cache, resp, errorCarga } = useListaCatalogo(conexion.id, deBases, undefined, fuente)

  const porDefecto = resp?.porDefecto ?? (deBases ? null : (conexion.introspeccion?.esquemaPorDefecto ?? null))
  const opciones = useMemo(
    () => opcionesEsquemaConsola(resp ? resp.esquemas : null, porDefecto, elegido, efectivo, filtro, t.deLaConexion),
    // `t` depende solo de `nivel`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resp, porDefecto, elegido, efectivo, filtro, nivel]
  )
  const [activo, setActivo] = useState(() => indiceInicialEsquema(opciones))
  // Cuando llega la lista (o cambia el filtro), el cursor vuelve a la vigente, o a
  // la primera si la vigente no está entre las filtradas.
  useEffect(() => {
    setActivo(indiceInicialEsquema(opciones))
    // Solo al cambiar la LISTA o el filtro, no en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp, filtro])
  useEffect(() => {
    setActivo((a) => Math.max(0, Math.min(a, opciones.length - 1)))
  }, [opciones.length])

  const elegir = (i: number): void => {
    const o = opciones[i]
    if (!o) return
    if (o.actual) {
      onCerrar()
      return
    }
    onElegir(o.esquema)
    onCerrar()
  }

  const reintentar = (): void => void cache.reintentar(fuente.carga)
  return { t, filtro, setFiltro, resp, errorCarga, reintentar, opciones, activo, setActivo, elegir }
}

type Selector = ReturnType<typeof useSelectorEsquema>

/** Esc cancela, Enter elige la activa, ↑/↓ y Re Pág/Av Pág mueven el cursor. */
function teclaSelector(e: React.KeyboardEvent, s: Selector, onCerrar: () => void): void {
  teclaPopover(e, {
    total: s.opciones.length,
    setActivo: s.setActivo,
    alEscape: onCerrar,
    alEnter: () => s.elegir(s.activo),
    conPaginas: true
  })
}

/** Una opción: la marca de la vigente y su texto; pasar el ratón la hace activa. */
function FilaSelector({
  o,
  i,
  s,
  idBase,
  altoFila
}: {
  o: OpcionEsquemaConsola
  i: number
  s: Selector
  idBase: string
  altoFila: number
}): React.JSX.Element {
  return (
    <div
      id={`${idBase}-s${i}`}
      role="option"
      aria-selected={o.actual}
      className={`db-pop-fila${i === s.activo ? ' activa' : ''}${o.sistema ? ' atenuada' : ''}${o.esquema === null ? ' db-pop-conexion' : ''}`}
      style={{ height: altoFila }}
      title={o.sistema ? `${o.texto}: ${s.t.delSistema}` : o.texto}
      // Sin robar el foco al filtro.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={() => {
        if (i !== s.activo) s.setActivo(i)
      }}
      onClick={() => s.elegir(i)}
    >
      <span className="db-pop-marca" aria-hidden="true">
        {o.actual ? <IconoCommit /> : null}
      </span>
      <span className="db-pop-nombre">{o.texto}</span>
    </div>
  )
}

/** La lista de opciones (o «ninguno» si el filtro no deja ninguna). */
function ListaSelector({ s, idBase, altoFila }: { s: Selector; idBase: string; altoFila: number }): React.JSX.Element {
  const altoLista = Math.min(Math.max(s.opciones.length, 1), FILAS_MAX) * altoFila
  return (
    <div id={`${idBase}-lista`} role="listbox" aria-label={s.t.lista}>
      {s.opciones.length === 0 ? (
        s.resp && <div className="db-pop-estado">{s.t.ninguno}</div>
      ) : (
        <VirtualList<OpcionEsquemaConsola>
          className="db-pop-lista"
          style={{ height: altoLista }}
          items={s.opciones}
          itemHeight={altoFila}
          getKey={(o) => (o.esquema === null ? '\u0000conexion' : o.esquema)}
          scrollToIndex={s.activo}
          renderItem={(o, i) => <FilaSelector o={o} i={i} s={s} idBase={idBase} altoFila={altoFila} />}
        />
      )}
    </div>
  )
}

/** El selector del esquema (o la base) de una consola, por portal y alineado a su botón. */
export function SelectorEsquemaConsola(props: PropsSelectorEsquema): React.JSX.Element {
  const { conexion, ancla, altoFila, onCerrar } = props
  const idBase = useId()
  const raizRef = useRef<HTMLDivElement>(null)
  const filtroRef = useRef<HTMLInputElement>(null)
  const s = useSelectorEsquema(props)
  // Clic fuera = cancelar: aquí no hay un borrador que aplicar al salir.
  useCierreYFoco(raizRef, filtroRef, onCerrar)
  const [pos, setPos] = useState<PosicionPopover>({
    left: Math.max(MARGEN, ancla.right - ANCHO_SELECTOR),
    top: ancla.bottom + HUECO
  })
  // Bajo el botón y alineado por la derecha; si no cabe debajo, encima.
  useLayoutEffect(
    () => recolocar(raizRef.current, (ancho) => ancla.right - ancho, ancla.top, ancla.bottom, setPos),
    [ancla.right, ancla.top, ancla.bottom, s.opciones.length, s.resp]
  )

  const contenido = (
    <div
      ref={raizRef}
      className="db-esquemas-pop db-esquema-consola-pop"
      role="dialog"
      aria-label={`${s.t.cabecera} ${conexion.alias}`}
      style={{ left: pos.left, top: pos.top, width: ANCHO_SELECTOR }}
      onKeyDown={(e) => teclaSelector(e, s, onCerrar)}
    >
      <div className="db-pop-cabecera">
        {s.t.cabecera} <span className="db-pop-alias">{conexion.alias}</span>
      </div>
      <input
        ref={filtroRef}
        className="db-pop-filtro"
        value={s.filtro}
        placeholder={s.t.filtrar}
        spellCheck={false}
        role="combobox"
        aria-expanded="true"
        aria-controls={`${idBase}-lista`}
        aria-activedescendant={s.opciones.length > 0 ? `${idBase}-s${s.activo}` : undefined}
        aria-label={s.t.filtrar}
        onChange={(e) => s.setFiltro(e.target.value)}
      />
      <EstadoCargaPopover
        hayLista={s.resp !== null}
        errorCarga={s.errorCarga}
        cargando={s.t.cargando}
        onReintentar={s.reintentar}
      />
      <ListaSelector s={s} idBase={idBase} altoFila={altoFila} />
      <div className="db-pop-pie">
        <span className="db-pop-pista">Enter elige · Esc cancela</span>
      </div>
    </div>
  )

  return createPortal(contenido, document.body)
}
