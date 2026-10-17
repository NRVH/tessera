// =============================================================================
// Utilidades que comparten las pestañas de colección y de clave: ids de petición para poder
// cancelarlas por su `peticionId` y copiar al portapapeles avisando del resultado.
// Las usan `DbColeccionPane`, `DbClavePane` y sus hooks.
// =============================================================================

import { notify, notifyError } from '../../../comun/notifications'
import { txColeccionDocs } from './textosColeccionDocs'

let contadorPeticiones = 0

/** Un id de petición único en la sesión, con un prefijo que dice de qué es. */
export function nuevaPeticion(prefijo: string): string {
  contadorPeticiones++
  return `${prefijo}-${Date.now().toString(36)}-${contadorPeticiones.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Copia `texto` y avisa: «<que> copiado», o el error. */
export function copiarTexto(texto: string, que: string): void {
  void window.tessera.clipboard
    .write(texto)
    .then(() => notify('success', txColeccionDocs().copiado(que)))
    .catch((err: unknown) => notifyError(txColeccionDocs().noSePudoCopiar, err))
}
