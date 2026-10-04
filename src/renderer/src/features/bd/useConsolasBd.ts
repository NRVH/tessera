// =============================================================================
// useConsolasBd: las CONSOLAS (archivos `consolas/*` del espacio de datos) de los
// perfiles que la vista de bases de datos necesita ahora, por perfil y sin suscripción:
// se relee al entrar un perfil en el interés, cuando algo toca una consola y al
// recuperar el foco la ventana. Las altas son optimistas y la poda de pestañas va por
// `onListado`, solo tras un listado bueno.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DbConsolaInfo } from '../../../../shared/db-explorador-ipc'
import { claveDe } from './useConexionesBd'

/** Las consolas por perfil, con cómo releerlas y el alta optimista. */
export interface ConsolasBd {
  /** Consolas ya leídas, por perfil. Sin entrada = aún no se sabe. */
  porPerfil: ReadonlyMap<string, readonly DbConsolaInfo[]>
  /** Vuelve a listar un perfil, o todos los de interés si no se indica. */
  recargar: (perfilId?: string) => void
  /** Alta optimista: la consola recién creada entra ya, antes del próximo listado. */
  anadir: (perfilId: string, consola: DbConsolaInfo) => void
}

type PorPerfil = ReadonlyMap<string, readonly DbConsolaInfo[]>
/** Altas optimistas de un perfil aún no confirmadas, con su momento de entrada. */
type Optimistas = Map<string, { consola: DbConsolaInfo; en: number }>

/**
 * La lista de un listado más las altas optimistas POSTERIORES a su inicio; las
 * anteriores ya tenían que venir en él (si no vienen, se borraron) y se olvidan.
 */
function fundirOptimistas(valor: readonly DbConsolaInfo[], optimistas: Optimistas | undefined, inicio: number): DbConsolaInfo[] {
  const lista = [...valor]
  if (!optimistas) return lista
  for (const [id, o] of optimistas) {
    if (lista.some((c) => c.id === id)) optimistas.delete(id)
    else if (o.en > inicio) lista.push(o.consola)
    else optimistas.delete(id)
  }
  return lista
}

/** El mapa con la lista nueva de un perfil (el mismo si no cambió nada). */
function conLista(prev: PorPerfil, perfilId: string, lista: readonly DbConsolaInfo[]): PorPerfil {
  const antes = prev.get(perfilId)
  if (antes !== undefined && JSON.stringify(antes) === JSON.stringify(lista)) return prev
  const next = new Map(prev)
  next.set(perfilId, lista)
  return next
}

/** El mapa sin los perfiles que salieron del interés (el mismo si no sobra ninguno). */
function soloInteres(prev: PorPerfil, interes: ReadonlySet<string>): PorPerfil {
  let sobra = false
  for (const k of prev.keys()) {
    if (!interes.has(k)) {
      sobra = true
      break
    }
  }
  if (!sobra) return prev
  const next = new Map<string, readonly DbConsolaInfo[]>()
  for (const [k, v] of prev) if (interes.has(k)) next.set(k, v)
  return next
}

/** El mapa con la consola recién creada al final de su perfil. */
function conAlta(prev: PorPerfil, perfilId: string, consola: DbConsolaInfo): PorPerfil {
  const next = new Map(prev)
  next.set(perfilId, [...(prev.get(perfilId) ?? []).filter((c) => c.id !== consola.id), consola])
  return next
}

/** Apunta una alta optimista de un perfil con su momento de entrada. */
function apuntarOptimista(todas: Map<string, Optimistas>, perfilId: string, consola: DbConsolaInfo, en: number): void {
  let delPerfil = todas.get(perfilId)
  if (!delPerfil) {
    delPerfil = new Map()
    todas.set(perfilId, delPerfil)
  }
  delPerfil.set(consola.id, { consola, en })
}

/**
 * Las consolas de los perfiles de interés.
 * @param onListado se llama tras cada listado BUENO con los ids que existen (más
 *   las altas optimistas que el listado no podía conocer). Es donde `useBdApp` poda las
 *   pestañas de consolas borradas. Se lee por ref: no hace falta que sea estable.
 */
export function useConsolasBd(
  perfilesInteres: readonly string[],
  onListado?: (perfilId: string, idsVivos: readonly string[]) => void
): ConsolasBd {
  const clave = claveDe(perfilesInteres)
  const onListadoRef = useRef(onListado)
  onListadoRef.current = onListado
  const [porPerfil, setPorPerfil] = useState<PorPerfil>(() => new Map())
  /** Reloj lógico: cada listado y cada alta optimista toman un número creciente. */
  const relojRef = useRef(0)
  /** Último listado lanzado por perfil (solo cuenta la respuesta del último). */
  const ultimoRef = useRef(new Map<string, number>())
  const optimistasRef = useRef(new Map<string, Optimistas>())
  const interesRef = useRef<string[]>([])
  interesRef.current = clave ? clave.split(',') : []

  const listar = useCallback((perfilId: string) => {
    const inicio = ++relojRef.current
    ultimoRef.current.set(perfilId, inicio)
    window.tessera.dbExplorador
      .listarConsolas(perfilId)
      .then((r) => {
        if (ultimoRef.current.get(perfilId) !== inicio) return
        if (!r.ok) {
          // Sin lista no se toca nada (y, sobre todo, no se poda ninguna pestaña).
          console.error('[db] no se pudieron listar las consolas:', r.error.mensaje)
          return
        }
        const optimistas = optimistasRef.current.get(perfilId)
        const lista = fundirOptimistas(r.valor, optimistas, inicio)
        if (optimistas && optimistas.size === 0) optimistasRef.current.delete(perfilId)
        setPorPerfil((prev) => conLista(prev, perfilId, lista))
        onListadoRef.current?.(perfilId, lista.map((c) => c.id))
      })
      .catch((err: unknown) => console.error('[db] no se pudieron listar las consolas:', err))
  }, [])

  useEffect(() => {
    const interes = clave ? clave.split(',') : []
    const set = new Set(interes)
    setPorPerfil((prev) => soloInteres(prev, set))
    for (const perfilId of interes) listar(perfilId)
  }, [clave, listar])

  // Al volver a la ventana: el agente pudo tocar la carpeta mientras tanto.
  useEffect(() => {
    const alFoco = (): void => {
      for (const perfilId of interesRef.current) listar(perfilId)
    }
    window.addEventListener('focus', alFoco)
    return () => window.removeEventListener('focus', alFoco)
  }, [listar])

  const recargar = useCallback(
    (perfilId?: string) => {
      if (perfilId !== undefined) listar(perfilId)
      else for (const p of interesRef.current) listar(p)
    },
    [listar]
  )

  const anadir = useCallback((perfilId: string, consola: DbConsolaInfo) => {
    apuntarOptimista(optimistasRef.current, perfilId, consola, ++relojRef.current)
    setPorPerfil((prev) => conAlta(prev, perfilId, consola))
  }, [])

  return useMemo(() => ({ porPerfil, recargar, anadir }), [porPerfil, recargar, anadir])
}
