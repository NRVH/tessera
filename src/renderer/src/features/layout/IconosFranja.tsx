// =============================================================================
// Controles propios de la franja desacoplada: acoplar/desacoplar, la vista («solo la terminal») y el
// conmutador de panel en cabecera cuando la barra lateral está oculta.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { useRef } from 'react'
import { BotonDivididoMenu } from '../../comun/BotonDivididoMenu'
import { IconoTerminal } from '../../comun/iconosPanel'
import { IconoRama } from '../git'
import type { PanelInferiorCentro } from './layoutCentro'
import type { EntradaMenuVista } from './franjaDesacoplada.ts'
import { txLayout } from './textos.ts'

/** `inert` como atributo: React 18 no lo declara en sus tipos HTML. */
const INERTE = { inert: '' } as Record<string, string>

export function IconoFranja({ acoplar }: { acoplar: boolean }): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={acoplar ? 'M8 4V8H12M8 8l5.5-5.5' : 'M9.5 2.5H13.5V6.5M13.5 2.5L8 8'} />
      <path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
    </svg>
  )
}

/** Una ventana con el símbolo de terminal dentro: la vista de solo la terminal. */
export function IconoVistaCompacta(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="1.2" />
      <path d="M5 6.5l2 1.5-2 1.5M8.5 9.7H11" strokeWidth="1.2" />
    </svg>
  )
}

export function BotonAcopleFranja({ acoplar, clase, alPulsar }: {
  acoplar: boolean
  clase: string
  alPulsar: () => void
}): React.JSX.Element {
  const t = txLayout().franja
  const titulo = acoplar ? t.acoplarTitulo : t.desacoplarTitulo
  return (
    <button type="button" className={clase} title={titulo}
      aria-label={acoplar ? t.acoplar : t.desacoplar} onClick={alPulsar}>
      <IconoFranja acoplar={acoplar} />
    </button>
  )
}

/**
 * La vista de la ventana desacoplada. En la vista completa es un icono («Mostrar solo la terminal»); en la
 * compacta, el botón dividido «Vista | ▾»: la parte principal vuelve a la vista completa (y queda deshabilitada
 * si el ancho impone la compacta) y la flecha ofrece, además, acoplar. Es siempre el mismo botón, con o sin
 * flecha, para que el foco no se pierda al cambiar de vista.
 */
export function BotonVistaFranja({ compacta, impuestaPorAncho, entradas, alAlternarVista, alAcoplar }: {
  compacta: boolean
  impuestaPorAncho: boolean
  entradas: readonly EntradaMenuVista[]
  alAlternarVista: () => void
  alAcoplar: () => void
}): React.JSX.Element {
  const t = txLayout().franja
  const etiqueta = compacta ? t.mostrarVistaCompleta : t.mostrarSoloTerminal
  const principalRef = useRef<HTMLButtonElement>(null)
  return (
    <BotonDivididoMenu
      principalRef={principalRef}
      etiquetaPrincipal={etiqueta}
      tituloPrincipal={etiqueta}
      iconoPrincipal={<IconoVistaCompacta />}
      onPrincipal={alAlternarVista}
      principalActiva={compacta}
      principalNoDisponible={impuestaPorAncho ? t.compactaPorAncho : undefined}
      sinFlecha={!compacta}
      etiquetaFlecha={t.opcionesVista}
      tituloFlecha={t.opcionesVista}
      entradas={entradas.map((entrada) => entrada === 'vistaCompleta'
        ? {
            label: t.mostrarVistaCompleta,
            icon: <IconoVistaCompacta />,
            disabled: impuestaPorAncho,
            title: impuestaPorAncho ? t.compactaPorAncho : undefined,
            onClick: () => {
              principalRef.current?.focus({ preventScroll: true })
              alAlternarVista()
            }
          }
        : { label: t.acoplarEnPrincipal, icon: <IconoFranja acoplar />, onClick: alAcoplar })}
    />
  )
}

export function BotonConmutarPanelFranja({ destino, visible, clase, alPulsar }: {
  destino: PanelInferiorCentro
  visible: boolean
  clase: string
  alPulsar: () => void
}): React.JSX.Element {
  const t = txLayout().riel
  const esTerminal = destino === 'terminal'
  return (
    <span className={`control-plegable${visible ? '' : ' plegado'}`} aria-hidden={!visible} {...(visible ? {} : INERTE)}>
      <button
        type="button"
        className={clase}
        title={esTerminal ? t.terminalTitulo : t.gitLogTitulo}
        aria-label={esTerminal ? t.terminal : t.gitLog}
        onClick={alPulsar}
      >
        {esTerminal ? <IconoTerminal /> : <IconoRama tamaño={null} />}
      </button>
    </span>
  )
}
