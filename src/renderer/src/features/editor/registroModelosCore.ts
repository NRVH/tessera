// =============================================================================
// Registro de buffers compartidos con refcount: un buffer por (proyecto, ruta), núcleo PURO.
// El registro es el único dueño del modelo y NUNCA lo reemplaza: solo muta su contenido.
// No importa Monaco: todo lo externo entra por `DependenciasRegistro`. El binding real: `registroModelosTexto.ts`.
// Piezas: `registroModelosEntradas.ts` (ciclo de vida), `registroModelosDisco.ts` (escritura y recarga).
// Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import {
  adquirir,
  liberar,
  suscribirBorrado,
  suscribirSucio
} from './registroModelosEntradas.ts'
import { convertir, guardar, recargarDeDisco, revisarBorrado } from './registroModelosDisco.ts'
import type { Contexto, RegistroModelos, DependenciasRegistro } from './registroModelosTipos.ts'

export {
  esArchivoInexistente,
  GuardadoModeloBloqueado,
  type PeticionConversion,
  type TextoCargado,
  type RegistroModelos,
  type DependenciasRegistro,
  type RutaArchivo,
  type ModeloTextoCompartido,
  type ResultadoEscritura
} from './registroModelosTipos.ts'

/** Crea un registro de buffers compartidos sobre las dependencias inyectadas. */
export function crearRegistro<M>(deps: DependenciasRegistro<M>): RegistroModelos<M> {
  const ctx: Contexto<M> = { deps, entradas: new Map() }
  const { entradas } = ctx

  return {
    adquirir: (clave, ruta, opts) => adquirir(ctx, clave, ruta, opts),
    release: (clave) => liberar(ctx, clave),
    consultar: (clave) => entradas.get(clave)?.shared ?? null,
    contarRefs: (clave) => entradas.get(clave)?.refs ?? 0,
    estaSucio: (clave) => entradas.get(clave)?.sucio ?? false,
    estaBorrado: (clave) => entradas.get(clave)?.borrado ?? false,
    suscribirBorrado: (clave, cb) => suscribirBorrado(ctx, clave, cb),
    revisarBorrado: (clave) => revisarBorrado(ctx, clave),
    suscribirSucio: (clave, cb) => suscribirSucio(ctx, clave, cb),
    guardar: (clave) => guardar(ctx, clave),
    convertir: (clave, req) => convertir(ctx, clave, req),
    recargar: (clave, opts) => recargarDeDisco(ctx, clave, opts)
  }
}
