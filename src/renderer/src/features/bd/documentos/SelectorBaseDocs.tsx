// =============================================================================
// El selector de la base de la consola de MongoDB: el popover de la consola SQL (sus mismas
// clases `db-pop-*`) con la lista de `DOCS_CHANNELS.BASES`. No se reutiliza aquel porque lee
// la caché de bases SQL. Va por portal a `document.body` y sin lista virtual: un servidor de
// MongoDB tiene decenas de bases, no miles.
// =============================================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DbConnection } from '../../../../../shared/db-ipc'
import type { DbDocBase } from '../../../../../shared/db-documentos-ipc'
import { textoError } from '../consola/salidaConsola'
import { IconoCommit } from '../iconosBd'
import { FILAS_MAX, HUECO, MARGEN, mensajeDe, posicionSelector, type AnclaSelector } from './consolaComun'
import { EstadoSelector, FiltroSelector } from './piezasBarra'
import { teclaSelector, useCierreFuera } from './useSelectorBase'
import { useFocoDelFiltro } from '../consola/usePopoverFlotante'

const ANCHO_SELECTOR = 280

function useBasesDocs(conexionId: string): { bases: DbDocBase[] | null; error: string | null; reintentar: () => void } {
  const [bases, setBases] = useState<DbDocBase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  useEffect(() => {
    let vivo = true
    setError(null)
    window.tessera.dbDocumentos
      .bases({ conexionId, ...(intento > 0 ? { refrescar: true } : {}) })
      .then((r) => {
        if (!vivo) return
        if (r.ok) setBases(r.valor)
        else setError(textoError(r.error))
      })
      .catch((err: unknown) => {
        if (vivo) setError(mensajeDe(err))
      })
    return () => {
      vivo = false
    }
  }, [conexionId, intento])
  return { bases, error, reintentar: () => setIntento((n) => n + 1) }
}

function useOpcionesBases(
  bases: DbDocBase[] | null,
  actual: string | null
): {
  filtro: string
  setFiltro: (f: string) => void
  opciones: string[]
  activo: number
  setActivo: React.Dispatch<React.SetStateAction<number>>
} {
  const [filtro, setFiltro] = useState('')
  const [activo, setActivo] = useState(0)
  const opciones = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    return (bases ?? []).map((b) => b.nombre).filter((n) => f === '' || n.toLowerCase().includes(f))
  }, [bases, filtro])
  useEffect(() => {
    const i = actual === null ? -1 : opciones.indexOf(actual)
    setActivo(i >= 0 ? i : 0)
    // Solo al cambiar la lista o el filtro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opciones])
  return { filtro, setFiltro, opciones, activo, setActivo }
}

function usePosicionSelector(
  raizRef: React.RefObject<HTMLDivElement>,
  ancla: AnclaSelector,
  total: number,
  bases: DbDocBase[] | null,
  error: string | null
): { left: number; top: number } {
  const [pos, setPos] = useState({ left: Math.max(MARGEN, ancla.right - ANCHO_SELECTOR), top: ancla.bottom + HUECO })
  useLayoutEffect(() => {
    const el = raizRef.current
    if (!el) return
    const { left, top } = posicionSelector(el, { right: ancla.right, top: ancla.top, bottom: ancla.bottom })
    setPos((a) => (a.left === left && a.top === top ? a : { left, top }))
  }, [raizRef, ancla.right, ancla.top, ancla.bottom, total, bases, error])
  return pos
}

function ListaBases({
  opciones,
  actual,
  activo,
  altoFila,
  onActivar,
  onElegir
}: {
  opciones: string[]
  actual: string | null
  activo: number
  altoFila: number
  onActivar: (i: number) => void
  onElegir: (i: number) => void
}): React.JSX.Element {
  return (
    <div className="db-pop-lista" role="listbox" aria-label="Bases" style={{ maxHeight: FILAS_MAX * altoFila, overflowY: 'auto' }}>
      {opciones.map((n, i) => (
        <div
          key={n}
          role="option"
          aria-selected={n === actual}
          className={`db-pop-fila${i === activo ? ' activa' : ''}`}
          style={{ height: altoFila }}
          title={n}
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => onActivar(i)}
          onClick={() => onElegir(i)}
        >
          <span className="db-pop-marca" aria-hidden="true">
            {n === actual ? <IconoCommit /> : null}
          </span>
          <span className="db-pop-nombre">{n}</span>
        </div>
      ))}
    </div>
  )
}

/** El selector de la base de la consola de MongoDB, anclado bajo su botón. */
export function SelectorBaseDocs(p: {
  conexion: DbConnection
  actual: string | null
  ancla: AnclaSelector
  altoFila: number
  onElegir: (base: string) => void
  onCerrar: () => void
}): React.JSX.Element {
  const raizRef = useRef<HTMLDivElement>(null)
  const filtroRef = useRef<HTMLInputElement>(null)
  const { bases, error, reintentar } = useBasesDocs(p.conexion.id)
  const { filtro, setFiltro, opciones, activo, setActivo } = useOpcionesBases(bases, p.actual)
  const cerrarRef = useRef(p.onCerrar)
  cerrarRef.current = p.onCerrar
  useCierreFuera(raizRef, cerrarRef)
  useFocoDelFiltro(filtroRef)
  const pos = usePosicionSelector(raizRef, p.ancla, opciones.length, bases, error)

  const elegir = (i: number): void => {
    const n = opciones[i]
    if (n === undefined) return
    if (n !== p.actual) p.onElegir(n)
    cerrarRef.current()
  }
  const mover = (dir: number): void => setActivo((a) => Math.max(0, Math.min(opciones.length - 1, a + dir)))

  return createPortal(
    <div
      ref={raizRef}
      className="db-esquemas-pop db-esquema-consola-pop"
      role="dialog"
      aria-label={`Base de la consola en ${p.conexion.alias}`}
      style={{ left: pos.left, top: pos.top, width: ANCHO_SELECTOR }}
      onKeyDown={(e) => teclaSelector(e, { cerrar: () => cerrarRef.current(), elegir: () => elegir(activo), mover })}
    >
      <FiltroSelector alias={p.conexion.alias} filtroRef={filtroRef} filtro={filtro} placeholder="Filtrar bases" onFiltro={setFiltro} />
      <EstadoSelector cargando={!bases && !error} error={error} vacio={bases !== null && opciones.length === 0} onReintentar={reintentar} />
      {opciones.length > 0 && (
        <ListaBases
          opciones={opciones}
          actual={p.actual}
          activo={activo}
          altoFila={p.altoFila}
          onActivar={(i) => {
            if (i !== activo) setActivo(i)
          }}
          onElegir={elegir}
        />
      )}
      <div className="db-pop-pie">
        <span className="db-pop-pista">Enter elige · Esc cancela · también «use nombre»</span>
      </div>
    </div>,
    document.body
  )
}
