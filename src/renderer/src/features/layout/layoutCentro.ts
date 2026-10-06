// =============================================================================
// layoutCentro: qué se ve en el centro de la ventana, en una sola función pura.
// Deriva de la vista, el mosaico, las pestañas del editor y el estado del agente qué
// se oculta, qué crece, qué divisor se monta y qué dice la barra de estado; cuándo vale la
// franja inferior (Git·Log o la terminal) a pantalla completa y si ahí la columna y el conmutador
// de la barra son del agente de la terminal (lo esconde y lo coloca el CSS de `.shell`, sin
// desmontar nada), y qué hacen ahí las aperturas en el editor que pide Git. Sin JSX, sin DOM y
// sin imports: lo prueba `test-layout-centro.mts` con `node`.
// Decisiones: docs/decisiones/layout/oculto-manda-sobre-maximizado.md, docs/decisiones/agentes/agente-de-la-terminal.md
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
  /**
   * Panel de la franja PEDIDO a pantalla completa (el crudo del store); aquí se corrige con
   * `pantallaCompletaCoherente`. Ausente = ninguno.
   */
  pantallaCompletaPedida?: PanelInferiorCentro | null
  /** Preferencia del perfil: el usuario pidió ver el agente de la terminal a pantalla completa. */
  agenteTerminalVisible?: boolean
  /** El agente de la terminal del perfil está preparado (su carpeta conocida y sus targets montados). */
  agenteTerminalAbierto?: boolean
}

export interface SalidaLayoutCentro {
  /** `.editor-area` oculta entera (display:none). */
  editorOculto: boolean
  /** `.db-area` oculta entera (display:none). */
  dbAreaOculta: boolean
  cc: { hidden: boolean; grow: boolean; canExpand: boolean }
  /** Qué divisor vertical se monta junto a la columna del agente, si alguno. */
  divisorAgente: 'editor' | 'db' | 'terminal' | null
  /** De quién es la columna del agente: del proyecto, del espacio de datos, de la terminal o de nadie. */
  agente: 'proyecto' | 'espacio' | 'terminal' | null
  franja: { divisor: boolean; gitlog: boolean; terminalVisible: boolean }
  barraEstado: {
    ccVisible: boolean
    /** Por qué el conmutador no se puede pulsar, o null si se puede. */
    razonBloqueo: string | null
    /**
     * Qué hace el conmutador: la columna de siempre, el agente de datos o el de la terminal (a pantalla
     * completa de la terminal y con perfil gobierna el agente de la terminal, también para mostrarlo).
     */
    accion: 'cc' | 'agente-db' | 'agente-terminal'
  }
}

export const RAZON_SIN_ARCHIVO = 'Abre un archivo para poder ocultar la columna del agente'
export const RAZON_VISTA_DIVIDIDA =
  'En vista dividida la columna del agente se esconde para dejar sitio a los dos paneles. Cambia el modo del archivo para recuperarla.'
export const RAZON_MOSAICO =
  'En el mosaico de agentes las terminales ocupan toda la ventana. Sal del mosaico para ocultar la columna.'
export const RAZON_SIN_PERFIL_DB = 'Abre un perfil para usar el agente de datos'
export const RAZON_GITLOG_PANTALLA_COMPLETA =
  'A pantalla completa de Git no hay columna del agente. Pulsa Restaurar en el panel para volver a verla.'

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

/**
 * El valor COHERENTE de la franja a pantalla completa: el panel pedido solo vive mientras
 * ESE panel está A LA VISTA en la franja. Cerrarlo, cambiarlo por el otro, ir a 'db', entrar
 * en el mosaico o pasar a un perfil que no lo enseña lo apaga, y al volver el panel se abre
 * en la franja. Nunca lo enciende y es un punto fijo, así que se puede aplicar en cada render.
 */
export function pantallaCompletaCoherente(e: {
  pedida: PanelInferiorCentro | null
  franja: Pick<SalidaLayoutCentro['franja'], 'gitlog' | 'terminalVisible'>
  mosaico: boolean
}): PanelInferiorCentro | null {
  if (e.pedida === null || e.mosaico) return null
  const aLaVista = e.pedida === 'gitlog' ? e.franja.gitlog : e.franja.terminalVisible
  return aLaVista ? e.pedida : null
}

/**
 * Qué hace una apertura en el EDITOR pedida desde Git·Log; `pantallaCompleta` es la de
 * Git·Log. Fuera de ella, todas abren y nada más (lo de siempre). Dentro, el editor está
 * tapado: un gesto explícito (`'manual'`) sale del modo y abre; la vista previa al moverse
 * (`'auto'`) no hace nada, ni abre ni sale, así que al restaurar no queda nada abierto por ella.
 */
export function aperturaDesdeGit(e: { origen: 'manual' | 'auto'; pantallaCompleta: boolean }): {
  abrir: boolean
  salirDePantallaCompleta: boolean
} {
  if (!e.pantallaCompleta) return { abrir: true, salirDePantallaCompleta: false }
  const manual = e.origen === 'manual'
  return { abrir: manual, salirDePantallaCompleta: manual }
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

/**
 * ¿Es del agente de la terminal el conmutador de la barra de estado? Con la TERMINAL a pantalla completa
 * (la coherente: nunca con Git·Log, en 'db' ni en el mosaico) y con perfil, lo tenga a la vista o no:
 * ahí la columna del proyecto está tapada y alternarla no se vería.
 */
function conmutadorDelAgenteTerminal(e: EntradaLayoutCentro, franja: SalidaLayoutCentro['franja']): boolean {
  if (!e.hayPerfil) return false
  return pantallaCompletaCoherente({ pedida: e.pantallaCompletaPedida ?? null, franja, mosaico: e.mosaico }) === 'terminal'
}

/** El conmutador del agente de la terminal: pulsado si está pedido, y pulsable siempre (también para mostrarlo). */
function barraDelAgenteTerminal(pedido: boolean): SalidaLayoutCentro['barraEstado'] {
  return { ccVisible: pedido, razonBloqueo: null, accion: 'agente-terminal' }
}

/**
 * La columna con el agente de la terminal: se ve sin crecer ni maximizarse, con su divisor y con el
 * conmutador de la barra para ocultarlo. Lo demás (editor, área de BD, franja) no cambia: el CSS de
 * `.shell` lo esconde sin desmontarlo.
 */
function conAgenteTerminal(s: SalidaLayoutCentro): SalidaLayoutCentro {
  return {
    ...s,
    cc: { hidden: false, grow: false, canExpand: false },
    divisorAgente: 'terminal',
    agente: 'terminal',
    barraEstado: barraDelAgenteTerminal(true)
  }
}

/**
 * Lo del agente de la terminal sobre la salida de siempre. Con el conmutador suyo, el agente pedido Y
 * preparado ocupa la columna; si no (oculto o preparándose) solo cambia la barra: la columna sigue siendo
 * la de siempre, tapada por el CSS, y el conmutador es el que lo muestra.
 */
function conTerminalAPantallaCompleta(e: EntradaLayoutCentro, s: SalidaLayoutCentro): SalidaLayoutCentro {
  if (!conmutadorDelAgenteTerminal(e, s.franja)) return s
  const pedido = e.agenteTerminalVisible === true
  if (pedido && e.agenteTerminalAbierto === true) return conAgenteTerminal(s)
  return { ...s, barraEstado: barraDelAgenteTerminal(pedido) }
}

/**
 * Con Git·Log a pantalla completa (la coherente) la columna del proyecto está tapada y alternarla no se
 * vería: el conmutador se desactiva con su motivo. El atajo no lo gobierna ahí (solo actúa en 'db' y con la
 * terminal a pantalla completa), así que tampoco hace nada invisible.
 */
function conGitLogAPantallaCompleta(e: EntradaLayoutCentro, s: SalidaLayoutCentro): SalidaLayoutCentro {
  const coherente = pantallaCompletaCoherente({ pedida: e.pantallaCompletaPedida ?? null, franja: s.franja, mosaico: e.mosaico })
  if (coherente !== 'gitlog') return s
  return { ...s, barraEstado: { ...s.barraEstado, razonBloqueo: RAZON_GITLOG_PANTALLA_COMPLETA } }
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

  const salida: SalidaLayoutCentro = {
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
  return conGitLogAPantallaCompleta(e, conTerminalAPantallaCompleta(e, salida))
}
