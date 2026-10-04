// =============================================================================
// Densidad: el tamaño de letra de la INTERFAZ y las alturas de fila que se derivan de él.
// Una sola fuente para dos consumidores: se publica como variables CSS (`--ui-font`,
// `--ui-row-h`, `--ui-head-h`) y la lista virtual necesita el alto de fila en JS.
// Hay una base y superficies (explorador, git, bases de datos) que la heredan o fijan la suya.
// Puro, sin React ni DOM: se prueba con `node` a secas (`test-densidad.mts`).
// Decisiones: docs/decisiones/renderer/densidad-de-interfaz.md
// =============================================================================

/** Tamaño por defecto (px): la densidad habitual de las listas de archivos de los editores de código. */
export const UI_FONT_DEFAULT = 12
/** Por debajo de 9 px los iconos de 15 px dominan la fila y deja de leerse. */
export const UI_FONT_MIN = 9
/** Por encima de 18 px una ruta media ya no cabe en una columna de 260 px. */
export const UI_FONT_MAX = 18

/**
 * Tamaño efectivo: `0` (o cualquier cosa que no sea un número finito) significa
 * "el predeterminado", igual que en la apariencia de las terminales. El resto se
 * redondea y se acota.
 */
export function normalizarUiFont(n: number): number {
  if (!Number.isFinite(n) || n === 0) return UI_FONT_DEFAULT
  const entero = Math.round(n)
  return entero < UI_FONT_MIN ? UI_FONT_MIN : entero > UI_FONT_MAX ? UI_FONT_MAX : entero
}

/**
 * Alto de una fila de lista para un tamaño de letra dado: 20 px con la letra por
 * defecto de 12. No se deja al CSS (`line-height` + padding) porque el alto tiene que
 * existir en JS para la virtualización.
 */
export function altoFila(fontSize: number): number {
  return Math.round(normalizarUiFont(fontSize) * 1.7)
}

/**
 * Alto de una cabecera de subsección. Más aire que una fila porque lleva los
 * botones de acción en lote, y FIJO aunque no haya selección: si creciera al
 * aparecer los botones, el alto dependería de las marcas y el scroll saltaría al
 * marcar una casilla.
 */
export function altoCabecera(fontSize: number): number {
  return altoFila(fontSize) + 6
}

/**
 * Tamaño de los RÓTULOS DE CABECERA (Terminal, Git, Explorador, Cambios, Progreso…).
 *
 * Sale de la BASE, no de la superficie: estos rótulos son el nombre del panel (cromo),
 * no contenido. Si heredaran el tamaño de cada vista, un mismo rótulo saldría de un
 * cuerpo distinto en cada columna (hasta un 40 % de diferencia).
 *
 * Un píxel por debajo de la base, con suelo propio de 10 px: por debajo la negrita deja
 * de leerse como jerarquía.
 */
export function fontTitulo(baseFontSize: number): number {
  return Math.max(10, normalizarUiFont(baseFontSize) - 1)
}

/**
 * Tamaño efectivo de UNA superficie: `propio` si lo tiene, si no el de la base.
 *
 * `0` significa "igual que la interfaz", la misma convención que `terminalFontSize` y
 * `uiFontSize` en los ajustes: el archivo de ajustes es JSON plano que también escriben
 * versiones viejas, y un campo ausente y uno a 0 tienen que significar lo mismo.
 *
 * OJO con el orden: se resuelve ANTES de normalizar. Si se normalizara primero,
 * `normalizarUiFont(0)` daría 12 y la herencia se perdería.
 */
export function resolverTamano(base: number, propio: number): number {
  const p = Number.isFinite(propio) ? Math.round(propio) : 0
  return normalizarUiFont(p === 0 ? base : p)
}

/** ¿Esta superficie tiene tamaño propio, o sigue a la interfaz? */
export function tieneTamanoPropio(propio: number): boolean {
  return Number.isFinite(propio) && Math.round(propio) !== 0
}

/**
 * Tamaño efectivo de la VISTA DE BASES DE DATOS (árbol de conexiones, rejillas y
 * resultados), la única superficie que hereda de OTRA superficie y no de la base.
 *
 * `bd` = 0 significa «igual que el Explorador»: su árbol se pinta en la misma columna
 * lateral que el de archivos y compartían tamaño. Quien nunca lo tocó no ve cambios, y
 * en cuanto fija uno propio deja de seguir al Explorador. El stepper de Configuración
 * enseña este valor efectivo, así que el primer −/+ parte de lo que se ve.
 *
 * Es `resolverTamano` encadenado dos veces, en el orden que su comentario exige:
 * primero el Explorador sobre la base, luego la vista sobre el Explorador, y solo al
 * final se normaliza.
 */
export function resolverTamanoBd(base: number, explorador: number, bd: number): number {
  return resolverTamano(resolverTamano(base, explorador), bd)
}

// -----------------------------------------------------------------------------
// El modal de BUSCAR EN ARCHIVOS: tamaño propio y AUTOMÁTICO, derivado del ancho de la
// ventana y sin ajuste. No es una lista lateral sino una ventana de trabajo en la que se
// LEE código, y los 12 px de la base se quedan cortos. Entre 1280 px (portátil típico) y
// 2560 px (QHD) se interpola de 13 a 16 px: 13 es el suelo (por debajo se leería peor que
// el resto de la app) y 16 un escalón por encima del cuerpo de texto habitual (14 px).
// Va en JS y no en `clamp()` de CSS porque el alto de fila debe existir en JS.
// -----------------------------------------------------------------------------

/** Ventana por debajo de la cual el modal usa su letra más pequeña. */
export const BUSCAR_ANCHO_MIN = 1280
/** Ventana a partir de la cual ya no crece más. */
export const BUSCAR_ANCHO_MAX = 2560
/** Suelo: el tamaño de interfaz habitual de un escritorio. */
export const BUSCAR_FONT_MIN = 13
/** Techo: un escalón por encima del cuerpo de texto habitual (14 px). */
export const BUSCAR_FONT_MAX = 16

/**
 * Tamaño de letra del modal de búsqueda para un ancho de ventana dado.
 *
 * Se acota a los dos extremos: una ventana estrecha no baja del suelo (el modal
 * no puede leerse peor que la app) y una pantalla enorme no lo dispara.
 */
export function fontBusqueda(anchoVentana: number): number {
  if (!Number.isFinite(anchoVentana) || anchoVentana <= BUSCAR_ANCHO_MIN) return BUSCAR_FONT_MIN
  if (anchoVentana >= BUSCAR_ANCHO_MAX) return BUSCAR_FONT_MAX
  const t = (anchoVentana - BUSCAR_ANCHO_MIN) / (BUSCAR_ANCHO_MAX - BUSCAR_ANCHO_MIN)
  return Math.round(BUSCAR_FONT_MIN + t * (BUSCAR_FONT_MAX - BUSCAR_FONT_MIN))
}

/**
 * Las tres variables CSS de UNA superficie, listas para escribirse.
 *
 * Se escriben en `:root` para la base y como `style` inline en la raíz de cada
 * panel para las superficies con voz propia. Son las mismas tres claves a
 * propósito: la cascada hace el resto.
 */
export function variablesCss(fontSize: number): Record<string, string> {
  const f = normalizarUiFont(fontSize)
  return {
    '--ui-font': `${f}px`,
    '--ui-row-h': `${altoFila(f)}px`,
    '--ui-head-h': `${altoCabecera(f)}px`
  }
}
