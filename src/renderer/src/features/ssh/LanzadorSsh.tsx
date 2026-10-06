// =============================================================================
// El lanzador de conexiones SSH de la cabecera de la terminal: la lista de conexiones en un popover
// anclado al botón dividido «Nueva terminal | ▾». Su estado vive en el store, porque también lo abre el
// estado vacío de la terminal. Se cierra si la terminal deja de verse, si cambia la pantalla completa o si
// la ▾ deja de verse (el riel ya enseña la lista); si cambia el tamaño del panel o de la ventana se
// re-ancla al botón, sin perder el filtro. Depende del store de SSH.
// Decisiones: docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { AnclaPopover } from '../../comun/popoverFlotante'
import type { DatosListaConexionesSsh } from './ListaConexionesSsh'
import { PopoverConexionesSsh } from './PopoverConexionesSsh'
import { lanzadorSeCierra, type ModoLanzador } from './rielSsh'
import { accionesSsh, useStoreSsh } from './store'

/** Lo que recibe el lanzador: lo de la lista, de dónde cuelga, si la terminal se ve, su panel y el modo. */
export interface PropsLanzadorSsh extends DatosListaConexionesSsh {
  /** El botón dividido de la cabecera: el popover se alinea con su borde izquierdo, bajo él. */
  anclaRef: RefObject<HTMLElement>
  /** La terminal está a la vista: con ella oculta el lanzador se cierra. */
  visible: boolean
  /** El panel de la terminal: si cambia de tamaño con el lanzador abierto, este se re-ancla al botón. */
  panelRef: RefObject<HTMLElement>
  pantallaCompleta: boolean
  /** La ▾ de la que cuelga se ve: si deja de verse (el riel enseña la lista), el lanzador se cierra. */
  flechaVisible: boolean
}

/** Lo mismo, sin cambiar de identidad si las tres medidas no se movieron (no repinta de más). */
function mismaAncla(a: AnclaPopover | null, b: AnclaPopover | null): boolean {
  return a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.bottom === b.bottom)
}

/**
 * El rectángulo del ancla: se mide al abrir el lanzador y se vuelve a medir si el panel de la terminal
 * cambia de tamaño (se arrastra el divisor de la franja, se maximiza) o la ventana también, de modo que el
 * lanzador se re-ancla al botón en vez de cerrarse (cerrarlo perdía el filtro tecleado).
 */
function useAncla(abierta: boolean, ref: RefObject<HTMLElement>, panelRef: RefObject<HTMLElement>): AnclaPopover | null {
  const [ancla, setAncla] = useState<AnclaPopover | null>(null)
  useLayoutEffect(() => {
    const medir = (): void => {
      const r = ref.current?.getBoundingClientRect()
      const nueva = abierta && r ? { left: r.left, top: r.top, bottom: r.bottom } : null
      setAncla((previa) => (mismaAncla(previa, nueva) ? previa : nueva))
    }
    medir()
    const panel = panelRef.current
    if (!abierta || !panel) return
    const observador = new ResizeObserver(medir)
    observador.observe(panel)
    window.addEventListener('resize', medir)
    return () => {
      observador.disconnect()
      window.removeEventListener('resize', medir)
    }
  }, [abierta, ref, panelRef])
  return ancla
}

/** Con el lanzador abierto, lo cierra si cambia el modo de la terminal (`lanzadorSeCierra`). */
function useCerrarSiCambiaElModo(abierta: boolean, pantallaCompleta: boolean, flechaVisible: boolean): void {
  const previo = useRef<ModoLanzador>({ pantallaCompleta, flechaVisible })
  useEffect(() => {
    const ahora = { pantallaCompleta, flechaVisible }
    if (abierta && lanzadorSeCierra(previo.current, ahora)) accionesSsh.cerrarLista()
    previo.current = ahora
  }, [abierta, pantallaCompleta, flechaVisible])
}

/** El lanzador de conexiones SSH del perfil: nada mientras está cerrado. */
export function LanzadorSsh({ anclaRef, visible, panelRef, pantallaCompleta, flechaVisible, ...lista }: PropsLanzadorSsh): React.JSX.Element | null {
  const abierta = useStoreSsh((s) => s.listaAbierta)
  const ancla = useAncla(abierta, anclaRef, panelRef)
  // Una terminal oculta no puede tener el lanzador a la vista: se cierra en vez de reabrirse solo al volver.
  useEffect(() => {
    if (!visible) accionesSsh.cerrarLista()
  }, [visible])
  useCerrarSiCambiaElModo(abierta, pantallaCompleta, flechaVisible)
  // Sin la ▾ no hay a qué anclarse (el riel enseña la lista): no se pinta ni un fotograma, aunque el
  // efecto que lo cierra aún no haya corrido.
  if (!abierta || !visible || !flechaVisible || !ancla) return null
  return <PopoverConexionesSsh {...lista} ancla={ancla} onCerrar={accionesSsh.cerrarLista} />
}
