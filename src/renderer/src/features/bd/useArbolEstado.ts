// =============================================================================
// El estado LOCAL de la interacción del lateral de BD (menú, diálogos, búsqueda, arrastre,
// avisos): efímero, se pierde al desmontar. Hooks que llama `DbArbol`, en su orden; el
// estado que tiene efecto propio se declara junto a él (aviso y arrastre, aquí abajo).
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ArrastreArbol, AvisoArbol, EstadoUiArbol } from './DbArbolTipos'

/** Cuánto dura a la vista un aviso de éxito. */
const AVISO_OK_MS = 6000

/** El estado de la interacción que no tiene efecto propio, y los refs del lateral. */
export function useArbolEstado(): EstadoUiArbol {
  const [busqueda, setBusqueda] = useState<EstadoUiArbol['busqueda']>(null)
  const [menu, setMenu] = useState<EstadoUiArbol['menu']>(null)
  const [popover, setPopover] = useState<EstadoUiArbol['popover']>(null)
  const [confirmacion, setConfirmacion] = useState<EstadoUiArbol['confirmacion']>(null)
  const [renombrando, setRenombrando] = useState<EstadoUiArbol['renombrando']>(null)
  const [filtrandoClaves, setFiltrandoClaves] = useState<EstadoUiArbol['filtrandoClaves']>(null)
  const [peticionTx, setPeticionTx] = useState<EstadoUiArbol['peticionTx']>(null)
  const [probando, setProbando] = useState<string | null>(null)
  const [ordenLocal, setOrdenLocal] = useState<EstadoUiArbol['ordenLocal']>(null)
  const [soltandoArchivo, setSoltandoArchivo] = useState(false)

  const listaRef = useRef<HTMLDivElement>(null)
  const busquedaRef = useRef<HTMLInputElement>(null)
  const menuPorTeclado = useRef(0)
  const ultimoCierrePopover = useRef<{ conexionId: string; base?: string; en: number } | null>(null)

  return {
    busqueda,
    setBusqueda,
    menu,
    setMenu,
    popover,
    setPopover,
    confirmacion,
    setConfirmacion,
    renombrando,
    setRenombrando,
    filtrandoClaves,
    setFiltrandoClaves,
    peticionTx,
    setPeticionTx,
    probando,
    setProbando,
    ordenLocal,
    setOrdenLocal,
    soltandoArchivo,
    setSoltandoArchivo,
    listaRef,
    busquedaRef,
    menuPorTeclado,
    ultimoCierrePopover
  }
}

/** El aviso de la cabecera; uno de éxito se va solo a los `AVISO_OK_MS`. */
export function useArbolAviso(): [AvisoArbol | null, Dispatch<SetStateAction<AvisoArbol | null>>] {
  const [aviso, setAviso] = useState<AvisoArbol | null>(null)
  useEffect(() => {
    if (!aviso || aviso.tono !== 'ok') return
    const t = window.setTimeout(() => setAviso((a) => (a === aviso ? null : a)), AVISO_OK_MS)
    return () => window.clearTimeout(t)
  }, [aviso])
  return [aviso, setAviso]
}

/**
 * El arrastre de una conexión para reordenar. El de una fila que sale de la ventana virtual
 * desmonta su nodo, y el `dragend` de un nodo desmontado no llega a nadie: se limpia también
 * desde fuera.
 */
export function useArbolArrastre(): [ArrastreArbol | null, Dispatch<SetStateAction<ArrastreArbol | null>>] {
  const [arrastre, setArrastre] = useState<ArrastreArbol | null>(null)
  useEffect(() => {
    if (!arrastre) return
    const fin = (): void => setArrastre(null)
    window.addEventListener('drop', fin)
    window.addEventListener('dragend', fin)
    return () => {
      window.removeEventListener('drop', fin)
      window.removeEventListener('dragend', fin)
    }
  }, [arrastre])
  return [arrastre, setArrastre]
}
