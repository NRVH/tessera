// =============================================================================
// La franja inferior a pantalla completa: las clases de `.shell` para el panel que se pinta
// maximizado (lo calcula una sola vez el layout del centro, en el render) y el espejo de ese
// valor y del perfil a la vista para los manejadores de eventos. Lo compone App.tsx; ocultar
// lo demás es solo CSS, así que nada se desmonta.
// Decisiones: docs/decisiones/layout/pantalla-completa-de-la-franja.md
// =============================================================================
import { useLayoutEffect } from 'react'
import type { PanelInferiorCentro } from './layoutCentro'
import { useStoreLayout } from './store'

/** La clase de cada panel (`git-pantalla-completa` la busca el e2e de Git·Log). */
const CLASE_POR_PANEL: Record<PanelInferiorCentro, string> = {
  gitlog: 'git-pantalla-completa',
  terminal: 'terminal-pantalla-completa'
}

/** Las clases que `.shell` lleva con la franja a pantalla completa (la genérica y la de su panel), o '' sin modo. */
export function clasesPantallaCompleta(panel: PanelInferiorCentro | null): string {
  return panel === null ? '' : ` franja-pantalla-completa ${CLASE_POR_PANEL[panel]}`
}

/**
 * Publica lo que se pinta y el perfil a la vista para los atajos y las aperturas, que no tienen el
 * perfil. Solo es el espejo: lo que se pinta ya salió del render.
 */
export function useEspejoPantallaCompleta(pantallaCompleta: PanelInferiorCentro | null, perfilId: string): void {
  useLayoutEffect(() => {
    const s = useStoreLayout.getState()
    if (s.franjaPantallaCompleta !== pantallaCompleta || s.perfilALaVista !== perfilId) {
      useStoreLayout.setState({ franjaPantallaCompleta: pantallaCompleta, perfilALaVista: perfilId })
    }
  })
}
