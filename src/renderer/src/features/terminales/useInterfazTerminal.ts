// =============================================================================
// Lo que un `TerminalPane` pinta encima del xterm: el buscador, las miniaturas de las
// imágenes pegadas y el menú de Copiar/Pegar, con las acciones que los alimentan
// (copiar, buscar, pegar por el pipeline compartido, escribir al pty de su sesión).
// Estado y funciones del propio pane; ningún efecto.
// =============================================================================

import { useRef, useState, type Dispatch, type MouseEvent, type SetStateAction } from 'react'
import type { SearchOptions } from '../../comun/SearchBox'
import { buscarEnXterm, cerrarBuscadorXterm, copiarSeleccion, type ResultadosBusqueda } from './buscadorXterm'
import { handleTerminalPaste } from './clipboardPaste'
import { debeAbrirMenuContextual } from './comportamientoTerminal'
import type { PastedImagePreview } from './TerminalImageChips'
import type { RefsTerminal } from './terminalPaneTipos'

/** Posición del menú contextual y si había selección al abrirlo (habilita «Copiar»). */
export interface MenuContextualTerminal {
  x: number
  y: number
  hasSelection: boolean
}

/** Estado y acciones de la capa de interfaz de una terminal. */
export interface InterfazTerminal {
  searchOpen: boolean
  setSearchOpen: (abierto: boolean) => void
  searchResults: ResultadosBusqueda | null
  setSearchResults: (r: ResultadosBusqueda | null) => void
  imagePreviews: PastedImagePreview[]
  setImagePreviews: Dispatch<SetStateAction<PastedImagePreview[]>>
  ctxMenu: MenuContextualTerminal | null
  setCtxMenu: (m: MenuContextualTerminal | null) => void
  copySelection: () => void
  runSearch: (query: string, opts: SearchOptions, direction: 'next' | 'prev') => void
  closeSearch: () => void
  writeToPty: (data: string) => void
  pasteFromClipboard: (e?: ClipboardEvent) => void
  enfocar: () => void
  alClicDerecho: (e: MouseEvent) => void
}

/**
 * Estado y acciones del buscador, las miniaturas, el menú contextual y el pegado. Con `soloTexto`
 * (una sesión SSH) el pegado no manda rutas de archivos ni imágenes: solo texto.
 */
export function useInterfazTerminal(refs: RefsTerminal, soloTexto = false): InterfazTerminal {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<ResultadosBusqueda | null>(null)
  const [imagePreviews, setImagePreviews] = useState<PastedImagePreview[]>([])
  const previewId = useRef(0)
  const [ctxMenu, setCtxMenu] = useState<MenuContextualTerminal | null>(null)

  const copySelection = (): void => copiarSeleccion(refs)
  const writeToPty = (data: string): void => {
    const id = refs.session.current
    if (id) window.tessera.terminal.write({ sessionId: id, data })
  }
  const addImagePreview = (url: string): void => {
    const id = ++previewId.current
    setImagePreviews((prev) => [...prev, { id, url }])
  }
  const pasteFromClipboard = (e?: ClipboardEvent): void => {
    const term = refs.term.current
    if (!term || !refs.session.current) return
    void handleTerminalPaste(term, writeToPty, e, { onImagePreview: addImagePreview, soloTexto })
  }
  const enfocar = (): void => refs.term.current?.focus()
  const closeSearch = (): void => cerrarBuscadorXterm(refs, setSearchResults, setSearchOpen)
  const alClicDerecho = (e: MouseEvent): void => {
    e.preventDefault()
    // Si la aplicación de dentro pide el ratón, el clic derecho es suyo y el menú estorba.
    const term = refs.term.current
    if (!debeAbrirMenuContextual(term?.modes.mouseTrackingMode, e.shiftKey)) return
    setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection: term?.hasSelection() ?? false })
  }
  const runSearch = (query: string, opts: SearchOptions, direction: 'next' | 'prev'): void =>
    buscarEnXterm(refs, setSearchResults, query, opts, direction)

  return {
    searchOpen,
    setSearchOpen,
    searchResults,
    setSearchResults,
    imagePreviews,
    setImagePreviews,
    ctxMenu,
    setCtxMenu,
    copySelection,
    runSearch,
    closeSearch,
    writeToPty,
    pasteFromClipboard,
    enfocar,
    alClicDerecho
  }
}
