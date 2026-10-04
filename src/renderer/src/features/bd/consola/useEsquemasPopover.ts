// =============================================================================
// Estado del popover de esquemas (o bases) visibles de una conexión: el borrador de
// la configuración, el filtro, las filas navegables con su cursor y el aplicar. Toda
// la aritmética de la casilla tri-estado es de `shared/dbEsquemas`, la misma con que
// el main cuenta N; qué lista y qué canal, de `nivelBasesBd.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { DbConnection, DbEsquemasVisibles } from '../../../../../shared/db-ipc'
import type { DbEsquema } from '../../../../../shared/db-explorador-ipc'
import {
  alternarEsquema,
  alternarPorDefecto,
  alternarTodos,
  configEfectiva,
  estadoCasillaTodos,
  estaVisible,
  porDefectoMarcado
} from '../../../../../shared/dbEsquemas'
import { filtrarEsquemas, mensajeDeError, mismaConfigEsquemas, ordenarEsquemasPopover } from '../filasArbolBd'
import type { FuentePopover, NivelPopover } from '../nivelBasesBd'
import { useListaCatalogo } from './useListaCatalogo'

/** Una fila navegable: las dos casillas fijas de arriba o un esquema de la lista. */
export type FilaPop = { tipo: 'todos' } | { tipo: 'porDefecto' } | { tipo: 'esquema'; esquema: DbEsquema }

/** Aplica el borrador por el canal de su nivel; si no cambió nada, solo cierra. */
function useAplicarEsquemas(
  conexionId: string,
  nivel: NivelPopover,
  borrador: DbEsquemasVisibles,
  original: MutableRefObject<DbEsquemasVisibles>,
  onCerrar: () => void
) {
  const [aplicando, setAplicando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aplicandoRef = useRef(false)
  async function aplicar(): Promise<void> {
    if (aplicandoRef.current) return
    // Cerrar sin cambios no escribe (ni invalida el índice de nombres en el main).
    if (mismaConfigEsquemas(borrador, original.current)) {
      onCerrar()
      return
    }
    aplicandoRef.current = true
    setAplicando(true)
    setError(null)
    try {
      const r =
        nivel === 'bases'
          ? await window.tessera.dbExplorador.fijarBases(conexionId, borrador)
          : await window.tessera.dbExplorador.fijarEsquemas(conexionId, borrador)
      if (r.ok) {
        onCerrar()
        return
      }
      setError(r.error.mensaje)
    } catch (err) {
      setError(mensajeDeError(err))
    } finally {
      aplicandoRef.current = false
      setAplicando(false)
    }
  }
  return { aplicando, error, setError, aplicar }
}

/** Las filas navegables en orden: las fijas (solo sin filtro) y luego la lista. */
function filasNavegables(hayLista: boolean, filtro: string, porDefecto: string | null, lista: DbEsquema[]): FilaPop[] {
  const out: FilaPop[] = []
  if (hayLista && filtro.trim() === '') {
    out.push({ tipo: 'todos' })
    if (porDefecto !== null) out.push({ tipo: 'porDefecto' })
  }
  for (const esquema of lista) out.push({ tipo: 'esquema', esquema })
  return out
}

/** Estado, lista y acciones del popover de esquemas o bases visibles. */
export function useEsquemasPopover(
  conexion: DbConnection,
  nivel: NivelPopover,
  base: string | undefined,
  fuente: FuentePopover,
  onCerrar: () => void
) {
  const configGuardada = nivel === 'bases' ? conexion.bases : conexion.esquemas
  const [borrador, setBorrador] = useState<DbEsquemasVisibles>(() => configEfectiva(configGuardada))
  const original = useRef<DbEsquemasVisibles>(configEfectiva(configGuardada))
  const [filtro, setFiltro] = useState('')
  const [activo, setActivo] = useState(0)
  const { cache, resp, errorCarga } = useListaCatalogo(conexion.id, nivel === 'bases', base, fuente)
  const { aplicando, error, setError, aplicar } = useAplicarEsquemas(conexion.id, nivel, borrador, original, onCerrar)

  const porDefecto =
    resp?.porDefecto ?? (nivel === 'esquemas' && base === undefined ? (conexion.introspeccion?.esquemaPorDefecto ?? null) : null)
  const todos = useMemo(() => (resp ? resp.esquemas.map((x) => x.nombre) : []), [resp])
  const ordenados = useMemo(() => (resp ? ordenarEsquemasPopover(resp.esquemas) : []), [resp])
  const visiblesLista = useMemo(() => filtrarEsquemas(ordenados, filtro), [ordenados, filtro])
  const filasNav = useMemo<FilaPop[]>(
    () => filasNavegables(resp !== null, filtro, porDefecto, visiblesLista),
    [resp, filtro, porDefecto, visiblesLista]
  )

  // El cursor no puede quedarse fuera de la lista al filtrar.
  useEffect(() => {
    setActivo((a) => Math.max(0, Math.min(a, filasNav.length - 1)))
  }, [filasNav.length])

  function alternarFila(f: FilaPop): void {
    if (!resp) return
    setError(null)
    if (f.tipo === 'todos') setBorrador((b) => alternarTodos(b, todos, porDefecto))
    else if (f.tipo === 'porDefecto') setBorrador((b) => alternarPorDefecto(b, todos, porDefecto))
    else setBorrador((b) => alternarEsquema(b, f.esquema.nombre, todos, porDefecto))
  }

  const casillaDe = (f: FilaPop): 'vacia' | 'parcial' | 'llena' => {
    if (f.tipo === 'todos') return estadoCasillaTodos(borrador, todos, porDefecto)
    if (f.tipo === 'porDefecto') return porDefectoMarcado(borrador) ? 'llena' : 'vacia'
    return estaVisible(borrador, f.esquema.nombre, porDefecto) ? 'llena' : 'vacia'
  }

  const reintentar = (): void => void cache.reintentar(fuente.carga)
  return {
    borrador,
    filtro,
    setFiltro,
    activo,
    setActivo,
    resp,
    errorCarga,
    reintentar,
    porDefecto,
    todos,
    visiblesLista,
    filasNav,
    alternarFila,
    casillaDe,
    aplicando,
    error,
    aplicar
  }
}
