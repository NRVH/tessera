// =============================================================================
// Portapapeles de archivos del explorador: decide si un pegado sale de la copia
// interna de Tessera o del portapapeles del sistema, y guarda la interna.
// Sin React ni DOM, para probarlo entero con `node` (test-file-clipboard.mts).
// Decisiones: docs/decisiones/explorador/portapapeles-de-archivos.md
// =============================================================================

import { MAX_TEXTO_SONDEO, type ClipboardProbe } from '../../../../shared/clipboard-ipc'
import { parentDir } from './posixPath'

export type OpPegado = 'copiar' | 'cortar'

/** Lo que el usuario copió o cortó DENTRO de Tessera. */
export interface PortapapelesInterno {
  op: OpPegado
  /**
   * Rutas relativas POSIX dentro del proyecto, ya minimizadas por prefijo (ver
   * `seleccionArbol.ts`). Plural desde que el explorador tiene selección múltiple.
   */
  paths: string[]
  /** Contenedora donde se copió: pegar en OTRO proyecto no tendría sentido. */
  projectHostPath: string
  /**
   * Texto que se deja en el portapapeles del sistema al copiar: con varias rutas, su unión por
   * saltos de línea. Hace de marca de caducidad y de «pegar en el editor pega las rutas».
   */
  marca: string
}

/** Qué se va a pegar, ya decidido. */
export type FuentePegado =
  | { kind: 'interno'; entrada: PortapapelesInterno }
  /** Ficheros del Explorador de Windows. `op` sale del Preferred DropEffect. */
  | { kind: 'externo'; op: OpPegado }
  /** Un bitmap en memoria: se volcará como PNG nuevo. */
  | { kind: 'imagen' }
  | { kind: 'ninguno' }

/**
 * Decide la fuente del pegado.
 *
 * `proyectoActual` es la contenedora del árbol donde se está pegando: un portapapeles
 * interno de otro proyecto se descarta porque su ruta es relativa a OTRA raíz y
 * apuntaría a un sitio equivocado (o a ninguno).
 */
export function decidirFuentePegado(
  interno: PortapapelesInterno | null,
  proyectoActual: string,
  sondeo: ClipboardProbe
): FuentePegado {
  // El sistema tiene algo que solo pudo llegar DESPUÉS de nuestra copia (que solo
  // dejó texto): gana él, sin mirar el interno.
  if (sondeo.kind === 'files') {
    return { kind: 'externo', op: sondeo.effect === 'cut' ? 'cortar' : 'copiar' }
  }
  if (sondeo.kind === 'image') return { kind: 'imagen' }

  if (interno === null) return { kind: 'ninguno' }
  if (interno.projectHostPath !== proyectoActual) return { kind: 'ninguno' }
  // La marca sigue en el portapapeles => nadie copió nada en medio. Se compara recortada
  // porque el sondeo devuelve como mucho MAX_TEXTO_SONDEO caracteres.
  if ((sondeo.texto ?? '') !== interno.marca.slice(0, MAX_TEXTO_SONDEO)) return { kind: 'ninguno' }
  return { kind: 'interno', entrada: interno }
}

/**
 * Carpeta donde debe caer el pegado, a partir de lo que se clicó. Como en los gestores
 * de archivos: sobre una CARPETA se pega dentro; sobre un ARCHIVO se pega junto a él (en
 * su carpeta), no "dentro" del archivo.
 */
export function destinoPegado(path: string, isDir: boolean): string {
  return isDir ? path : parentDir(path)
}

// Estado vivo: singleton de módulo y no un useState del árbol, para sobrevivir a los
// remontajes de FileTree al cambiar de pestaña de proyecto (ver el ADR de cabecera).
let actual: PortapapelesInterno | null = null
const suscriptores = new Set<() => void>()

function notificar(): void {
  for (const fn of suscriptores) fn()
}

/** Guarda lo copiado/cortado. `null` lo vacía. */
export function setPortapapelesInterno(entrada: PortapapelesInterno | null): void {
  actual = entrada
  notificar()
}

/** Lo copiado/cortado ahora mismo (sin validar contra el portapapeles del sistema). */
export function getPortapapelesInterno(): PortapapelesInterno | null {
  return actual
}

/** Suscripción para `useSyncExternalStore`. Devuelve la función de baja. */
export function subscribePortapapelesInterno(cb: () => void): () => void {
  suscriptores.add(cb)
  return () => {
    suscriptores.delete(cb)
  }
}
