// =============================================================================
// Registro de buffers compartidos con refcount: un buffer por (proyecto, ruta), núcleo PURO.
// El registro es el único dueño del modelo y NUNCA lo reemplaza: solo muta su contenido.
// No importa Monaco: todo lo externo entra por `RegistryDeps`. El binding real: `textModelRegistry.ts`.
// Piezas: `modelRegistryEntradas.ts` (ciclo de vida), `modelRegistryDisco.ts` (escritura y recarga).
// Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import {
  adquirir,
  liberar,
  suscribirBorrado,
  suscribirSucio
} from './modelRegistryEntradas.ts'
import { convertir, guardar, recargarDeDisco, revisarBorrado } from './modelRegistryDisco.ts'
import type { Contexto, ModelRegistry, RegistryDeps } from './modelRegistryTipos.ts'

export {
  esArchivoInexistente,
  ModelSaveBlocked,
  type ConvertRequest,
  type LoadedText,
  type ModelRegistry,
  type RegistryDeps,
  type SharedTextModel,
  type WriteOutcome
} from './modelRegistryTipos.ts'

/** Crea un registro de buffers compartidos sobre las dependencias inyectadas. */
export function createRegistry<M>(deps: RegistryDeps<M>): ModelRegistry<M> {
  const ctx: Contexto<M> = { deps, entries: new Map() }
  const { entries } = ctx

  return {
    acquire: (key, path, opts) => adquirir(ctx, key, path, opts),
    release: (key) => liberar(ctx, key),
    peek: (key) => entries.get(key)?.shared ?? null,
    refCount: (key) => entries.get(key)?.refs ?? 0,
    isDirty: (key) => entries.get(key)?.dirty ?? false,
    estaBorrado: (key) => entries.get(key)?.borrado ?? false,
    subscribeBorrado: (key, cb) => suscribirBorrado(ctx, key, cb),
    revisarBorrado: (key) => revisarBorrado(ctx, key),
    subscribeDirty: (key, cb) => suscribirSucio(ctx, key, cb),
    save: (key) => guardar(ctx, key),
    convert: (key, req) => convertir(ctx, key, req),
    reload: (key, opts) => recargarDeDisco(ctx, key, opts)
  }
}
