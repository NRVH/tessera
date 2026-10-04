// =============================================================================
// arbolBdClaves — las claves de los nodos del árbol de BD: tuplas unidas por NUL con el
// tipo de nodo delante, y el ÁMBITO `base␁esquema` del nivel «Bases».
// Puro (lo cargan las pruebas con `node`); lo reexporta `arbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import type { DbParteDetalle, DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'

/** Separador de las claves: NUL, que ningún motor admite en un nombre (escrito como escape). */
export const SEP = '\u0000'

function unir(partes: readonly string[]): string {
  return partes.join(SEP)
}

/**
 * Separa la base del esquema dentro del ámbito: un carácter de control distinto de `SEP`, así
 * el ámbito sigue siendo UNA pieza de la tupla y las posiciones no cambian.
 */
const SEP_BASE = '\u0001'

/** El ámbito de un esquema en las claves: el esquema tal cual, o `base␁esquema` con nivel «Bases». */
export function ambitoEsquema(esquema: string, base?: string): string {
  return base === undefined ? esquema : `${base}${SEP_BASE}${esquema}`
}

/** Lo contrario de `ambitoEsquema`: el esquema y, si la lleva, la base. */
export function partesAmbito(ambito: string): { esquema: string; base?: string } {
  const i = ambito.indexOf(SEP_BASE)
  return i === -1 ? { esquema: ambito } : { base: ambito.slice(0, i), esquema: ambito.slice(i + 1) }
}

/** Las claves de cada tipo de nodo; `base`, cuando la hay, siempre el último argumento. */
export const claveBd = {
  conexion: (conexionId: string): string => unir(['conexion', conexionId]),
  consolas: (conexionId: string): string => unir(['consolas', conexionId]),
  consola: (conexionId: string, consolaId: string): string => unir(['consola', conexionId, consolaId]),
  /** La lista de BASES de una conexión con nivel «Bases» (`DbBasesRespuesta`). */
  bases: (conexionId: string): string => unir(['bases', conexionId]),
  /** Una base del nivel «Bases»; guarda los esquemas de ESA base. */
  base: (conexionId: string, base: string): string => unir(['base', conexionId, base]),
  esquema: (conexionId: string, esquema: string, base?: string): string =>
    unir(['esquema', conexionId, ambitoEsquema(esquema, base)]),
  carpeta: (conexionId: string, esquema: string, tipo: DbTipoObjeto, base?: string): string =>
    unir(['carpeta', conexionId, ambitoEsquema(esquema, base), tipo]),
  /** La firma (sobrecargas de PG) solo entra si existe: '' y ausente son distintas. */
  objeto: (conexionId: string, esquema: string, tipo: DbTipoObjeto, nombre: string, firma?: string, base?: string): string => {
    const ambito = ambitoEsquema(esquema, base)
    return unir(firma === undefined ? ['objeto', conexionId, ambito, tipo, nombre] : ['objeto', conexionId, ambito, tipo, nombre, firma])
  },
  detalle: (conexionId: string, esquema: string, tipo: DbTipoObjeto, nombre: string, parte: DbParteDetalle, base?: string): string =>
    unir(['detalle', conexionId, ambitoEsquema(esquema, base), tipo, nombre, parte]),
  hoja: (
    conexionId: string,
    esquema: string,
    tipo: DbTipoObjeto,
    nombre: string,
    parte: DbParteDetalle,
    hoja: string,
    base?: string
  ): string => unir(['hoja', conexionId, ambitoEsquema(esquema, base), tipo, nombre, parte, hoja]),
  /**
   * La fila de una conexión AJENA (`FilaAjena`, en `filasArbolBd`): el aplanador no la pinta,
   * pero su clave lleva el id en la misma posición, así que `conexionDeClave` y la poda por
   * conexión la tratan como a las demás. `n` es su posición entre las ajenas que comparten id
   * (1, 2…): la primera conserva la clave sin número.
   */
  ajena: (conexionId: string, n = 1): string => unir(n > 1 ? ['ajena', conexionId, String(n)] : ['ajena', conexionId]),
  /** La lista de bases de una conexión de documentos sin base fija (`DbDocBase[]`). */
  docBases: (conexionId: string): string => unir(['docBases', conexionId]),
  /** Una base de documentos; guarda SUS colecciones (también la base fija de la conexión). */
  docBase: (conexionId: string, base: string): string => unir(['docBase', conexionId, base]),
  coleccion: (conexionId: string, base: string, nombre: string): string => unir(['coleccion', conexionId, base, nombre]),
  /** Las bases numeradas de una conexión de claves (`DbKvBases`). */
  kvBases: (conexionId: string): string => unir(['kvBases', conexionId]),
  /** Una base numerada; guarda el recorrido de sus claves. */
  kvBase: (conexionId: string, indice: number): string => unir(['kvBase', conexionId, String(indice)]),
  /** Una clave, por su base64 (los bytes exactos: el texto pintado puede repetirse). */
  kvClave: (conexionId: string, indice: number, base64: string): string => unir(['kvClave', conexionId, String(indice), base64]),
  /** Una carpeta de claves, por su prefijo PINTADO con el separador (`usuario:1:`). */
  kvCarpeta: (conexionId: string, indice: number, prefijo: string): string => unir(['kvCarpeta', conexionId, String(indice), prefijo]),
  /** La fila «Cargar más claves» de una base. */
  kvMas: (conexionId: string, indice: number): string => unir(['kvMas', conexionId, String(indice)])
}

/** La conexión a la que pertenece una clave de nodo (para podar por conexión), o null. */
export function conexionDeClave(clave: string): string | null {
  const partes = clave.split(SEP)
  return partes.length >= 2 ? partes[1] : null
}

/** Si la clave es la de la fila de una consola, su id; si no, null. */
export function consolaDeClave(clave: string): string | null {
  const partes = clave.split(SEP)
  return partes.length === 3 && partes[0] === 'consola' ? partes[2] : null
}
