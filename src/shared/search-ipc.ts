// =============================================================================
// Contrato IPC de la búsqueda en archivos (Ctrl+Shift+F). Va aparte de `files:*` porque
// es un barrido con vida propia: arranca, emite resultados a chorros y se cancela.
// La petición no lleva carpeta (el ámbito es el proyecto activo) y las rutas que vuelven
// son POSIX relativas a la contenedora, quizá virtuales (`lib/x.jar!/com/A.class`).
// invoke (renderer -> main): START, CANCEL; send (main -> renderer): RESULTS, DONE.
// Decisiones: docs/decisiones/busqueda/busqueda-en-archivos.md
// =============================================================================

import type { OpcionesBusqueda } from './textSearch'

export const SEARCH_CHANNELS = {
  /** invoke: arranca una búsqueda (cancela la anterior). IniciarBusqueda -> BusquedaAceptada. */
  START: 'search:start',
  /** invoke: el árbol de CARPETAS de los proyectos abiertos. CarpetasRequest -> CarpetasResult. */
  CARPETAS: 'search:carpetas',
  /** invoke: cancela una búsqueda por su id. CancelarBusqueda -> void. */
  CANCEL: 'search:cancel',
  /** send (main -> renderer): un lote de coincidencias. LoteResultados. */
  RESULTS: 'search:results',
  /** send (main -> renderer): la búsqueda terminó (o se canceló, o falló). FinBusqueda. */
  DONE: 'search:done'
} as const

/**
 * Dónde se busca. Son los dos ámbitos que se pidieron —todo el proyecto o una
 * carpeta suya— y ninguno más: fuera quedan los módulos y los ámbitos con nombre, y
 * fuera queda también elegir cualquier carpeta del equipo.
 *
 * SIEMPRE DENTRO DEL PROYECTO ACTIVO, y esa es la razón de que `carpeta` sea una
 * ruta RELATIVA y no lleve proyecto: el main tiene UNA sola raíz de archivos, la
 * de la pestaña activa (ver `FileService.root`). Elegir una carpeta de OTRO
 * proyecto abierto es, por tanto, activar ese proyecto primero —lo hace el
 * renderer, igual que si se hubiera pulsado su pestaña— y buscar después. Se
 * descartó pasar la raíz del otro proyecto por aquí: haría que las rutas de los
 * resultados fueran relativas a una raíz que NO es la activa, y entonces ni la
 * vista previa ni "Abrir en el editor" —que resuelven contra la activa— podrían
 * abrir lo encontrado.
 */
export type AmbitoBusqueda =
  /** Todo el proyecto activo, carpetas y subcarpetas. Es el de siempre. */
  | { tipo: 'proyecto' }
  /**
   * Solo una carpeta del proyecto activo y lo que cuelgue de ella.
   * Ruta RELATIVA POSIX; `''` significaría la raíz, o sea lo mismo que 'proyecto'.
   */
  | { tipo: 'carpeta'; carpeta: string }

/** Lo que se pide. La carpeta, si la hay, es relativa al proyecto ACTIVO. */
export interface IniciarBusqueda {
  /** Lo que se busca. Vacío = no se arranca nada. */
  query: string
  /** Mayúsculas / palabra completa / regex. Mismo tipo que los otros buscadores. */
  opts: OpcionesBusqueda
  /** Todo el proyecto, o una sola carpeta suya. */
  ambito: AmbitoBusqueda
}

/**
 * Un proyecto abierto del que se quieren listar las carpetas.
 *
 * `raiz` es una ruta HOST, y es la ÚNICA de todo este contrato: no es una ruta de
 * archivo, es el identificador de un proyecto abierto, exactamente el mismo valor
 * que el renderer ya manda en `workspace:setFilesRoot` para anclar el explorador.
 * La invariante de "el renderer no envía rutas de Windows" habla de las rutas
 * DENTRO del proyecto, que siguen siendo relativas también aquí.
 */
export interface ProyectoBuscable {
  /** Nombre de la pestaña, para el encabezado de su grupo en la lista. */
  nombre: string
  /** Ruta host de la contenedora del proyecto. */
  raiz: string
}

/** Una carpeta del árbol, ya lista para pintar una fila sangrada. */
export interface CarpetaBuscable {
  /** Ruta RELATIVA POSIX a la raíz de su proyecto. Nunca ''. */
  path: string
  /** Último tramo, que es lo que se lee en la fila. */
  nombre: string
  /** 0 = hija directa de la raíz. Es la sangría. */
  profundidad: number
}

export interface CarpetasRequest {
  proyectos: ProyectoBuscable[]
}

/** Las carpetas de cada proyecto, en el MISMO orden en que se pidieron. */
export interface CarpetasResult {
  proyectos: {
    nombre: string
    raiz: string
    carpetas: CarpetaBuscable[]
    /** Se alcanzó el tope y hay carpetas sin listar. */
    truncado: boolean
    /** Motivo humano si ese proyecto no se pudo leer. El resto SÍ se devuelve. */
    error?: string
  }[]
}

/**
 * Respuesta del START. El `busquedaId` NO es decorativo: es lo que permite al
 * renderer DESCARTAR los lotes que no son suyos.
 *
 * Sin él hay una carrera real y silenciosa: al teclear, cada pulsación cancela la
 * búsqueda anterior, pero los mensajes que esa búsqueda ya había puesto en la cola
 * del IPC siguen llegando. Sin id, esos lotes pintarían resultados de la consulta
 * ANTERIOR debajo de los de la actual, mezclados y sin nada que lo delatara.
 */
export interface BusquedaAceptada {
  busquedaId: number
  /**
   * El fin, cuando la búsqueda TERMINA ANTES DE ARRANCAR (consulta vacía, o no hay
   * proyecto activo). Viaja en la RESPUESTA y no por el canal DONE, y eso no es
   * gusto: `DONE` es un `send` desde dentro del `handle`, así que llegaría al
   * renderer ANTES que la respuesta del invoke — es decir, antes de que el renderer
   * conozca el id con el que filtra. El fin se descartaba por no ser "suyo" y el
   * modal se quedaba en "Buscando…" para siempre. Lo que se puede contestar en la
   * respuesta no se manda por un canal aparte.
   */
  fin?: FinBusqueda
}

export interface CancelarBusqueda {
  busquedaId: number
}

/** De dónde salió una coincidencia. Gobierna qué puede prometer la fila. */
export type OrigenCoincidencia =
  /** De texto de verdad: hay línea, columna y contexto reales. */
  | 'texto'
  /**
   * Del NOMBRE del archivo, no de su contenido. No hay línea: `texto` es la RUTA
   * del archivo, con el resaltado sobre el tramo del nombre que casó, porque lo
   * que se quiere ver al buscar un archivo por su nombre es DÓNDE está.
   *
   * Se añadió después de usar la búsqueda de verdad: buscar "FileService.ts"
   * encontraba las cinco referencias en otros archivos y NO el archivo, que es
   * justo lo que se estaba buscando. Al principio se decidió lo contrario —solo
   * contenido— y el uso real lo desmintió.
   */
  | 'archivo'
  /**
   * De una constante del POOL de un .class (nombre de clase, de método, de campo,
   * o un literal de cadena). NO hay número de línea y no se inventa uno: el pool de
   * constantes no tiene líneas. `texto` es la constante que casó.
   */
  | 'clase'

/** Una coincidencia, ya lista para pintar una fila. */
export interface CoincidenciaArchivo {
  /**
   * Ruta RELATIVA a la contenedora del proyecto, POSIX. Puede ser VIRTUAL si la
   * coincidencia está dentro de un contenedor ("lib/x.jar!/com/A.class").
   */
  path: string
  /** Basename, para la columna derecha de la fila (evita recalcularlo por fila). */
  nombre: string
  /** Línea 1-based. **0 = sin línea** (`origen` 'clase' o 'archivo'). */
  linea: number
  /** Columna 1-based DENTRO de `texto` (que puede venir recortado por la izquierda). */
  columna: number
  /**
   * Columna 1-based en la LÍNEA REAL del archivo. **0 cuando no aplica**, que son
   * los dos orígenes sin línea: 'clase' (el pool de constantes no está en ningún
   * sitio del código) y 'archivo' (lo que casó es el nombre, no el contenido).
   *
   * Va aparte de `columna` porque las dos son distintas y confundirlas deja el
   * cursor donde no es: `texto` viene sin la sangría de la izquierda y puede venir
   * recortado con "…", así que su columna es la del TEXTO QUE SE PINTA. `columna`
   * es para el resaltado de la fila; ésta, para "Abrir en el editor".
   */
  columnaArchivo: number
  /** Largo de la coincidencia, en caracteres de `texto`. */
  longitud: number
  /**
   * Lo que se pinta a la izquierda de la fila, según el origen: la LÍNEA recortada
   * ('texto'), la CONSTANTE del pool ('clase') o la RUTA del archivo ('archivo',
   * recortada por el MEDIO para conservar la carpeta y el nombre). Nunca lleva
   * saltos de línea.
   */
  texto: string
  origen: OrigenCoincidencia
}

/** Un lote de coincidencias de la búsqueda `busquedaId`. */
export interface LoteResultados {
  busquedaId: number
  coincidencias: CoincidenciaArchivo[]
}

/** La búsqueda terminó. Llega SIEMPRE, también al cancelar y al fallar. */
export interface FinBusqueda {
  busquedaId: number
  /** Coincidencias emitidas en total (la suma de los lotes). */
  totalCoincidencias: number
  /** Archivos DISTINTOS con al menos una coincidencia. */
  archivos: number
  /**
   * true si se alcanzó el tope y hay más coincidencias sin emitir. El contador de
   * la UI dice "N+" para no MENTIR sobre el total: nada de truncar en silencio.
   */
  truncado: boolean
  /** true si terminó porque llegó otra búsqueda o se cerró el modal. */
  cancelado: boolean
  /** Mensaje humano si el barrido falló entero (sin proyecto activo, etc.). */
  error?: string
}
