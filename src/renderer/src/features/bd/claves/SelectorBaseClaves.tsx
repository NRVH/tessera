// =============================================================================
// El selector de la base de la consola de Redis: el popover de las otras consolas (sus mismas
// clases `db-pop-*`) con las bases NUMERADAS de `KV_CHANNELS.BASES` (`basesDeClaves`, la misma
// lista que el árbol; si la petición falla, las del descriptor y el error encima con
// «Reintentar»). El filtro acepta `3` o `db3`. Va por portal a `document.body` y sin lista
// virtual: un servidor de Redis tiene 16 bases por defecto, no miles.
// =============================================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DbConnection } from '../../../../../shared/db-ipc'
import type { DbKvBases } from '../../../../../shared/db-claves-ipc'
import { descriptor, esDeClaves } from '../../../../../shared/motores/index'
import { basesDeClaves, etiquetaBaseClaves, type BaseClaves } from '../arbolClaves'
import { textoError } from '../consola/salidaConsola'
import { IconoCommit } from '../iconosBd'
import { FILAS_MAX, HUECO, MARGEN, mensajeDe, posicionSelector, type AnclaSelector } from '../documentos/consolaComun'
import { EstadoSelector, FiltroSelector } from '../documentos/piezasBarra'
import { teclaSelector, useCierreFuera } from '../documentos/useSelectorBase'
import { useFocoDelFiltro } from '../../../comun/usePopoverFlotante'
import { baseDeFiltro } from './consolaClaves'

const ANCHO_SELECTOR = 240

function useRespuestaBases(conexionId: string): { resp: DbKvBases | null; cargando: boolean; error: string | null; reintentar: () => void } {
  const [resp, setResp] = useState<DbKvBases | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  useEffect(() => {
    let vivo = true
    setError(null)
    setCargando(true)
    window.tessera.dbClaves
      .bases({ conexionId })
      .then((r) => {
        if (!vivo) return
        if (r.ok) setResp(r.valor)
        else setError(textoError(r.error))
      })
      .catch((err: unknown) => {
        if (vivo) setError(mensajeDe(err))
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [conexionId, intento])
  return { resp, cargando, error, reintentar: () => setIntento((n) => n + 1) }
}

function useBasesDeClaves(conexion: DbConnection, resp: DbKvBases | null, cargando: boolean, error: string | null): BaseClaves[] {
  return useMemo((): BaseClaves[] => {
    if (cargando && !error) return []
    const d = descriptor(conexion.motor)
    if (!esDeClaves(d)) return []
    const lista = basesDeClaves(resp, d, conexion)
    // Sin conteos (ACL sin `+info`): ni un 0 que mienta.
    return resp?.conteosDesconocidos ? lista.map((b) => ({ ...b, claves: null })) : lista
  }, [cargando, error, resp, conexion])
}

function useOpcionesClaves(
  bases: BaseClaves[],
  actual: number
): {
  filtro: string
  setFiltro: (f: string) => void
  opciones: BaseClaves[]
  activo: number
  setActivo: React.Dispatch<React.SetStateAction<number>>
} {
  const [filtro, setFiltro] = useState('')
  const [activo, setActivo] = useState(0)
  const opciones = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    if (f === '') return bases
    const n = baseDeFiltro(f)
    return bases.filter((b) => (n !== null ? String(b.indice).startsWith(String(n)) : etiquetaBaseClaves(b.indice).includes(f)))
  }, [bases, filtro])
  useEffect(() => {
    const i = opciones.findIndex((b) => b.indice === actual)
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
  cargando: boolean,
  error: string | null
): { left: number; top: number } {
  const [pos, setPos] = useState({ left: Math.max(MARGEN, ancla.right - ANCHO_SELECTOR), top: ancla.bottom + HUECO })
  useLayoutEffect(() => {
    const el = raizRef.current
    if (!el) return
    const { left, top } = posicionSelector(el, { right: ancla.right, top: ancla.top, bottom: ancla.bottom })
    setPos((a) => (a.left === left && a.top === top ? a : { left, top }))
  }, [raizRef, ancla.right, ancla.top, ancla.bottom, total, cargando, error])
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
  opciones: BaseClaves[]
  actual: number
  activo: number
  altoFila: number
  onActivar: (i: number) => void
  onElegir: (i: number) => void
}): React.JSX.Element {
  return (
    <div className="db-pop-lista" role="listbox" aria-label="Bases" style={{ maxHeight: FILAS_MAX * altoFila, overflowY: 'auto' }}>
      {opciones.map((b, i) => (
        <div
          key={b.indice}
          role="option"
          aria-selected={b.indice === actual}
          className={`db-pop-fila${i === activo ? ' activa' : ''}`}
          style={{ height: altoFila }}
          title={etiquetaBaseClaves(b.indice)}
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => onActivar(i)}
          onClick={() => onElegir(i)}
        >
          <span className="db-pop-marca" aria-hidden="true">
            {b.indice === actual ? <IconoCommit /> : null}
          </span>
          <span className="db-pop-nombre">{etiquetaBaseClaves(b.indice)}</span>
          {b.claves !== null && b.claves > 0 && <span className="kv-pop-conteo">{b.claves === 1 ? '1 clave' : `${b.claves} claves`}</span>}
        </div>
      ))}
    </div>
  )
}

/** El selector de la base de la consola de Redis, anclado bajo su botón. */
export function SelectorBaseClaves(p: {
  conexion: DbConnection
  actual: number
  ancla: AnclaSelector
  altoFila: number
  onElegir: (base: number) => void
  onCerrar: () => void
}): React.JSX.Element {
  const raizRef = useRef<HTMLDivElement>(null)
  const filtroRef = useRef<HTMLInputElement>(null)
  const { resp, cargando, error, reintentar } = useRespuestaBases(p.conexion.id)
  const bases = useBasesDeClaves(p.conexion, resp, cargando, error)
  const { filtro, setFiltro, opciones, activo, setActivo } = useOpcionesClaves(bases, p.actual)
  const cerrarRef = useRef(p.onCerrar)
  cerrarRef.current = p.onCerrar
  useCierreFuera(raizRef, cerrarRef)
  useFocoDelFiltro(filtroRef)
  const pos = usePosicionSelector(raizRef, p.ancla, opciones.length, cargando, error)

  const elegir = (i: number): void => {
    const b = opciones[i]
    if (b === undefined) return
    if (b.indice !== p.actual) p.onElegir(b.indice)
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
      <FiltroSelector alias={p.conexion.alias} filtroRef={filtroRef} filtro={filtro} placeholder="Filtrar bases (3 o db3)" onFiltro={setFiltro} />
      <EstadoSelector
        cargando={cargando && !error}
        error={error}
        vacio={!cargando && bases.length > 0 && opciones.length === 0}
        onReintentar={reintentar}
      />
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
        <span className="db-pop-pista">Enter elige · Esc cancela · también «SELECT n»</span>
      </div>
    </div>,
    document.body
  )
}
