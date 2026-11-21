// =============================================================================
// Cuándo se abre y se cierra el submenú de un `MenuContextual`: espera un momento al apuntar su fila, no se cierra si
// el ratón va camino de él aunque cruce otras filas, y la tecla o el clic lo abren en el acto.
// Decisiones: docs/decisiones/renderer/menu-contextual.md
// =============================================================================
import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { documentoDe } from '../util/ventanaDe'
import { seDirigeAlPanel, type Punto } from './menuContextualModelo'

const MS_ABRIR = 150
const MS_CAMBIAR = 120
/** Lo que aguanta abierto mientras el ratón cruza otras filas hacia el panel. */
const MS_ATRAVESAR = 350
/** Distancia mínima entre muestras: con movimientos de 1 px la dirección no significa nada. */
const PX_MUESTRA = 6

export interface EstadoSubmenu {
  abierto: { indice: number; enfocar: boolean } | null
  panelRef: RefObject<HTMLDivElement>
  abrir: (indice: number, enfocar: boolean) => void
  /** → desde el menú: entra en el submenú abierto con el ratón o, si no hay ninguno, en el de la fila enfocada. */
  entrar: (indice: number | null) => void
  cerrar: () => void
  cancelarEspera: () => void
  alEntrarFila: (indice: number, esSubmenu: boolean) => void
  alMover: (e: PointerEvent) => void
}

export function useSubmenu(): EstadoSubmenu {
  const [abierto, setAbierto] = useState<EstadoSubmenu['abierto']>(null)
  const abiertoRef = useRef(abierto)
  abiertoRef.current = abierto
  const panelRef = useRef<HTMLDivElement>(null)
  const espera = useRef<number | undefined>(undefined)
  const anterior = useRef<Punto | null>(null)
  const ultimo = useRef<Punto | null>(null)

  const cancelarEspera = useCallback((): void => window.clearTimeout(espera.current), [])
  useEffect(() => cancelarEspera, [cancelarEspera])

  const abrir = useCallback((indice: number, enfocar: boolean): void => {
    cancelarEspera()
    setAbierto({ indice, enfocar })
  }, [cancelarEspera])

  const entrar = useCallback((indice: number | null): void => {
    const destino = abiertoRef.current?.indice ?? indice
    if (destino !== null) abrir(destino, true)
  }, [abrir])

  const cerrar = useCallback((): void => {
    cancelarEspera()
    setAbierto(null)
  }, [cancelarEspera])

  const alMover = useCallback((e: PointerEvent): void => {
    const punto = { x: e.clientX, y: e.clientY }
    const previo = ultimo.current
    if (previo && Math.hypot(punto.x - previo.x, punto.y - previo.y) < PX_MUESTRA) return
    anterior.current = previo
    ultimo.current = punto
  }, [])

  const alEntrarFila = useCallback((indice: number, esSubmenu: boolean): void => {
    cancelarEspera()
    const actual = abiertoRef.current
    if (actual?.indice === indice) return
    if (!esSubmenu && actual === null) return
    const panel = panelRef.current?.getBoundingClientRect()
    const apuntando = panel && anterior.current && ultimo.current && seDirigeAlPanel(anterior.current, ultimo.current, panel)
    const ms = apuntando ? MS_ATRAVESAR : actual ? MS_CAMBIAR : MS_ABRIR
    espera.current = window.setTimeout(() => {
      // Con el foco dentro manda el teclado: rozar otra fila no le quita el panel.
      if (!panelRef.current?.contains(documentoDe(panelRef.current).activeElement)) setAbierto(esSubmenu ? { indice, enfocar: false } : null)
    }, ms)
  }, [cancelarEspera])

  return { abierto, panelRef, abrir, entrar, cerrar, cancelarEspera, alEntrarFila, alMover }
}
