// =============================================================================
// insigniaEstado: fuente ÚNICA de la decoración de estado git del working-tree para
// toda la UI (panel de Cambios, explorador y pestañas): la letra y la clase de
// color salen del MISMO sitio. Solo lectura: mapea un CambioWorktree (dos ejes) a
// una letra efectiva, sin tocar IPC.
// =============================================================================

import type { CambioWorktree } from '../../../../../shared/git-ipc'

/**
 * ¿El archivo está en conflicto? Un eje `U`, o AA (los dos lados lo añaden) o DD (los dos
 * lo borran): esas dos parejas solo las da un registro `u` de `status` (fuera de un
 * conflicto, el eje del árbol nunca es `A` y un borrado preparado no tiene eje del árbol).
 * Es la regla de la sección Conflictos y de la letra `U`, donde descartar no se ofrece.
 */
export function enConflicto(cambio: CambioWorktree): boolean {
  const x = cambio.estadoIndice
  const y = cambio.estadoWorktree
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
}

/**
 * Letra efectiva a mostrar para un archivo del working-tree, colapsando los dos
 * ejes (estadoIndice/estadoWorktree) a un solo símbolo por PRECEDENCIA:
 * U(conflicto, ver `enConflicto`) > R(rename) > A(alta, incl. untracked '?') > D(borrado) >
 * C(copy) > T(typechange) > M(modificado).
 */
export function letraInsignia(cambio: CambioWorktree): string {
  const x = cambio.estadoIndice
  const y = cambio.estadoWorktree
  if (enConflicto(cambio)) return 'U'
  if (x === 'R' || y === 'R') return 'R'
  if (x === 'A' || y === 'A' || y === '?') return 'A'
  if (x === 'D' || y === 'D') return 'D'
  if (x === 'C' || y === 'C') return 'C'
  if (x === 'T' || y === 'T') return 'T'
  return 'M'
}

/** Clase CSS de COLOR DE TEXTO para una letra de status (árbol, pestañas, panel). */
export function claseEstado(letra: string): string {
  return `git-status-${letra}`
}

/**
 * Índice de decoraciones de la lista completa de cambios: la letra de cada archivo y
 * toda carpeta ancestro de un cambio. Las claves son POSIX relativas a la contenedora,
 * el mismo espacio que `EntradaArchivo.ruta` del explorador.
 */
export interface DecoracionesWorktree {
  /** path de archivo -> letra de status. */
  porRuta: Map<string, string>
  /** paths de carpeta que contienen (recursivamente) algún cambio. */
  carpetasSucias: Set<string>
}

/** Construye el índice de decoraciones a partir de los cambios del working-tree. */
export function construirDecoraciones(cambios: CambioWorktree[]): DecoracionesWorktree {
  const porRuta = new Map<string, string>()
  const carpetasSucias = new Set<string>()

  for (const cambio of cambios) {
    porRuta.set(cambio.ruta, letraInsignia(cambio))
    // Rollup: cada prefijo de carpeta del path ("app/src/Foo.java" -> "app", "app/src").
    const segmentos = cambio.ruta.split('/')
    let prefijo = ''
    for (let i = 0; i < segmentos.length - 1; i++) {
      prefijo = prefijo === '' ? segmentos[i] : `${prefijo}/${segmentos[i]}`
      carpetasSucias.add(prefijo)
    }
  }

  return { porRuta, carpetasSucias }
}
