// =============================================================================
// La decisión de cómo animar el reparto: las zonas entran y salen por su lado, las demás viajan a su sitio
// nuevo, y cambiar de contexto (perfil, proyecto o vista) es instantáneo. Pura.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import type { PanelInferiorCentro, SalidaLayoutCentro } from './layoutCentro.ts'

/** Lo del layout que cambia zonas de sitio o de tamaño; lo demás (la barra de estado, `puedeExpandir`) no se anima. */
export function firmaLayout(l: SalidaLayoutCentro): string {
  return [
    l.editorOculto,
    l.dbAreaOculta,
    l.cc.oculta,
    l.cc.crece,
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
 * un cierre (`tipoDeCambio`).
 */
export function apareceAlgo(antes: SalidaLayoutCentro, despues: SalidaLayoutCentro): boolean {
  return [
    antes.editorOculto && !despues.editorOculto,
    antes.dbAreaOculta && !despues.dbAreaOculta,
    antes.cc.oculta && !despues.cc.oculta,
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

/** Todas las zonas que se miden en una transición: las del reparto y el lateral, que también cambia de alto. */
export type ZonaMedida = ZonaReparto | '.panel-lateral'

/** El tamaño de una zona, o `null` si no se ve. */
export type CajaZona = { ancho: number; alto: number } | null

/** De qué lado entra y hacia cuál se va una zona; `null` en las que no se desplazan. */
export function ladoDeZona(zona: ZonaMedida): 'abajo' | 'derecha' | null {
  if (zona === '.terminal-panel' || zona === '.git-log-panel') return 'abajo'
  return zona === '.right-panel' ? 'derecha' : null
}

/** Lo que decide el reparto de la ventana: el layout del centro y el panel de la franja que se pinta maximizado. */
export interface RepartoVisto {
  disposicion: SalidaLayoutCentro
  pantalla: PanelInferiorCentro | null
  /** El agente que enseña la columna: cambia con el reparto, para no verse el nuevo antes de que empiece el movimiento. */
  columna?: string | null
}

/** Cómo se anima un cambio: su clase, las zonas que salen por su lado y las que entran por él. */
export interface CambioDeReparto {
  tipo: 'apertura' | 'cierre'
  seVan: ZonaReparto[]
  aparecen: ZonaReparto[]
  /** La franja se maximiza o se restaura: lo que va a tapar sigue a la vista hasta que llega. */
  maximiza?: true
  /** La columna del agente va pegada a la franja maximizada: entran o salen juntas, como un solo bloque, por abajo. */
  columnaConFranja?: true
  /** La terminal visible cambia entre su tamaño normal y maximizada: la lista y el agente se abren o se cierran con su borde. */
  morfa?: true
}

const ZONA_DE_PANEL: Record<PanelInferiorCentro, ZonaReparto> = { gitlog: '.git-log-panel', terminal: '.terminal-panel' }

function panelVisible(disposicion: SalidaLayoutCentro, panel: PanelInferiorCentro): boolean {
  return panel === 'gitlog' ? disposicion.franja.gitlog : disposicion.franja.terminalVisible
}

export function firmaReparto(r: RepartoVisto): string {
  return `${firmaLayout(r.disposicion)}|${r.pantalla}`
}

/**
 * Cómo se anima pasar de un reparto a otro, o `null` si es instantáneo. Al maximizar o restaurar solo se mueve la
 * franja, que crece o encoge sobre lo demás: las zonas que tapa no cuentan como zonas que aparecen o se van.
 */
export function cambioDeReparto(antes: RepartoVisto, despues: RepartoVisto, contextoAntes: string, contextoDespues: string): CambioDeReparto | null {
  if (contextoAntes !== contextoDespues || firmaReparto(antes) === firmaReparto(despues)) return null
  if (antes.pantalla !== despues.pantalla) return despues.pantalla !== null ? alMaximizar(antes, despues.disposicion, despues.pantalla) : alRestaurar(antes.disposicion, despues.disposicion, antes.pantalla as PanelInferiorCentro)
  const tipo = tipoDeCambio(antes.disposicion, despues.disposicion, contextoAntes, contextoDespues)
  if (tipo === null) return null
  return tipo === 'cierre'
    ? { tipo, seVan: zonasQueSeVan(antes.disposicion, despues.disposicion), aparecen: [] }
    : { tipo, seVan: [], aparecen: zonasQueAparecen(antes.disposicion, despues.disposicion) }
}

/** Las marcas de un cambio de maximizado: si la columna va con la franja y si la terminal cambia de forma. */
function marcasMaximizado(columnaConFranja: boolean, morfa: boolean): Pick<CambioDeReparto, 'maximiza' | 'columnaConFranja' | 'morfa'> {
  return { maximiza: true, ...(columnaConFranja ? { columnaConFranja: true as const } : {}), ...(morfa ? { morfa: true as const } : {}) }
}

/** Un panel que se pinta maximizado. El agente de la terminal va y viene con él: su columna sí se ve junto a la franja. */
function alMaximizar(antes: RepartoVisto, disposicion: SalidaLayoutCentro, panel: PanelInferiorCentro): CambioDeReparto {
  const entraAgente = antes.disposicion.agente !== 'terminal' && disposicion.agente === 'terminal'
  const seAbre = !panelVisible(antes.disposicion, panel)
  const aparecen: ZonaReparto[] = [...(seAbre ? [ZONA_DE_PANEL[panel]] : []), ...(entraAgente ? (['.right-panel'] as const) : [])]
  return { tipo: 'apertura', seVan: [], aparecen, ...marcasMaximizado(seAbre && entraAgente, !seAbre && panel === 'terminal') }
}

/** Un panel que deja de pintarse maximizado, porque se restaura o porque se oculta. */
function alRestaurar(antes: SalidaLayoutCentro, despues: SalidaLayoutCentro, maximizado: PanelInferiorCentro): CambioDeReparto {
  const otro: PanelInferiorCentro = maximizado === 'gitlog' ? 'terminal' : 'gitlog'
  const aparecen = panelVisible(despues, otro) && !panelVisible(antes, otro) ? [ZONA_DE_PANEL[otro]] : []
  const saleAgente = antes.agente === 'terminal' && despues.agente !== 'terminal'
  const saleFranja = !panelVisible(despues, maximizado)
  const seVan: ZonaReparto[] = [...(saleFranja ? [ZONA_DE_PANEL[maximizado]] : []), ...(saleAgente ? (['.right-panel'] as const) : [])]
  return { tipo: 'cierre', seVan, aparecen, ...marcasMaximizado(saleFranja && saleAgente, !saleFranja && maximizado === 'terminal') }
}

/**
 * ¿El texto de esta zona cambia de sitio entre sus dos capturas? La terminal se vuelve a partir o enseña otras líneas,
 * y dos textos distintos fundiéndose se leen como uno ilegible: el nuevo sustituye al viejo al terminar el movimiento.
 */
export function cambiaElTexto(zona: ZonaMedida, antes: CajaZona, despues: CajaZona): boolean {
  if (antes === null || despues === null) return false
  return zona === '.terminal-panel' || (zona === '.right-panel' && despues.ancho !== antes.ancho)
}

/**
 * ¿La zona enseña su captura vieja mientras viaja? Al encoger es la que tiene contenido hasta el borde que se
 * mueve, porque la nueva acaba antes y dejaría un hueco. En una zona con terminal que cambia de ancho, también al
 * crecer: la nueva se está volviendo a partir mientras tanto, y entra con un fundido cuando ya está lista.
 */
export function conservaCaptura(zona: ZonaMedida, antes: CajaZona, despues: CajaZona): boolean {
  if (antes === null || despues === null) return false
  if (despues.ancho < antes.ancho || despues.alto < antes.alto) return true
  return (zona === '.right-panel' || zona === '.terminal-panel') && despues.ancho !== antes.ancho
}

/**
 * Las zonas que se van en un cambio de reparto. La columna del agente sigue en la página aunque se cierre o
 * se oculte el de la terminal (cambia de contenido), así que se dice aquí y no se deduce del DOM.
 */
export function zonasQueSeVan(antes: SalidaLayoutCentro, despues: SalidaLayoutCentro): ZonaReparto[] {
  const van: ZonaReparto[] = []
  if (!antes.editorOculto && despues.editorOculto) van.push('.editor-area')
  if (!antes.dbAreaOculta && despues.dbAreaOculta) van.push('.db-area')
  if ((!antes.cc.oculta && despues.cc.oculta) || (antes.agente === 'terminal' && despues.agente !== 'terminal')) van.push('.right-panel')
  if (antes.franja.gitlog && !despues.franja.gitlog) van.push('.git-log-panel')
  if (antes.franja.terminalVisible && !despues.franja.terminalVisible) van.push('.terminal-panel')
  return van
}

/**
 * Las zonas que aparecen y se desplazan al entrar. Se dice aquí y no se deduce del tamaño: a pantalla completa, la
 * columna del agente tiene caja detrás de la terminal aunque no se vea.
 */
export function zonasQueAparecen(antes: SalidaLayoutCentro, despues: SalidaLayoutCentro): ZonaReparto[] {
  const entran: ZonaReparto[] = []
  if ((antes.cc.oculta && !despues.cc.oculta) || (antes.agente !== 'terminal' && despues.agente === 'terminal')) entran.push('.right-panel')
  if (!antes.franja.gitlog && despues.franja.gitlog) entran.push('.git-log-panel')
  if (!antes.franja.terminalVisible && despues.franja.terminalVisible) entran.push('.terminal-panel')
  return entran
}

/**
 * Cómo se anima un cambio de reparto: `apertura` si aparece una zona; `cierre` si solo se van zonas (las
 * que se van, `zonasQueSeVan`, salen por su lado mientras las demás viajan al suyo); `null` sin cambio o
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

