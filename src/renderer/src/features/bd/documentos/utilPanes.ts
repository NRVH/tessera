// =============================================================================
// Utilidades que comparten las pestañas de colección y de clave: ids de petición para poder
// cancelarlas por su `peticionId` y copiar al portapapeles avisando del resultado.
// Las usan `DbColeccionPane`, `DbClavePane` y sus hooks.
// =============================================================================

import { notifyError } from '../../../comun/notifications'
import { txColeccionDocs } from './textosColeccionDocs'

let contadorPeticiones = 0

/** Un id de petición único en la sesión, con un prefijo que dice de qué es. */
export function nuevaPeticion(prefijo: string): string {
  contadorPeticiones++
  return `${prefijo}-${Date.now().toString(36)}-${contadorPeticiones.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** El control confirma el éxito; los errores conservan su aviso. */
export function copiarTexto(texto: string, _que: string): Promise<boolean> {
  return window.tessera.clipboard
    .write(texto)
    .then(() => true)
    .catch((err: unknown) => { notifyError(txColeccionDocs().noSePudoCopiar, err); return false })
}
