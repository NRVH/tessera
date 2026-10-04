// =============================================================================
// Protocolo entre el main y `workers/searchWorker`. Solo TIPOS.
// -----------------------------------------------------------------------------
// Va en su propio archivo —y no dentro del worker ni del servicio— porque los dos
// extremos lo necesitan y ninguno debe importar del otro: el servicio arrastraría
// el worker a su grafo de módulos, y el worker arrastraría `electron`.
//
// NO es el contrato IPC (`shared/search-ipc.ts`). Ese habla con el renderer y no
// puede llevar rutas de Windows; este es interno al main, y `raiz` sí es absoluta.
// =============================================================================

import type { OpcionesBusqueda } from '../../shared/textSearch'
import type { CoincidenciaArchivo } from '../../shared/search-ipc'

/** Lo que se le pasa al worker por `workerData`. */
export interface PeticionBarrido {
  /** Raíz ABSOLUTA (del host). Ya resuelta y validada por FileService. */
  raiz: string
  /**
   * Carpeta por la que empezar, RELATIVA POSIX a `raiz` (`''` = todo). Viaja
   * relativa y no absoluta aposta: es lo que garantiza que el barrido no pueda
   * salirse de `raiz` ni aunque el renderer mandara algo raro (la validación real
   * es de `FileService.resolveProyecto`, antes de llegar aquí).
   */
  subcarpeta: string
  query: string
  opts: OpcionesBusqueda
}

/** Lo que el worker publica por `parentPort`. */
export type MensajeWorkerBusqueda =
  | { tipo: 'lote'; coincidencias: CoincidenciaArchivo[] }
  | { tipo: 'fin'; total: number; archivos: number; truncado: boolean; error?: string }
