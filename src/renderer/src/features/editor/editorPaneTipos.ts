// =============================================================================
// Tipos de EditorPane: las props del pane, los metadatos que eleva a la barra de
// estado y la petición de conversión de codificación o fin de línea.
// Sin imports de valor: lo cargan EditorPane y los hooks que lo componen.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import type { ModoVista } from './modoVista'
import type { OpenFile } from './centerPane'

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
export interface EditorConvertReq {
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

/** Props de EditorPane. Las peticiones por `token` disparan al subir su valor. */
export interface EditorPaneProps {
  /** Archivo a editar; en una pestaña sin título es un `OpenFile` sintético. */
  file: OpenFile
  /** Id del buffer sin título: no lee de disco y guarda por `onSaveUntitled`. */
  untitledId?: string
  /** Guarda el buffer sin título; devuelve false si se canceló o falló. */
  onSaveUntitled?: (content: string) => Promise<boolean>
  /** Guardado pedido desde fuera, como Ctrl+S. 0/undefined = sin petición. */
  saveToken?: number
  /** Pane activo; el resto está oculto con display:none, sin desmontar. */
  visible: boolean
  /** Pane realmente a la vista (el área del editor puede estar oculta entera). */
  buscable?: boolean
  /** Se dispara tras un guardado exitoso. */
  onSaved?: () => void
  /** Eleva el estado sucio del buffer cada vez que cambia de valor. */
  onDirtyChange?: (dirty: boolean) => void
  /** El archivo dejó de existir en disco (o volvió); el buffer sigue vivo. */
  onBorradoChange?: (borrado: boolean) => void
  /** Eleva el modo de vista de este pane; lo reportan todos, no solo el visible. */
  onModoVista?: (modo: ModoVista) => void
  /** Recarga desde disco al subir; muta el buffer compartido in-place. */
  reloadToken?: number
  /** Eleva codificación y fin de línea; `null` si no aplica (binario o sin título). */
  onMeta?: (meta: EditorMeta | null) => void
  /** Conversión de codificación o fin de línea pedida desde la barra de estado. */
  convert?: EditorConvertReq
  /** Reabre con otra codificación: relee de disco y descarta lo no guardado. */
  reopenEncoding?: { token: number; encodingId: string }
  /** Clave del buffer compartido en el registro; ausente en los sin título. */
  modelKey?: string
  /** Centra una línea y pone el cursor ahí (resultado de la búsqueda en archivos). */
  revelar?: EditorRevelar
}
