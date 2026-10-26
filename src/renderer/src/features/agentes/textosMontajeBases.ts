// =============================================================================
// Textos de la cabecera del agente que dicen DÓNDE: el selector «Bases montadas»,
// el rótulo del historial de conversaciones y el lugar que nombra su modal. Cada
// agente se nombra por la vista donde vive: «el agente de datos», «el agente de la
// terminal»; los textos de proyecto no cambian. Lógica pura con test bajo `node`.
// Decisiones: docs/decisiones/agentes/textos-espacio-de-datos.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

/**
 * Dónde vive el agente de un pane: un proyecto, el espacio de datos (vista Bases de datos),
 * la carpeta del agente de la terminal (a pantalla completa de la terminal) o la carpeta del
 * usuario (una ventana de agente).
 */
export type LugarAgente = 'proyecto' | 'datos' | 'terminal' | 'ventana'

/** Los lugares de la ventana principal (la columna, el mosaico): todos menos la ventana de agente. */
export type LugarEnLaPrincipal = Exclude<LugarAgente, 'ventana'>

/** Lo que pinta el selector de montaje según dónde viva. */
export interface TextosMontajeBases {
  /** Título del popover. */
  titulo: string
  /** Rótulo emergente (`title`) del botón-icono, con el número montado. */
  rotuloBoton: string
}

/** Un complemento por sitio; el de proyecto es el texto de siempre. */
interface Lugares {
  proyecto: string
  datos: string
  terminal: string
  ventana: string
}

const tx = crearTextos(
  {
    /** Complemento de lugar («en …») de cada sitio. */
    en: {
      proyecto: 'en este proyecto',
      datos: 'en el agente de datos',
      terminal: 'en el agente de la terminal',
      ventana: 'en tu carpeta de usuario'
    } as Lugares,
    /** Complemento de pertenencia («de …») de cada sitio. */
    de: {
      proyecto: 'de este proyecto',
      datos: 'del agente de datos',
      terminal: 'del agente de la terminal',
      ventana: 'de tu carpeta de usuario'
    } as Lugares,
    /** Rótulo de la cabecera del modal en los agentes que no son de un proyecto. */
    cabecera: { datos: 'agente de datos', terminal: 'agente de la terminal', ventana: 'carpeta de usuario' },
    tituloBases: (donde: string) => `Bases montadas ${donde}`,
    rotuloMontadas: (n: number, donde: string) => `${n} base(s) montada(s) ${donde}`,
    rotuloMontar: (donde: string) => `Montar bases de datos ${donde}`,
    historial: (de: string) => `Historial de conversaciones ${de}`,
    enCarpeta: (carpeta: string) => `en ${carpeta || 'este proyecto'}`
  },
  {
    en: {
      proyecto: 'in this project',
      datos: 'in the data agent',
      terminal: 'in the terminal agent',
      ventana: 'in your user folder'
    },
    de: {
      proyecto: 'of this project',
      datos: 'of the data agent',
      terminal: 'of the terminal agent',
      ventana: 'of your user folder'
    },
    cabecera: { datos: 'data agent', terminal: 'terminal agent', ventana: 'user folder' },
    tituloBases: (donde: string) => `Databases mounted ${donde}`,
    rotuloMontadas: (n: number, donde: string) => `${n} database${n === 1 ? '' : 's'} mounted ${donde}`,
    rotuloMontar: (donde: string) => `Mount databases ${donde}`,
    historial: (de: string) => `Conversation history ${de}`,
    enCarpeta: (carpeta: string) => `in ${carpeta || 'this project'}`
  }
)

/** Textos del selector según dónde vive el pane y cuántas bases tiene montadas ahora. */
export function textosMontajeBases(lugar: LugarAgente, montadas: number): TextosMontajeBases {
  const t = tx()
  const donde = t.en[lugar]
  return {
    titulo: t.tituloBases(donde),
    rotuloBoton: montadas > 0 ? t.rotuloMontadas(montadas, donde) : t.rotuloMontar(donde)
  }
}

/**
 * Rótulo emergente (`title`) del botón de historial de conversaciones de la cabecera
 * del agente. El historial se filtra por la carpeta de la sesión, así que en el
 * espacio de datos son las conversaciones del agente de datos, no las de un proyecto.
 */
export function rotuloHistorialConversaciones(lugar: LugarAgente): string {
  const t = tx()
  return t.historial(t.de[lugar])
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
 * La ventana de agente, «carpeta de usuario» y no el nombre de la cuenta del sistema.
 */
export function lugarHistorial(lugar: LugarAgente, projectHostPath: string): LugarHistorial {
  const t = tx()
  if (lugar !== 'proyecto') return { cabecera: t.cabecera[lugar], enVacio: t.en[lugar] }
  const carpeta = projectHostPath.split(/[\\/]+/).filter(Boolean).pop() ?? ''
  return { cabecera: carpeta, enVacio: t.enCarpeta(carpeta) }
}
