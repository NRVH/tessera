// =============================================================================
// useArbolBd — las filas del árbol de bases de datos y su CARGA PEREZOSA.
// Une la caché de catálogo (`cacheMetaBd`, que sobrevive al desmontaje del lateral), el
// aplanador puro (`aplanarArbolBd`) y lo desplegado (`expandidos`, de `useBdApp`), y
// devuelve las filas listas para la lista virtual. Tras cada render pide las cargas que
// faltan y refresca lo obsoleto que se VE.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { aplanarArbolBd, cargasPendientes, type CargaBd, type FilaBd } from './arbolBd'
import { cacheMetaBd } from './cacheMetaBd'
import { cargaDeFila } from './filasArbolBd'
import type { DbConsolaInfo } from '../../../../shared/db-explorador-ipc'
import type { DbConnection } from '../../../../shared/db-ipc'

export interface EntradaUseArbolBd {
  conexiones: readonly DbConnection[]
  consolas: readonly DbConsolaInfo[]
  expandidos: ReadonlySet<string>
  /** Búsqueda al teclear ('' = sin filtro). */
  filtro: string
}

export interface ArbolBd {
  filas: FilaBd[]
  /** «Reintentar» de una fila de error. */
  reintentar: (carga: CargaBd) => void
}

/** Las filas del árbol ya aplanadas, pidiendo lo que falta de lo que se ve. */
export function useArbolBd({ conexiones, consolas, expandidos, filtro }: EntradaUseArbolBd): ArbolBd {
  const cache = cacheMetaBd()
  const version = useSyncExternalStore(cache.suscribir, cache.version)

  // `version` es la que avisa de que la caché cambió; la instantánea se lee dentro
  // (y conserva su identidad mientras la versión no cambie).
  const filas = useMemo(() => {
    void version
    const inst = cache.instantaneaArbol()
    return aplanarArbolBd({ ...inst, conexiones, consolas, expandidos, filtro })
  }, [cache, version, conexiones, consolas, expandidos, filtro])

  useEffect(() => {
    for (const carga of cargasPendientes(filas)) void cache.cargar(carga)
    // Con búsqueda no se refresca nada: lo que se ve está abierto POR la búsqueda,
    // no porque el usuario lo desplegara, y teclear no debe salir al servidor.
    if (filtro.trim() !== '') return
    for (const f of filas) {
      if (!('expandida' in f) || !f.expandida) continue
      // Lo obsoleto se mira en la clave DE LA CARGA, no en la de la fila: son la misma
      // salvo en una conexión con nivel «Bases», cuya lista vive en `claveBd.bases`.
      const carga = cargaDeFila(f)
      if (carga && cache.obsoleta(carga.clave)) void cache.cargar(carga)
    }
  }, [cache, filas, filtro])

  return { filas, reintentar: (carga) => void cache.reintentar(carga) }
}
