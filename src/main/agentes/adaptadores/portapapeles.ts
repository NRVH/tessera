// =============================================================================
// Imagen del portapapeles del sistema como PNG, para pegarla en la sesión del agente.
// Adaptador sobre `clipboard` de Electron: el controlador del agente lo recibe inyectado
// desde `src/main/agentes/componer.ts` y las pruebas le pasan uno falso.
// =============================================================================

import { clipboard } from 'electron'

/** Lo que el controlador del agente necesita del portapapeles. */
export interface PortapapelesImagen {
  /** Los bytes PNG de la imagen del portapapeles, o null si no hay imagen. */
  leerPng(): Buffer | null
}

/** Portapapeles real del sistema. */
export const portapapelesDelSistema: PortapapelesImagen = {
  leerPng() {
    const imagen = clipboard.readImage()
    if (imagen.isEmpty()) return null
    const png = imagen.toPNG()
    if (png.length === 0) return null
    return png
  }
}
