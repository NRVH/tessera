// =============================================================================
// Contrato IPC del portapapeles (main <-> preload <-> renderer).
// El `clipboard` de Electron no existe en un renderer sandboxed y navigator.clipboard
// es frágil bajo contextIsolation, así que lo sirve el main.
// Canales (invoke): READ -> string, WRITE(ClipboardWriteMessage) -> void,
// SAVE_IMAGE -> string | null.
// =============================================================================

export const CLIPBOARD_CHANNELS = {
  /** invoke: lee el texto del portapapeles del sistema. Sin argumentos -> string. */
  READ: 'clipboard:read',
  /** invoke: escribe texto en el portapapeles del sistema. ClipboardWriteMessage -> void. */
  WRITE: 'clipboard:write',
  /**
   * invoke: si el portapapeles del sistema contiene una IMAGEN, la vuelca como PNG
   * a un archivo temporal único y devuelve su ruta absoluta; si no hay imagen (o
   * falla el guardado), devuelve null. Sin argumentos -> string | null.
   * Sirve para pegar imágenes en la terminal como archivo adjunto (CC/Codex).
   */
  SAVE_IMAGE: 'clipboard:saveImage',
  /**
   * invoke: SONDEO BARATO del portapapeles, para decidir si el menú contextual del
   * explorador pinta "Pegar" y con qué etiqueta. Sin argumentos -> ClipboardProbe.
   *
   * Es lo bastante barato para llamarlo en CADA apertura de menú: por dentro son
   * comprobaciones de disponibilidad de formato más, como mucho, dos lecturas. NO
   * lee la lista de rutas ni decodifica la imagen — eso es caro y solo hace falta
   * si el usuario llega a hacer clic.
   */
  PROBE: 'clipboard:probe',
  /**
   * invoke: PEGA en una carpeta del proyecto lo que haya en el portapapeles del
   * sistema (ficheros del Explorador de Windows, o un bitmap).
   * ClipboardPasteRequest -> PasteResult (de files-ipc).
   *
   * El renderer solo dice DÓNDE. Quién lee las rutas, si el gesto fue copiar o
   * cortar, y el vaciado posterior del portapapeles, es todo cosa del MAIN — a
   * propósito: dejar que el renderer mandara rutas absolutas del host junto a un
   * "cortar" convertiría un fallo suyo en un borrado recursivo de cualquier carpeta
   * del disco (ver PasteRequest en files-ipc).
   *
   * Puede tardar ~250 ms: por dentro lee CF_HDROP con un Get-Clipboard de
   * PowerShell. Solo se llama al hacer clic en "Pegar", nunca al abrir el menú.
   */
  PASTE_INTO: 'clipboard:pasteInto'
} as const

/** Petición de pegado desde el portapapeles del sistema: solo el destino. */
export interface ClipboardPasteRequest {
  /** Carpeta destino, relativa a la raíz del proyecto (POSIX, "" = raíz). */
  destDir: string
}

export interface ClipboardWriteMessage {
  /** Texto plano a copiar al portapapeles del sistema. */
  text: string
}

/** Qué hay en el portapapeles, desde el punto de vista del explorador de archivos. */
export type ClipboardPasteKind =
  /** Ficheros/carpetas copiados o cortados (Explorador de Windows u otro gestor). */
  | 'files'
  /** Un bitmap EN MEMORIA (captura de pantalla, "copiar imagen" del navegador). */
  | 'image'
  /** Texto, o nada: no hay ficheros que pegar. */
  | 'none'

export interface ClipboardProbe {
  kind: ClipboardPasteKind
  /**
   * Nº de elementos cuando se puede saber SIN leer la lista. 0 = "hay ficheros pero
   * no sé cuántos" (el formato que lo dice lo pone el Shell, y un gestor de archivos
   * de terceros puede no ponerlo). Nunca significa "cero".
   */
  count: number
  /** ¿El origen pidió COPIAR o CORTAR? Ante la duda, siempre 'copy' (ver parseDropEffect). */
  effect: 'copy' | 'cut'
  /**
   * Texto del portapapeles, RECORTADO a `MAX_TEXTO_SONDEO`, SOLO con kind 'none'.
   * Sirve para una cosa: casar con la MARCA que deja el portapapeles interno del
   * explorador y saber si sigue vigente. Ver renderer/features/explorador/fileClipboard.ts.
   */
  texto?: string
}

/**
 * Tope del texto que devuelve el sondeo, y por tanto de lo que se puede comparar
 * con la marca del portapapeles interno.
 *
 * VIVE AQUÍ, EN EL CONTRATO, Y NO EN EL MAIN, y eso es lo que arregla un fallo
 * silencioso: desde que el explorador copia VARIAS rutas, la marca es el join de
 * todas y pasa de 2048 caracteres con nada, ~27 ficheros. El sondeo devolvía el
 * texto recortado, la comparación por igualdad no casaba nunca y el resultado era
 * que «Pegar» desaparecía del menú, Ctrl+V no hacía nada y encima se limpiaba el
 * corte pendiente — sin un solo error. Con el tope compartido, el renderer recorta
 * su marca igual antes de comparar.
 *
 * 2048 y no más: esto cruza el IPC cada vez que se abre un menú contextual.
 */
export const MAX_TEXTO_SONDEO = 2048

