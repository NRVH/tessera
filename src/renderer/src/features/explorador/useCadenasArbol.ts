// =============================================================================
// Cadenas de carpetas del árbol: el estado que las guarda y los dos efectos que las
// cargan (por carpeta visible y al refrescar). Hooks de `FileTree`, llamados desde
// `useArbol` en este orden: el orden de los efectos forma parte de su contrato.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { FileEntry } from '../../../../shared/files-ipc'
import { ColaConcurrencia, esCancelada } from '../../../../shared/colaConcurrencia'
import { entradasConCadena, necesitaCadena, podarCadenas, type ChainInfo, type FlatRow } from './treeFlatten'

/** Cadenas cargadas, sus errores y los registros que comparten los dos efectos de carga. */
export interface EstadoCadenas {
  /** Cadena compactada y sus hijos, por ruta del primer segmento. */
  chains: Map<string, ChainInfo>
  setChains: React.Dispatch<React.SetStateAction<Map<string, ChainInfo>>>
  /** Fallo de listado, por ruta del primer segmento. */
  chainErrors: Map<string, string>
  setChainErrors: React.Dispatch<React.SetStateAction<Map<string, string>>>
  /** Carpetas cuyo `listDir` está en vuelo. */
  loadingChains: MutableRefObject<Set<string>>
  /** Tope del abanico de `listDir` de todo el árbol. */
  colaIndexado: ColaConcurrencia
  /** false solo tras el desmontaje real del árbol. */
  mountedRef: MutableRefObject<boolean>
}

/** Sigue la cadena de carpetas de único hijo-carpeta desde `entry` y la fusiona en una fila. */
async function loadChain(entry: FileEntry): Promise<ChainInfo> {
  // Un contenedor (.jar, .war…) es su propia fila: no se compacta con lo que tiene dentro.
  if (entry.contenedor != null) {
    return { segments: [entry], children: await window.tessera.files.listDir(entry.path) }
  }
  const segments = [entry]
  let children = await window.tessera.files.listDir(entry.path)
  while (children.length === 1 && children[0].kind === 'dir') {
    segments.push(children[0])
    children = await window.tessera.files.listDir(children[0].path)
  }
  return { segments, children }
}

/** Estado de las cadenas y el aviso de que el árbol sigue montado. */
export function useEstadoCadenas(): EstadoCadenas {
  const [chains, setChains] = useState<Map<string, ChainInfo>>(new Map())
  const [chainErrors, setChainErrors] = useState<Map<string, string>>(new Map())
  const loadingChains = useRef<Set<string>>(new Set())
  // Inicialización perezosa: el argumento de `useRef` se evalúa en cada render.
  const colaRef = useRef<ColaConcurrencia | null>(null)
  if (colaRef.current === null) colaRef.current = new ColaConcurrencia(8)
  // Sustituye a un `cancelled` por efecto: se activaba en cada re-ejecución y dejaba
  // carpetas «cargando…» para siempre. Un dato que llega se aplica mientras el árbol viva.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  return { chains, setChains, chainErrors, setChainErrors, loadingChains, colaIndexado: colaRef.current, mountedRef }
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Carga perezosa: por cada carpeta visible cuya cadena aún no se conoce, la pide. Al
 * llegar cambia `chains`, se re-aplana y el efecto vuelve a correr para el nivel siguiente.
 */
export function useCargaPerezosa(cad: EstadoCadenas, rows: FlatRow[]): void {
  const { chains, chainErrors, setChains, setChainErrors, loadingChains, colaIndexado, mountedRef } = cad
  useEffect(() => {
    for (const row of rows) {
      if (!necesitaCadena(row)) continue
      const path = row.entry.path
      if (chains.has(path) || chainErrors.has(path) || loadingChains.current.has(path)) continue
      loadingChains.current.add(path)
      colaIndexado
        .correr(() => loadChain(row.entry))
        .then((c) => {
          loadingChains.current.delete(path)
          if (!mountedRef.current) return
          setChains((prev) => (prev.has(path) ? prev : new Map(prev).set(path, c)))
        })
        .catch((err: unknown) => {
          loadingChains.current.delete(path)
          // Cancelada por una ráfaga nueva: no es un fallo de la carpeta.
          if (!mountedRef.current || esCancelada(err)) return
          setChainErrors((prev) => new Map(prev).set(path, mensajeDe(err)))
        })
    }
  }, [rows, chains, chainErrors, colaIndexado, loadingChains, mountedRef, setChains, setChainErrors])
}

/**
 * Refresco (watcher o CRUD): re-lista en sitio las cadenas de las carpetas visibles y poda
 * del caché las de ramas colapsadas, que se recargan frescas al re-expandir.
 */
export function useRefrescoCadenas(cad: EstadoCadenas, rows: FlatRow[], refreshToken: number): void {
  const { setChains, setChainErrors, loadingChains, colaIndexado } = cad
  useEffect(() => {
    if (refreshToken === 0) return
    // Tira el abanico de la ráfaga anterior que no llegó a arrancar; lo que ya está en
    // vuelo se deja terminar. `loadingChains` no se vacía: lo comparten los dos efectos y
    // vaciarlo dejaba pedir dos veces la misma carpeta.
    colaIndexado.cancelarPendientes()
    const visibles = entradasConCadena(rows)
    setChains((prev) => podarCadenas(prev, visibles))
    setChainErrors(new Map())
    let cancelled = false
    for (const [path, entry] of visibles) {
      // Se apunta antes de encolar: mientras viva la petición, el efecto perezoso no la repite.
      loadingChains.current.add(path)
      colaIndexado
        .correr(() => loadChain(entry))
        .then((c) => {
          loadingChains.current.delete(path)
          if (!cancelled) setChains((prev) => new Map(prev).set(path, c))
        })
        .catch((err: unknown) => {
          loadingChains.current.delete(path)
          // Una cancelación no es un fallo: pintarla como error dejaría el árbol en rojo en un build.
          if (cancelled || esCancelada(err)) return
          setChainErrors((prev) => new Map(prev).set(path, mensajeDe(err)))
        })
    }
    return () => {
      cancelled = true
    }
    // Solo en cambios de refreshToken: lee `rows` por cierre y no debe re-disparar con `setChains`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])
}
