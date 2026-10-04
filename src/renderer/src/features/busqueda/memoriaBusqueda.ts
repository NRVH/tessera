// =============================================================================
// Lo que el modal de búsqueda recuerda entre aperturas (en memoria, mientras la app siga
// abierta) y sus valores por defecto. Lo usan el modal y el store de la feature.
// Es un módulo puro: no importa componentes como valor.
// =============================================================================
import type { OpcionesBusqueda } from '../../../../shared/textSearch'
import type { SeleccionCarpeta } from './AmbitoBusqueda'

/** Lo que sobrevive a cerrar el modal. */
export interface MemoriaBusqueda {
  query: string
  opts: OpcionesBusqueda
  altoPrevia: number
  ancho: number
  alto: number
  /** "En el proyecto" o "En una carpeta", y cuál. Se recuerda entre aperturas. */
  modoAmbito: 'proyecto' | 'carpeta'
  /**
   * La carpeta elegida, con el proyecto al que pertenece. Lleva la raíz porque una
   * ruta relativa sola no significa nada: `src/main` existe en varios proyectos.
   * Si ese proyecto ya no está abierto, el modal cae a "En el proyecto" solo.
   */
  carpeta: SeleccionCarpeta | null
}

/** Tamaño por defecto del modal y de la vista previa, que nace alta porque lo que se lee es el archivo. */
export const MEMORIA_BUSQUEDA_INICIAL: MemoriaBusqueda = {
  query: '',
  opts: { caseSensitive: false, wholeWord: false, regex: false },
  altoPrevia: 420,
  ancho: 1180,
  alto: 860,
  modoAmbito: 'proyecto',
  carpeta: null
}
