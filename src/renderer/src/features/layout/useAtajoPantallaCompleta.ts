// =============================================================================
// Atajo de la franja a pantalla completa (Mod+Shift+↩): alterna el panel de la franja que
// tiene el foco. Va en fase de CAPTURA, como el del mosaico: con la terminal enfocada xterm
// convertiría el acorde en un CR y mandaría el prompt a medio escribir. Solo vale con el
// foco dentro de la franja (o en el agente de la terminal, que solo se ve con ella a pantalla
// completa), fuera del mosaico (allí el mismo acorde amplía una casilla) y sin un modal delante.
// Decisiones: docs/decisiones/layout/pantalla-completa-de-la-franja.md
// =============================================================================
import { useEffect } from 'react'
import { esAlternarPantallaCompleta } from '../../util/atajos'
import { hayModalAbierto } from '../../util/modalAbierto'
import { panelDeLaFranja } from '../../util/zonaEnfocada'
import { useStoreMosaico } from '../mosaico'
import { fijadoresLayout, useStoreLayout } from './store'

/** El pane del agente de la terminal (`data-lugar` de `features/agentes/AgentTerminalPane.tsx`). */
const SEL_AGENTE_TERMINAL = '[data-lugar="terminal"]'

/**
 * El panel que alterna el acorde con el foco en `destino`, o null. El agente de la terminal vive en la
 * columna y no en la franja, pero solo se ve con la terminal a pantalla completa: con el foco en él, el
 * acorde la restaura como si se pulsara desde la terminal.
 */
function panelDelAcorde(destino: EventTarget | null): 'terminal' | 'gitlog' | null {
  const panel = panelDeLaFranja(destino)
  if (panel !== null) return panel
  const enAgenteTerminal = destino instanceof Element && destino.closest(SEL_AGENTE_TERMINAL) !== null
  return enAgenteTerminal && useStoreLayout.getState().franjaPantallaCompleta === 'terminal' ? 'terminal' : null
}

/** Registra el atajo una sola vez; el estado vivo se lee del store al pulsar. */
export function useAtajoPantallaCompleta(): void {
  useEffect(() => {
    function alPulsar(e: KeyboardEvent): void {
      if (e.isComposing || !esAlternarPantallaCompleta(e)) return
      const panel = panelDelAcorde(e.target)
      if (panel === null || useStoreMosaico.getState().mosaicoActivo || hayModalAbierto()) return
      // Se consume también la autorrepetición: a xterm le llegaría como un CR por repetición.
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      const actual = useStoreLayout.getState().franjaPantallaCompleta
      fijadoresLayout.franjaPantallaCompleta(actual === panel ? null : panel)
    }
    window.addEventListener('keydown', alPulsar, true)
    return () => window.removeEventListener('keydown', alPulsar, true)
  }, [])
}
