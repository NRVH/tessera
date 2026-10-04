// =============================================================================
// arbolBdNodo — la pieza común del aplanador del árbol de BD: el nodo con hijos perezosos,
// el contexto que leen todas las familias (entrada y consolas por conexión), el marcador de
// lo que falta (cargando o error) y la carpeta de consolas, que tienen todas las conexiones.
// Puro; lo usan `arbolBdNodosSql.ts`, `arbolBdNodosFamilias.ts` y `arbolBdAplanado.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import { claveBd } from './arbolBdClaves.ts'
import type { DbConsolaInfo, DbErrorSql } from '../../../../shared/db-explorador-ipc.ts'
import type { CargaBd, EntradaArbolBd, FilaBd, FilaCarpetaConsolas, FilaConsola } from './arbolBdTipos.ts'

/** Lo que se pinta DETRÁS de los hijos de un nodo expandido. */
export type EstadoHijos =
  | { variante: 'loading'; carga: CargaBd }
  | { variante: 'error'; error: DbErrorSql; carga: CargaBd }
  | { variante: 'empty'; mensaje: string }

export interface HijosNodo {
  nodos: Nodo[]
  /** Lo que se pinta DETRÁS de los hijos: cargando, error o vacío. */
  estado: EstadoHijos | null
}

export interface Nodo {
  /** La fila con `expandida=false` y sin marcas de búsqueda. */
  base: FilaBd
  contenedor: boolean
  /** Texto que la búsqueda compara, o null si la fila no se busca (carpetas). */
  etiqueta: string | null
  hijos: () => HijosNodo
}

export const SIN_HIJOS = (): HijosNodo => ({ nodos: [], estado: null })

/** Lo que leen los nodos al construirse: la entrada y sus consolas agrupadas por conexión. */
export interface ContextoArbol {
  e: EntradaArbolBd
  consolasPorConexion: ReadonlyMap<string, readonly DbConsolaInfo[]>
}

export function crearContexto(e: EntradaArbolBd): ContextoArbol {
  const consolasPorConexion = new Map<string, DbConsolaInfo[]>()
  for (const k of e.consolas) {
    const lista = consolasPorConexion.get(k.conexionId)
    if (lista) lista.push(k)
    else consolasPorConexion.set(k.conexionId, [k])
  }
  return { e, consolasPorConexion }
}

/** Los hijos de un nodo aún sin datos: su error si la carga falló (con su «Reintentar») o «Cargando…». */
export function pendiente(ctx: ContextoArbol, carga: CargaBd, nodos: Nodo[] = []): HijosNodo {
  const error = ctx.e.errores.get(carga.clave)
  return { nodos, estado: error ? { variante: 'error', error, carga } : { variante: 'loading', carga } }
}

/** Hijos ya cargados; si no hay ninguno, el marcador «vacío» con su mensaje. */
export function cargados(nodos: Nodo[], vacia: boolean, mensaje: string): HijosNodo {
  return { nodos, estado: vacia ? { variante: 'empty', mensaje } : null }
}

/** El `base?` de filas y cargas: la clave solo existe si hay base. */
export function conBase(b: string | undefined): { base?: string } {
  return b === undefined ? {} : { base: b }
}

/** Los primeros hijos de toda conexión: su carpeta de consolas, si tiene alguna. */
export function inicioConexion(ctx: ContextoArbol, conexionId: string): Nodo[] {
  const nodos: Nodo[] = []
  const consolas = ctx.consolasPorConexion.get(conexionId) ?? []
  if (consolas.length > 0) nodos.push(nodoCarpetaConsolas(conexionId, consolas))
  return nodos
}

function nodoCarpetaConsolas(conexionId: string, consolas: readonly DbConsolaInfo[]): Nodo {
  const base: FilaCarpetaConsolas = {
    kind: 'carpeta-consolas',
    key: claveBd.consolas(conexionId),
    depth: 1,
    conexionId,
    cuenta: consolas.length,
    expandida: false
  }
  return {
    base,
    contenedor: true,
    etiqueta: null,
    hijos: () => ({
      nodos: [...consolas]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
        .map((k) => {
          const fila: FilaConsola = {
            kind: 'consola',
            key: claveBd.consola(conexionId, k.id),
            depth: 2,
            conexionId,
            consola: k
          }
          return { base: fila, contenedor: false, etiqueta: k.nombre, hijos: SIN_HIJOS }
        }),
      estado: null
    })
  }
}
