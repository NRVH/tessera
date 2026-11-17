// =============================================================================
// Tipos del registro de buffers compartidos y su entrada interna.
// Módulo puro: sin Monaco ni DOM, lo cargan pruebas con `node`.
// Lo consumen `registroModelosCore.ts` y sus piezas (`registroModelosEntradas.ts`, `registroModelosDisco.ts`).
// Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import type { RutaEnProyecto } from '../../../../shared/archivos-ipc.ts'

/** Lo que devuelve una carga de texto. Espejo de `ContenidoArchivo` del IPC, sin acoplarse a él. */
export interface TextoCargado {
  contenido: string
  lenguaje: string
  encoding: string
  truncado: boolean
  binario: boolean
}

/** Resultado de una escritura a disco. */
export interface ResultadoEscritura {
  bytesEscritos: number
}

/** Un archivo: su ruta relativa y la contenedora de su proyecto, juntas hasta el main. */
export type RutaArchivo = RutaEnProyecto

/** Todo lo que el núcleo necesita del exterior, inyectado para que sea puro y testeable. */
export interface DependenciasRegistro<M> {
  crearModelo(texto: string, lenguaje: string): M
  liberarModelo(modelo: M): void
  fijarValor(modelo: M, texto: string): void
  fijarLenguaje(modelo: M, lenguaje: string): void
  /** Fin de línea del modelo. Cambiarlo cuenta como edición (mueve la versión). */
  obtenerEol(modelo: M): 'CRLF' | 'LF'
  fijarEol(modelo: M, eol: 'CRLF' | 'LF'): void
  /** Versión para anclar el estado sucio: deshacer hasta el punto guardado devuelve el mismo id. */
  versionId(modelo: M): number
  obtenerValor(modelo: M): string
  /** Suscribe cambios de contenido; devuelve el desuscriptor. */
  observar(modelo: M, onCambio: () => void): () => void
  cargar(ruta: RutaArchivo, encodingForzado?: string): Promise<TextoCargado>
  /** ¿El archivo sigue en disco? Se pregunta sin leerlo, que es lo único posible con el buffer sucio. */
  existe(ruta: RutaArchivo): Promise<boolean>
  escribir(ruta: RutaArchivo, contenido: string, encoding: string): Promise<ResultadoEscritura>
}

/** Vista inmutable de una entrada del registro. `model` es null SOLO si es binario. */
export interface ModeloTextoCompartido<M> {
  readonly clave: string
  readonly ruta: string
  readonly modelo: M | null
  readonly lenguaje: string
  readonly encoding: string
  readonly truncado: boolean
  readonly binario: boolean
}

/** Petición de conversión (la que dispara el selector de la barra de estado). */
export interface PeticionConversion {
  eol?: 'CRLF' | 'LF'
  encodingId?: string
}

/** API del registro de buffers compartidos con refcount. */
export interface RegistroModelos<M> {
  /** Sube el refcount SÍNCRONAMENTE y devuelve la entrada (cargándola la primera vez). */
  adquirir(clave: string, ruta: RutaArchivo, opts?: { encodingForzado?: string }): Promise<ModeloTextoCompartido<M>>
  /** Baja el refcount; al llegar a 0 dispone. No-op si la key no existe o ya está en 0. */
  release(clave: string): void
  /** Entrada YA cargada, o null. No dispara carga ni toca el refcount. */
  consultar(clave: string): ModeloTextoCompartido<M> | null
  contarRefs(clave: string): number
  estaSucio(clave: string): boolean
  /** Notifica el estado sucio. Emite el valor ACTUAL en el momento de suscribirse. */
  suscribirSucio(clave: string, cb: (sucio: boolean) => void): () => void
  /** ¿El archivo YA NO EXISTE en disco pero su buffer sigue abierto? */
  estaBorrado(clave: string): boolean
  /** Notifica el estado «borrado en disco». Emite el ACTUAL al suscribirse. */
  suscribirBorrado(clave: string, cb: (borrado: boolean) => void): () => void
  /** Re-pregunta si el archivo sigue en disco y ajusta la marca sin tocar el buffer. */
  revisarBorrado(clave: string): Promise<boolean>
  /** Guarda con la codificación de la entrada. `null` si no había nada que guardar. */
  guardar(clave: string): Promise<ResultadoEscritura | null>
  /** Cambia EOL y/o codificación y ESCRIBE. `null` si la petición no cambiaba nada. */
  convertir(clave: string, req: PeticionConversion): Promise<ResultadoEscritura | null>
  /** Re-lee de disco MUTANDO el modelo in-place. Single-flight por key. */
  recargar(clave: string, opts?: { encodingForzado?: string }): Promise<ModeloTextoCompartido<M>>
}

/** Rechazo ESPERADO de un guardado: el pane pinta el mensaje tal cual. Se distingue por tipo, no por texto. */
export class GuardadoModeloBloqueado extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'GuardadoModeloBloqueado'
  }
}

/**
 * ¿Este fallo de lectura significa «ese archivo YA NO ESTÁ» y no «algo va mal»?
 * Se mira el texto porque el IPC de Electron re-serializa el error y pierde su `code`.
 */
export function esArchivoInexistente(err: unknown): boolean {
  const mensaje = err instanceof Error ? err.message : String(err ?? '')
  return /ENOENT|ENOTDIR|no such file or directory/i.test(mensaje)
}

/** El archivo de una entrada, tal como viaja al disco. */
export function rutaDe(e: Pick<EntradaModelo<unknown>, 'raiz' | 'ruta'>): RutaArchivo {
  return { raiz: e.raiz, ruta: e.ruta }
}

/** Entrada interna del registro: un buffer, sus titulares y su estado. */
export interface EntradaModelo<M> {
  clave: string
  ruta: string
  /** Contenedora del proyecto del archivo: toda lectura y escritura va a ella, nunca a la activa. */
  raiz: string
  refs: number
  promesa: Promise<ModeloTextoCompartido<M>>
  /** Snapshot publicado. null mientras la carga está en vuelo. */
  shared: ModeloTextoCompartido<M> | null
  modelo: M | null
  lenguaje: string
  encoding: string
  truncado: boolean
  binario: boolean
  unobserve: (() => void) | null
  sucio: boolean
  /** El archivo desapareció del disco y su buffer sigue abierto. */
  borrado: boolean
  versionGuardadaId: number
  oyentesSucio: Set<(sucio: boolean) => void>
  oyentesBorrado: Set<(borrado: boolean) => void>
  recargando: Promise<ModeloTextoCompartido<M>> | null
  /** El último titular soltó mientras la carga seguía en vuelo: al asentar, suicidarse. */
  descartada: boolean
}

/** Estado compartido por las piezas del registro: dependencias y mapa de entradas. */
export interface Contexto<M> {
  deps: DependenciasRegistro<M>
  entradas: Map<string, EntradaModelo<M>>
}
