// =============================================================================
// Textos de la cabecera del agente que dicen DÓNDE: el selector «Bases montadas»,
// el rótulo del historial de conversaciones y el lugar que nombra su modal. Cada
// agente se nombra por la vista donde vive: «el agente de datos», «el agente de la
// terminal»; los textos de proyecto no cambian. Lógica pura con test bajo `node`.
// Decisiones: docs/decisiones/agentes/textos-espacio-de-datos.md
// =============================================================================

/**
 * Dónde vive el agente de un pane: un proyecto, el espacio de datos (vista Bases de datos)
 * o la carpeta del agente de la terminal (a pantalla completa de la terminal).
 */
export type LugarAgente = 'proyecto' | 'datos' | 'terminal'

/** Lo que pinta el selector de montaje según dónde viva. */
export interface TextosMontajeBases {
  /** Título del popover. */
  titulo: string
  /** Rótulo emergente (`title`) del botón-icono, con el número montado. */
  rotuloBoton: string
}

/** Complemento de lugar («en …») de cada sitio; el de proyecto es el texto de siempre. */
const EN: Record<LugarAgente, string> = {
  proyecto: 'en este proyecto',
  datos: 'en el agente de datos',
  terminal: 'en el agente de la terminal'
}

/** Complemento de pertenencia («de …») de cada sitio; el de proyecto es el texto de siempre. */
const DE: Record<LugarAgente, string> = {
  proyecto: 'de este proyecto',
  datos: 'del agente de datos',
  terminal: 'del agente de la terminal'
}

/** Rótulo de la cabecera del modal en los agentes que no son de un proyecto. */
const CABECERA: Record<Exclude<LugarAgente, 'proyecto'>, string> = {
  datos: 'agente de datos',
  terminal: 'agente de la terminal'
}

/** Textos del selector según dónde vive el pane y cuántas bases tiene montadas ahora. */
export function textosMontajeBases(lugar: LugarAgente, montadas: number): TextosMontajeBases {
  const donde = EN[lugar]
  return {
    titulo: `Bases montadas ${donde}`,
    rotuloBoton: montadas > 0 ? `${montadas} base(s) montada(s) ${donde}` : `Montar bases de datos ${donde}`
  }
}

/**
 * Rótulo emergente (`title`) del botón de historial de conversaciones de la cabecera
 * del agente. El historial se filtra por la carpeta de la sesión, así que en el
 * espacio de datos son las conversaciones del agente de datos, no las de un proyecto.
 */
export function rotuloHistorialConversaciones(lugar: LugarAgente): string {
  return `Historial de conversaciones ${DE[lugar]}`
}

/** Dónde dice el modal de historial que están las conversaciones. */
export interface LugarHistorial {
  /** Rótulo de la cabecera junto al título ('' = no se pinta). */
  cabecera: string
  /** Complemento del vacío: «Aún no hay conversaciones de X <en…>». */
  enVacio: string
}

/**
 * Lugar del modal de historial. En un proyecto es el nombre de su carpeta (lo de
 * siempre: el último segmento de la ruta, o «este proyecto» si no hay). El espacio de
 * datos y el agente de la terminal viven en `<userData>/<…>/<id del perfil>`: su carpeta
 * es el ID del perfil, que no le dice nada al usuario, así que se nombran como en su vista.
 */
export function lugarHistorial(lugar: LugarAgente, projectHostPath: string): LugarHistorial {
  if (lugar !== 'proyecto') return { cabecera: CABECERA[lugar], enVacio: EN[lugar] }
  const carpeta = projectHostPath.split(/[\\/]+/).filter(Boolean).pop() ?? ''
  return { cabecera: carpeta, enVacio: `en ${carpeta || 'este proyecto'}` }
}
