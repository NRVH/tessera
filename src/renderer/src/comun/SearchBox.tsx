// =============================================================================
// SearchBox: caja de búsqueda superpuesta (Ctrl+F) que no conoce a quién busca: recibe
// `onFind`, `onNavigate` y `results` (índice/total) y gestiona la query, los alternadores
// (Aa / palabra / regex), Enter=siguiente, Shift+Enter=anterior, Esc=cerrar y el contador.
// `onFind` recalcula desde la primera coincidencia (una llamada por tecla) y `onNavigate` mueve
// el índice: un buscador con índice propio no distingue una cosa de la otra con un solo callback.
// La usan las terminales y las vistas renderizadas de .md y .docx. Depende de `TogglesBusqueda`.
// =============================================================================

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { pegarRecortado } from '../util/pasteTrim'
import { esRegexValida, type OpcionesBusqueda } from '../../../shared/textSearch'
import { TogglesBusqueda } from './TogglesBusqueda'

/** Alternadores de la caja. Mismo contrato que el motor de búsqueda de documento. */
export type SearchOptions = OpcionesBusqueda

type Resultados = { index: number; count: number } | null

interface SearchBoxProps {
  /** Búsqueda INCREMENTAL (cambió la query o una opción): recalcula desde la 1ª. */
  onFind: (query: string, opts: SearchOptions) => void
  /** Navegación explícita (Enter / Shift+Enter / flechas): mueve el índice. */
  onNavigate: (query: string, opts: SearchOptions, direction: 'next' | 'prev') => void
  /** Resultado actual: índice (0-based; -1 si ninguno o si se superó el umbral) y total. null = sin buscar. */
  results: Resultados
  /** Cierra el buscador (el consumidor limpia resaltados y devuelve el foco). */
  onClose: () => void
  /** Etiqueta accesible; por defecto, la de la terminal. */
  ariaLabel?: string
  /** Clase extra sobre `.search-box` (p. ej. `en-documento`, que lo baja bajo el header). */
  className?: string
  /**
   * Sube para pedir que el input se re-enfoque y se seleccione. Sirve para el segundo Ctrl+F con
   * el buscador ya abierto: vuelve al campo y selecciona lo escrito, sin remontar la caja (que
   * perdería la query).
   */
  focusToken?: number
}

/** Texto del contador según el estado de la búsqueda. */
function etiquetaContador(regexInvalid: boolean, query: string, results: Resultados): string {
  if (regexInvalid) return 'Regex inválido'
  if (!query) return ''
  if (!results || results.count === 0) return 'Sin resultados'
  if (results.index < 0) return `${results.count} coincidencias`
  return `${results.index + 1} / ${results.count}`
}

/** Autofoco al abrir, y de nuevo cada vez que sube `focusToken` (segundo Ctrl+F). */
function useAutofoco(inputRef: RefObject<HTMLInputElement>, focusToken: number): void {
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [inputRef, focusToken])
}

/**
 * Búsqueda INCREMENTAL: al cambiar la query o las opciones recalcula desde la primera
 * coincidencia. `onFind` no va en deps (se redefine cada render y crearía un bucle).
 */
function useBusquedaIncremental(
  query: string,
  opts: SearchOptions,
  regexInvalid: boolean,
  onFind: (query: string, opts: SearchOptions) => void
): void {
  useEffect(() => {
    if (regexInvalid) return // patrón regex incompleto: no dispares la búsqueda
    onFind(query, opts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, opts.caseSensitive, opts.wholeWord, opts.regex])
}

interface BotonNavProps {
  onClick: () => void
  title: string
  ariaLabel: string
  children: ReactNode
}

function BotonNav({ onClick, title, ariaLabel, children }: BotonNavProps): React.JSX.Element {
  return (
    <button type="button" className="search-box-nav" onClick={onClick} title={title} aria-label={ariaLabel}>
      {children}
    </button>
  )
}

/** Los tres botones de la derecha: coincidencia anterior, siguiente y cerrar. */
function BotonesNav({
  onPrev,
  onNext,
  onClose
}: {
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <>
      <BotonNav onClick={onPrev} title="Anterior (Shift+Enter)" ariaLabel="Coincidencia anterior">
        <ArrowUp />
      </BotonNav>
      <BotonNav onClick={onNext} title="Siguiente (Enter)" ariaLabel="Coincidencia siguiente">
        <ArrowDown />
      </BotonNav>
      <BotonNav onClick={onClose} title="Cerrar (Esc)" ariaLabel="Cerrar buscador">
        <CloseX />
      </BotonNav>
    </>
  )
}

function opcionesIniciales(): SearchOptions {
  return { caseSensitive: false, wholeWord: false, regex: false }
}

export function SearchBox({
  onFind,
  onNavigate,
  results,
  onClose,
  ariaLabel = 'Buscar en la terminal',
  className = '',
  focusToken = 0
}: SearchBoxProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [opts, setOpts] = useState<SearchOptions>(opcionesIniciales)
  const inputRef = useRef<HTMLInputElement>(null)

  useAutofoco(inputRef, focusToken)

  // Con el modo regex activo, un patrón a medio teclear ('(', '[', '*', '\') no compila y
  // `new RegExp` lanzaría un SyntaxError síncrono que desmontaría el pane: no se busca con él.
  const regexInvalid = opts.regex && query.length > 0 && !esRegexValida(query)

  useBusquedaIncremental(query, opts, regexInvalid, onFind)

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!regexInvalid) onNavigate(query, opts, e.shiftKey ? 'prev' : 'next')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const showError = regexInvalid || (!!query && (!results || results.count === 0))

  return (
    <div
      className={`search-box${className ? ` ${className}` : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className={`search-box-input${showError ? ' no-match' : ''}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onPaste={pegarRecortado(setQuery)}
        onKeyDown={handleKeyDown}
        placeholder="Buscar"
        spellCheck={false}
        aria-label={ariaLabel}
      />
      <span className="search-box-count">{etiquetaContador(regexInvalid, query, results)}</span>
      <TogglesBusqueda opts={opts} onChange={setOpts} />
      <BotonesNav
        onPrev={() => onNavigate(query, opts, 'prev')}
        onNext={() => onNavigate(query, opts, 'next')}
        onClose={onClose}
      />
    </div>
  )
}

function ArrowUp(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" width="13" height="13">
      <path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function ArrowDown(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" width="13" height="13">
      <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function CloseX(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" width="13" height="13">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}
