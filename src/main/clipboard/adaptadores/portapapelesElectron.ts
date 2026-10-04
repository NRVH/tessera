// =============================================================================
// Lo que el portapapeles de archivos lee de Electron: los formatos disponibles, un buffer o un
// texto por formato, el bitmap como PNG, el vaciado y la carpeta temporal de `app`.
// `PortapapelesSistema` es el contrato que reciben `clipboardFiles.ts` e `ipc.ts`;
// `portapapelesElectron()` lo implementa con `clipboard` y `app`, y lo crea `src/main/index.ts`.
// =============================================================================

import { app, clipboard } from 'electron'

export interface PortapapelesSistema {
  /** `clipboard.availableFormats()`: nombres MIME que sintetiza Chromium. */
  formatos(): string[]
  /** `clipboard.readBuffer(formato)`. Lanza si el portapapeles está bloqueado por otra app. */
  leerBuffer(formato: string): Buffer
  /** `clipboard.readText()`, entero. */
  leerTexto(): string
  /** `clipboard.writeText`. */
  escribirTexto(texto: string): void
  /** `clipboard.read(formato)`: el contenido de un formato nativo como texto. */
  leer(formato: string): string
  /** El bitmap del portapapeles codificado a PNG; vacío (longitud 0) si no hay imagen. */
  imagenPng(): Buffer
  /** `clipboard.clear()`. */
  vaciar(): void
  /** `app.getPath('temp')`: donde se vuelca la imagen pegada. */
  rutaTemporal(): string
}

/** El portapapeles real. */
export function portapapelesElectron(): PortapapelesSistema {
  return {
    formatos: () => clipboard.availableFormats(),
    leerBuffer: (formato) => clipboard.readBuffer(formato),
    leerTexto: () => clipboard.readText(),
    escribirTexto: (texto) => clipboard.writeText(texto),
    leer: (formato) => clipboard.read(formato),
    imagenPng: () => {
      const image = clipboard.readImage()
      return image.isEmpty() ? Buffer.alloc(0) : image.toPNG()
    },
    vaciar: () => clipboard.clear(),
    rutaTemporal: () => app.getPath('temp')
  }
}
