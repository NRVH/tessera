// =============================================================================
// Textos de la cabecera del agente que dicen DÓNDE: el selector «Bases montadas»,
// el rótulo del historial de conversaciones y el lugar que nombra su modal.
// En el agente del espacio de datos se dice «el agente de datos», no «este
// proyecto»; los textos de proyecto no cambian. Lógica pura con test bajo `node`.
// Decisiones: docs/decisiones/agentes/textos-espacio-de-datos.md
// =============================================================================

/** Lo que pinta el selector de montaje según dónde viva. */
export interface TextosMontajeBases {
  /** Título del popover. */
  titulo: string
  /** Rótulo emergente (`title`) del botón-icono, con el número montado. */
  rotuloBoton: string
}

/** Complemento de lugar en el agente de un proyecto (el texto de siempre). */
const EN_PROYECTO = 'en este proyecto'
/** Complemento de lugar en el agente del espacio de datos (vista Bases de datos). */
const EN_ESPACIO_DE_DATOS = 'en el agente de datos'
/** Complemento de pertenencia en el agente de un proyecto (el texto de siempre). */
const DE_PROYECTO = 'de este proyecto'
/** Complemento de pertenencia en el agente del espacio de datos. */
const DEL_ESPACIO_DE_DATOS = 'del agente de datos'

/**
 * Textos del selector. `esEspacioDeDatos` dice si el pane es el agente de la vista
 * Bases de datos; `montadas`, cuántas bases tiene montadas ahora.
 */
export function textosMontajeBases(esEspacioDeDatos: boolean, montadas: number): TextosMontajeBases {
  const donde = esEspacioDeDatos ? EN_ESPACIO_DE_DATOS : EN_PROYECTO
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
export function rotuloHistorialConversaciones(esEspacioDeDatos: boolean): string {
  return `Historial de conversaciones ${esEspacioDeDatos ? DEL_ESPACIO_DE_DATOS : DE_PROYECTO}`
}

/** Dónde dice el modal de historial que están las conversaciones. */
export interface LugarHistorial {
  /** Rótulo de la cabecera junto al título ('' = no se pinta). */
  cabecera: string
  /** Complemento del vacío: «Aún no hay conversaciones de X <en…>». */
  enVacio: string
}

/** Rótulo de la cabecera del modal en el agente del espacio de datos. */
const CABECERA_ESPACIO_DE_DATOS = 'agente de datos'

/**
 * Lugar del modal de historial. En un proyecto es el nombre de su carpeta (lo de
 * siempre: el último segmento de la ruta, o «este proyecto» si no hay). En el espacio
 * de datos, esa carpeta es `<userData>/conexiones/<id del perfil>`: su nombre es el ID
 * del perfil, que no le dice nada al usuario, así que se nombra como en el resto de la
 * vista: «el agente de datos».
 */
export function lugarHistorial(esEspacioDeDatos: boolean, projectHostPath: string): LugarHistorial {
  if (esEspacioDeDatos) {
    return { cabecera: CABECERA_ESPACIO_DE_DATOS, enVacio: EN_ESPACIO_DE_DATOS }
  }
  const carpeta = projectHostPath.split(/[\\/]+/).filter(Boolean).pop() ?? ''
  return { cabecera: carpeta, enVacio: `en ${carpeta || 'este proyecto'}` }
}
