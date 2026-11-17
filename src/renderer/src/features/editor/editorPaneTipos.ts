// =============================================================================
// Tipos de PaneEditor: las props del pane, los metadatos que eleva a la barra de
// estado y la petición de conversión de codificación o fin de línea.
// Sin imports de valor: lo cargan PaneEditor y los hooks que lo componen.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import type { ModoVista } from './modoVista'
import type { ArchivoAbierto } from './paneCentral'

/** Metadatos de codificación/fin-de-línea que el editor eleva a la barra de estado. */
export interface EditorMeta {
  /** Id de codificación del catálogo (shared/encodings), p. ej. 'utf8'. */
  encodingId: string
  /** Fin de línea del modelo. */
  eol: 'CRLF' | 'LF'
}

/**
 * Petición de conversión desde la barra de estado. `token` sube en cada petición y
 * solo viene uno de `encodingId`/`eol`. La conversión escribe el archivo.
 */
export interface PeticionConversionEditor {
  token: number
  encodingId?: string
  eol?: 'CRLF' | 'LF'
}

/** Destino de un «ve a esta línea»; `token` sube en cada petición. */
export interface EditorRevelar {
  linea: number
  columna: number
  token: number
}

/** Props de PaneEditor. Las peticiones por `token` disparan al subir su valor. */
export interface PropsPaneEditor {
  /** Archivo a editar; en una pestaña sin título es un `ArchivoAbierto` sintético. */
  archivo: ArchivoAbierto
  /** Id del buffer sin título: no lee de disco y guarda por `onGuardarSinTitulo`. */
  sinTituloId?: string
  /** Guarda el buffer sin título; devuelve false si se canceló o falló. */
  onGuardarSinTitulo?: (contenido: string) => Promise<boolean>
  /** Guardado pedido desde fuera, como Ctrl+S. 0/undefined = sin petición. */
  tokenGuardado?: number
  /** Pane activo; el resto está oculto con display:none, sin desmontar. */
  visible: boolean
  /** Pane realmente a la vista (el área del editor puede estar oculta entera). */
  buscable?: boolean
  /** Se dispara tras un guardado exitoso. */
  onGuardado?: () => void
  /** Eleva el estado sucio del buffer cada vez que cambia de valor. */
  onCambioSucio?: (sucio: boolean) => void
  /** El archivo dejó de existir en disco (o volvió); el buffer sigue vivo. */
  onCambioBorrado?: (borrado: boolean) => void
  /** Eleva el modo de vista de este pane; lo reportan todos, no solo el visible. */
  onModoVista?: (modo: ModoVista) => void
  /** Recarga desde disco al subir; muta el buffer compartido in-place. */
  tokenRecarga?: number
  /** Eleva codificación y fin de línea; `null` si no aplica (binario o sin título). */
  onMeta?: (meta: EditorMeta | null) => void
  /** Conversión de codificación o fin de línea pedida desde la barra de estado. */
  peticionConversion?: PeticionConversionEditor
  /** Reabre con otra codificación: relee de disco y descarta lo no guardado. */
  peticionReapertura?: { token: number; encodingId: string }
  /** Clave del buffer compartido en el registro; ausente en los sin título. */
  claveModelo?: string
  /** Centra una línea y pone el cursor ahí (resultado de la búsqueda, o la posición guardada al reabrir). */
  revelar?: EditorRevelar
  /** Modo de vista con que se abre (el guardado en la sesión del proyecto); sin él, el de serie del archivo. */
  modoInicial?: ModoVista
}
