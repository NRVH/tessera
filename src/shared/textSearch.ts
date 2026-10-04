// =============================================================================
// Buscar texto: la parte que no toca el DOM (construir la expresión, recorrer sin colgarse,
// mover el índice y `mapearRango`, que traduce un desplazamiento a nodo y posición).
// En `shared` porque la usan el buscador del editor y la búsqueda en archivos del main, y
// así corre bajo `node` y se prueba. La capa del DOM (`features/editor/domSearch.ts`) se
// queda fina, sin decisiones. Se busca sobre el texto ya concatenado que arma quien llama.
// =============================================================================

export interface OpcionesBusqueda {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/** Una coincidencia como [inicio, fin) sobre el texto concatenado. */
export interface Coincidencia {
  inicio: number
  fin: number
}

/**
 * Tope de coincidencias. Un documento largo con una query de una letra puede dar
 * decenas de miles: resaltarlas todas no ayuda a nadie y sí cuesta. Se para aquí y
 * el contador dice "N+" para no MENTIR sobre el total (nada de truncar en silencio).
 */
export const MAX_COINCIDENCIAS = 5000

/** ¿El patrón compila? Con regex a medio teclear ('(', '[', '\') no compila. */
export function esRegexValida(patron: string): boolean {
  try {
    new RegExp(patron)
    return true
  } catch {
    return false
  }
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * La expresión con la que se busca, o null si no hay nada que buscar (query vacía o
 * patrón a medio teclear).
 *
 * ESTÁ SEPARADA DE `buscarCoincidencias` PORQUE COMPILAR NO ES GRATIS y hay un
 * llamador que busca LÍNEA A LÍNEA sobre un archivo entero (la vista previa de la
 * búsqueda, que resalta todas las coincidencias del archivo): con la compilación
 * dentro, un .java generado de 2 MiB costaba decenas de miles de `new RegExp` por
 * cada pulsación de flecha, en el hilo de pintado. Compilar una vez y recorrer con
 * `coincidenciasCon` es el mismo criterio con un `new RegExp` en total.
 */
export function compilarBusqueda(query: string, opts: OpcionesBusqueda): RegExp | null {
  if (!query) return null

  const fuente = opts.regex ? query : escaparRegex(query)
  // \b se ancla a [A-Za-z0-9_], así que "palabra completa" con un patrón que empieza
  // o acaba en símbolo no casaría nunca; se aplica igual que en el buscador de la
  // terminal (mismo comportamiento en los dos sitios) y se deja al usuario decidir.
  const patron = opts.wholeWord ? `\\b(?:${fuente})\\b` : fuente
  if (!esRegexValida(patron)) return null

  return new RegExp(patron, opts.caseSensitive ? 'g' : 'gi')
}

/**
 * Todas las coincidencias de una expresión YA COMPILADA, en orden.
 *
 * `lastIndex` se pone a cero al entrar: la expresión es reutilizable entre llamadas
 * y una `g` conserva dónde se quedó. Sin esto, la segunda línea empezaría a buscar
 * donde acabó la primera y se saltaría coincidencias sin dar ningún síntoma.
 */
export function coincidenciasCon(texto: string, re: RegExp): Coincidencia[] {
  re.lastIndex = 0
  const fuera: Coincidencia[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) {
    // Una coincidencia VACÍA (p. ej. la regex `a*` sobre "bbb") no avanza lastIndex:
    // sin este empujón el while no termina nunca y se cuelga el renderer.
    if (m[0].length === 0) {
      re.lastIndex += 1
      continue
    }
    fuera.push({ inicio: m.index, fin: m.index + m[0].length })
    if (fuera.length >= MAX_COINCIDENCIAS) break
  }
  return fuera
}

/**
 * Todas las coincidencias de `query` en `texto`, en orden.
 * Query vacía o patrón inválido -> [] (no es un error: es "aún no hay nada que buscar").
 */
export function buscarCoincidencias(
  texto: string,
  query: string,
  opts: OpcionesBusqueda
): Coincidencia[] {
  const re = compilarBusqueda(query, opts)
  return re === null ? [] : coincidenciasCon(texto, re)
}

/**
 * Siguiente índice al navegar, circular. `actual` -1 = todavía ninguna elegida:
 * 'next' lleva a la primera y 'prev' a la última (como los buscadores de los editores).
 * Sin coincidencias devuelve -1.
 */
export function moverIndice(total: number, actual: number, dir: 'next' | 'prev'): number {
  if (total <= 0) return -1
  if (actual < 0) return dir === 'next' ? 0 : total - 1
  return dir === 'next' ? (actual + 1) % total : (actual - 1 + total) % total
}

/** Dónde cae un [inicio, fin) dentro de una lista de segmentos consecutivos. */
export interface PosicionEnSegmentos {
  iSegIni: number
  offIni: number
  iSegFin: number
  offFin: number
}

/**
 * Traduce un rango del texto concatenado a (segmento, desplazamiento) de inicio y
 * de fin — que es justo lo que necesita `Range.setStart/setEnd` con nodos de texto.
 *
 * `segmentos` son las LONGITUDES de cada trozo, en el mismo orden en que se
 * concatenaron. Los segmentos VACÍOS se saltan a propósito en los dos extremos: un
 * nodo de texto sin contenido no puede alojar el borde de una selección, y
 * dejarlo entrar produce rangos que el navegador pinta de cero píxeles.
 * Devuelve null si el rango no cabe (defensivo: significa que el corpus y los
 * segmentos se desincronizaron).
 */
export function mapearRango(
  longitudes: readonly number[],
  inicio: number,
  fin: number
): PosicionEnSegmentos | null {
  if (fin <= inicio || inicio < 0) return null

  let iSegIni = -1
  let offIni = 0
  let iSegFin = -1
  let offFin = 0
  let acc = 0

  for (let i = 0; i < longitudes.length; i++) {
    const len = longitudes[i]
    if (len > 0 && iSegIni < 0 && acc + len > inicio) {
      iSegIni = i
      offIni = inicio - acc
    }
    if (len > 0 && acc + len >= fin) {
      iSegFin = i
      offFin = fin - acc
      break
    }
    acc += len
  }

  if (iSegIni < 0 || iSegFin < 0) return null
  return { iSegIni, offIni, iSegFin, offFin }
}
