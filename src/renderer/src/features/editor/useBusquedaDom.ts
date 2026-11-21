// =============================================================================
// Mod+F (Ctrl+F / Cmd+F) en una vista renderizada (HTML de Markdown), donde Monaco
// está oculto y su buscador no existe. Se escucha en `window` y solo lo atiende la vista `activo`
// (no `visible`: un pane dentro de un subárbol oculto armaría el atajo). Los Range mueren cuando
// cambia el HTML, así que se recalcula; `CSS.highlights` es global y se limpia solo si es mío.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { buscarCoincidencias, moverIndice, type OpcionesBusqueda } from '../../../../shared/busquedaTexto'
import { esModPrincipal } from '../../util/atajos'
import {
  aplicarResaltado,
  desplazarHasta,
  leerCorpus,
  limpiarResaltado,
  rangoDeCoincidencia,
  type CorpusDom
} from './busquedaDom'

/** Opciones de la búsqueda en una vista renderizada. */
export interface OpcionesBusquedaDom {
  /** ¿Está esta vista de verdad a la vista y en modo documento? */
  activo: boolean
  /** El HTML pintado: no se usa su valor, es la señal de que hay que rehacer las coincidencias. */
  html: string
}

/** Estado y acciones de la búsqueda en una vista renderizada. */
export interface BusquedaDom {
  abierto: boolean
  resultados: { indice: number; total: number } | null
  /** Sube en cada Mod+F con el buscador ya abierto, para re-enfocar su campo. */
  tokenFoco: number
  /** Búsqueda incremental: recalcula y va a la primera coincidencia. */
  buscar: (consulta: string, opts: OpcionesBusqueda) => void
  /** Navegación explícita: mueve el índice. */
  navegar: (consulta: string, opts: OpcionesBusqueda, dir: 'next' | 'prev') => void
  cerrar: () => void
  /** Ref-callback para el nodo con el TEXTO. */
  refContenido: (el: HTMLElement | null) => void
  /** Ref-callback para el nodo que SCROLLEA (en Markdown, el mismo). */
  refContenedorScroll: (el: HTMLElement | null) => void
}

interface UltimaBusqueda {
  consulta: string
  opts: OpcionesBusqueda
}

/** Mod+F en `window` (el div del HTML no es focusable); ignora el que viene de otro campo de texto. */
function useAtajoBuscar(
  activo: boolean,
  setAbierto: (abierto: boolean) => void,
  setTokenFoco: (fn: (n: number) => number) => void
): void {
  useEffect(() => {
    if (!activo) return
    function alPulsarTecla(e: KeyboardEvent): void {
      if (!esModPrincipal(e) || e.shiftKey || e.altKey) return
      if (e.key !== 'f' && e.key !== 'F') return
      const el = e.target as HTMLElement | null
      // Desde el propio buscador, Mod+F significa "vuelve al campo y selecciona".
      const enBuscador = !!el?.closest?.('.search-box')
      if (!enBuscador && el?.closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      setAbierto(true)
      setTokenFoco((n) => n + 1)
    }
    window.addEventListener('keydown', alPulsarTecla)
    return () => window.removeEventListener('keydown', alPulsarTecla)
  }, [activo, setAbierto, setTokenFoco])
}

/** Rehace la última búsqueda cuando cambia el HTML: los Range de antes apuntan a nodos que ya no existen. */
function useRehacerAlCambiarHtml(
  html: string,
  abierto: boolean,
  activo: boolean,
  ultimaRef: React.MutableRefObject<UltimaBusqueda | null>,
  indiceRef: React.MutableRefObject<number>,
  recalcular: (consulta: string, opts: OpcionesBusqueda, indiceDeseado: number) => void
): void {
  useEffect(() => {
    if (!abierto || !activo) return
    const ultima = ultimaRef.current
    if (!ultima?.consulta) return
    recalcular(ultima.consulta, ultima.opts, indiceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html])
}

/** Los rangos de las coincidencias de `query` en el texto visible del contenedor. */
function rangosDeBusqueda(contenedor: HTMLElement, consulta: string, opts: OpcionesBusqueda): Range[] {
  const corpus: CorpusDom = leerCorpus(contenedor)
  return buscarCoincidencias(corpus.texto, consulta, opts)
    .map((c) => rangoDeCoincidencia(corpus, c))
    .filter((r): r is Range => r !== null)
}

/** Deja la coincidencia a la vista si hay una y hay scroller. */
function verCoincidencia(rango: Range | undefined, contenedorScroll: HTMLElement | null): void {
  if (rango && contenedorScroll) desplazarHasta(rango, contenedorScroll)
}

type Resultados = { indice: number; total: number } | null

interface MotorBusqueda {
  ultimaRef: React.MutableRefObject<UltimaBusqueda | null>
  indiceRef: React.MutableRefObject<number>
  limpiarSiEsMio: () => void
  recalcular: (consulta: string, opts: OpcionesBusqueda, indiceDeseado: number) => void
  buscar: (consulta: string, opts: OpcionesBusqueda) => void
  navegar: (consulta: string, opts: OpcionesBusqueda, dir: 'next' | 'prev') => void
  refContenido: (el: HTMLElement | null) => void
  refContenedorScroll: (el: HTMLElement | null) => void
}

/** Refs, resaltado y navegación de la búsqueda; el estado visible lo pone `setResultados`. */
function useMotorBusqueda(setResultados: (r: Resultados) => void): MotorBusqueda {
  const contenidoRef = useRef<HTMLElement | null>(null)
  const contenedorScrollRef = useRef<HTMLElement | null>(null)
  // Última búsqueda, para rehacerla cuando cambie el HTML sin que el usuario toque nada.
  const ultimaRef = useRef<UltimaBusqueda | null>(null)
  const rangosRef = useRef<Range[]>([])
  const indiceRef = useRef(-1)

  // Los nodos llegan por ref-callback: existen solo condicionalmente (no mientras carga el archivo).
  const refContenido = useCallback((el: HTMLElement | null) => {
    contenidoRef.current = el
  }, [])
  const refContenedorScroll = useCallback((el: HTMLElement | null) => {
    contenedorScrollRef.current = el
  }, [])

  // Borra los resaltados solo si son de esta instancia: con N panes por keep-alive, limpiar
  // sin más borraría los del pane que sí está buscando. Tener rangos es el título de propiedad.
  const limpiarSiEsMio = useCallback(() => {
    if (rangosRef.current.length === 0) return
    rangosRef.current = []
    limpiarResaltado()
  }, [])

  /** Recalcula coincidencias y resaltado. `indiceDeseado` -1 = ir a la primera. */
  const recalcular = useCallback(
    (consulta: string, opts: OpcionesBusqueda, indiceDeseado: number) => {
      const contenedor = contenidoRef.current
      ultimaRef.current = { consulta, opts }

      if (!contenedor || !consulta) {
        indiceRef.current = -1
        limpiarSiEsMio()
        setResultados(consulta ? { indice: -1, total: 0 } : null)
        return
      }

      const rangos = rangosDeBusqueda(contenedor, consulta, opts)
      rangosRef.current = rangos
      const indice = rangos.length === 0 ? -1 : Math.min(Math.max(indiceDeseado, 0), rangos.length - 1)
      indiceRef.current = indice

      aplicarResaltado(rangos, indice)
      setResultados({ indice, total: rangos.length })

      verCoincidencia(rangos[indice], contenedorScrollRef.current)
    },
    [limpiarSiEsMio, setResultados]
  )

  // Incremental: siempre desde la primera, o teclear "abc" acabaría en la 3ª coincidencia.
  const buscar = useCallback(
    (consulta: string, opts: OpcionesBusqueda) => recalcular(consulta, opts, -1),
    [recalcular]
  )

  const navegar = useCallback(
    (consulta: string, opts: OpcionesBusqueda, dir: 'next' | 'prev') => {
      const total = rangosRef.current.length
      // Si la query cambió sin pasar por el efecto incremental, se recalcula primero.
      const ultima = ultimaRef.current
      if (!ultima || ultima.consulta !== consulta || total === 0) {
        recalcular(consulta, opts, -1)
        return
      }
      const indice = moverIndice(total, indiceRef.current, dir)
      indiceRef.current = indice
      aplicarResaltado(rangosRef.current, indice)
      setResultados({ indice, total })
      verCoincidencia(rangosRef.current[indice], contenedorScrollRef.current)
    },
    [recalcular, setResultados]
  )

  return { ultimaRef, indiceRef, limpiarSiEsMio, recalcular, buscar, navegar, refContenido, refContenedorScroll }
}

/** Ctrl+F sobre una vista renderizada: resalta, cuenta y navega coincidencias sin tocar el DOM. */
export function useBusquedaDom({ activo, html }: OpcionesBusquedaDom): BusquedaDom {
  const [abierto, setAbierto] = useState(false)
  const [resultados, setResultados] = useState<{ indice: number; total: number } | null>(null)
  const [tokenFoco, setTokenFoco] = useState(0)

  const motor = useMotorBusqueda(setResultados)
  const { ultimaRef, indiceRef, limpiarSiEsMio, recalcular } = motor

  const cerrar = useCallback(() => {
    setAbierto(false)
    setResultados(null)
    indiceRef.current = -1
    ultimaRef.current = null
    limpiarSiEsMio()
  }, [indiceRef, ultimaRef, limpiarSiEsMio])

  useAtajoBuscar(activo, setAbierto, setTokenFoco)

  // Dejar de estar activo (otra pestaña, agente maximizado, fuera de la vista) cierra y limpia.
  useEffect(() => {
    if (activo) return
    setAbierto(false)
    setResultados(null)
    indiceRef.current = -1
    limpiarSiEsMio()
  }, [activo, indiceRef, limpiarSiEsMio])

  useRehacerAlCambiarHtml(html, abierto, activo, ultimaRef, indiceRef, recalcular)

  // Al desmontar: desmontar un pane que no pintó nada no toca el registro.
  useEffect(() => () => limpiarSiEsMio(), [limpiarSiEsMio])

  return {
    abierto,
    resultados,
    tokenFoco,
    buscar: motor.buscar,
    navegar: motor.navegar,
    cerrar,
    refContenido: motor.refContenido,
    refContenedorScroll: motor.refContenedorScroll
  }
}
