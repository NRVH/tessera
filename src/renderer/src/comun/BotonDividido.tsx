// =============================================================================
// BotonDividido: un botón de icono con dos mitades y dos paradas de Tab. La principal hace lo de
// siempre al instante; la flecha despliega lo que le toque a quien aloja el botón: un diálogo, así que
// lleva `aria-haspopup="dialog"` y `aria-expanded`, y Intro, Espacio y ↓ la pulsan. Lo desplegado lo monta
// quien lo aloja, colgado de `grupoRef` y en la capa flotante: la zona que aloja el botón puede recortarlo.
// Con `sinFlecha` no hay flecha: queda la principal sola, como un botón simple. Depende de su CSS
// (`botonDividido.css`).
// Decisiones: docs/decisiones/renderer/boton-dividido-y-capa-flotante.md
// =============================================================================

import './botonDividido.css'
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

export interface BotonDivididoProps {
  /** Nombre accesible de la mitad principal (se busca por él: no lo cambies sin tocar los e2e). */
  etiquetaPrincipal: string
  tituloPrincipal: string
  iconoPrincipal: ReactNode
  onPrincipal: () => void
  /** Por qué la mitad principal no se puede usar; ausente = disponible. Va en el `title` de una envoltura. */
  principalNoDisponible?: string
  /**
   * Sin flecha: el botón es solo la principal. La flecha no se esconde, se quita: sin ella no queda hueco,
   * parada de Tab ni nombre que anunciar.
   */
  sinFlecha?: boolean
  /** Nombre accesible de la flecha; no puede contener el de la principal (se buscan por subcadena). */
  etiquetaFlecha: string
  tituloFlecha: string
  flechaDeshabilitada?: boolean
  /** Lo que despliega la flecha está a la vista: `aria-expanded`, y el botón no se funde en reposo (`.abierto`). */
  flechaAbierta: boolean
  /** El id de lo que despliega, para `aria-controls` mientras está a la vista. */
  flechaControla?: string
  /** Pulsar la flecha (clic, Intro, Espacio o ↓) despliega o recoge lo suyo. */
  onFlecha: () => void
  /** El conjunto de las dos mitades: de él cuelga lo que despliega la flecha. */
  grupoRef: RefObject<HTMLSpanElement>
  /** Clase del envoltorio: es la que ganan los estilos de quien lo aloja (p. ej. el fundido en reposo). */
  className?: string
  /**
   * Si se quita la flecha con el foco en ella y la principal no se puede usar (un deshabilitado no recibe
   * foco), a dónde va: lo decide quien aloja el botón, que sabe qué apareció en su lugar. Sin él el foco se pierde.
   */
  destinoFocoSinPrincipal?: () => void
}

/** Chevron de 10 px: lo único del botón que no es de un icono compartido. */
function ChevronFlecha(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/**
 * ↓ sobre la flecha la despliega; Intro y Espacio ya hacen clic. La tecla no sigue subiendo: lo desplegado
 * ya está montado cuando el mismo evento llega más arriba, y no debe reaccionar a él.
 */
function teclaDeLaFlecha(e: KeyboardEvent, abierta: boolean, onFlecha: () => void): void {
  if (e.key !== 'ArrowDown' || abierta) return
  e.preventDefault()
  e.stopPropagation()
  onFlecha()
}

/**
 * La flecha. Si se quita con el foco puesto en ella (`sinFlecha`), el foco pasa a la principal y no cae en `<body>`,
 * donde los atajos de la zona que aloja el botón dejarían de valer. La limpieza corre antes de que React quite el nodo.
 */
function Flecha(p: BotonDivididoProps & { principalRef: RefObject<HTMLButtonElement> }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  // La limpieza lee lo último de las props sin volver a montar la flecha.
  const destinoRef = useRef(p.destinoFocoSinPrincipal)
  destinoRef.current = p.destinoFocoSinPrincipal
  const { principalRef } = p
  useLayoutEffect(() => {
    const flecha = ref.current
    // La principal se lee AL LIMPIAR y no al montar: entrar o salir de su envoltura (`principalNoDisponible`)
    // la desmonta y monta otra, y la de entonces ya no estaría en el DOM.
    const principalUsable = (): HTMLButtonElement | null => {
      const principal = principalRef.current
      return principal !== null && principal.isConnected && !principal.disabled ? principal : null
    }
    return () => {
      if (flecha === null || document.activeElement !== flecha) return
      const principal = principalUsable()
      if (principal !== null) {
        principal.focus()
        return
      }
      // Deshabilitada no recibe foco. Lo que aparece en lugar de la flecha (el riel, o la principal recién
      // montada en el mismo cambio) puede no estar en el DOM aún al correr esta limpieza: se mira de nuevo
      // cuando el cambio ya está aplicado.
      queueMicrotask(() => {
        if (document.activeElement !== null && document.activeElement !== document.body) return
        const otra = principalUsable()
        if (otra !== null) otra.focus()
        else destinoRef.current?.()
      })
    }
  }, [principalRef])
  return (
    <button
      ref={ref}
      type="button"
      className="btn btn-icon boton-dividido-flecha"
      aria-haspopup="dialog"
      aria-expanded={p.flechaAbierta}
      aria-controls={p.flechaAbierta ? p.flechaControla : undefined}
      aria-label={p.etiquetaFlecha}
      title={p.tituloFlecha}
      disabled={p.flechaDeshabilitada}
      // Lo desplegado se cierra con un mousedown fuera de él: sin esto, pulsar la flecha con ello
      // abierto lo cerraba en el mousedown y el clic lo reabría.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={p.onFlecha}
      onKeyDown={(e) => teclaDeLaFlecha(e, p.flechaAbierta, p.onFlecha)}
    >
      <ChevronFlecha />
    </button>
  )
}

/** El botón dividido «principal | ▾»; con `sinFlecha`, solo la principal. */
export function BotonDividido(p: BotonDivididoProps): React.JSX.Element {
  const principalRef = useRef<HTMLButtonElement>(null)
  const principal = (
    <button
      ref={principalRef}
      type="button"
      className="btn btn-icon boton-dividido-principal"
      onClick={p.onPrincipal}
      disabled={p.principalNoDisponible !== undefined}
      title={p.principalNoDisponible === undefined ? p.tituloPrincipal : undefined}
      aria-label={p.etiquetaPrincipal}
    >
      {p.iconoPrincipal}
    </button>
  )
  const abierto = p.flechaAbierta && !p.sinFlecha
  return (
    <span ref={p.grupoRef} className={`boton-dividido${p.className ? ` ${p.className}` : ''}${abierto ? ' abierto' : ''}`}>
      {/* Un control deshabilitado no recibe el ratón: el porqué cuelga de una envoltura viva. */}
      {p.principalNoDisponible === undefined ? (
        principal
      ) : (
        <span className="btn-envoltura" title={p.principalNoDisponible}>
          {principal}
        </span>
      )}
      {!p.sinFlecha && <Flecha {...p} principalRef={principalRef} />}
    </span>
  )
}
