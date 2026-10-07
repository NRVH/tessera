// =============================================================================
// La franja inferior a pantalla completa: qué panel se pinta maximizado
// (`pantallaCompletaCoherente`) y la corrección del store cuando deja de valer, para que
// no resucite la próxima vez que se abra ese panel. Cada perfil recuerda el suyo mientras
// la app está abierta; no se persiste. Lo compone
// App.tsx, que pone la clase en `.shell`; ocultar lo demás es solo CSS, así que nada
// se desmonta.
// Decisiones: docs/decisiones/layout/pantalla-completa-de-la-franja.md
// =============================================================================
import { useLayoutEffect, useRef } from 'react'
import { pantallaCompletaAlCambiarDePerfil, pantallaCompletaCoherente, type PanelInferiorCentro, type SalidaLayoutCentro } from './layoutCentro'
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
  mosaico: boolean,
  perfilId: string | null
): PanelInferiorCentro | null {
  const pedida = useStoreLayout((s) => s.franjaPantallaCompleta)
  const coherente = pantallaCompletaCoherente({ pedida, franja, mosaico })
  const recordadas = useRef(new Map<string, PanelInferiorCentro | null>())
  const perfilPrevio = useRef(perfilId)
  // Antes que la corrección: guarda el modo del perfil que se va tal y como estaba en el store.
  useLayoutEffect(() => {
    const saliente = perfilPrevio.current
    if (saliente === perfilId) return
    perfilPrevio.current = perfilId
    const actual = useStoreLayout.getState().franjaPantallaCompleta
    const siguiente = pantallaCompletaAlCambiarDePerfil(recordadas.current, saliente, perfilId, actual)
    if (siguiente !== actual) useStoreLayout.setState({ franjaPantallaCompleta: siguiente })
  }, [perfilId])
  // Se recalcula con el store de ahora: el efecto de arriba puede haberlo cambiado en este mismo commit.
  useLayoutEffect(() => {
    const actual = useStoreLayout.getState().franjaPantallaCompleta
    const corregida = pantallaCompletaCoherente({ pedida: actual, franja, mosaico })
    if (corregida !== actual) useStoreLayout.setState({ franjaPantallaCompleta: corregida })
  })
  return coherente
}
