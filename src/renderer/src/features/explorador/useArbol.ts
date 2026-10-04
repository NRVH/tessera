// =============================================================================
// Estado y efectos de `FileTree`: el árbol aplanado, la selección, los diálogos, el
// menú, el arrastre y la expansión. `useArbol` llama a los hooks parciales en el orden
// en que se declaraban los efectos del componente y devuelve el `Arbol` que consumen
// las funciones de operaciones. Todo es estado del MISMO componente: `FileTree` se
// remonta con `key={projectHostPath}` y ninguna pieza puede sobrevivir a eso por su cuenta.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FileEntry } from '../../../../shared/files-ipc'
import { esDescendiente } from '../../../../shared/jarPath'
import { flattenTree, type FlatRow } from './treeFlatten'
import { getPortapapelesInterno, subscribePortapapelesInterno } from './fileClipboard'
import {
  SELECCION_VACIA,
  lineasFantasma,
  podarSeleccion,
  rutasMovibles,
  type ElementoFantasma,
  type EstadoSeleccion,
  type FilaNodo
} from './seleccionArbol'
import {
  useCargaPerezosa,
  useEstadoCadenas,
  useRefrescoCadenas,
  type EstadoCadenas
} from './useCadenasArbol'
import type {
  Arbol,
  ConflictoImportacion,
  EstadoMenu,
  FileDialog,
  PropsFileTree
} from './tiposArbol'

type Poner<T> = React.Dispatch<React.SetStateAction<T>>

/** Menú, portapapeles observado, diálogo y carpetas abiertas (con su aviso al padre). */
function useEstadoBase(props: PropsFileTree) {
  const { projectHostPath, initialExpanded, onExpandedChange } = props
  const [menu, setMenu] = useState<EstadoMenu | null>(null)
  // Se observa el portapapeles interno solo para atenuar la fila cortada.
  const portapapeles = useSyncExternalStore(subscribePortapapelesInterno, getPortapapelesInterno)
  const cutPaths = useMemo<ReadonlySet<string>>(
    () =>
      portapapeles?.op === 'cortar' && portapapeles.projectHostPath === projectHostPath
        ? new Set(portapapeles.paths)
        : new Set(),
    [portapapeles, projectHostPath]
  )
  const [dialog, setDialog] = useState<FileDialog>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  // Arranca con las carpetas que estaban abiertas la última vez en este proyecto.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded ?? []))
  useEffect(() => {
    onExpandedChange(projectHostPath, expanded)
  }, [expanded, projectHostPath, onExpandedChange])
  return { menu, setMenu, cutPaths, dialog, setDialog, dialogError, setDialogError, expanded, setExpanded }
}

/** Borra el arrastre interno ante cualquier fin de arrastre de la ventana (red de seguridad). */
function useLimpiarArrastreGlobal(setArrastrados: Poner<string[]>): void {
  useEffect(() => {
    const clear = (): void => setArrastrados([])
    // `relatedTarget` null = el cursor abandonó la ventana, no cambió de elemento.
    const alSalir = (e: DragEvent): void => {
      if (e.relatedTarget === null) clear()
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    window.addEventListener('dragleave', alSalir)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
      window.removeEventListener('dragleave', alSalir)
      window.removeEventListener('blur', clear)
    }
  }, [setArrastrados])
}

/** Pone a null un valor efímero pasados `ms` desde que aparece. */
function useAutoLimpiar(valor: string | null, limpiar: Poner<string | null>, ms: number): void {
  useEffect(() => {
    if (!valor) return
    const t = setTimeout(() => limpiar(null), ms)
    return () => clearTimeout(t)
  }, [valor, limpiar, ms])
}

/**
 * Revelado pedido desde fuera del árbol. El último token atendido se siembra con el que
 * haya al montar: la petición vive en un store que nadie limpia y, sin la semilla, un
 * árbol remontado perseguiría la ruta del proyecto anterior.
 */
function useRevelarDesdeFuera(
  revelarRuta: PropsFileTree['revelarRuta'],
  setRevealPath: Poner<string | null>
): void {
  const revelarToken = revelarRuta?.token
  const revelarObjetivo = revelarRuta?.path
  const ultimoRevelado = useRef(revelarToken)
  useEffect(() => {
    if (revelarToken === undefined) return
    if (revelarObjetivo === undefined || revelarObjetivo.length === 0) return
    if (ultimoRevelado.current === revelarToken) return
    ultimoRevelado.current = revelarToken
    setRevealPath(revelarObjetivo)
  }, [revelarToken, revelarObjetivo, setRevealPath])
}

/** Selección, carpeta actual, refs de interacción, arrastre y avisos efímeros. */
function useEstadoInteraccion(revelarRuta: PropsFileTree['revelarRuta']) {
  // La selección vive aquí y no en el DOM: las filas se desmontan al scrollear.
  const [selectedDir, setSelectedDir] = useState('')
  const [seleccion, setSeleccion] = useState<EstadoSeleccion>(SELECCION_VACIA)
  const clicPendienteRef = useRef<string | null>(null)
  const treeRef = useRef<HTMLDivElement | null>(null)
  const menuGenRef = useRef(0)
  const [arrastrados, setArrastrados] = useState<string[]>([])
  useLimpiarArrastreGlobal(setArrastrados)
  const [opError, setOpError] = useState<string | null>(null)
  const [importConflict, setImportConflict] = useState<ConflictoImportacion | null>(null)
  useAutoLimpiar(opError, setOpError, 4000)
  // Ruta a revelar tras crear o mover: se limpia sola a los 2 s para no re-expandir.
  const [revealPath, setRevealPath] = useState<string | null>(null)
  useAutoLimpiar(revealPath, setRevealPath, 2000)
  useRevelarDesdeFuera(revelarRuta, setRevealPath)
  return {
    selectedDir, setSelectedDir, seleccion, setSeleccion, clicPendienteRef, treeRef, menuGenRef,
    arrastrados, setArrastrados, opError, setOpError, importConflict, setImportConflict,
    revealPath, setRevealPath
  }
}

/** Raíz del proyecto: se carga al montar y se recarga ante cada cambio del watcher o del CRUD. */
function useRaizArbol() {
  const [rootEntries, setRootEntries] = useState<FileEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const bumpRefresh = (): void => setRefreshToken((t) => t + 1)
  useEffect(() => window.tessera.files.onChanged(() => setRefreshToken((t) => t + 1)), [])
  useEffect(() => {
    let cancelled = false
    window.tessera.files
      .listDir('')
      .then((entries) => {
        if (!cancelled) setRootEntries(entries)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [refreshToken])
  return { rootEntries, error, refreshToken, bumpRefresh }
}

/** Filas aplanadas, sus índices por clave y las dos caras de una selección. */
function useFilasArbol(
  rootEntries: FileEntry[] | null,
  cad: EstadoCadenas,
  expanded: Set<string>
) {
  const { chains, chainErrors } = cad
  const rows = useMemo<FlatRow[]>(
    () =>
      rootEntries ? flattenTree({ roots: rootEntries, chains, expanded, errors: chainErrors }) : [],
    [rootEntries, chains, expanded, chainErrors]
  )
  // Los índices de un rango van sobre la lista aplanada, no sobre el DOM.
  const clavesNodo = useMemo(
    () => rows.flatMap((r) => (r.kind === 'node' ? [r.key] : [])),
    [rows]
  )
  const filaPorClave = useMemo(() => {
    const m = new Map<string, FilaNodo>()
    for (const r of rows) if (r.kind === 'node') m.set(r.key, r)
    return m
  }, [rows])
  const rutasArrastre = useCallback(
    (claves: Iterable<string>): string[] => rutasMovibles(claves, filaPorClave, 'arrastre'),
    [filaPorClave]
  )
  const rutasHoja = useCallback(
    (claves: Iterable<string>): string[] => rutasMovibles(claves, filaPorClave, 'hoja'),
    [filaPorClave]
  )
  return { rows, clavesNodo, filaPorClave, rutasArrastre, rutasHoja }
}

/**
 * Poda de la selección: quita las claves que ya no existen y conserva el resto. No corre
 * hasta que llega la raíz: podar contra unas filas vacías borraría una selección válida.
 */
function usePodaSeleccion(
  rootEntries: FileEntry[] | null,
  clavesNodo: string[],
  setSeleccion: Poner<EstadoSeleccion>
): void {
  useEffect(() => {
    if (rootEntries === null) return
    setSeleccion((prev) => podarSeleccion(prev, new Set(clavesNodo)))
  }, [clavesNodo, rootEntries, setSeleccion])
}

/**
 * Alterna carpetas y expande los ancestros de la ruta a revelar. Colapsar arrastra a los
 * descendientes; `esDescendiente` y no `startsWith(x + '/')` porque la frontera de un
 * contenedor es `!/`. Colapsar no toca la selección: la poda quita lo que deja de verse.
 */
function useExpansion(
  rows: FlatRow[],
  setExpanded: Poner<Set<string>>,
  revealPath: string | null
) {
  function toggleExpand(leafPath: string): void {
    setExpanded((prev) => {
      if (!prev.has(leafPath)) return new Set(prev).add(leafPath)
      const next = new Set<string>()
      for (const p of prev) {
        if (p === leafPath || esDescendiente(leafPath, p)) continue
        next.add(p)
      }
      return next
    })
  }
  // Cascada asíncrona: al cargar una cadena aparece la de dentro. Idempotente.
  useEffect(() => {
    if (!revealPath) return
    setExpanded((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const row of rows) {
        if (row.kind !== 'node' || !row.isDir) continue
        const isAncestor = revealPath === row.leaf.path || esDescendiente(row.leaf.path, revealPath)
        if (isAncestor && !next.has(row.leaf.path)) {
          next.add(row.leaf.path)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [revealPath, rows, setExpanded])
  // Fila objetivo del revelado, o null mientras sus ancestros siguen expandiéndose.
  const revealIndex = useMemo<number | null>(() => {
    if (!revealPath) return null
    const i = rows.findIndex(
      (r) =>
        r.kind === 'node' &&
        (r.leaf.path === revealPath ||
          r.entry.path === revealPath ||
          r.segments.some((s) => s.path === revealPath))
    )
    return i >= 0 ? i : null
  }, [revealPath, rows])
  return { toggleExpand, revealIndex }
}

/**
 * Arrastre nativo de varios archivos y fantasma. `arrastrarFuera` vive en el árbol por su
 * `finally`: `startDrag` resuelve cuando el gesto del sistema termina, sea como sea, y es la
 * única señal exacta para apagar `arrastrados` (Esc dentro de la ventana no dispara nada más).
 */
function useArrastreArbol(
  rows: FlatRow[],
  seleccion: EstadoSeleccion,
  setOpError: Poner<string | null>,
  setArrastrados: Poner<string[]>
) {
  const arrastrarFuera = useCallback(
    (rutas: readonly string[], icono: string): void => {
      void (async () => {
        try {
          await window.tessera.files.startDrag([...rutas], icono)
        } catch (err) {
          setOpError(err instanceof Error ? err.message : String(err))
        } finally {
          setArrastrados([])
        }
      })()
    },
    [setOpError, setArrastrados]
  )
  // Lo que el usuario ve seleccionado, en el orden del árbol; no las rutas minimizadas.
  const fantasma = useMemo(() => {
    if (seleccion.claves.size < 2) return { lineas: [] as ElementoFantasma[], resto: 0 }
    const elementos: ElementoFantasma[] = []
    for (const r of rows) {
      if (r.kind !== 'node' || !seleccion.claves.has(r.key)) continue
      elementos.push({ nombre: r.leaf.name, isDir: r.isDir })
    }
    return lineasFantasma(elementos)
  }, [rows, seleccion])
  return { arrastrarFuera, fantasma }
}

/** Todo el estado de `FileTree`; los efectos se registran en el orden histórico del componente. */
export function useArbol(props: PropsFileTree): Arbol {
  const base = useEstadoBase(props)
  const cad = useEstadoCadenas()
  const inter = useEstadoInteraccion(props.revelarRuta)
  const raiz = useRaizArbol()
  const filas = useFilasArbol(raiz.rootEntries, cad, base.expanded)
  usePodaSeleccion(raiz.rootEntries, filas.clavesNodo, inter.setSeleccion)
  useCargaPerezosa(cad, filas.rows)
  useRefrescoCadenas(cad, filas.rows, raiz.refreshToken)
  const expansion = useExpansion(filas.rows, base.setExpanded, inter.revealPath)
  const arrastre = useArrastreArbol(filas.rows, inter.seleccion, inter.setOpError, inter.setArrastrados)
  return { props, ...base, ...inter, ...raiz, ...filas, ...expansion, ...arrastre }
}
