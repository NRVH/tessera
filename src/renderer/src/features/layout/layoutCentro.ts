// =============================================================================
// layoutCentro: qué se ve en el centro de la ventana, en una sola función pura.
// Deriva de la vista, el mosaico, las pestañas del editor y el estado del agente qué
// se oculta, qué crece, qué divisor se monta y qué dice la barra de estado.
// Sin JSX, sin DOM y sin imports: lo prueba `test-layout-centro.mts` con `node`.
// Decisiones: docs/decisiones/layout/oculto-manda-sobre-maximizado.md
// =============================================================================

export type VistaCentro = 'files' | 'git' | 'db'
/** Mismo tipo que `PanelInferior` de ActivityBar (redeclarado para no importar un .tsx). */
export type PanelInferiorCentro = 'terminal' | 'gitlog'

export interface EntradaLayoutCentro {
  vista: VistaCentro
  /** Mosaico de agentes: independiente de la vista. */
  mosaico: boolean
  /** Hay pestañas en el editor del proyecto activo (`editorTabs.tabs.length > 0`). */
  hayPestanasEditor: boolean
  /** Agente maximizado sobre el editor (`ccExpanded`). */
  ccExpandido: boolean
  /** Columna del agente oculta por cualquier motivo: pestillo o vista dividida (`ccHidden`). */
  ccOculto: boolean
  /** El archivo activo está en vista dividida (`toggleCcBloqueado`). */
  vistaDividida: boolean
  /** Preferencia del perfil: el usuario pidió ver el agente de datos. */
  agenteDbVisible: boolean
  /** El espacio de datos del perfil está abierto (ruta conocida y sesión preparada). */
  espacioAbierto: boolean
  hayPerfil: boolean
  panelInferior: PanelInferiorCentro | null
}

export interface SalidaLayoutCentro {
  /** `.editor-area` oculta entera (display:none). */
  editorOculto: boolean
  /** `.db-area` oculta entera (display:none). */
  dbAreaOculta: boolean
  cc: { hidden: boolean; grow: boolean; canExpand: boolean }
  /** Qué divisor vertical se monta junto a la columna del agente, si alguno. */
  divisorAgente: 'editor' | 'db' | null
  /** De quién es la columna del agente: del proyecto, del espacio de datos o de nadie. */
  agente: 'proyecto' | 'espacio' | null
  franja: { divisor: boolean; gitlog: boolean; terminalVisible: boolean }
  barraEstado: {
    ccVisible: boolean
    /** Por qué el conmutador no se puede pulsar, o null si se puede. */
    razonBloqueo: string | null
    /** Qué hace el conmutador: la columna de siempre o el agente de datos. */
    accion: 'cc' | 'agente-db'
  }
}

export const RAZON_SIN_ARCHIVO = 'Abre un archivo para poder ocultar la columna del agente'
export const RAZON_VISTA_DIVIDIDA =
  'En vista dividida la columna del agente se esconde para dejar sitio a los dos paneles. Cambia el modo del archivo para recuperarla.'
export const RAZON_MOSAICO =
  'En el mosaico de agentes las terminales ocupan toda la ventana. Sal del mosaico para ocultar la columna.'
export const RAZON_SIN_PERFIL_DB = 'Abre un perfil para usar el agente de datos'

/**
 * El valor COHERENTE del maximizado del agente: el que tiene, salvo que la columna
 * esté oculta de verdad (oculta Y con pestañas), que lo cancela.
 * Nunca lo enciende y es un punto fijo, así que se puede aplicar en cada render.
 */
export function maximizadoCoherente(
  e: Pick<EntradaLayoutCentro, 'ccExpandido' | 'ccOculto' | 'hayPestanasEditor'>
): boolean {
  return e.ccExpandido && !(e.ccOculto && e.hayPestanasEditor)
}

/** Razón de bloqueo de las vistas 'files' y 'git' (la del editor). */
function razonClasicaDe(e: EntradaLayoutCentro): string | null {
  if (!e.hayPestanasEditor) return RAZON_SIN_ARCHIVO
  return e.vistaDividida ? RAZON_VISTA_DIVIDIDA : null
}

/** En 'db' el agente del espacio solo cuenta si se pidió Y el espacio está listo. */
function agenteDbListo(e: EntradaLayoutCentro): boolean {
  return e.hayPerfil && e.agenteDbVisible && e.espacioAbierto
}

/** El divisor vertical junto a la columna del agente: ninguno en el mosaico. */
function divisorAgenteDe(
  e: EntradaLayoutCentro,
  db: boolean,
  listoDb: boolean,
  ocultoEfectivo: boolean
): SalidaLayoutCentro['divisorAgente'] {
  if (e.mosaico) return null
  if (db) return listoDb ? 'db' : null
  return e.hayPestanasEditor && !e.ccExpandido && !ocultoEfectivo ? 'editor' : null
}

/** De quién es la columna del agente: en el mosaico siempre del proyecto. */
function agenteDe(e: EntradaLayoutCentro, db: boolean, listoDb: boolean): SalidaLayoutCentro['agente'] {
  if (e.mosaico || !db) return 'proyecto'
  return listoDb ? 'espacio' : null
}

/** La franja inferior no se ve en 'db'; el divisor tampoco en el mosaico. */
function franjaDe(e: EntradaLayoutCentro, db: boolean): SalidaLayoutCentro['franja'] {
  return {
    divisor: e.panelInferior !== null && !db && !e.mosaico,
    gitlog: e.panelInferior === 'gitlog' && !db,
    terminalVisible: e.panelInferior === 'terminal' && !db
  }
}

/** Por qué el conmutador de la barra de estado no se puede pulsar, o null. */
function razonBloqueoDe(e: EntradaLayoutCentro, db: boolean): string | null {
  if (e.mosaico) return RAZON_MOSAICO
  if (db) return e.hayPerfil ? null : RAZON_SIN_PERFIL_DB
  return razonClasicaDe(e)
}

/** Si la columna del agente está oculta y si crece: el mosaico la muestra y la hace crecer. */
function columnaAgenteDe(
  e: EntradaLayoutCentro,
  db: boolean,
  listoDb: boolean,
  ocultoEfectivo: boolean,
  editorOculto: boolean
): { hidden: boolean; grow: boolean } {
  if (e.mosaico) return { hidden: false, grow: true }
  if (db) return { hidden: !listoDb, grow: false }
  return { hidden: ocultoEfectivo, grow: editorOculto }
}

/** Deriva la visibilidad del centro. Pura y total: cualquier combinación de entrada vale. */
export function derivarLayoutCentro(e: EntradaLayoutCentro): SalidaLayoutCentro {
  const db = e.vista === 'db'
  const hay = e.hayPestanasEditor
  const ocultoEfectivo = e.ccOculto && hay
  // Con la columna oculta el maximizado no esconde el editor (la defensa del ADR).
  const expandidoEfectivo = maximizadoCoherente(e)
  const editorOculto = !hay || expandidoEfectivo || db || e.mosaico
  const listoDb = agenteDbListo(e)
  const columna = columnaAgenteDe(e, db, listoDb, ocultoEfectivo, editorOculto)

  return {
    editorOculto,
    dbAreaOculta: !db || e.mosaico,
    cc: { hidden: columna.hidden, grow: columna.grow, canExpand: !db && hay },
    divisorAgente: divisorAgenteDe(e, db, listoDb, ocultoEfectivo),
    agente: agenteDe(e, db, listoDb),
    franja: franjaDe(e, db),
    barraEstado: {
      ccVisible: e.mosaico || !columna.hidden,
      razonBloqueo: razonBloqueoDe(e, db),
      accion: db ? 'agente-db' : 'cc'
    }
  }
}
