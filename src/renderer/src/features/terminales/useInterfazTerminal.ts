// =============================================================================
// Lo que un `TerminalPane` pinta encima del xterm: el buscador, las miniaturas de las
// imágenes pegadas y el menú de Copiar/Pegar, con las acciones que los alimentan
// (copiar, buscar, pegar por el pipeline compartido, escribir al pty de su sesión).
// Estado y funciones del propio pane; ningún efecto.
// =============================================================================

import { useRef, useState, type Dispatch, type MouseEvent, type SetStateAction } from 'react'
import type { OpcionesBusqueda } from '../../../../shared/busquedaTexto'
import { buscarEnXterm, cerrarBuscadorXterm, copiarSeleccion, type ResultadosBusqueda } from './buscadorXterm'
import { alPegarTerminal } from './pegadoPortapapeles'
import { debeAbrirMenuContextual } from './comportamientoTerminal'
import type { PreviaImagenPegada } from './ChipsImagenTerminal'
import type { RefsTerminal } from './terminalPaneTipos'

/** Posición del menú contextual y si había selección al abrirlo (habilita «Copiar»). */
export interface MenuContextualTerminal {
  x: number
  y: number
  tieneSeleccion: boolean
}

/** Estado y acciones de la capa de interfaz de una terminal. */
export interface InterfazTerminal {
  buscadorAbierto: boolean
  setBuscadorAbierto: (abierto: boolean) => void
  resultadosBusqueda: ResultadosBusqueda | null
  setResultadosBusqueda: (r: ResultadosBusqueda | null) => void
  previasImagen: PreviaImagenPegada[]
  setPreviasImagen: Dispatch<SetStateAction<PreviaImagenPegada[]>>
  ctxMenu: MenuContextualTerminal | null
  setCtxMenu: (m: MenuContextualTerminal | null) => void
  copiarSeleccionTerminal: () => void
  ejecutarBusqueda: (consulta: string, opts: OpcionesBusqueda, direccion: 'next' | 'prev') => void
  cerrarBuscadorTerminal: () => void
  escribirAPty: (datos: string) => void
  pegarDesdePortapapeles: (e?: ClipboardEvent) => void
  enfocar: () => void
  alClicDerecho: (e: MouseEvent) => void
}

/**
 * Estado y acciones del buscador, las miniaturas, el menú contextual y el pegado. Con `soloTexto`
 * (una sesión SSH) el pegado no manda rutas de archivos ni imágenes: solo texto.
 */
export function useInterfazTerminal(refs: RefsTerminal, soloTexto = false): InterfazTerminal {
  const [buscadorAbierto, setBuscadorAbierto] = useState(false)
  const [resultadosBusqueda, setResultadosBusqueda] = useState<ResultadosBusqueda | null>(null)
  const [previasImagen, setPreviasImagen] = useState<PreviaImagenPegada[]>([])
  const previaId = useRef(0)
  const [ctxMenu, setCtxMenu] = useState<MenuContextualTerminal | null>(null)

  const copiarSeleccionTerminal = (): void => copiarSeleccion(refs)
  const escribirAPty = (datos: string): void => {
    const id = refs.sesion.current
    if (id) window.tessera.terminal.escribir({ sessionId: id, data: datos })
  }
  const anadirPreviaImagen = (url: string): void => {
    const id = ++previaId.current
    setPreviasImagen((prev) => [...prev, { id, url }])
  }
  const pegarDesdePortapapeles = (e?: ClipboardEvent): void => {
    const term = refs.term.current
    if (!term || !refs.sesion.current) return
    void alPegarTerminal(term, escribirAPty, e, { onPreviaImagen: anadirPreviaImagen, soloTexto })
  }
  const enfocar = (): void => refs.term.current?.focus()
  const cerrarBuscadorTerminal = (): void => cerrarBuscadorXterm(refs, setResultadosBusqueda, setBuscadorAbierto)
  const alClicDerecho = (e: MouseEvent): void => {
    e.preventDefault()
    // Si la aplicación de dentro pide el ratón, el clic derecho es suyo y el menú estorba.
    const term = refs.term.current
    if (!debeAbrirMenuContextual(term?.modes.mouseTrackingMode, e.shiftKey)) return
    setCtxMenu({ x: e.clientX, y: e.clientY, tieneSeleccion: term?.hasSelection() ?? false })
  }
  const ejecutarBusqueda = (consulta: string, opts: OpcionesBusqueda, direccion: 'next' | 'prev'): void =>
    buscarEnXterm(refs, setResultadosBusqueda, consulta, opts, direccion)

  return {
    buscadorAbierto,
    setBuscadorAbierto,
    resultadosBusqueda,
    setResultadosBusqueda,
    previasImagen,
    setPreviasImagen,
    ctxMenu,
    setCtxMenu,
    copiarSeleccionTerminal,
    ejecutarBusqueda,
    cerrarBuscadorTerminal,
    escribirAPty,
    pegarDesdePortapapeles,
    enfocar,
    alClicDerecho
  }
}
