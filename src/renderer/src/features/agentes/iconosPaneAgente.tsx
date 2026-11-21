// =============================================================================
// Iconos de la cabecera y del pie del pane del agente, y su menú contextual mínimo
// (Copiar / Pegar). Los iconos usan `currentColor`: el color lo manda el botón, así
// que ninguno destaca sobre sus hermanos de la misma barra.
// =============================================================================

import { MenuContextual } from '../../comun/MenuContextual'
import { txPane } from './textosPane.ts'

interface PropsMenuContextualAgente {
  x: number
  y: number
  puedeCopiar: boolean
  onCopiar: () => void
  onPegar: () => void
  onCerrar: () => void
}

/** Menú contextual de la terminal del agente; se cierra con un clic fuera o Escape. */
export function MenuContextualAgente({ x, y, puedeCopiar, onCopiar, onPegar, onCerrar }: PropsMenuContextualAgente): React.JSX.Element {
  const t = txPane().menus
  return <MenuContextual x={x} y={y} onCerrar={onCerrar} items={[
    { label: t.copiar, onClick: onCopiar, disabled: !puedeCopiar },
    { label: t.pegar, onClick: onPegar }
  ]} />
}

/** Chevron del selector de proyecto de una casilla: pequeño y atenuado. */
export function IconoCaret(): React.JSX.Element {
  return (
    <svg
      className="casilla-caret"
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/** Bocadillo con "+": iniciar una conversación nueva. */
export function IconoChatNuevo(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 20l1.4-4.2A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 8.5v5M9.5 11h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Reloj con flecha de retroceso: historial de conversaciones. */
export function IconoHistorialAgente(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Cilindro de base de datos: montar bases en el proyecto. */
export function IconoMontajeDb(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14"
      strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5.5" rx="8" ry="3.2" />
      <path d="M4 5.5v6c0 1.77 3.58 3.2 8 3.2s8-1.43 8-3.2v-6" />
      <path d="M4 11.5v6c0 1.77 3.58 3.2 8 3.2s8-1.43 8-3.2v-6" />
    </svg>
  )
}

/** Flecha circular de "reiniciar", en `currentColor` como sus hermanos del header. */
export function IconoRecargarAgente(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 11a8 8 0 1 0-2.3 5.6" strokeLinecap="round" />
      <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** "Ir al proyecto" (casilla del mosaico): una flecha que SALE de un marco. */
export function IconoIrAlProyecto(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M13 4h7v7M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Las propiedades comunes de los iconos del selector de cuenta: trazo, sin relleno y del color del texto. */
function SvgCuenta({ tam, grosor = 1.6, children }: { tam: number; grosor?: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={grosor} strokeLinecap="round" strokeLinejoin="round" width={tam} height={tam} aria-hidden="true">
      {children}
    </svg>
  )
}

/** Tu equipo (el agente nativo): una pantalla. */
export function IconoEquipo({ tam = 16 }: { tam?: number }): React.JSX.Element {
  return (
    <SvgCuenta tam={tam}>
      <rect x="3.5" y="5" width="17" height="11" rx="1.6" />
      <path d="M9 19.5h6M12 16v3.5" />
    </SvgCuenta>
  )
}

/** Un contenedor de Docker (una cuenta en Docker): un cubo. */
export function IconoContenedor({ tam = 16 }: { tam?: number }): React.JSX.Element {
  return (
    <SvgCuenta tam={tam} grosor={1.5}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </SvgCuenta>
  )
}

/** Una cuenta de Docker global: disponible en todos los perfiles. */
export function IconoGlobal({ tam = 16 }: { tam?: number }): React.JSX.Element {
  return (
    <SvgCuenta tam={tam} grosor={1.5}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.500 5.600 12 3z" />
    </SvgCuenta>
  )
}


/** El uso de las cuentas: dos barras de nivel, la de la ventana corta encima de la larga. */
export function IconoUsoCuentas({ tam = 14 }: { tam?: number }): React.JSX.Element {
  return (
    <SvgCuenta tam={tam} grosor={2}>
      <path d="M4 8.5h16" opacity="0.35" />
      <path d="M4 8.5h7" />
      <path d="M4 15.5h16" opacity="0.35" />
      <path d="M4 15.5h12" />
    </SvgCuenta>
  )
}

/** Una puerta con una flecha en el sentido del acceso. */
function IconoPuerta({ entrar }: { entrar: boolean }): React.JSX.Element {
  return (
    <SvgCuenta tam={14} grosor={1.7}>
      <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
      <path d={entrar ? 'M11 8l4 4-4 4M6 12h9' : 'M10 8l-4 4 4 4M6 12h9'} />
    </SvgCuenta>
  )
}

/** Una flecha que sale por la puerta, para cerrar sesión. */
export function IconoSalir(): React.JSX.Element {
  return <IconoPuerta entrar={false} />
}

/** Una flecha que entra por la puerta, para iniciar sesión. */
export function IconoEntrar(): React.JSX.Element {
  return <IconoPuerta entrar />
}

/** La marca de la cuenta en uso. */
export function IconoElegida(): React.JSX.Element {
  return (
    <SvgCuenta tam={14} grosor={2}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </SvgCuenta>
  )
}

/** Añadir: el más del pie del selector. */
export function IconoMas(): React.JSX.Element {
  return (
    <SvgCuenta tam={14} grosor={1.8}>
      <path d="M12 5v14M5 12h14" />
    </SvgCuenta>
  )
}

/** Más acciones de una cuenta: los tres puntos, que abren su menú. */
export function IconoMasAcciones(): React.JSX.Element {
  return (
    <SvgCuenta tam={16} grosor={2.6}>
      <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" />
    </SvgCuenta>
  )
}

/** Continuar la conversación en otra cuenta o agente: dos flechas que se cruzan de un lado a otro. */
export function IconoPasarA({ tam = 16 }: { tam?: number }): React.JSX.Element {
  return (
    <SvgCuenta tam={tam} grosor={1.6}>
      <path d="M4 8h13M14 4.5L17.5 8 14 11.5" />
      <path d="M20 16H7M10 12.5L6.5 16 10 19.5" />
    </SvgCuenta>
  )
}
