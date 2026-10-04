// =============================================================================
// Interacción con el ratón del árbol: el clic sobre una fila en dos fases, el arranque
// del arrastre y los gestos sobre el espacio vacío del panel. Reciben el `Arbol` del
// render en curso; la decisión de qué queda seleccionado vive en `seleccionArbol`.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { hasExternalFiles, droppedHostPaths } from './arrastreArbol'
import { importarNodos, moverNodos } from './operacionesArbol'
import { abrirMenu } from './menuArbol'
import {
  SELECCION_VACIA,
  aplazarAlSoltar,
  puedeSoltarN,
  resolverClic,
  type ModificadoresClic
} from './seleccionArbol'
import type { Arbol } from './tiposArbol'

/**
 * Aplica el clic sobre una fila; devuelve true si además hay que activarla (abrir el
 * archivo o alternar la carpeta). Son dos fases por el arrastre de grupos: colapsar la
 * selección en el `mousedown` la mataría antes del `dragstart`. El `mousedown` nunca
 * activa: abrir al apretar iría contra el resto de la app y se comería el arrastre.
 */
export function alClicarFila(
  a: Arbol,
  clave: string,
  mods: ModificadoresClic,
  fase: 'abajo' | 'arriba'
): boolean {
  if (fase === 'abajo') {
    if (aplazarAlSoltar(a.seleccion, clave, mods)) {
      a.clicPendienteRef.current = clave
      return false
    }
    a.clicPendienteRef.current = null
    a.setSeleccion(resolverClic(a.seleccion, a.clavesNodo, clave, mods))
    return false
  }
  const aplazado = a.clicPendienteRef.current === clave
  a.clicPendienteRef.current = null
  if (aplazado) {
    // Se apretó sobre una fila del grupo y no se arrastró: ahora sí colapsa.
    a.setSeleccion(resolverClic(a.seleccion, a.clavesNodo, clave, { mod: false, shift: false }))
    return true
  }
  // Ctrl+clic y Mayús+clic son gestos de selección: no abren archivos ni despliegan carpetas.
  return !mods.mod && !mods.shift
}

/**
 * Prepara el arrastre desde `clave`: fija el conjunto arrastrado y devuelve las rutas
 * movibles para el `dataTransfer`. Vive aquí porque solo el árbol tiene las filas que
 * pasan de claves a rutas; el respaldo `[clave]` cubre un `dragstart` sin `mousedown`.
 */
export function prepararArrastre(a: Arbol, clave: string): string[] {
  const claves = a.seleccion.claves.has(clave) ? [...a.seleccion.claves] : [clave]
  const rutas = a.rutasArrastre(claves)
  a.setArrastrados(rutas)
  return rutas
}

/** Clic en el vacío: vacía la selección y trae el foco al panel para que los atajos lleguen. */
export function alPulsarVacio(a: Arbol, e: React.MouseEvent<HTMLDivElement>): void {
  // Se descarta por el target y no con `stopPropagation` en la fila: el `mousedown` tiene
  // que seguir subiendo hasta `window`, que es lo que cierra el menú contextual.
  if ((e.target as HTMLElement).closest('.tree-row')) return
  a.setSeleccion(SELECCION_VACIA)
  e.currentTarget.focus()
}

/** Clic derecho en el espacio vacío (las filas paran el evento): menú de la raíz. */
export function alClicDerechoVacio(a: Arbol, e: React.MouseEvent<HTMLDivElement>): void {
  e.preventDefault()
  void abrirMenu(a, e.clientX, e.clientY, { kind: 'raiz' })
}

/** Habilita soltar en la raíz; el arrastre propio manda sobre los archivos del sistema. */
export function alSobrevolarVacio(a: Arbol, e: React.DragEvent<HTMLDivElement>): void {
  if (a.arrastrados.length > 0) {
    if (!puedeSoltarN(a.arrastrados, '')) return
    e.preventDefault()
    // Sin decirlo, con `effectAllowed = 'copyMove'` el cursor enseña COPIAR mientras se mueve.
    e.dataTransfer.dropEffect = 'move'
    return
  }
  if (hasExternalFiles(e)) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
}

/** Soltar en el vacío: mueve lo arrastrado o importa lo que venga del sistema a la raíz. */
export function alSoltarEnVacio(a: Arbol, e: React.DragEvent<HTMLDivElement>): void {
  e.preventDefault()
  if (a.arrastrados.length > 0) {
    void moverNodos(a, a.arrastrados, '')
    return
  }
  if (hasExternalFiles(e)) void importarNodos(a, droppedHostPaths(e), '')
}
