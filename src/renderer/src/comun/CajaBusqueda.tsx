// =============================================================================
// CajaBusqueda: caja de búsqueda superpuesta (Ctrl+F) que no conoce a quién busca: recibe
// `onBuscar`, `onNavigate` y `resultados` (índice/total) y gestiona la query, los alternadores
// (Aa / palabra / regex), Enter=siguiente, Shift+Enter=anterior, Esc=cerrar y el contador.
// `onBuscar` recalcula desde la primera coincidencia (una llamada por tecla) y `onNavigate` mueve
// el índice: un buscador con índice propio no distingue una cosa de la otra con un solo callback.
// La usan las terminales y la vista renderizada de Markdown. Depende de `ConmutadoresBusqueda`.
// =============================================================================

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { pegarRecortado } from '../util/pasteTrim'
import { esRegexValida, type OpcionesBusqueda } from '../../../shared/busquedaTexto'
import { txComun } from './textos.ts'
import { ConmutadoresBusqueda } from './ConmutadoresBusqueda'

type Resultados = { indice: number; total: number } | null

interface PropsCajaBusqueda {
  /** Búsqueda INCREMENTAL (cambió la query o una opción): recalcula desde la 1ª. */
  onBuscar: (consulta: string, opts: OpcionesBusqueda) => void
  /** Navegación explícita (Enter / Shift+Enter / flechas): mueve el índice. */
  onNavigate: (consulta: string, opts: OpcionesBusqueda, direccion: 'next' | 'prev') => void
  /** Resultado actual: índice (0-based; -1 si ninguno o si se superó el umbral) y total. null = sin buscar. */
  resultados: Resultados
  /** Cierra el buscador (el consumidor limpia resaltados y devuelve el foco). */
  onCerrar: () => void
  /** Etiqueta accesible; por defecto, la de la terminal. */
  etiquetaAria?: string
  /** Clase extra sobre `.search-box` (p. ej. `en-documento`, que lo baja bajo el header). */
  className?: string
  /**
   * Sube para pedir que el input se re-enfoque y se seleccione. Sirve para el segundo Ctrl+F con
   * el buscador ya abierto: vuelve al campo y selecciona lo escrito, sin remontar la caja (que
   * perdería la query).
   */
  tokenFoco?: number
}

/** Texto del contador según el estado de la búsqueda. */
function etiquetaContador(regexInvalida: boolean, consulta: string, resultados: Resultados): string {
  const t = txComun()
  if (regexInvalida) return t.regexInvalido
  if (!consulta) return ''
  if (!resultados || resultados.total === 0) return t.sinResultados
  if (resultados.indice < 0) return t.coincidencias(resultados.total)
  return `${resultados.indice + 1} / ${resultados.total}`
}

/** Autofoco al abrir, y de nuevo cada vez que sube `tokenFoco` (segundo Ctrl+F). */
function useAutofoco(entradaRef: RefObject<HTMLInputElement>, tokenFoco: number): void {
  useEffect(() => {
    entradaRef.current?.focus()
    entradaRef.current?.select()
  }, [entradaRef, tokenFoco])
}

/**
 * Búsqueda INCREMENTAL: al cambiar la query o las opciones recalcula desde la primera
 * coincidencia. `onBuscar` no va en deps (se redefine cada render y crearía un bucle).
 */
function useBusquedaIncremental(
  consulta: string,
  opts: OpcionesBusqueda,
  regexInvalida: boolean,
  onBuscar: (consulta: string, opts: OpcionesBusqueda) => void
): void {
  useEffect(() => {
    if (regexInvalida) return // patrón regex incompleto: no dispares la búsqueda
    onBuscar(consulta, opts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, opts.distingueMayusculas, opts.palabraCompleta, opts.regex])
}

interface PropsBotonNavegacion {
  onClic: () => void
  titulo: string
  etiquetaAria: string
  children: ReactNode
}

function BotonNavegacion({ onClic, titulo, etiquetaAria, children }: PropsBotonNavegacion): React.JSX.Element {
  return (
    <button type="button" className="search-box-nav" onClick={onClic} title={titulo} aria-label={etiquetaAria}>
      {children}
    </button>
  )
}

/** Los tres botones de la derecha: coincidencia anterior, siguiente y cerrar. */
function BotonesNavegacion({
  onPrev,
  onSiguiente,
  onCerrar
}: {
  onPrev: () => void
  onSiguiente: () => void
  onCerrar: () => void
}): React.JSX.Element {
  const t = txComun()
  return (
    <>
      <BotonNavegacion onClic={onPrev} titulo={t.anterior} etiquetaAria={t.coincidenciaAnterior}>
        <IconoFlechaArriba />
      </BotonNavegacion>
      <BotonNavegacion onClic={onSiguiente} titulo={t.siguiente} etiquetaAria={t.coincidenciaSiguiente}>
        <IconoFlechaAbajo />
      </BotonNavegacion>
      <BotonNavegacion onClic={onCerrar} titulo={t.cerrarEsc} etiquetaAria={t.cerrarBuscador}>
        <IconoEquis />
      </BotonNavegacion>
    </>
  )
}

function opcionesIniciales(): OpcionesBusqueda {
  return { distingueMayusculas: false, palabraCompleta: false, regex: false }
}

export function CajaBusqueda({
  onBuscar,
  onNavigate,
  resultados,
  onCerrar,
  etiquetaAria,
  className = '',
  tokenFoco = 0
}: PropsCajaBusqueda): React.JSX.Element {
  const t = txComun()
  const [consulta, setConsulta] = useState('')
  const [opts, setOpts] = useState<OpcionesBusqueda>(opcionesIniciales)
  const entradaRef = useRef<HTMLInputElement>(null)

  useAutofoco(entradaRef, tokenFoco)

  // Con el modo regex activo, un patrón a medio teclear ('(', '[', '*', '\') no compila y
  // `new RegExp` lanzaría un SyntaxError síncrono que desmontaría el pane: no se busca con él.
  const regexInvalida = opts.regex && consulta.length > 0 && !esRegexValida(consulta)

  useBusquedaIncremental(consulta, opts, regexInvalida, onBuscar)

  function alPulsarTecla(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!regexInvalida) onNavigate(consulta, opts, e.shiftKey ? 'prev' : 'next')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCerrar()
    }
  }

  const hayErrorVisible = regexInvalida || (!!consulta && (!resultados || resultados.total === 0))

  return (
    <div
      className={`search-box${className ? ` ${className}` : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={entradaRef}
        className={`search-box-input${hayErrorVisible ? ' no-match' : ''}`}
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
        onPaste={pegarRecortado(setConsulta)}
        onKeyDown={alPulsarTecla}
        placeholder={t.buscar}
        spellCheck={false}
        aria-label={etiquetaAria ?? t.buscarEnTerminal}
      />
      <span className="search-box-count">{etiquetaContador(regexInvalida, consulta, resultados)}</span>
      <ConmutadoresBusqueda opts={opts} onCambio={setOpts} />
      <BotonesNavegacion
        onPrev={() => onNavigate(consulta, opts, 'prev')}
        onSiguiente={() => onNavigate(consulta, opts, 'next')}
        onCerrar={onCerrar}
      />
    </div>
  )
}

function IconoFlechaArriba(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" width="13" height="13">
      <path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconoFlechaAbajo(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" width="13" height="13">
      <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconoEquis(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" width="13" height="13">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}
