// =============================================================================
// Lo que comparten las pestañas de las terminales (las locales y las SSH): la ranura que se está
// renombrando, el campo de renombrado en línea y el teclado de una pestaña. Presentación pura: qué
// pasa al confirmar lo decide quien monta la pestaña.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import type { KeyboardEvent } from 'react'
import { esBorrarPestanaEnfocada } from '../../util/atajos'

/**
 * Ranura que se está renombrando ahora mismo. LLEVA SU CLAVE: los ids son únicos solo DENTRO de un
 * proyecto (`t1` existe en todos) o de un perfil (`s1`), y sin la clave el texto a medias de uno
 * acababa renombrando la pestaña de otro al cambiar de proyecto o de perfil.
 */
export interface Renombrando {
  key: string
  id: string
  texto: string
}

/** La clave de renombrado de las pestañas SSH de un perfil: no choca con la de ningún proyecto. */
export function claveRenombradoSsh(perfilId: string): string {
  return `ssh|${perfilId}`
}

interface CampoProps {
  texto: string
  /** El nombre actual, para el nombre accesible del campo. */
  nombre: string
  onTexto: (texto: string) => void
  onConfirmar: () => void
  onCancelar: () => void
}

/** Input de renombrado: confirma al salir (perder lo escrito por hacer clic fuera enfada); Esc descarta. */
export function CampoRenombrar({ texto, nombre, onTexto, onConfirmar, onCancelar }: CampoProps): React.JSX.Element {
  return (
    <input
      className="terminal-tab-input"
      // El ancho SIGUE al texto: uno fijo haría saltar las pestañas de la derecha al escribir.
      size={Math.max(4, texto.length)}
      value={texto}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onTexto(e.target.value)}
      onBlur={onConfirmar}
      onKeyDown={(e) => {
        e.stopPropagation() // que las teclas no lleguen a la pestaña
        if (e.key === 'Enter') onConfirmar()
        else if (e.key === 'Escape') onCancelar()
      }}
      aria-label={`Nombre de ${nombre}`}
    />
  )
}

/** Teclado de una pestaña: Enter/Espacio selecciona, F2 renombra y `esBorrarPestanaEnfocada` cierra (Supr; ⌘⌫ en Mac). */
export function teclaDePestana(
  e: KeyboardEvent,
  acciones: { seleccionar: () => void; renombrar: () => void; cerrar: () => void }
): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    acciones.seleccionar()
  } else if (e.key === 'F2') {
    e.preventDefault()
    acciones.renombrar()
  } else if (esBorrarPestanaEnfocada(e)) {
    // La ✕ va a `tabIndex={-1}` para no meter dos paradas de tabulador por pestaña: sin
    // esta tecla, cerrar una terminal sería solo con el ratón. El gesto es el de cada
    // plataforma (`Supr`, o `⌘⌫` en Mac) y Mayús/Alt/Ctrl+Supr no cierran.
    e.preventDefault()
    acciones.cerrar()
  }
}
