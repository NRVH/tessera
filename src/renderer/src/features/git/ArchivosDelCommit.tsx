// =============================================================================
// ArchivosDelCommit: la mitad superior de la tercera columna del log, con los archivos
// que tocó el commit seleccionado. En ÁRBOL y virtualizado, sin casillas. Seleccionar es
// ver: un clic o una flecha mueve el cursor y abre el diff contra el padre; quién abre y
// cuándo lo decide el padre, aquí solo se avisa de qué fila se tocó.
// Decisiones: docs/decisiones/git/log-apertura-y-teclado.md
// =============================================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import { FilaArbolArchivo } from './FilaArbolArchivo'
import { VirtualList } from '../../comun/VirtualList'
import {
  aplanarArbolArchivos,
  construirArbolArchivos,
  type FilaArbol
} from './modelo/arbolArchivos'
import { resolveDiffTarget } from './modelo/resolveDiffTarget'
import { prefetchDiff } from './modelo/blobCache'
import type { Commit, FileChange } from '../../../../shared/git-ipc'

/** Id DOM de una fila; la ruta es única dentro del commit, no hace falta prefijo por tipo. */
function idFilaArchivo(ruta: string): string {
  return `git-arch-${ruta}`
}

interface DatosArchivos {
  /** Archivos del commit vigente, o null mientras cargan o si son de otro commit. */
  archivos: FileChange[] | null
  error: string | null
  colapsadas: ReadonlySet<string>
  setColapsadas: Dispatch<SetStateAction<ReadonlySet<string>>>
}

/**
 * Pide los archivos del commit. Se guardan ETIQUETADOS con su hash: el estado del commit
 * anterior sobrevive un render y se elevaría al padre bajo el hash nuevo. Un contador
 * descarta las respuestas viejas al barrer el log con las flechas.
 */
function useDatosArchivos(hash: string, repoHostPath: string | null, anclado: boolean): DatosArchivos {
  const [datos, setDatos] = useState<{ hash: string; lista: FileChange[] } | null>(null)
  const archivos = datos !== null && datos.hash === hash ? datos.lista : null
  const [error, setError] = useState<string | null>(null)
  const [colapsadas, setColapsadas] = useState<ReadonlySet<string>>(() => new Set())
  const peticionRef = useRef(0)
  useEffect(() => {
    // Sin anclaje no se pregunta: un vacío de rechazo se leería como «no cambió archivos».
    if (!anclado) return
    const id = ++peticionRef.current
    setDatos(null)
    setError(null)
    // El colapso se reinicia CON los archivos: son rutas del commit anterior.
    setColapsadas(new Set())
    window.tessera.git
      .filesForCommit(hash, repoHostPath ?? undefined)
      .then((result) => {
        if (peticionRef.current === id) setDatos({ hash, lista: result })
      })
      .catch((err: unknown) => {
        if (peticionRef.current === id) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
  }, [hash, repoHostPath, anclado])
  return { archivos, error, colapsadas, setColapsadas }
}

interface ContextoFila {
  commit: Commit
  rutaSeleccionada: string | null
  cambioPorRuta: ReadonlyMap<string, FileChange>
  alternarCarpeta: (ruta: string) => void
  prefetch: (change: FileChange) => void
  onSeleccionar: (path: string) => void
  onAbrirDiff: (commit: Commit, change: FileChange) => void
}

function pintarFila(fila: FilaArbol, c: ContextoFila): React.JSX.Element {
  if (fila.nodo.tipo === 'carpeta') {
    const ruta = fila.nodo.ruta
    return (
      <FilaArbolArchivo
        fila={fila}
        // Una carpeta también se selecciona: el cursor se posa en ella para plegarla con ←/→.
        seleccionada={ruta === c.rutaSeleccionada}
        onAlternarCarpeta={() => c.alternarCarpeta(ruta)}
        enfocable={false}
        rol="option"
        idFila={idFilaArchivo(ruta)}
      />
    )
  }
  const change = c.cambioPorRuta.get(fila.nodo.ruta)
  if (!change) return <div className="git-arbol-fila" />
  return (
    <FilaArbolArchivo
      fila={fila}
      seleccionada={change.path === c.rutaSeleccionada}
      onSeleccionar={() => c.onSeleccionar(change.path)}
      onAbrir={() => c.onAbrirDiff(c.commit, change)}
      onPrefetch={() => c.prefetch(change)}
      enfocable={false}
      rol="option"
      idFila={idFilaArchivo(change.path)}
    />
  )
}

interface PropsArchivosDelCommit {
  commit: Commit
  /** Repo del commit: viaja con la petición, o una respuesta tardía preguntaría en OTRO repo. */
  repoHostPath: string | null
  /** ¿El backend está anclado a `repoHostPath`? Sin anclaje se leería un vacío de rechazo. */
  anclado: boolean
  /** Alto de fila en px (theme/densidad; el mismo que ve el CSS). */
  altoFila: number
  /** Alto de la LISTA en px: lo reparte el divisor de DetalleCommit. */
  altoArchivos: number
  /** Fila marcada por el cursor: el ÚNICO resaltado de esta lista. */
  rutaSeleccionada: string | null
  onSeleccionar: (path: string) => void
  onAbrirDiff: (commit: Commit, change: FileChange) => void
  /**
   * Las filas ya listas en el orden en que se ven, y la vuelta ruta→FileChange: lo que
   * permite al padre abrir «el primer archivo» y mover el cursor sin duplicar la petición.
   */
  onFilas?: (
    hash: string,
    filas: readonly FilaArbol[],
    cambioPorRuta: ReadonlyMap<string, FileChange>
  ) => void
  /** Fila a dejar a la vista, con token (ver `scrollToken` de VirtualList). */
  revelar?: { indice: number; token: number } | null
  /** Teclado de la lista. Va en el CONTENEDOR: la lista desmonta sus filas. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  /** Asa para que el padre pueda PLEGAR una carpeta con el teclado. */
  alternarRef?: { current: ((ruta: string) => void) | null }
}

/** Árbol aplanado y la vuelta ruta a FileChange (el árbol es puro y no conoce el tipo de git). */
function useFilasArchivos(
  archivos: FileChange[] | null,
  colapsadas: ReadonlySet<string>
): { filas: readonly FilaArbol[]; cambioPorRuta: ReadonlyMap<string, FileChange> } {
  const arbol = useMemo(
    () =>
      construirArbolArchivos(
        (archivos ?? []).map((f) => ({ path: f.path, letra: f.status, oldPath: f.oldPath }))
      ),
    [archivos]
  )
  const filas = useMemo(() => aplanarArbolArchivos(arbol, colapsadas), [arbol, colapsadas])
  const cambioPorRuta = useMemo(() => new Map((archivos ?? []).map((f) => [f.path, f])), [archivos])
  return { filas, cambioPorRuta }
}

/** Pliega o despliega una carpeta y deja esa acción al padre mientras el componente viva. */
function useAlternarCarpeta(
  setColapsadas: DatosArchivos['setColapsadas'],
  alternarRef: PropsArchivosDelCommit['alternarRef']
): (ruta: string) => void {
  const alternarCarpeta = useCallback(
    (ruta: string): void => {
      setColapsadas((prev) => {
        const siguiente = new Set(prev)
        if (!siguiente.delete(ruta)) siguiente.add(ruta)
        return siguiente
      })
    },
    [setColapsadas]
  )
  // El asa se retira al morir para que nadie llame a un setState de un componente desmontado.
  useEffect(() => {
    if (!alternarRef) return
    alternarRef.current = alternarCarpeta
    return () => {
      alternarRef.current = null
    }
  }, [alternarRef, alternarCarpeta])
  return alternarCarpeta
}

function EstadosArchivos(p: { error: string | null; archivos: FileChange[] | null }): React.JSX.Element {
  const { error, archivos } = p
  return (
    <>
      {error && <div className="git-error">No se pudieron leer los archivos: {error}</div>}
      {!error && archivos === null && <div className="git-state-inline">Cargando archivos…</div>}
      {!error && archivos?.length === 0 && (
        <div className="git-state-inline">Este commit no cambió archivos.</div>
      )}
    </>
  )
}

export function ArchivosDelCommit(p: PropsArchivosDelCommit): React.JSX.Element {
  const { commit, onFilas, alternarRef } = p
  const { archivos, error, colapsadas, setColapsadas } = useDatosArchivos(commit.hash, p.repoHostPath, p.anclado)

  const { filas, cambioPorRuta } = useFilasArchivos(archivos, colapsadas)

  // Eleva las filas en cuanto están y en cada replegado. La guarda de `archivos !== null`
  // es obligatoria: en vuelo `filas` vale `[]`, indistinguible de «nada abrible», y el
  // padre consumiría su petición de apertura contra un árbol que aún no existe.
  useEffect(() => {
    if (archivos === null) return
    onFilas?.(commit.hash, filas, cambioPorRuta)
  }, [commit.hash, archivos, filas, cambioPorRuta, onFilas])

  const prefetch = useCallback(
    (change: FileChange): void => {
      const target = resolveDiffTarget(commit.hash, commit.parents[0] ?? null, change)
      prefetchDiff(target.before, target.after)
    },
    [commit.hash, commit.parents]
  )

  const alternarCarpeta = useAlternarCarpeta(setColapsadas, alternarRef)

  const contexto: ContextoFila = {
    commit,
    rutaSeleccionada: p.rutaSeleccionada,
    cambioPorRuta,
    alternarCarpeta,
    prefetch,
    onSeleccionar: p.onSeleccionar,
    onAbrirDiff: p.onAbrirDiff
  }
  return (
    <VirtualList<FilaArbol>
      className="git-detalle-archivos"
      style={{ flex: `0 0 ${p.altoArchivos}px` }}
      ariaLabel="Archivos del commit"
      items={filas}
      itemHeight={p.altoFila}
      getKey={(fila) => `${fila.nodo.tipo === 'carpeta' ? 'd' : 'f'}:${fila.nodo.ruta}`}
      header={<EstadosArchivos error={error} archivos={archivos} />}
      renderItem={(fila) => pintarFila(fila, contexto)}
      scrollToIndex={p.revelar?.indice ?? null}
      scrollToken={p.revelar?.token}
      role="listbox"
      aria-activedescendant={p.rutaSeleccionada === null ? undefined : idFilaArchivo(p.rutaSeleccionada)}
      // Una sola parada de tabulador para toda la lista (las filas están a -1).
      tabIndex={0}
      onKeyDown={p.onKeyDown}
      // `onMouseDown` y no `onClick`: el foco tiene que llegar ANTES que el handler de la fila.
      onMouseDown={(e) => e.currentTarget.focus()}
    />
  )
}
