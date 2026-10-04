// =============================================================================
// Tipos que comparten los módulos de git del main: el repo resuelto, las entradas de un lote
// y las opciones del servicio. Solo declaraciones, para que ningún módulo dependa de otro por
// un tipo. Lo usan `GitService` y todas sus operaciones.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import type { EmisorEventos } from '../util/emisorEventos'

/** Opciones del servicio de git; `projectRoot` y `log` son opcionales para poder probarlo. */
export interface GitServiceOptions {
  /** Raíz del proyecto activo. Omitida: el servicio arranca sin proyecto y espera `setProjectRoot`. */
  projectRoot?: string
  /** Logger del main (por defecto `console.log` con prefijo). */
  log?: (msg: string) => void
  /**
   * Confirma un borrado irrecuperable (archivo sin seguimiento, o añadido sin commit):
   * recibe el nombre y devuelve true si el usuario lo aprueba. Por defecto no borra nada.
   */
  confirmDiscard?: (fileName: string) => Promise<boolean>
  /**
   * Confirma UNA vez un descarte en lote: recibe los nombres de lo que se va a BORRAR (lo
   * que git puede devolver no se lista). Por defecto no borra nada.
   */
  confirmDiscardMany?: (fileNames: string[]) => Promise<boolean>
  /** Emisor hacia el renderer para los avisos parciales de `multiStatus`; sin él no se emite nada. */
  eventos?: EmisorEventos
}

/**
 * Un repo resuelto y listo para operar: dónde corre git (`root`) y cómo se traducen las
 * rutas entre el espacio del renderer (relativas a la CONTENEDORA) y el de git (relativas
 * al repo). Se resuelve por repo explícito o por la ruta de un archivo (su primer segmento).
 */
export interface RepoCtx {
  /** Raíz real del repo (cwd de git). Nunca cruza el IPC. */
  root: string
  /** Multi-repo: `<contenedora>/<prefix>` === `root`; "" si no aplica. */
  prefix: string
  /** Monorepo: `<root>/<inner>` === contenedora; "" si no aplica. Excluyente con `prefix`. */
  inner: string
}

/** Una ruta de un lote, en los dos espacios que hacen falta. */
export interface EntradaRepo {
  /** Contenedora-relativa (la que entiende el renderer): se devuelve en el resultado. */
  rel: string
  /** Relativa al repo (la que entiende git). NUNCA vacía: ver `agruparPorRepo`. */
  repoPath: string
}

/** Las rutas de un lote que caen en el MISMO repo. */
export interface GrupoRepo {
  ctx: RepoCtx
  entradas: EntradaRepo[]
}

/**
 * Qué hay que hacerle a un archivo para descartarlo: `revertir` (en HEAD, recuperable),
 * `borrar-indexado` (añadido sin commit: fuera del índice y del disco) o `borrar` (sin seguimiento).
 */
export type ClaseDescarte = 'revertir' | 'borrar-indexado' | 'borrar'

/**
 * Lo que la clasificación dice de una ruta: su `ClaseDescarte`, o un rechazo con el motivo para el
 * usuario (una carpeta, un conflicto, algo en disco que el descarte perdería sin poder confirmarlo).
 */
export type Clasificacion = ClaseDescarte | { rechazo: string }

/** Lo que guarda la caché de «commits de la rama actual» por repo: la historia de HEAD y su índice. */
export interface HistoriaDeHead {
  head: string
  hashes: string[]
  set: Set<string>
}
