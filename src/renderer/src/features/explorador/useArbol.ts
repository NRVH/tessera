// =============================================================================
// Estado y efectos de `ArbolArchivos`: el árbol aplanado, la selección, los diálogos, el
// menú, el arrastre y la expansión. `useArbol` llama a los hooks parciales en el orden
// en que se declaraban los efectos del componente y devuelve el `Arbol` que consumen
// las funciones de operaciones. Todo es estado del MISMO componente, que es de UN proyecto:
// hay un `ArbolArchivos` por proyecto y ninguna pieza se comparte con el de otro.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { EntradaArchivo } from '../../../../shared/archivos-ipc'
import { esDescendiente } from '../../../../shared/jarPath'
import { aplanarArbol, type FilaAplanada } from './aplanarArbol'
import { obtenerPortapapelesInterno, suscribirPortapapelesInterno } from './portapapelesArchivos'
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
  DialogoArchivo,
  PropsArbolArchivos
} from './tiposArbol'

type Poner<T> = React.Dispatch<React.SetStateAction<T>>

/** Menú, portapapeles observado, diálogo y carpetas abiertas (con su aviso al padre). */
function useEstadoBase(props: PropsArbolArchivos) {
  const { rutaHostProyecto, expandidasIniciales, onCambioExpandidas } = props
  const [menu, setMenu] = useState<EstadoMenu | null>(null)
  // Se observa el portapapeles interno solo para atenuar la fila cortada.
  const portapapeles = useSyncExternalStore(suscribirPortapapelesInterno, obtenerPortapapelesInterno)
  const rutasCortadas = useMemo<ReadonlySet<string>>(
    () =>
      portapapeles?.op === 'cortar' && portapapeles.rutaHostProyecto === rutaHostProyecto
        ? new Set(portapapeles.rutas)
        : new Set(),
    [portapapeles, rutaHostProyecto]
  )
  const [dialogo, setDialogo] = useState<DialogoArchivo>(null)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  // Un árbol que deja de verse cierra su menú y su diálogo: ocultos seguirían en la pila de
  // diálogos, y Esc o el foco irían a ellos y no a lo que se ve.
  if (!props.activo && (menu !== null || dialogo !== null)) {
    setMenu(null)
    setDialogo(null)
  }
  // Arranca con las carpetas que estaban abiertas la última vez en este proyecto.
  const [expandidas, setExpandidas] = useState<Set<string>>(() => new Set(expandidasIniciales ?? []))
  useEffect(() => {
    onCambioExpandidas(rutaHostProyecto, expandidas)
  }, [expandidas, rutaHostProyecto, onCambioExpandidas])
  return { menu, setMenu, rutasCortadas, dialogo, setDialogo, errorDialogo, setErrorDialogo, expandidas, setExpandidas }
}

/** Borra el arrastre interno ante cualquier fin de arrastre de la ventana (red de seguridad). */
function useLimpiarArrastreGlobal(setArrastrados: Poner<string[]>): void {
  useEffect(() => {
    const limpiar = (): void => setArrastrados([])
    // `relatedTarget` null = el cursor abandonó la ventana, no cambió de elemento.
    const alSalir = (e: DragEvent): void => {
      if (e.relatedTarget === null) limpiar()
    }
    window.addEventListener('dragend', limpiar)
    window.addEventListener('drop', limpiar)
    window.addEventListener('dragleave', alSalir)
    window.addEventListener('blur', limpiar)
    return () => {
      window.removeEventListener('dragend', limpiar)
      window.removeEventListener('drop', limpiar)
      window.removeEventListener('dragleave', alSalir)
      window.removeEventListener('blur', limpiar)
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
 * árbol recién montado perseguiría la ruta del proyecto anterior. Un árbol oculto da por
 * atendidas las que llegan sin revelarlas: son del proyecto que se ve, no del suyo.
 */
function useRevelarDesdeFuera(
  revelarRuta: PropsArbolArchivos['revelarRuta'],
  activo: boolean,
  setRutaPorRevelar: Poner<string | null>
): void {
  const revelarToken = revelarRuta?.token
  const revelarObjetivo = revelarRuta?.ruta
  const ultimoRevelado = useRef(revelarToken)
  useEffect(() => {
    if (revelarToken === undefined) return
    if (revelarObjetivo === undefined || revelarObjetivo.length === 0) return
    if (ultimoRevelado.current === revelarToken) return
    ultimoRevelado.current = revelarToken
    if (activo) setRutaPorRevelar(revelarObjetivo)
  }, [revelarToken, revelarObjetivo, activo, setRutaPorRevelar])
}

/** Selección, carpeta actual, refs de interacción, arrastre y avisos efímeros. */
function useEstadoInteraccion(revelarRuta: PropsArbolArchivos['revelarRuta'], activo: boolean) {
  // La selección vive aquí y no en el DOM: las filas se desmontan al scrollear.
  const [dirSeleccionado, setDirSeleccionado] = useState('')
  const [seleccion, setSeleccion] = useState<EstadoSeleccion>(SELECCION_VACIA)
  const clicPendienteRef = useRef<string | null>(null)
  const arbolRef = useRef<HTMLDivElement | null>(null)
  const menuGenRef = useRef(0)
  const [arrastrados, setArrastrados] = useState<string[]>([])
  useLimpiarArrastreGlobal(setArrastrados)
  const [opError, setOpError] = useState<string | null>(null)
  const [conflictoImportacion, setConflictoImportacion] = useState<ConflictoImportacion | null>(null)
  // Su diálogo de conflictos, igual que el menú y los demás diálogos (`useEstadoBase`).
  if (!activo && conflictoImportacion !== null) setConflictoImportacion(null)
  useAutoLimpiar(opError, setOpError, 4000)
  // Ruta a revelar tras crear o mover: se limpia sola a los 2 s para no re-expandir.
  const [rutaPorRevelar, setRutaPorRevelar] = useState<string | null>(null)
  useAutoLimpiar(rutaPorRevelar, setRutaPorRevelar, 2000)
  useRevelarDesdeFuera(revelarRuta, activo, setRutaPorRevelar)
  return {
    dirSeleccionado, setDirSeleccionado, seleccion, setSeleccion, clicPendienteRef, arbolRef, menuGenRef,
    arrastrados, setArrastrados, opError, setOpError, conflictoImportacion, setConflictoImportacion,
    rutaPorRevelar, setRutaPorRevelar
  }
}

/**
 * Raíz del proyecto `raiz`: se carga al montar y se recarga ante cada cambio del watcher o del CRUD.
 * Oculto (`activo` false) no escucha: los avisos son del proyecto anclado, y lo que cambie en el
 * suyo mientras tanto no le llega. Por eso se recarga SIEMPRE al volver a verse.
 */
function useRaizArbol(raiz: string, activo: boolean) {
  const [entradasRaiz, setEntradasRaiz] = useState<EntradaArchivo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tokenRefresco, setTokenRefresco] = useState(0)
  const [activoAntes, setActivoAntes] = useState(activo)
  const forzarRefresco = (): void => setTokenRefresco((t) => t + 1)
  useEffect(() => {
    if (!activo) return
    return window.tessera.files.alCambiar(() => setTokenRefresco((t) => t + 1))
  }, [activo])
  // Ajuste en el render, sin efecto: el árbol que vuelve a verse ya pide su refresco en este commit.
  if (activo !== activoAntes) {
    setActivoAntes(activo)
    if (activo) setTokenRefresco((t) => t + 1)
  }
  useEffect(() => {
    let cancelado = false
    window.tessera.files
      .listarDirectorio({ raiz, ruta: '' })
      .then((entradas) => {
        if (cancelado) return
        setEntradasRaiz(entradas)
        // Un fallo anterior no se queda pintado sobre un listado que ya llegó.
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelado = true
    }
  }, [raiz, tokenRefresco])
  return { entradasRaiz, error, tokenRefresco, forzarRefresco }
}

/** Filas aplanadas, sus índices por clave y las dos caras de una selección. */
function useFilasArbol(
  entradasRaiz: EntradaArchivo[] | null,
  cad: EstadoCadenas,
  expandidas: Set<string>
) {
  const { cadenas, erroresCadena } = cad
  const filas = useMemo<FilaAplanada[]>(
    () =>
      entradasRaiz ? aplanarArbol({ raices: entradasRaiz, cadenas, expandidas, errores: erroresCadena }) : [],
    [entradasRaiz, cadenas, expandidas, erroresCadena]
  )
  // Los índices de un rango van sobre la lista aplanada, no sobre el DOM.
  const clavesNodo = useMemo(
    () => filas.flatMap((r) => (r.tipo === 'node' ? [r.clave] : [])),
    [filas]
  )
  const filaPorClave = useMemo(() => {
    const m = new Map<string, FilaNodo>()
    for (const r of filas) if (r.tipo === 'node') m.set(r.clave, r)
    return m
  }, [filas])
  const rutasArrastre = useCallback(
    (claves: Iterable<string>): string[] => rutasMovibles(claves, filaPorClave, 'arrastre'),
    [filaPorClave]
  )
  const rutasHoja = useCallback(
    (claves: Iterable<string>): string[] => rutasMovibles(claves, filaPorClave, 'hoja'),
    [filaPorClave]
  )
  return { filas, clavesNodo, filaPorClave, rutasArrastre, rutasHoja }
}

/**
 * Poda de la selección: quita las claves que ya no existen y conserva el resto. No corre
 * hasta que llega la raíz: podar contra unas filas vacías borraría una selección válida.
 */
function usePodaSeleccion(
  entradasRaiz: EntradaArchivo[] | null,
  clavesNodo: string[],
  setSeleccion: Poner<EstadoSeleccion>
): void {
  useEffect(() => {
    if (entradasRaiz === null) return
    setSeleccion((prev) => podarSeleccion(prev, new Set(clavesNodo)))
  }, [clavesNodo, entradasRaiz, setSeleccion])
}

/**
 * Alterna carpetas y expande los ancestros de la ruta a revelar. Colapsar arrastra a los
 * descendientes; `esDescendiente` y no `startsWith(x + '/')` porque la frontera de un
 * contenedor es `!/`. Colapsar no toca la selección: la poda quita lo que deja de verse.
 */
function useExpansion(
  filas: FilaAplanada[],
  setExpandidas: Poner<Set<string>>,
  rutaPorRevelar: string | null
) {
  function alternarExpandido(rutaHoja: string): void {
    setExpandidas((prev) => {
      if (!prev.has(rutaHoja)) return new Set(prev).add(rutaHoja)
      const siguiente = new Set<string>()
      for (const p of prev) {
        if (p === rutaHoja || esDescendiente(rutaHoja, p)) continue
        siguiente.add(p)
      }
      return siguiente
    })
  }
  // Cascada asíncrona: al cargar una cadena aparece la de dentro. Idempotente.
  useEffect(() => {
    if (!rutaPorRevelar) return
    setExpandidas((prev) => {
      let hayCambio = false
      const siguiente = new Set(prev)
      for (const fila of filas) {
        if (fila.tipo !== 'node' || !fila.esDir) continue
        const esAncestro = rutaPorRevelar === fila.hoja.ruta || esDescendiente(fila.hoja.ruta, rutaPorRevelar)
        if (esAncestro && !siguiente.has(fila.hoja.ruta)) {
          siguiente.add(fila.hoja.ruta)
          hayCambio = true
        }
      }
      return hayCambio ? siguiente : prev
    })
  }, [rutaPorRevelar, filas, setExpandidas])
  // Fila objetivo del revelado, o null mientras sus ancestros siguen expandiéndose.
  const indicePorRevelar = useMemo<number | null>(() => {
    if (!rutaPorRevelar) return null
    const i = filas.findIndex(
      (r) =>
        r.tipo === 'node' &&
        (r.hoja.ruta === rutaPorRevelar ||
          r.entrada.ruta === rutaPorRevelar ||
          r.segmentos.some((s) => s.ruta === rutaPorRevelar))
    )
    return i >= 0 ? i : null
  }, [rutaPorRevelar, filas])
  return { alternarExpandido, indicePorRevelar }
}

/**
 * Arrastre nativo de varios archivos y fantasma. `arrastrarFuera` vive en el árbol por su
 * `finally`: `startDrag` resuelve cuando el gesto del sistema termina, sea como sea, y es la
 * única señal exacta para apagar `arrastrados` (Esc dentro de la ventana no dispara nada más).
 */
function useArrastreArbol(
  raiz: string,
  filas: FilaAplanada[],
  seleccion: EstadoSeleccion,
  inter: { setOpError: Poner<string | null>; setArrastrados: Poner<string[]> }
) {
  const { setOpError, setArrastrados } = inter
  const arrastrarFuera = useCallback(
    (rutas: readonly string[], icono: string): void => {
      void (async () => {
        try {
          await window.tessera.files.iniciarArrastre({ raiz, rutas: [...rutas], icono })
        } catch (err) {
          setOpError(err instanceof Error ? err.message : String(err))
        } finally {
          setArrastrados([])
        }
      })()
    },
    [raiz, setOpError, setArrastrados]
  )
  // Lo que el usuario ve seleccionado, en el orden del árbol; no las rutas minimizadas.
  const fantasma = useMemo(() => {
    if (seleccion.claves.size < 2) return { lineas: [] as ElementoFantasma[], resto: 0 }
    const elementos: ElementoFantasma[] = []
    for (const r of filas) {
      if (r.tipo !== 'node' || !seleccion.claves.has(r.clave)) continue
      elementos.push({ nombre: r.hoja.nombre, esDir: r.esDir })
    }
    return lineasFantasma(elementos)
  }, [filas, seleccion])
  return { arrastrarFuera, fantasma }
}

/** Todo el estado de `ArbolArchivos`; los efectos se registran en el orden histórico del componente. */
export function useArbol(props: PropsArbolArchivos): Arbol {
  const base = useEstadoBase(props)
  const cad = useEstadoCadenas(props.rutaHostProyecto)
  const inter = useEstadoInteraccion(props.revelarRuta, props.activo)
  const raiz = useRaizArbol(props.rutaHostProyecto, props.activo)
  const filas = useFilasArbol(raiz.entradasRaiz, cad, base.expandidas)
  usePodaSeleccion(raiz.entradasRaiz, filas.clavesNodo, inter.setSeleccion)
  useCargaPerezosa(cad, filas.filas)
  useRefrescoCadenas(cad, filas.filas, raiz.tokenRefresco)
  const expansion = useExpansion(filas.filas, base.setExpandidas, inter.rutaPorRevelar)
  const arrastre = useArrastreArbol(props.rutaHostProyecto, filas.filas, inter.seleccion, inter)
  return { props, ...base, ...inter, ...raiz, ...filas, ...expansion, ...arrastre }
}
