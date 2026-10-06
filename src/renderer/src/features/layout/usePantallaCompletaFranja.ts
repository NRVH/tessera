// =============================================================================
// La franja inferior a pantalla completa: qué panel se pinta maximizado
// (`pantallaCompletaCoherente`) y la corrección del store cuando deja de valer, para que
// no resucite la próxima vez que se abra ese panel. Efímero: no se persiste. Lo compone
// App.tsx, que pone la clase en `.shell`; ocultar lo demás es solo CSS, así que nada
// se desmonta.
// Decisiones: docs/decisiones/layout/pantalla-completa-de-la-franja.md
// =============================================================================
import { useLayoutEffect } from 'react'
import { pantallaCompletaCoherente, type PanelInferiorCentro, type SalidaLayoutCentro } from './layoutCentro'
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

/** ¿Qué panel de la franja se pinta a pantalla completa? Corrige el store antes de pintar si ya no vale. */
export function usePantallaCompletaFranja(
  franja: SalidaLayoutCentro['franja'],
  mosaico: boolean
): PanelInferiorCentro | null {
  const pedida = useStoreLayout((s) => s.franjaPantallaCompleta)
  const coherente = pantallaCompletaCoherente({ pedida, franja, mosaico })
  useLayoutEffect(() => {
    if (coherente !== useStoreLayout.getState().franjaPantallaCompleta) {
      useStoreLayout.setState({ franjaPantallaCompleta: coherente })
    }
  })
  return coherente
}
