// =============================================================================
// Los efectos del modal «Buscar en archivos» como hooks del propio modal, más su densidad y
// el teclado de la lista. Se llaman desde `useBusquedaEnArchivos` en el orden en que estaban
// dentro del componente: el orden de los efectos decide cuándo se cancela un barrido y cuándo
// se activa otro proyecto.
// Decisiones: docs/decisiones/busqueda/busqueda-en-archivos.md
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import { altoFila, fontBusqueda, variablesCss } from '../../theme/densidad'
import { esDeUnaListaDeSelect } from '../../comun/useDialogo'
import {
  ESTADO_INICIAL,
  agregarLote,
  iniciarBusqueda,
  mover,
  terminarBusqueda,
  type EstadoBusqueda
} from './filasResultado'
import type { SeleccionCarpeta } from './AmbitoBusqueda'
import type { MemoriaBusqueda } from './memoriaBusqueda'
import type {
  AmbitoBusqueda as Ambito,
  CoincidenciaArchivo,
  ProyectoBuscable
} from '../../../../shared/search-ipc'
import type { OpcionesBusqueda } from '../../../../shared/textSearch'

/** Retardo antes de lanzar el barrido: por debajo se lanzan búsquedas que nadie llega a ver. */
const RETARDO_BUSQUEDA_MS = 250

type SetEstado = Dispatch<SetStateAction<EstadoBusqueda>>

/** Tamaño inicial del modal, acotado a la ventana ACTUAL (entre aperturas pudo achicarse). */
export function tamanoInicial(m: MemoriaBusqueda): { ancho: number; alto: number } {
  return {
    ancho: Math.min(m.ancho, window.innerWidth - 24),
    alto: Math.min(m.alto, window.innerHeight - 24)
  }
}

/**
 * Densidad propia del modal, derivada del ancho de la ventana. Se guarda el tamaño ya
 * derivado y no el ancho: arrastrar el borde produce cientos de anchos y cuatro tamaños.
 */
export function useDensidadBusqueda(): { vars: Record<string, string>; altoDeFila: number } {
  const [fuente, setFuente] = useState(() => fontBusqueda(window.innerWidth))
  useEffect(() => {
    const alRedimensionar = (): void => setFuente(fontBusqueda(window.innerWidth))
    window.addEventListener('resize', alRedimensionar)
    return () => window.removeEventListener('resize', alRedimensionar)
  }, [])
  const vars = useMemo(() => variablesCss(fuente), [fuente])
  return { vars, altoDeFila: altoFila(fuente) }
}

interface SuscripcionArgs {
  idRef: MutableRefObject<number>
  setEstado: SetEstado
  memoria: MemoriaBusqueda
  onRecordar: (m: MemoriaBusqueda) => void
}

/** Cancela el barrido vivo, si lo hay. Lee el id al llamarla: el de ahora, no el del montaje. */
function cancelarBarrido(idRef: MutableRefObject<number>): void {
  if (idRef.current > 0) void window.tessera.search.cancelar(idRef.current)
}

/** Se suscribe a los resultados; al desmontar cancela el barrido y recuerda el estado. */
export function useSuscripcionResultados({
  idRef,
  setEstado,
  memoria,
  onRecordar
}: SuscripcionArgs): void {
  // En refs para que la limpieza no dependa de ellos y no se re-registre al teclear.
  const recordarRef = useRef(memoria)
  recordarRef.current = memoria
  const onRecordarRef = useRef(onRecordar)
  onRecordarRef.current = onRecordar

  useEffect(() => {
    // Antes de lanzar nada: el primer lote puede llegar muy pronto.
    const offLotes = window.tessera.search.onResultados((lote) => {
      setEstado((e) => agregarLote(e, lote))
    })
    const offFin = window.tessera.search.onFin((fin) => {
      setEstado((e) => terminarBusqueda(e, fin))
    })
    return () => {
      offLotes()
      offFin()
      cancelarBarrido(idRef)
      onRecordarRef.current(recordarRef.current)
    }
  }, [idRef, setEstado])
}

/** El ámbito que se manda al main: la carpeta elegida, o todo el proyecto. */
function ambitoDe(modoAmbito: 'proyecto' | 'carpeta', carpeta: SeleccionCarpeta | null): Ambito {
  return modoAmbito === 'carpeta' && carpeta !== null
    ? { tipo: 'carpeta', carpeta: carpeta.carpeta }
    : { tipo: 'proyecto' }
}

/** Lanza el barrido y fija el estado que corresponde a la respuesta. */
function arrancarBarrido(
  peticion: { query: string; opts: OpcionesBusqueda; ambito: Ambito },
  idRef: MutableRefObject<number>,
  setEstado: SetEstado
): void {
  void window.tessera.search
    .iniciar(peticion)
    .then(({ busquedaId, fin }) => {
      idRef.current = busquedaId
      // El estado se reinicia AQUÍ y no al teclear: hasta que la nueva arranca se siguen
      // viendo los resultados anteriores, sin parpadeo a vacío.
      const arrancada = iniciarBusqueda(busquedaId)
      // `fin` llega en la respuesta cuando terminó antes de arrancar (sin proyecto activo).
      setEstado(fin ? terminarBusqueda(arrancada, fin) : arrancada)
    })
    .catch((err) => {
      idRef.current = 0
      setEstado((s) => ({
        ...s,
        buscando: false,
        error: err instanceof Error ? err.message : String(err)
      }))
    })
}

interface LanzarArgs {
  idRef: MutableRefObject<number>
  setEstado: SetEstado
  query: string
  opts: OpcionesBusqueda
  projectKey: string
  modoAmbito: 'proyecto' | 'carpeta'
  carpeta: SeleccionCarpeta | null
  raizActiva: string | null
}

/** Lanza la búsqueda con retardo cada vez que cambia lo que la determina. */
export function useLanzarBusqueda({
  idRef,
  setEstado,
  query,
  opts,
  projectKey,
  modoAmbito,
  carpeta,
  raizActiva
}: LanzarArgs): void {
  useEffect(() => {
    // Con «En una carpeta» a medias no se busca: caer a todo el proyecto enseñaría un
    // resultado que no es el pedido. Sin proyecto activo no se espera: se lanza igual para
    // que el main conteste «No hay proyecto activo».
    const esperandoAmbito =
      raizActiva !== null &&
      modoAmbito === 'carpeta' &&
      (carpeta === null || carpeta.raiz !== raizActiva)
    const limpia = query.trim()
    if (limpia === '' || esperandoAmbito) {
      // Borrar el recuadro tiene que parar el barrido, y ponerlo a 0 después de cancelar.
      cancelarBarrido(idRef)
      idRef.current = 0
      setEstado(ESTADO_INICIAL)
      return
    }
    const ambito = ambitoDe(modoAmbito, carpeta)
    const t = setTimeout(
      () => arrancarBarrido({ query: limpia, opts, ambito }, idRef, setEstado),
      RETARDO_BUSQUEDA_MS
    )
    return () => clearTimeout(t)
    // `projectKey` entra a propósito: cambiar de proyecto relanza contra el nuevo.
    // `raizActiva` destraba la espera cuando el proyecto de la carpeta termina de activarse.
  }, [query, opts, projectKey, modoAmbito, carpeta, raizActiva, idRef, setEstado])
}

interface AmbitoCarpetaArgs {
  carpeta: SeleccionCarpeta | null
  proyectos: ProyectoBuscable[]
  modoAmbito: 'proyecto' | 'carpeta'
  raizActiva: string | null
  onActivarProyecto: (raiz: string) => void
  setCarpeta: (c: SeleccionCarpeta | null) => void
  setModoAmbito: (m: 'proyecto' | 'carpeta') => void
}

/** Suelta la carpeta recordada de un proyecto ya cerrado y activa el de la carpeta elegida. */
export function useAmbitoCarpeta({
  carpeta,
  proyectos,
  modoAmbito,
  raizActiva,
  onActivarProyecto,
  setCarpeta,
  setModoAmbito
}: AmbitoCarpetaArgs): void {
  // Sin esto el ámbito quedaría clavado en algo inalcanzable y el modal no buscaría más.
  useEffect(() => {
    if (carpeta === null) return
    if (proyectos.some((p) => p.raiz === carpeta.raiz)) return
    setCarpeta(null)
    setModoAmbito('proyecto')
  }, [carpeta, proyectos, setCarpeta, setModoAmbito])

  // Elegir una carpeta de otro proyecto lo activa, como pulsar su pestaña.
  useEffect(() => {
    if (modoAmbito !== 'carpeta' || carpeta === null) return
    if (raizActiva === null || carpeta.raiz === raizActiva) return
    onActivarProyecto(carpeta.raiz)
  }, [modoAmbito, carpeta, raizActiva, onActivarProyecto])
}

/** Segundo Ctrl+Shift+F: vuelve al campo y selecciona lo escrito. */
export function useEnfoqueCampo(inputRef: RefObject<HTMLInputElement>, token: number): void {
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [inputRef, token])
}

/**
 * Teclas de la lista, capturadas en todo el modal para que valgan con el foco en el campo
 * de texto, que es donde está mientras se teclea.
 */
export function teclaDeLista(
  e: React.KeyboardEvent,
  ctx: {
    fila: CoincidenciaArchivo | null
    setEstado: SetEstado
    abrir: (c: CoincidenciaArchivo) => void
    alPulsarTecla: (e: React.KeyboardEvent) => void
  }
): void {
  // Con la lista de un select desplegada, sus teclas son de la lista (es del DOM y burbujea).
  if (esDeUnaListaDeSelect(e.target)) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    ctx.setEstado((s) => mover(s, e.key === 'ArrowDown' ? 'abajo' : 'arriba'))
    return
  }
  if (e.key === 'Enter' && ctx.fila !== null) {
    e.preventDefault()
    ctx.abrir(ctx.fila)
    return
  }
  ctx.alPulsarTecla(e)
}
