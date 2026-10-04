// =============================================================================
// Ciclo de vida de las entradas del registro de buffers: alta, carga, baja y avisos.
// Puro (sin Monaco): `languageForFilename` es una tabla; el import lleva extensión para `node`.
// Lo usa `modelRegistryCore.ts`; el guardado y la recarga viven en `modelRegistryDisco.ts`.
// Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import { languageForFilename } from '../../../../shared/files-ipc.ts'
import type { Contexto, Entry, LoadedText, SharedTextModel } from './modelRegistryTipos.ts'
import { esArchivoInexistente } from './modelRegistryTipos.ts'

/** Vista inmutable de la entrada en este instante. */
export function snapshot<M>(e: Entry<M>): SharedTextModel<M> {
  return {
    key: e.key,
    path: e.path,
    model: e.model,
    language: e.language,
    encoding: e.encoding,
    truncated: e.truncated,
    binary: e.binary
  }
}

/** Marca (o desmarca) «borrado en disco» y lo reparte a los N titulares. */
export function marcarBorrado<M>(e: Entry<M>, next: boolean): void {
  if (next === e.borrado) return
  e.borrado = next
  // Copia de los listeners, por el mismo motivo que en `recomputeDirty`.
  for (const cb of [...e.listenersBorrado]) cb(next)
}

/** Recalcula el estado sucio y lo reparte a los N titulares (solo si CAMBIÓ). */
export function recomputeDirty<M>(ctx: Contexto<M>, e: Entry<M>): void {
  const next = e.model !== null && ctx.deps.versionId(e.model) !== e.savedVersionId
  if (next === e.dirty) return
  e.dirty = next
  // Copia: un titular puede desuscribirse dentro de su callback y mutar el Set en la iteración.
  for (const cb of [...e.listeners]) cb(next)
}

function destroy<M>(ctx: Contexto<M>, e: Entry<M>): void {
  e.unobserve?.()
  e.unobserve = null
  if (e.model !== null) ctx.deps.disposeModel(e.model)
  e.model = null
  e.shared = null
  e.listeners.clear()
  e.listenersBorrado.clear()
  // Por identidad: nunca se borra del mapa una entrada que ya no es la nuestra.
  if (ctx.entries.get(e.key) === e) ctx.entries.delete(e.key)
}

/**
 * Fallo al leer al abrir. Si el archivo NO existe devuelve un buffer vacío para publicarlo
 * marcado (la pestaña restaurada cuyo archivo desapareció con la app cerrada); cualquier
 * otro fallo sube. Síncrona a propósito: la carga no gana ninguna microtarea por partirla.
 */
function lecturaFallida<M>(ctx: Contexto<M>, e: Entry<M>, err: unknown): LoadedText {
  if (!esArchivoInexistente(err)) {
    // No queda cacheada en error, y se borra por IDENTIDAD: si mientras leíamos llegó
    // OTRO titular (doble montaje de React), el mapa ya guarda una entrada nueva.
    if (ctx.entries.get(e.key) === e) ctx.entries.delete(e.key)
    throw err
  }
  // El lenguaje sale del nombre: un .java inexistente se abre coloreado como Java.
  return {
    content: '',
    language: languageForFilename(e.path),
    encoding: 'utf8',
    truncated: false,
    binary: false
  }
}

async function startLoad<M>(
  ctx: Contexto<M>,
  e: Entry<M>,
  forcedEncoding?: string
): Promise<SharedTextModel<M>> {
  let res: LoadedText
  let naceBorrado = false
  try {
    res = await ctx.deps.load(e.path, forcedEncoding)
  } catch (err) {
    res = lecturaFallida(ctx, e, err)
    naceBorrado = true
  }

  // El último titular soltó mientras leíamos: no se publica nada y no se crea modelo.
  if (e.killed) return snapshot(e)

  const model = res.binary ? null : ctx.deps.createModel(res.content, res.language)

  // Segunda comprobación: `createModel` es síncrono, pero el `await` de arriba dio
  // tiempo a que llegara el release. Sin esto se fugaría un modelo.
  if (e.killed) {
    if (model !== null) ctx.deps.disposeModel(model)
    return snapshot(e)
  }

  e.model = model
  e.language = res.language
  e.encoding = res.encoding
  e.truncated = res.truncated
  e.binary = res.binary
  if (model !== null) {
    e.savedVersionId = ctx.deps.versionId(model)
    e.unobserve = ctx.deps.observe(model, () => recomputeDirty(ctx, e))
  }
  // La marca va DESPUÉS de anclar el punto limpio: nace vacío pero NO sucio, solo marcado.
  if (naceBorrado) marcarBorrado(e, true)
  e.shared = snapshot(e)
  return e.shared
}

function nuevaEntrada<M>(key: string, path: string): Entry<M> {
  return {
    key,
    path,
    refs: 0,
    promise: null as unknown as Promise<SharedTextModel<M>>,
    shared: null,
    model: null,
    language: 'plaintext',
    encoding: 'utf8',
    truncated: false,
    binary: false,
    unobserve: null,
    dirty: false,
    borrado: false,
    savedVersionId: 0,
    listeners: new Set(),
    listenersBorrado: new Set(),
    reloading: null,
    killed: false
  }
}

/** Alta de un titular: crea la entrada la primera vez y sube el refcount. */
export function adquirir<M>(
  ctx: Contexto<M>,
  key: string,
  path: string,
  opts?: { forcedEncoding?: string }
): Promise<SharedTextModel<M>> {
  let e = ctx.entries.get(key)
  if (e === undefined) {
    e = nuevaEntrada<M>(key, path)
    ctx.entries.set(key, e)
    e.promise = startLoad(ctx, e, opts?.forcedEncoding)
  } else if (e.path !== path) {
    // La key deriva de la ruta: solo pasa si alguien la construyó a mano.
    throw new Error(`Colisión de key "${key}": "${e.path}" vs "${path}".`)
  }
  // El incremento va ANTES de cualquier await: dos panes montados en el mismo tick con
  // la carga en vuelo dejarían el refcount en 1 y el primer cierre dispondría el modelo.
  e.refs++
  return e.promise
}

/** Baja de un titular; al llegar a 0 se dispone (o se marca para suicidarse si aún carga). */
export function liberar<M>(ctx: Contexto<M>, key: string): void {
  const e = ctx.entries.get(key)
  if (e === undefined) return
  if (e.refs <= 0) return // el cleanup doble de React en modo estricto no debe romper
  e.refs--
  if (e.refs > 0) return
  if (e.shared === null) {
    // Aún cargando: se marca para que la carga se suicide y se saca del mapa ya.
    e.killed = true
    ctx.entries.delete(key)
    return
  }
  destroy(ctx, e)
}

/** Suscripción al estado sucio; emite el valor actual al suscribirse. */
export function suscribirSucio<M>(
  ctx: Contexto<M>,
  key: string,
  cb: (dirty: boolean) => void
): () => void {
  const e = ctx.entries.get(key)
  if (e === undefined) {
    cb(false)
    return () => {}
  }
  e.listeners.add(cb)
  // Emisión inmediata: quien llega tarde a un buffer ya sucio pinta el punto en el primer render.
  cb(e.dirty)
  return () => {
    e.listeners.delete(cb)
  }
}

/** Suscripción al estado «borrado en disco»; emite el actual al suscribirse. */
export function suscribirBorrado<M>(
  ctx: Contexto<M>,
  key: string,
  cb: (borrado: boolean) => void
): () => void {
  const e = ctx.entries.get(key)
  if (e === undefined) {
    cb(false)
    return () => {}
  }
  e.listenersBorrado.add(cb)
  cb(e.borrado)
  return () => {
    e.listenersBorrado.delete(cb)
  }
}
