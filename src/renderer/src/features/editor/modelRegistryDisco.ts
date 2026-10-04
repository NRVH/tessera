// =============================================================================
// Operaciones del registro que tocan el disco: guardar, convertir, recargar y revisar el borrado.
// Puro (sin Monaco). Las guardas post-await comparan la entrada por identidad: el buffer puede
// haberse cerrado y su key reciclada para otro archivo mientras se esperaba.
// Lo usa `modelRegistryCore.ts`. Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import { marcarBorrado, recomputeDirty, snapshot } from './modelRegistryEntradas.ts'
import {
  esArchivoInexistente,
  ModelSaveBlocked,
  type ConvertRequest,
  type Contexto,
  type Entry,
  type LoadedText,
  type SharedTextModel,
  type WriteOutcome
} from './modelRegistryTipos.ts'

function mustEntry<M>(ctx: Contexto<M>, key: string): Entry<M> {
  const e = ctx.entries.get(key)
  if (!e) throw new Error(`Buffer no adquirido: "${key}".`)
  return e
}

/** Guardas comunes a `save` y `convert`: escribir en estos casos DESTRUIRÍA datos. */
function assertWritable<M>(e: Entry<M>, verb: 'guardar' | 'convertir'): M {
  if (e.binary || e.model === null) {
    throw new ModelSaveBlocked(`No se puede ${verb} un archivo binario.`)
  }
  if (e.truncated) {
    throw new ModelSaveBlocked(
      verb === 'guardar'
        ? 'No se puede guardar un archivo abierto truncado (>2 MiB): se perdería el resto.'
        : 'No se puede convertir un archivo abierto truncado (>2 MiB).'
    )
  }
  return e.model
}

/** Re-pregunta si el archivo sigue en disco y ajusta la marca. NO TOCA EL BUFFER. */
export async function revisarBorrado<M>(ctx: Contexto<M>, key: string): Promise<boolean> {
  const e = ctx.entries.get(key)
  if (e === undefined) return false
  let hay: boolean
  try {
    hay = await ctx.deps.existe(e.path)
  } catch {
    // La pregunta falló: en la duda se deja la marca como estaba.
    return e.borrado
  }
  if (ctx.entries.get(key) !== e) return false
  marcarBorrado(e, !hay)
  return e.borrado
}

/**
 * Buffer limpio y marcado, tras re-preguntar al disco: la marca puede ser un falso positivo
 * (un `git checkout` desenlaza y recrea los archivos), y escribir ahí machacaría el archivo
 * vigente. Devuelve `true` si hay que abortar el guardado. Síncrona: el `await` va en `guardar`.
 */
function marcaEraFalsa<M>(ctx: Contexto<M>, key: string, e: Entry<M>, sigue: boolean): boolean {
  if (ctx.entries.get(key) !== e) return true // se cerró mientras preguntábamos
  if (!sigue) return false
  marcarBorrado(e, false)
  return true
}

/** Guarda con la codificación de la entrada. `null` si no había nada que guardar. */
export async function guardar<M>(ctx: Contexto<M>, key: string): Promise<WriteOutcome | null> {
  const e = mustEntry(ctx, key)
  const model = assertWritable(e, 'guardar')
  // `!e.borrado` es lo que hace que Ctrl+S recree un archivo borrado por fuera.
  if (!e.dirty && !e.borrado) return null
  // Sucio: se escribe sin preguntar, mandan las ediciones. Limpio y marcado: se re-pregunta.
  if (!e.dirty) {
    let sigue: boolean
    try {
      sigue = await ctx.deps.existe(e.path)
    } catch {
      // No se pudo preguntar: se sigue con el guardado que el usuario pidió con Ctrl+S.
      sigue = false
    }
    if (marcaEraFalsa(ctx, key, e, sigue)) return null
  }

  // La versión se captura ANTES del await: si se sigue escribiendo, el buffer queda sucio.
  const versionAtSave = ctx.deps.versionId(model)
  const content = ctx.deps.getValue(model) // respeta el EOL del modelo; sin normalizar
  const res = await ctx.deps.write(e.path, content, e.encoding)

  if (ctx.entries.get(key) !== e) return res // se cerró durante la escritura
  e.savedVersionId = versionAtSave
  marcarBorrado(e, false)
  recomputeDirty(ctx, e)
  return res
}

/** Cambia EOL y/o codificación y ESCRIBE. `null` si la petición no cambiaba nada. */
export async function convertir<M>(
  ctx: Contexto<M>,
  key: string,
  req: ConvertRequest
): Promise<WriteOutcome | null> {
  const e = mustEntry(ctx, key)
  const model = assertWritable(e, 'convertir')

  const nextEncoding = req.encodingId ?? e.encoding
  const currentEol = ctx.deps.getEol(model)
  const nextEol = req.eol ?? currentEol
  // No-op: reescribir lo que ya hay movería el mtime y dispararía el watcher para nada.
  if (nextEncoding === e.encoding && nextEol === currentEol) return null

  if (nextEol !== currentEol) ctx.deps.setEol(model, nextEol)
  // Después del cambio de EOL: cambiarlo cuenta como edición y mueve la versión.
  const versionAtSave = ctx.deps.versionId(model)
  const content = ctx.deps.getValue(model)
  const res = await ctx.deps.write(e.path, content, nextEncoding)

  if (ctx.entries.get(key) !== e) return res
  marcarBorrado(e, false)
  e.encoding = nextEncoding
  e.shared = snapshot(e)
  e.savedVersionId = versionAtSave
  recomputeDirty(ctx, e)
  return res
}

/** Aplica al modelo lo leído de disco: nada si el texto es igual, `setValue` si difiere. */
function aplicarLectura<M>(ctx: Contexto<M>, e: Entry<M>, model: M, res: LoadedText): void {
  // Con el contenido igual no se toca el modelo: `setValue` limpia la pila de deshacer y
  // el eco del watcher tras el propio Ctrl+S dejaría sin deshacer en cada guardado.
  if (ctx.deps.getValue(model) !== res.content) ctx.deps.setValue(model, res.content)
  ctx.deps.setLanguage(model, res.language)
  // El punto limpio se re-ancla SIEMPRE, también en el no-op.
  e.savedVersionId = ctx.deps.versionId(model)
}

async function recargar<M>(
  ctx: Contexto<M>,
  key: string,
  e: Entry<M>,
  forcedEncoding?: string
): Promise<SharedTextModel<M>> {
  // Que el archivo haya desaparecido no es un fallo: se conserva el buffer, se marca y
  // Ctrl+S lo recrea. Cualquier otro fallo de lectura sí sube.
  let res: LoadedText
  try {
    res = await ctx.deps.load(e.path, forcedEncoding)
  } catch (err) {
    if (!esArchivoInexistente(err)) throw err
    if (ctx.entries.get(key) === e) marcarBorrado(e, true)
    return snapshot(e)
  }
  if (ctx.entries.get(key) !== e) return snapshot(e) // se cerró mientras leíamos
  marcarBorrado(e, false) // volvió a existir

  if (e.model !== null && !res.binary) aplicarLectura(ctx, e, e.model, res)
  // Si el archivo cambió de TIPO (texto <-> binario) solo se actualizan los metadatos:
  // vaciar el buffer destruiría ediciones y crear un modelo rompería la invariante.
  e.language = res.language
  e.encoding = res.encoding
  e.truncated = res.truncated
  e.binary = res.binary
  e.shared = snapshot(e)
  recomputeDirty(ctx, e)
  return e.shared
}

/** Re-lee de disco MUTANDO el modelo in-place. Single-flight por key. */
export function recargarDeDisco<M>(
  ctx: Contexto<M>,
  key: string,
  opts?: { forcedEncoding?: string }
): Promise<SharedTextModel<M>> {
  const e = ctx.entries.get(key)
  if (e === undefined) return Promise.reject(new Error(`Buffer no adquirido: "${key}".`))
  // Single-flight: el token de la pestaña y el del diff pueden subir en el mismo tick.
  if (e.reloading !== null) return e.reloading

  const p = recargar(ctx, key, e, opts?.forcedEncoding)
  e.reloading = p
  return p.finally(() => {
    if (e.reloading === p) e.reloading = null
  })
}
