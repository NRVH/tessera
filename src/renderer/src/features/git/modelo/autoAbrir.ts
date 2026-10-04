// =============================================================================
// autoAbrir: qué archivo de un commit se abre SOLO al seleccionarlo y cuál se salta, y qué
// filas admite el cursor con las flechas. El listón es más alto que el de abrir a mano: aquí
// un falso positivo cuesta trabajo veinte veces seguidas. Puro: sin React ni DOM, solo
// `import type` del árbol (por eso los imports llevan extensión).
// Decisiones: docs/decisiones/git/log-apertura-y-teclado.md
// =============================================================================

// Con extensión: `node` carga este módulo a secas desde su prueba y ahí no hay resolvedor.
import { extensionDe } from '../../../util/extensionArchivo.ts'
import type { FilaArbol } from './arbolArchivos.ts'

/**
 * Extensiones que la apertura automática SALTA. La familia ZIP (jar, war, apk…) NO está:
 * tiene diff propio y saltarla sería saltarse justo el archivo que se venía a mirar. Se
 * quedan los comprimidos que no son ZIP (nada sabe leerlos por dentro), los paquetes de
 * sistema y el `.class` suelto (su visor descompila con una JVM por archivo). Pdf, docx e
 * imágenes SÍ se auto-abren: saltarlos en silencio haría imprevisible qué se abre al pulsar ↓.
 */
export const NO_AUTO_ABRIBLES: ReadonlySet<string> = new Set([
  // Comprimidos que NO son ZIP: no hay con qué leerlos por dentro.
  '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst',
  // Paquetes de sistema e imágenes de disco.
  'deb', 'rpm', 'dmg', 'iso',
  // Salida de compilación: descompilar en un barrido no se paga.
  'class'
])

/**
 * ¿Merece la pena abrir el diff de este archivo por iniciativa propia? La ruta puede ser
 * VIRTUAL (`lib/x.jar!/com/A.class`): se clasifica por la extensión de su último tramo.
 */
export function esAutoAbrible(path: string): boolean {
  return !NO_AUTO_ABRIBLES.has(extensionDe(path))
}

/**
 * La primera fila de ARCHIVO auto-abrible, en el orden en que se VE (el del árbol ya
 * aplanado, no el crudo de git). `null` si el commit solo trae carpetas y empaquetados.
 */
export function primeraFilaAbrible(filas: readonly FilaArbol[]): FilaArbol | null {
  for (const fila of filas) {
    if (fila.nodo.tipo !== 'archivo') continue
    if (esAutoAbrible(fila.nodo.ruta)) return fila
  }
  return null
}

/**
 * Índice de la fila vecina en una dirección, saltando lo que no se puede abrir; `null`
 * cuando ya no queda ninguna (los extremos NO envuelven). Las CARPETAS son destino válido:
 * sin poder posar el cursor en ellas, `←`/`→` no tendrían a qué aplicarse. Quien llama
 * decide si además se abre algo. `desde` puede estar fuera del rango a propósito (-1 o
 * `filas.length`): así se entra sin cursor previo por el extremo que toque.
 */
export function siguienteFilaAbrible(
  filas: readonly FilaArbol[],
  desde: number,
  dir: 1 | -1
): number | null {
  for (let i = desde + dir; i >= 0 && i < filas.length; i += dir) {
    const nodo = filas[i].nodo
    if (nodo.tipo === 'carpeta' || esAutoAbrible(nodo.ruta)) return i
  }
  return null
}
