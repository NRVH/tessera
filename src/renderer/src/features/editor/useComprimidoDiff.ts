// =============================================================================
// Estado y efectos de ComprimidoDiffPane, en hooks del mismo pane: comparación del contenedor,
// contenido de la entrada elegida, árbol de entradas y alto de la lista.
// Solo compara el pane del proyecto activo, y solo pide contenido con el pane visible.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { aplanarArbolArchivos, asegurarEstilosGit, construirArbolArchivos } from '../git'
import { MAX_ANIDAMIENTO } from '../../../../shared/jarPath'
import { iniciarComparacion, pedirContenidoEntrada } from './comprimidoDiffCarga'
import {
  ALTO_CROMO_LISTA,
  MAX_LISTA_AUTO,
  MIN_LISTA,
  aLado,
  calcularAviso,
  enMemoriaDe,
  ladosMutables
} from './comprimidoDiffModelo'
import type { DiffTarget } from './diffEditorTipos'
import type {
  CompararResult,
  EntradaComparada,
  EntradaResult
} from '../../../../shared/comprimidos-ipc'

interface EntradaComparacion {
  target: DiffTarget
  targetKey: string
  activeTargetKey: string
  fsTick: number
}

/** Compara el contenedor y guarda la cadena de niveles anidados, la comparación y la entrada elegida. */
function useComparacionComprimido({ target, targetKey, activeTargetKey, fsTick }: EntradaComparacion) {
  /** Cadena de contenedores anidados en la que estamos. [] = el de primer nivel. */
  const [dentro, setDentro] = useState<string[]>([])
  const [comparacion, setComparacion] = useState<CompararResult | null>(null)
  const [cargando, setCargando] = useState(true)
  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  // En ref para que el efecto de comparar la consulte sin que volver a compararse sea una dep.
  const seleccionadaRef = useRef(seleccionada)
  seleccionadaRef.current = seleccionada
  const nivelMostradoRef = useRef<string | null>(null)
  const peticionRef = useRef(0)

  const lados = useMemo(
    () => ({ antes: aLado(target, 'before'), despues: aLado(target, 'after') }),
    [target]
  )
  // Un diff entre dos commits son objetos inmutables: repedirlo por cada tick sería tirar trabajo.
  const tickEfectivo = ladosMutables(lados.antes, lados.despues) ? fsTick : 0

  useEffect(() => {
    // Solo compara el pane del proyecto activo; al volver a serlo, este efecto se re-ejecuta.
    if (targetKey !== activeTargetKey) return
    return iniciarComparacion({
      lados, dentro, peticionRef, nivelMostradoRef, seleccionadaRef,
      setCargando, setComparacion, setSeleccionada
    })
  }, [lados, dentro, tickEfectivo, targetKey, activeTargetKey])

  // Al cambiar de contenedor la lista de antes ya no vale: sería enseñar otra cosa que lo pedido.
  useEffect(() => {
    setComparacion(null)
  }, [dentro])

  const porNombre = useMemo(() => {
    const mapa = new Map<string, EntradaComparada>()
    for (const e of comparacion?.entradas ?? []) mapa.set(e.nombre, e)
    return mapa
  }, [comparacion])

  const elegir = useCallback(
    (nombre: string) => {
      if (porNombre.get(nombre)?.contenedor === true) {
        // Entrar, no abrir un diff. El tope de anidamiento lo impone el servicio; aquí se respeta.
        setDentro((prev) => (prev.length >= MAX_ANIDAMIENTO ? prev : [...prev, nombre]))
        setSeleccionada(null)
        return
      }
      setSeleccionada(nombre)
    },
    [porNombre]
  )

  return { dentro, setDentro, comparacion, cargando, seleccionada, lados, porNombre, elegir }
}

interface EntradaContenidoHook {
  seleccionada: string | null
  comparacion: CompararResult | null
  lados: ReturnType<typeof useComparacionComprimido>['lados']
  dentro: string[]
  paneKey: string
  visible: boolean
}

/** Pide el contenido de la entrada elegida, con antirrebote y solo con el pane visible. */
function useContenidoEntrada(e: EntradaContenidoHook) {
  const { seleccionada, comparacion, lados, dentro, paneKey, visible } = e
  const [contenido, setContenido] = useState<EntradaResult | null>(null)
  const [pidiendo, setPidiendo] = useState(false)
  const tokenRef = useRef(0)
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelarPeticion = useCallback(() => {
    if (temporizadorRef.current !== null) {
      clearTimeout(temporizadorRef.current)
      temporizadorRef.current = null
    }
  }, [])

  useEffect(() => {
    cancelarPeticion()
    // `pidiendo` se apaga en TODAS las salidas: si no, un retorno temprano lo dejaría encendido
    // sin nada en vuelo y «Leyendo la entrada…» no terminaría.
    setPidiendo(false)
    if (seleccionada === null || !visible) return
    const fila = comparacion?.entradas.find((x) => x.nombre === seleccionada)
    if (fila === undefined || fila.contenedor) return
    return pedirContenidoEntrada({
      lados, dentro, nombre: seleccionada, paneKey, temporizadorRef, tokenRef,
      setContenido, setPidiendo, cancelar: cancelarPeticion
    })
  }, [seleccionada, comparacion, lados, dentro, paneKey, visible, cancelarPeticion])

  useEffect(() => {
    setContenido(null)
  }, [dentro])

  return { contenido, pidiendo }
}

/** Árbol de entradas cambiadas, aplanado según las carpetas plegadas. */
function useArbolEntradas(comparacion: CompararResult | null, dentro: string[]) {
  const [colapsadas, setColapsadas] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    setColapsadas(new Set())
  }, [dentro])

  const filas = useMemo(() => {
    const entradas = comparacion?.entradas ?? []
    // Compacta las carpetas de un solo hijo: `com/acme/paquete` sale en una fila y no en tres.
    const arbol = construirArbolArchivos(entradas.map((e) => ({ path: e.nombre, letra: e.estado })))
    return aplanarArbolArchivos(arbol, colapsadas)
  }, [comparacion, colapsadas])

  const alternarCarpeta = useCallback((ruta: string) => {
    setColapsadas((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(ruta)) siguiente.delete(ruta)
      else siguiente.add(ruta)
      return siguiente
    })
  }, [])

  return { filas, alternarCarpeta }
}

/**
 * Alto de la lista: se ajusta a las filas ya aplanadas (cuenta exacta por construcción) hasta
 * que el usuario mueve el divisor; desde entonces manda él.
 */
function useAltoLista(filas: readonly unknown[], altoFila: number) {
  const [altoLista, setAltoLista] = useState(MIN_LISTA)
  const repartidoAManoRef = useRef(false)
  // El alto de fila vivo, en ref: cambiar el tamaño de letra no debe relanzar el ajuste.
  const altoFilaRef = useRef(altoFila)
  altoFilaRef.current = altoFila

  useEffect(() => {
    if (repartidoAManoRef.current) return
    const auto = filas.length * altoFilaRef.current + ALTO_CROMO_LISTA
    setAltoLista(Math.max(MIN_LISTA, Math.min(MAX_LISTA_AUTO, auto)))
  }, [filas])

  return { altoLista, setAltoLista, repartidoAManoRef }
}

interface EntradaPane {
  target: DiffTarget
  visible: boolean
  paneKey: string
  targetKey: string
  activeTargetKey: string
  altoFila: number
  fsTick: number
}

/** Todo el estado de ComprimidoDiffPane; los hooks se llaman siempre en este orden. */
export function useComprimidoDiff(p: EntradaPane) {
  // Las filas usan el CSS de git, scoped bajo `.git-ui`: si este pane se monta antes que ningún
  // panel de git, nadie habría inyectado esa hoja todavía.
  useLayoutEffect(() => asegurarEstilosGit(), [])
  const cmp = useComparacionComprimido(p)
  const { contenido, pidiendo } = useContenidoEntrada({ ...cmp, paneKey: p.paneKey, visible: p.visible })
  const arbol = useArbolEntradas(cmp.comparacion, cmp.dentro)
  const alto = useAltoLista(arbol.filas, p.altoFila)

  const enMemoria = useMemo(() => enMemoriaDe(contenido, cmp.dentro), [contenido, cmp.dentro])
  const { comparacion, cargando, seleccionada, porNombre } = cmp
  const aviso = useMemo(
    () => calcularAviso({ comparacion, cargando, seleccionada, contenido, pidiendo, porNombre }),
    [comparacion, cargando, seleccionada, contenido, pidiendo, porNombre]
  )
  const procedencia = contenido?.java?.despues ?? contenido?.java?.antes ?? null
  return { ...cmp, ...arbol, ...alto, enMemoria, aviso, procedencia }
}
