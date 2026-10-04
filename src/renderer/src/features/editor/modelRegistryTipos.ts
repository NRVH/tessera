// =============================================================================
// Tipos del registro de buffers compartidos y su entrada interna.
// Módulo puro: sin Monaco ni DOM, lo cargan pruebas con `node`.
// Lo consumen `modelRegistryCore.ts` y sus piezas (`modelRegistryEntradas.ts`, `modelRegistryDisco.ts`).
// Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

/** Lo que devuelve una carga de texto. Espejo de `FileContent` del IPC, sin acoplarse a él. */
export interface LoadedText {
  content: string
  language: string
  encoding: string
  truncated: boolean
  binary: boolean
}

/** Resultado de una escritura a disco. */
export interface WriteOutcome {
  bytesWritten: number
}

/** Todo lo que el núcleo necesita del exterior, inyectado para que sea puro y testeable. */
export interface RegistryDeps<M> {
  createModel(text: string, language: string): M
  disposeModel(model: M): void
  setValue(model: M, text: string): void
  setLanguage(model: M, language: string): void
  /** Fin de línea del modelo. Cambiarlo cuenta como edición (mueve la versión). */
  getEol(model: M): 'CRLF' | 'LF'
  setEol(model: M, eol: 'CRLF' | 'LF'): void
  /** Versión para anclar el estado sucio: deshacer hasta el punto guardado devuelve el mismo id. */
  versionId(model: M): number
  getValue(model: M): string
  /** Suscribe cambios de contenido; devuelve el desuscriptor. */
  observe(model: M, onChange: () => void): () => void
  load(path: string, forcedEncoding?: string): Promise<LoadedText>
  /** ¿El archivo sigue en disco? Se pregunta sin leerlo, que es lo único posible con el buffer sucio. */
  existe(path: string): Promise<boolean>
  write(path: string, content: string, encoding: string): Promise<WriteOutcome>
}

/** Vista inmutable de una entrada del registro. `model` es null SOLO si es binario. */
export interface SharedTextModel<M> {
  readonly key: string
  readonly path: string
  readonly model: M | null
  readonly language: string
  readonly encoding: string
  readonly truncated: boolean
  readonly binary: boolean
}

/** Petición de conversión (la que dispara el selector de la barra de estado). */
export interface ConvertRequest {
  eol?: 'CRLF' | 'LF'
  encodingId?: string
}

/** API del registro de buffers compartidos con refcount. */
export interface ModelRegistry<M> {
  /** Sube el refcount SÍNCRONAMENTE y devuelve la entrada (cargándola la primera vez). */
  acquire(key: string, path: string, opts?: { forcedEncoding?: string }): Promise<SharedTextModel<M>>
  /** Baja el refcount; al llegar a 0 dispone. No-op si la key no existe o ya está en 0. */
  release(key: string): void
  /** Entrada YA cargada, o null. No dispara carga ni toca el refcount. */
  peek(key: string): SharedTextModel<M> | null
  refCount(key: string): number
  isDirty(key: string): boolean
  /** Notifica el estado sucio. Emite el valor ACTUAL en el momento de suscribirse. */
  subscribeDirty(key: string, cb: (dirty: boolean) => void): () => void
  /** ¿El archivo YA NO EXISTE en disco pero su buffer sigue abierto? */
  estaBorrado(key: string): boolean
  /** Notifica el estado «borrado en disco». Emite el ACTUAL al suscribirse. */
  subscribeBorrado(key: string, cb: (borrado: boolean) => void): () => void
  /** Re-pregunta si el archivo sigue en disco y ajusta la marca sin tocar el buffer. */
  revisarBorrado(key: string): Promise<boolean>
  /** Guarda con la codificación de la entrada. `null` si no había nada que guardar. */
  save(key: string): Promise<WriteOutcome | null>
  /** Cambia EOL y/o codificación y ESCRIBE. `null` si la petición no cambiaba nada. */
  convert(key: string, req: ConvertRequest): Promise<WriteOutcome | null>
  /** Re-lee de disco MUTANDO el modelo in-place. Single-flight por key. */
  reload(key: string, opts?: { forcedEncoding?: string }): Promise<SharedTextModel<M>>
}

/** Rechazo ESPERADO de un guardado: el pane pinta el mensaje tal cual. Se distingue por tipo, no por texto. */
export class ModelSaveBlocked extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelSaveBlocked'
  }
}

/**
 * ¿Este fallo de lectura significa «ese archivo YA NO ESTÁ» y no «algo va mal»?
 * Se mira el texto porque el IPC de Electron re-serializa el error y pierde su `code`.
 */
export function esArchivoInexistente(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /ENOENT|ENOTDIR|no such file or directory/i.test(msg)
}

/** Entrada interna del registro: un buffer, sus titulares y su estado. */
export interface Entry<M> {
  key: string
  path: string
  refs: number
  promise: Promise<SharedTextModel<M>>
  /** Snapshot publicado. null mientras la carga está en vuelo. */
  shared: SharedTextModel<M> | null
  model: M | null
  language: string
  encoding: string
  truncated: boolean
  binary: boolean
  unobserve: (() => void) | null
  dirty: boolean
  /** El archivo desapareció del disco y su buffer sigue abierto. */
  borrado: boolean
  savedVersionId: number
  listeners: Set<(dirty: boolean) => void>
  listenersBorrado: Set<(borrado: boolean) => void>
  reloading: Promise<SharedTextModel<M>> | null
  /** El último titular soltó mientras la carga seguía en vuelo: al asentar, suicidarse. */
  killed: boolean
}

/** Estado compartido por las piezas del registro: dependencias y mapa de entradas. */
export interface Contexto<M> {
  deps: RegistryDeps<M>
  entries: Map<string, Entry<M>>
}
