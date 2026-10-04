// =============================================================================
// El panel de los popovers de la barra de título: un `role="dialog"` con nombre, pintado
// como hijo `position: fixed` de la envoltura de su botón (sin portal). Su cierre es
// `usePopoverBarra.ts`, y el reloj de sus «hace N min», `useAhora.ts`.
// Decisiones: docs/decisiones/layout/marco-y-lienzo.md
// =============================================================================

import type { ReactNode } from 'react'

interface PropsPopoverBarra {
  /** Nombre del diálogo para el lector de pantalla. */
  etiqueta: string
  /** Clase propia del popover, además de `.actualizacion-pop`. */
  clase?: string
  children: ReactNode
}

/** El panel que abre un botón de la barra de título. */
export function PopoverBarra({ etiqueta, clase, children }: PropsPopoverBarra): React.JSX.Element {
  return (
    <div className={clase ? `actualizacion-pop ${clase}` : 'actualizacion-pop'} role="dialog" aria-label={etiqueta}>
      {children}
    </div>
  )
}
