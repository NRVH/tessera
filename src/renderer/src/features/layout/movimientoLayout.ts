// =============================================================================
// La decisión de cómo animar el reparto: una apertura viaja, un cierre se funde, y cambiar de contexto
// (perfil, proyecto, vista o pantalla completa) es instantáneo. Pura.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import type { SalidaLayoutCentro } from './layoutCentro.ts'

/** Lo del layout que cambia zonas de sitio o de tamaño; lo demás (la barra de estado, `canExpand`) no se anima. */
export function firmaLayout(l: SalidaLayoutCentro): string {
  return [
    l.editorOculto,
    l.dbAreaOculta,
    l.cc.hidden,
    l.cc.grow,
    l.divisorAgente,
    l.agente,
    l.agenteDbMaximizado,
    l.terminalPlegada,
    l.franja.divisor,
    l.franja.gitlog,
    l.franja.terminalVisible
  ].join('|')
}

/**
 * ¿Aparece alguna zona? Una apertura viaja de un reparto al otro; un cambio en el que solo se van zonas es
 * un cierre, que se funde (`tipoDeCambio`).
 */
export function apareceAlgo(antes: SalidaLayoutCentro, despues: SalidaLayoutCentro): boolean {
  return [
    antes.editorOculto && !despues.editorOculto,
    antes.dbAreaOculta && !despues.dbAreaOculta,
    antes.cc.hidden && !despues.cc.hidden,
    // La terminal que reaparece porque se cerró o se ocultó el agente que la tapaba es un cierre, no una apertura.
    antes.terminalPlegada && !despues.terminalPlegada && antes.agente === despues.agente,
    !antes.franja.gitlog && despues.franja.gitlog,
    !antes.franja.terminalVisible && despues.franja.terminalVisible,
    // Que la columna deje de ser del agente de la terminal es que ese agente se cerró o se ocultó: un cierre.
    antes.agente !== despues.agente && despues.agente !== null && antes.agente !== 'terminal'
  ].some(Boolean)
}

/** El selector de cada zona del reparto, el mismo al que `movimiento.css` le pone nombre en la transición. */
export type ZonaReparto = '.editor-area' | '.db-area' | '.right-panel' | '.git-log-panel' | '.terminal-panel'

/**
 * Las zonas que se van en un cambio de reparto. La columna del agente sigue en la página aunque se cierre o
 * se oculte el de la terminal (cambia de contenido), así que se dice aquí y no se deduce del DOM.
 */
export function zonasQueSeVan(antes: SalidaLayoutCentro, despues: SalidaLayoutCentro): ZonaReparto[] {
  const van: ZonaReparto[] = []
  if (!antes.editorOculto && despues.editorOculto) van.push('.editor-area')
  if (!antes.dbAreaOculta && despues.dbAreaOculta) van.push('.db-area')
  if ((!antes.cc.hidden && despues.cc.hidden) || (antes.agente === 'terminal' && despues.agente !== 'terminal')) van.push('.right-panel')
  if (antes.franja.gitlog && !despues.franja.gitlog) van.push('.git-log-panel')
  if (antes.franja.terminalVisible && !despues.franja.terminalVisible) van.push('.terminal-panel')
  return van
}

/**
 * Cómo se anima un cambio de reparto: `apertura` si aparece una zona; `cierre` si solo se van zonas (las
 * que se van, `zonasQueSeVan`, se funden en su sitio mientras las demás viajan al suyo); `null` sin cambio o
 * al cambiar de contexto, que es instantáneo.
 */
export function tipoDeCambio(
  antes: SalidaLayoutCentro,
  despues: SalidaLayoutCentro,
  contextoAntes: string,
  contextoDespues: string
): 'apertura' | 'cierre' | null {
  if (contextoAntes !== contextoDespues || firmaLayout(antes) === firmaLayout(despues)) return null
  return apareceAlgo(antes, despues) ? 'apertura' : 'cierre'
}

