// =============================================================================
// Atajo de la franja a pantalla completa (Mod+Shift+↩): alterna el panel de la franja que
// tiene el foco en la principal; en una ventana hija desacoplada se consume sin efecto para
// que el Intro no llegue al pty. Va en fase de CAPTURA, como el del mosaico: con la terminal
// enfocada xterm convertiría el acorde en un CR y mandaría el prompt a medio escribir. Solo
// vale con el foco dentro de la franja (o en el agente de la terminal, o en el riel del modo),
// fuera del mosaico (allí el mismo acorde amplía una casilla) y sin un modal delante en esa ventana.
// Decisiones: docs/decisiones/layout/pantalla-completa-de-la-franja.md
// =============================================================================
import { useEffect } from 'react'
import { esAlternarPantallaCompleta } from '../../util/atajos'
import { hayModalAbierto } from '../../util/modalAbierto'
import { esElemento } from '../../util/ventanaDe'
import { panelDeLaFranja } from '../../util/zonaEnfocada'
import { useStoreMosaico } from '../mosaico'
import { CLASE_RIEL_MODO } from './RielActividadPuro'
import { fijarMaximizado, useStoreLayout } from './store'
import { useStoreVentanasFranja } from './ventanasFranja'

/** El pane del agente de la terminal (`data-lugar` de `features/agentes/PaneTerminalAgente.tsx`). */
const SEL_AGENTE_TERMINAL = '[data-lugar="terminal"]'

/**
 * El panel que alterna el acorde con el foco en `destino`, o null. El agente de la terminal vive en la
 * columna y no en la franja, pero solo se ve con la terminal a pantalla completa: con el foco en él, el
 * acorde la restaura como si se pulsara desde la terminal.
 */
function panelDelAcorde(destino: EventTarget | null): 'terminal' | 'gitlog' | null {
  const panel = panelDeLaFranja(destino)
  if (panel !== null) return panel
  const enPantallaCompleta = useStoreLayout.getState().franjaPantallaCompleta
  // El riel a pantalla completa lleva «Restaurar», que anuncia el acorde: con el foco en él, vale para el panel del modo.
  if (esElemento(destino) && destino.closest(`.${CLASE_RIEL_MODO}`) !== null) return enPantallaCompleta
  const enAgenteTerminal = esElemento(destino) && destino.closest(SEL_AGENTE_TERMINAL) !== null
  return enAgenteTerminal && enPantallaCompleta === 'terminal' ? 'terminal' : null
}

/** En una ventana hija, vale si el foco está en la franja o en su agente de la terminal. */
function destinoEnFranjaHija(destino: EventTarget | null): boolean {
  return panelDeLaFranja(destino) !== null || (esElemento(destino) && destino.closest(SEL_AGENTE_TERMINAL) !== null)
}

/** Registra el atajo en la principal y en cada ventana hija desacoplada; lee el estado vivo del store al pulsar. */
export function useAtajoPantallaCompleta(): void {
  const abiertas = useStoreVentanasFranja((s) => s.abiertas)

  useEffect(() => {
    function alPulsar(e: KeyboardEvent): void {
      if (e.isComposing || !esAlternarPantallaCompleta(e)) return
      const panel = panelDelAcorde(e.target)
      if (panel === null || useStoreMosaico.getState().mosaicoActivo || hayModalAbierto(document)) return
      // Se consume también la autorrepetición: a xterm le llegaría como un CR por repetición.
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      fijarMaximizado(panel, useStoreLayout.getState().franjaPantallaCompleta !== panel)
    }
    window.addEventListener('keydown', alPulsar, true)
    return () => window.removeEventListener('keydown', alPulsar, true)
  }, [])

  useEffect(() => {
    const bajas: (() => void)[] = []
    for (const hija of abiertas.values()) {
      const ventana = hija.ventana
      if (ventana.closed) continue
      const alPulsarHija = (e: KeyboardEvent): void => {
        if (e.isComposing || !esAlternarPantallaCompleta(e)) return
        if (!destinoEnFranjaHija(e.target) || hayModalAbierto(ventana.document)) return
        e.preventDefault()
        e.stopPropagation()
      }
      ventana.addEventListener('keydown', alPulsarHija, true)
      bajas.push(() => ventana.removeEventListener('keydown', alPulsarHija, true))
    }
    return () => {
      for (const bajar of bajas) bajar()
    }
  }, [abiertas])
}
