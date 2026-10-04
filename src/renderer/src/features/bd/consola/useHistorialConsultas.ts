// =============================================================================
// Estado y acciones del popover del historial de consultas (`HistorialConsultas`): la
// lista que filtra el MAIN (con pausa, y la respuesta vieja se tira), los alias de las
// conexiones del perfil, insertar, borrar una o todas, y el teclado. Lo que se decide
// sin DOM (hora, qué se inserta, qué tecla borra) es de `historialConsola.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-historial.md
// =============================================================================

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { DbConnection } from '../../../../../shared/db-ipc'
import type { DbEntradaHistorial, DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import type { Plataforma } from '../../../../../shared/plataforma'
import { esHistorial } from '../../../util/atajos'
import {
  LIMITE_HISTORIAL,
  consultaHistorial,
  enterEnHistorial,
  esBorrarEntrada,
  moverEnHistorial
} from './historialConsola'
import type { AnclaDerecha } from './popoverFlotante'
import { textoError } from './salidaConsola'

/** Lo que recibe el popover del historial de consultas. */
export interface HistorialConsultasProps {
  perfilId: string
  conexion: DbConnection
  ancla: AnclaDerecha
  onInsertar: (sql: string) => void
  onCerrar: () => void
}

/** Pausa de tecleo antes de preguntar al main por el filtro. */
const PAUSA_FILTRO_MS = 150

/** Un fallo del IPC como respuesta de error, sin el prefijo de Electron. */
function fallo<T>(err: unknown): DbRespuesta<T> {
  const mensaje = (err instanceof Error ? err.message : String(err ?? '')).replace(
    /^Error invoking remote method '[^']*':\s*/,
    ''
  )
  return { ok: false, error: { motivo: 'interno', mensaje } }
}

/** Los alias de las conexiones del perfil, una vez: las borradas salen como tales. */
function useAliasConexiones(perfilId: string, conexion: DbConnection): ReadonlyMap<string, string> {
  const [alias, setAlias] = useState<ReadonlyMap<string, string>>(() => new Map([[conexion.id, conexion.alias]]))
  useEffect(() => {
    let vivo = true
    window.tessera.db
      .list(perfilId)
      .then((cs) => {
        if (vivo) setAlias(new Map(cs.map((c) => [c.id, c.alias])))
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [perfilId])
  return alias
}

/**
 * La lista: al abrir, al conmutar «Solo esta conexión» y tras la pausa del filtro. La
 * respuesta de una pregunta vieja, o la que llega con el popover cerrado, se tira.
 */
function useListaHistorial(p: HistorialConsultasProps, soloEsta: boolean, filtro: string) {
  const { perfilId } = p
  const conexionId = p.conexion.id
  const api = window.tessera.dbExplorador
  const [entradas, setEntradas] = useState<DbEntradaHistorial[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activo, setActivo] = useState(0)
  const [recarga, setRecarga] = useState(0)
  const cerrarRef = useRef(p.onCerrar)
  cerrarRef.current = p.onCerrar
  const insertarRef = useRef(p.onInsertar)
  insertarRef.current = p.onInsertar
  // La consulta con la que llegó la lista que se ve, y si hay un Enter esperando a la
  // lista de lo tecleado (`enterEnHistorial`).
  const vistaRef = useRef<string | null>(null)
  const enterEsperandoRef = useRef(false)
  const primeraRef = useRef(true)

  useEffect(() => {
    let vigente = true
    const consulta = consultaHistorial(soloEsta, filtro)
    const espera = primeraRef.current ? 0 : PAUSA_FILTRO_MS
    primeraRef.current = false
    const t = setTimeout(() => {
      const texto = filtro.trim()
      const pedido = { perfilId, ...(soloEsta ? { conexionId } : {}), ...(texto ? { texto } : {}), limite: LIMITE_HISTORIAL }
      void api
        .historial(pedido)
        .catch((err: unknown) => fallo<DbEntradaHistorial[]>(err))
        .then((r) => {
          if (!vigente) return
          const enterEsperando = enterEsperandoRef.current
          enterEsperandoRef.current = false
          if (!r.ok) {
            setError(textoError(r.error))
            return
          }
          vistaRef.current = consulta
          setEntradas(r.valor)
          setError(null)
          setActivo(0)
          // El Enter que se dio antes de que llegara: la primera de ESTA lista.
          const primera = r.valor[0]
          if (enterEsperando && primera) {
            insertarRef.current(primera.sql)
            cerrarRef.current()
          }
        })
    }, espera)
    return () => {
      clearTimeout(t)
      // Con un Enter esperando, una respuesta tardía insertaría tras cerrar con clic fuera.
      vigente = false
    }
  }, [api, perfilId, conexionId, soloEsta, filtro, recarga])

  const reintentar = (): void => setRecarga((n) => n + 1)
  return { api, entradas, setEntradas, error, setError, activo, setActivo, reintentar, cerrarRef, vistaRef, enterEsperandoRef }
}

/** Estado, lista y acciones del historial de consultas. */
export function useHistorialConsultas(p: HistorialConsultasProps, filtroRef: RefObject<HTMLInputElement>) {
  const { perfilId } = p
  const [filtro, setFiltro] = useState('')
  const [soloEsta, setSoloEsta] = useState(true)
  const [confirmando, setConfirmando] = useState(false)
  const alias = useAliasConexiones(perfilId, p.conexion)
  const l = useListaHistorial(p, soloEsta, filtro)
  const { api, entradas, setEntradas, setError, setActivo } = l
  const total = entradas ? entradas.length : 0

  const insertar = (i: number): void => {
    const e = entradas?.[i]
    if (!e) return
    p.onInsertar(e.sql)
    l.cerrarRef.current()
  }

  const borrar = (i: number): void => {
    const e = entradas?.[i]
    if (!e) return
    void api
      .borrarHistorial(perfilId, [e.id])
      .catch((err: unknown) => fallo<void>(err))
      .then((r) => {
        if (!r.ok) {
          setError(`No se pudo borrar: ${textoError(r.error)}`)
          return
        }
        setEntradas((ls) => (ls ? ls.filter((x) => x.id !== e.id) : ls))
        setActivo((a) => Math.max(0, Math.min(a, total - 2)))
      })
  }

  // El foco vuelve al filtro ANTES de que se desmonte el botón que lo tenía: si cae en
  // `body`, fuera del popover, su teclado deja de responder hasta un clic dentro.
  const cerrarConfirmacion = (): void => {
    filtroRef.current?.focus()
    setConfirmando(false)
  }

  const borrarTodo = (): void => {
    cerrarConfirmacion()
    void api
      .borrarHistorial(perfilId, null)
      .catch((err: unknown) => fallo<void>(err))
      .then((r) => {
        if (!r.ok) setError(`No se pudo borrar: ${textoError(r.error)}`)
        else setEntradas([])
      })
  }

  return { ...l, filtro, setFiltro, soloEsta, setSoloEsta, confirmando, setConfirmando, alias, total, insertar, borrar, cerrarConfirmacion, borrarTodo }
}

type Historial = ReturnType<typeof useHistorialConsultas>

/** Enter inserta la activa; con la lista de otro filtro aún en camino, espera a la nueva. */
function enterHistorial(h: Historial): void {
  const que = enterEnHistorial(h.vistaRef.current, consultaHistorial(h.soloEsta, h.filtro), h.total)
  if (que === 'insertar') h.insertar(h.activo)
  else if (que === 'esperar') h.enterEsperandoRef.current = true
}

/** El teclado del historial: todas las teclas se quedan en el popover. */
export function teclaHistorial(e: React.KeyboardEvent, h: Historial, plataforma: Plataforma, filtro: HTMLInputElement | null): void {
  // El portal burbujea por el árbol de React hasta la sección de la consola.
  e.stopPropagation()
  if (e.nativeEvent.isComposing) return
  if (e.key === 'Escape') {
    e.preventDefault()
    if (h.confirmando) h.cerrarConfirmacion()
    else h.cerrarRef.current()
    return
  }
  // El mismo acorde que lo abre, lo cierra (como el de la barra).
  if (esHistorial(e, plataforma)) {
    e.preventDefault()
    h.cerrarRef.current()
    return
  }
  if (h.confirmando) return
  const destino = e.target as HTMLElement
  // Enter en un botón (la papelera, «Borrar todo») lo resuelve el botón.
  if (e.key === 'Enter' && !(destino instanceof HTMLButtonElement)) {
    e.preventDefault()
    enterHistorial(h)
    return
  }
  const mover = moverEnHistorial(h.activo, h.total, e.key)
  if (mover !== null) {
    e.preventDefault()
    h.setActivo(mover)
    return
  }
  if (destino === filtro && esBorrarEntrada(e, h.filtro === '', plataforma)) {
    e.preventDefault()
    h.borrar(h.activo)
  }
}
