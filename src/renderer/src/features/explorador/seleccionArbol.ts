// =============================================================================
// Selección múltiple del explorador (Ctrl+clic, Mayús+clic): decide, sin mirar el DOM,
// qué queda seleccionado, qué se poda al refrescar y qué rutas se mandan al main.
// Sin React ni DOM, para probarlo con `node` (test-seleccion-arbol.mts): por eso los
// imports de valor llevan extensión explícita.
// Decisiones: docs/decisiones/explorador/seleccion-multiple-del-arbol.md
// =============================================================================

import { esDescendiente, esRutaVirtual, padreDeRuta, tocaContenedor } from '../../../../shared/jarPath.ts'
import { parentDir } from './posixPath.ts'
import type { FlatRow } from './treeFlatten.ts'

/** Fila de nodo del árbol aplanado (la única que se puede seleccionar). */
export type FilaNodo = Extract<FlatRow, { kind: 'node' }>

export interface EstadoSeleccion {
  /** Claves de FILA seleccionadas (`row.key`), no rutas movibles. Ver la cabecera. */
  claves: ReadonlySet<string>
  /**
   * Dónde empieza un rango de Shift. La mueven el clic normal y el Ctrl+clic; el
   * Shift NO, que es lo que permite ampliar y reducir el mismo rango a voluntad.
   */
  ancla: string | null
  /**
   * Última fila tocada. Es el destino de Ctrl+V y la que lleva el contorno de
   * "líder". Sustituye al viejo `focused` del Sidebar, que hacía este papel pero
   * era INVISIBLE: el usuario no tenía forma de saber dónde iba a pegar.
   */
  lider: string | null
}

export const SELECCION_VACIA: EstadoSeleccion = { claves: new Set(), ancla: null, lider: null }

/** Modificadores del clic. `mod` es Ctrl en Windows y ⌘ en Mac (ver `util/atajos`). */
export interface ModificadoresClic {
  mod: boolean
  shift: boolean
}

// -----------------------------------------------------------------------------
// Clics
// -----------------------------------------------------------------------------

/**
 * Estado tras un clic sobre `clave`. `claves` es la lista de claves de las filas de
 * NODO en orden de pintado (los placeholders "cargando…"/"(vacío)"/"error" quedan
 * fuera: un rango no puede incluirlos, y seleccionarlos no significaría nada).
 *
 *   ninguno    -> reemplaza por {clave}; mueve ancla y líder
 *   mod        -> alterna clave;         mueve ancla y líder
 *   shift      -> REEMPLAZA por el rango [ancla…clave]; el ancla NO se mueve
 *   mod+shift  -> AÑADE el rango [ancla…clave];         el ancla NO se mueve
 *
 * Sin ancla (o con un ancla que ya no existe), Shift degrada a clic normal: es lo
 * que hace cualquier explorador y evita el caso "no pasa nada" sin explicación.
 */
export function resolverClic(
  estado: EstadoSeleccion,
  claves: readonly string[],
  clave: string,
  mods: ModificadoresClic
): EstadoSeleccion {
  if (mods.shift) {
    const rango = rangoEntre(claves, estado.ancla, clave)
    if (rango === null) {
      return { claves: new Set([clave]), ancla: clave, lider: clave }
    }
    const siguientes = mods.mod ? new Set(estado.claves) : new Set<string>()
    for (const c of rango) siguientes.add(c)
    return { claves: siguientes, ancla: estado.ancla, lider: clave }
  }
  if (mods.mod) {
    const siguientes = new Set(estado.claves)
    if (siguientes.has(clave)) siguientes.delete(clave)
    else siguientes.add(clave)
    return { claves: siguientes, ancla: clave, lider: clave }
  }
  return { claves: new Set([clave]), ancla: clave, lider: clave }
}

/**
 * Claves entre `desde` y `hasta`, ambas incluidas y en cualquier dirección. `null`
 * si alguna de las dos no está en la lista (el ancla puede haber muerto en un
 * refresco, o la fila puede estar dentro de una carpeta que se colapsó).
 */
export function rangoEntre(
  claves: readonly string[],
  desde: string | null,
  hasta: string
): string[] | null {
  if (desde === null) return null
  const a = claves.indexOf(desde)
  const b = claves.indexOf(hasta)
  if (a < 0 || b < 0) return null
  return a <= b ? claves.slice(a, b + 1) : claves.slice(b, a + 1)
}

/**
 * ¿Este clic hay que aplicarlo al SOLTAR en vez de al APRETAR?
 *
 * Sí cuando es un clic sin modificadores sobre una fila que YA está en una selección
 * múltiple. No es un detalle de pulido: colapsar la selección en el `mousedown` MATA
 * el arrastre del grupo, porque para cuando corre `dragstart` ya solo queda una fila
 * seleccionada y el usuario acaba arrastrando uno de los cinco elementos que veía
 * marcados. Con el clic aplazado, soltar SIN arrastrar colapsa (comportamiento
 * normal) y arrastrar se lleva el grupo entero.
 */
export function aplazarAlSoltar(
  estado: EstadoSeleccion,
  clave: string,
  mods: ModificadoresClic
): boolean {
  return !mods.mod && !mods.shift && estado.claves.size > 1 && estado.claves.has(clave)
}

/**
 * Estado tras un clic DERECHO. Regla del repo (la misma que la vista de Cambios):
 * fila marcada -> no se toca nada, porque el menú va a actuar sobre toda la
 * selección; fila sin marcar -> la selección pasa a ser sólo ella, porque abrir un
 * menú no debe secuestrar una selección que estabas construyendo.
 */
export function resolverClicDerecho(estado: EstadoSeleccion, clave: string): EstadoSeleccion {
  if (estado.claves.has(clave)) return { ...estado, lider: clave }
  return { claves: new Set([clave]), ancla: clave, lider: clave }
}

/** Todas las filas visibles. El alcance es lo VISIBLE, nunca el proyecto entero. */
export function seleccionarTodo(claves: readonly string[]): EstadoSeleccion {
  if (claves.length === 0) return SELECCION_VACIA
  const ultima = claves[claves.length - 1]
  return { claves: new Set(claves), ancla: claves[0], lider: ultima }
}

// -----------------------------------------------------------------------------
// Ciclo de vida
// -----------------------------------------------------------------------------

/**
 * Quita lo que ya no existe. Se PODA, nunca se vacía: un refresco del watcher a
 * mitad de una selección (un build de fondo, un `npm install`) no puede borrar el
 * trabajo del usuario. Mismo patrón que `marcadas` en la vista de Cambios.
 *
 * Devuelve el MISMO objeto si no cayó nada: es lo que evita el bucle de render
 * cuando esto se llama desde un efecto que depende de las filas.
 */
export function podarSeleccion(
  estado: EstadoSeleccion,
  vivas: ReadonlySet<string>
): EstadoSeleccion {
  let cayo = false
  const siguientes = new Set<string>()
  for (const c of estado.claves) {
    if (vivas.has(c)) siguientes.add(c)
    else cayo = true
  }
  const ancla = estado.ancla !== null && vivas.has(estado.ancla) ? estado.ancla : null
  const lider = estado.lider !== null && vivas.has(estado.lider) ? estado.lider : null
  if (!cayo && ancla === estado.ancla && lider === estado.lider) return estado
  return { claves: siguientes, ancla, lider }
}

// Colapsar una carpeta no necesita función propia: sus filas salen del aplanado y
// `podarSeleccion` las quita sola. Subir la selección a la carpeta armaría un `Supr`
// destructivo (ver el ADR de cabecera).

/**
 * Quita de la selección `path` y todo lo que colgara de él. Se llama al mover,
 * renombrar o eliminar: si no, la selección seguiría apuntando a rutas muertas y el
 * siguiente gesto operaría sobre una carpeta que ya no existe — o, peor, sobre otra
 * distinta que más tarde reutilice ese nombre.
 */
export function olvidarDeSeleccion(
  estado: EstadoSeleccion,
  paths: readonly string[]
): EstadoSeleccion {
  const afectado = (c: string): boolean =>
    paths.some((p) => c === p || esDescendiente(p, c))
  const vivas = new Set<string>()
  for (const c of estado.claves) if (!afectado(c)) vivas.add(c)
  if (vivas.size === estado.claves.size) {
    const anclaViva = estado.ancla === null || !afectado(estado.ancla)
    const liderVivo = estado.lider === null || !afectado(estado.lider)
    if (anclaViva && liderVivo) return estado
  }
  return {
    claves: vivas,
    ancla: estado.ancla !== null && !afectado(estado.ancla) ? estado.ancla : null,
    lider: estado.lider !== null && !afectado(estado.lider) ? estado.lider : null
  }
}

// -----------------------------------------------------------------------------
// De claves de fila a rutas movibles
// -----------------------------------------------------------------------------

/**
 * Quita de la lista todo lo que cuelgue de otro elemento de la lista.
 *
 * Es LA función que hace que "seleccionar `src` y además `src/main/App.tsx`" mande
 * un solo origen. Sin ella el main movería `src` y después intentaría mover una ruta
 * que ya no existe, así que el todo-o-nada acabaría reventando con un ENOENT en vez
 * de con una colisión honesta.
 *
 * SUBE POR LOS ANCESTROS DE CADA RUTA en vez de compararla con las demás, y no es
 * una micro-optimización: la versión que comparaba cada ruta contra todas las
 * supervivientes era CUADRÁTICA, y esto no corre "una vez por arrastre" como decía
 * su comentario — corre en cada clic derecho, cada Ctrl+C/X, cada apertura del
 * diálogo de borrado y cada `dragstart`. Con 5 000 hermanos marcados (un Shift+clic
 * en una carpeta plana), eso son doce millones de comparaciones bloqueando el hilo
 * justo al abrir un menú. Así es O(n · profundidad), con la profundidad acotada por
 * la longitud de la ruta.
 *
 * `padreDeRuta` y no un `lastIndexOf('/')`: cruza bien la frontera '!/' de los
 * contenedores, que es donde un recorte a mano se equivoca.
 *
 * Se ordena igualmente para que la salida sea determinista y con el ancestro delante
 * de sus descendientes. Ojo con el atajo que parece equivalente y no lo es: comparar
 * sólo con el ÚLTIMO superviviente falla porque '!' (0x21) ordena ANTES que '/'
 * (0x2F), así que un fichero llamado `src!notas` se cuela entre `src` y `src/main` y
 * rompe la cadena. Subiendo por los ancestros ese caso no existe.
 */
export function minimizarPorPrefijo(rutas: readonly string[]): string[] {
  const todas = new Set(rutas)
  const salida: string[] = []
  for (const r of [...todas].sort()) {
    let padre = padreDeRuta(r)
    let tieneAncestro = false
    // El '' de la raíz corta el bucle: `padreDeRuta('x')` devuelve '' y `padreDeRuta('')`
    // también, así que sin esta condición sería infinito.
    while (padre !== '') {
      if (todas.has(padre)) {
        tieneAncestro = true
        break
      }
      padre = padreDeRuta(padre)
    }
    if (!tieneAncestro) salida.push(r)
  }
  return salida
}

/**
 * CUÁL de las dos rutas de una fila se quiere. La diferencia NO es un descuido: es
 * el contrato que el árbol ya tenía con una sola fila seleccionada.
 *
 *   'arrastre' -> el PRIMER segmento (`entry.path`): arrastrar una cadena compactada
 *                 mueve `com`, o sea la cadena entera tal como se ve.
 *   'hoja'     -> la ÚLTIMA (`leaf.path`, que además es la clave de fila): renombrar,
 *                 eliminar, cortar y copiar operan sobre la carpeta VISIBLE, la que
 *                 lleva el nombre en el que el usuario hizo clic.
 */
export type CaraDeFila = 'arrastre' | 'hoja'

/**
 * Rutas de una selección, en el orden en que se ven. Tres pasos y ninguno sobra:
 *   1) la cara pedida (ver `CaraDeFila`);
 *   2) fuera lo virtual: dentro de un .jar no se escribe;
 *   3) minimizar por prefijo.
 *
 * Las DOS caras salen de aquí a propósito. La variante 'hoja' vivía copiada en
 * `Sidebar.tsx`, y al estar en un `.tsx` era la única que los tests no podían tocar
 * — justo la que decide QUÉ se borra y QUÉ se corta. Un parámetro deja una sola
 * implementación y la mete entera en el arnés.
 */
export function rutasMovibles(
  claves: Iterable<string>,
  filaPorClave: ReadonlyMap<string, FilaNodo>,
  cara: CaraDeFila = 'arrastre'
): string[] {
  const rutas: string[] = []
  for (const c of claves) {
    const fila = filaPorClave.get(c)
    if (fila === undefined || fila.esVirtual) continue
    rutas.push(cara === 'hoja' ? fila.leaf.path : fila.entry.path)
  }
  return minimizarPorPrefijo(rutas)
}

/**
 * Rutas de la selección para las acciones que solo LEEN (hoy, «Copiar ruta»).
 *
 * A diferencia de `rutasMovibles` NO descarta lo que vive dentro de un contenedor: copiar
 * una ruta no escribe nada y la de una clase dentro de un .jar existe como localizador
 * (`absPath` compone `C:\…\x.jar!/com/A.class`). Con una selección mixta, descartarla
 * copiaría en silencio la ruta del otro archivo.
 */
export function rutasLegibles(
  claves: Iterable<string>,
  filaPorClave: ReadonlyMap<string, FilaNodo>
): string[] {
  const rutas: string[] = []
  for (const c of claves) {
    const fila = filaPorClave.get(c)
    if (fila !== undefined) rutas.push(fila.leaf.path)
  }
  return minimizarPorPrefijo(rutas)
}

// -----------------------------------------------------------------------------
// Soltar
// -----------------------------------------------------------------------------

/**
 * ¿Se puede soltar `src` DENTRO de `destDir`? Espeja la validación del main para dar
 * feedback visual al arrastrar. Era `canDropInto` en el Sidebar; se muda aquí para
 * poder probarla y para que la versión plural no la duplique.
 *
 * El DESTINO se mira con `tocaContenedor` porque sale de `parentDir(...)`: soltar
 * sobre una clase en la RAÍZ de un jar da `x.jar!`, que `esRutaVirtual` no reconoce.
 * El ORIGEN es siempre la ruta de un nodo del árbol, bien formada.
 *
 * `esDescendiente` en vez del viejo `destDir.startsWith(src + '/')`: también cruza
 * la frontera '!/' de los contenedores.
 */
export function puedeSoltar(src: string, destDir: string): boolean {
  if (rechazoDuro(src, destDir)) return false
  return destDir !== parentDir(src)
}

/**
 * La mitad NO NEGOCIABLE de la validación: lo que hace ilegal el movimiento se
 * acompañe de lo que se acompañe (sin origen, contenedores de por medio, soltar
 * sobre uno mismo o dentro de un descendiente). Separado del no-op a propósito,
 * porque la versión plural trata las dos mitades de forma distinta.
 */
function rechazoDuro(src: string, destDir: string): boolean {
  if (!src) return true
  if (tocaContenedor(destDir) || esRutaVirtual(src)) return true
  if (destDir === src) return true
  return esDescendiente(src, destDir)
}

/**
 * Orígenes que de verdad hay que mover a `destDir`: descarta los que YA viven ahí.
 * Estar en el destino es un NO-OP, no un error, y por eso no invalida el gesto —
 * arrastrar A+B sobre la carpeta donde A ya está tiene que mover B.
 */
export function origenesAMover(srcs: readonly string[], destDir: string): string[] {
  return srcs.filter((s) => s !== '' && parentDir(s) !== destDir)
}

/**
 * ¿Se habilita el drop de TODA la selección en `destDir`?
 *
 * Asimetría deliberada frente a `origenesAMover`: un rechazo DURO de UN SOLO origen
 * (ciclo, ruta virtual, contenedor como destino) tumba el gesto entero —mover `src`
 * dentro de `src/main` es ilegal se acompañe de lo que se acompañe—, mientras que un
 * no-op sólo se descarta. Si tras descartarlos no queda nada, tampoco se habilita:
 * encender la carpeta para no mover nada es prometer en falso.
 */
export function puedeSoltarN(srcs: readonly string[], destDir: string): boolean {
  if (srcs.length === 0) return false
  for (const s of srcs) if (rechazoDuro(s, destDir)) return false
  return origenesAMover(srcs, destDir).length > 0
}

/**
 * Efecto del cursor al sobrevolar una fila (`dragover`), o null si no se acepta el drop.
 * Manda el arrastre propio sobre los archivos del sistema: con varios archivos el gesto
 * es nativo aunque nazca en el árbol y trae `Files`, pero sigue siendo un movimiento.
 * Dentro de un contenedor (`esVirtual`) no se escribe nada.
 */
export function efectoDeDragOver(p: {
  esVirtual: boolean
  arrastrados: readonly string[]
  destino: string
  externo: boolean
}): 'move' | 'copy' | null {
  if (p.esVirtual) return null
  if (p.arrastrados.length > 0) return puedeSoltarN(p.arrastrados, p.destino) ? 'move' : null
  return p.externo ? 'copy' : null
}

// -----------------------------------------------------------------------------
// Fantasma de arrastre (parte pura)
// -----------------------------------------------------------------------------

/** Una línea del fantasma: lo justo para pintarla sin conocer el árbol. */
export interface ElementoFantasma {
  nombre: string
  isDir: boolean
}

/**
 * Qué líneas pinta el fantasma de arrastre y cuántas se quedan fuera.
 *
 * El tope no es cosmético: con 4 000 archivos seleccionados la imagen de arrastre
 * sería más alta que la pantalla, y Chromium la escala hasta dejarla ilegible.
 */
export function lineasFantasma(
  elementos: readonly ElementoFantasma[],
  tope = 7
): { lineas: ElementoFantasma[]; resto: number } {
  if (elementos.length <= tope) return { lineas: [...elementos], resto: 0 }
  return { lineas: elementos.slice(0, tope), resto: elementos.length - tope }
}

/**
 * Geometría del fantasma cuando hay que DIBUJARLO en un canvas (el arrastre nativo
 * hacia el sistema, que necesita una imagen y no un nodo del DOM).
 *
 * Vive aquí, con `lineasFantasma`, para que las dos direcciones del arrastre midan
 * con la misma regla: si algún día cambia el alto de fila o el tope de líneas, los
 * dos fantasmas cambian a la vez. Es pura aritmética y por eso se puede probar.
 */
export function medidasFantasma(
  lineas: number,
  resto: number,
  altoFila: number
): { ancho: number; alto: number; altoResto: number } {
  const altoResto = resto > 0 ? Math.round(altoFila * 0.8) : 0
  return {
    ancho: 240,
    alto: Math.round(lineas * altoFila + altoResto + 6),
    altoResto
  }
}
