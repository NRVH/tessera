// =============================================================================
// Ciclo de vida de las entradas del registro de buffers: alta, carga, baja y avisos.
// Puro (sin Monaco): `lenguajeDeNombreArchivo` es una tabla; el import lleva extensión para `node`.
// Lo usa `registroModelosCore.ts`; el guardado y la recarga viven en `registroModelosDisco.ts`.
// Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import { lenguajeDeNombreArchivo } from '../../../../shared/archivos-ipc.ts'
import type { Contexto, EntradaModelo, TextoCargado, RutaArchivo, ModeloTextoCompartido } from './registroModelosTipos.ts'
import { esArchivoInexistente, rutaDe } from './registroModelosTipos.ts'

/** Vista inmutable de la entrada en este instante. */
export function fotoEntrada<M>(e: EntradaModelo<M>): ModeloTextoCompartido<M> {
  return {
    clave: e.clave,
    ruta: e.ruta,
    modelo: e.modelo,
    lenguaje: e.lenguaje,
    encoding: e.encoding,
    truncado: e.truncado,
    binario: e.binario
  }
}

/** Marca (o desmarca) «borrado en disco» y lo reparte a los N titulares. */
export function marcarBorrado<M>(e: EntradaModelo<M>, siguiente: boolean): void {
  if (siguiente === e.borrado) return
  e.borrado = siguiente
  // Copia de los listeners, por el mismo motivo que en `recalcularSucio`.
  for (const cb of [...e.oyentesBorrado]) cb(siguiente)
}

/** Recalcula el estado sucio y lo reparte a los N titulares (solo si CAMBIÓ). */
export function recalcularSucio<M>(ctx: Contexto<M>, e: EntradaModelo<M>): void {
  const siguiente = e.modelo !== null && ctx.deps.versionId(e.modelo) !== e.versionGuardadaId
  if (siguiente === e.sucio) return
  e.sucio = siguiente
  // Copia: un titular puede desuscribirse dentro de su callback y mutar el Set en la iteración.
  for (const cb of [...e.oyentesSucio]) cb(siguiente)
}

function destruir<M>(ctx: Contexto<M>, e: EntradaModelo<M>): void {
  e.unobserve?.()
  e.unobserve = null
  if (e.modelo !== null) ctx.deps.liberarModelo(e.modelo)
  e.modelo = null
  e.shared = null
  e.oyentesSucio.clear()
  e.oyentesBorrado.clear()
  // Por identidad: nunca se borra del mapa una entrada que ya no es la nuestra.
  if (ctx.entradas.get(e.clave) === e) ctx.entradas.delete(e.clave)
}

/**
 * Fallo al leer al abrir. Si el archivo NO existe devuelve un buffer vacío para publicarlo
 * marcado (la pestaña restaurada cuyo archivo desapareció con la app cerrada); cualquier
 * otro fallo sube. Síncrona a propósito: la carga no gana ninguna microtarea por partirla.
 */
function lecturaFallida<M>(ctx: Contexto<M>, e: EntradaModelo<M>, err: unknown): TextoCargado {
  if (!esArchivoInexistente(err)) {
    // No queda cacheada en error, y se borra por IDENTIDAD: si mientras leíamos llegó
    // OTRO titular (doble montaje de React), el mapa ya guarda una entrada nueva.
    if (ctx.entradas.get(e.clave) === e) ctx.entradas.delete(e.clave)
    throw err
  }
  // El lenguaje sale del nombre: un .java inexistente se abre coloreado como Java.
  return {
    contenido: '',
    lenguaje: lenguajeDeNombreArchivo(e.ruta),
    encoding: 'utf8',
    truncado: false,
    binario: false
  }
}

async function iniciarCarga<M>(
  ctx: Contexto<M>,
  e: EntradaModelo<M>,
  encodingForzado?: string
): Promise<ModeloTextoCompartido<M>> {
  let res: TextoCargado
  let naceBorrado = false
  try {
    res = await ctx.deps.cargar(rutaDe(e), encodingForzado)
  } catch (err) {
    res = lecturaFallida(ctx, e, err)
    naceBorrado = true
  }

  // El último titular soltó mientras leíamos: no se publica nada y no se crea modelo.
  if (e.descartada) return fotoEntrada(e)

  const modelo = res.binario ? null : ctx.deps.crearModelo(res.contenido, res.lenguaje)

  // Segunda comprobación: `createModel` es síncrono, pero el `await` de arriba dio
  // tiempo a que llegara el release. Sin esto se fugaría un modelo.
  if (e.descartada) {
    if (modelo !== null) ctx.deps.liberarModelo(modelo)
    return fotoEntrada(e)
  }

  e.modelo = modelo
  e.lenguaje = res.lenguaje
  e.encoding = res.encoding
  e.truncado = res.truncado
  e.binario = res.binario
  if (modelo !== null) {
    e.versionGuardadaId = ctx.deps.versionId(modelo)
    e.unobserve = ctx.deps.observar(modelo, () => recalcularSucio(ctx, e))
  }
  // La marca va DESPUÉS de anclar el punto limpio: nace vacío pero NO sucio, solo marcado.
  if (naceBorrado) marcarBorrado(e, true)
  e.shared = fotoEntrada(e)
  return e.shared
}

function nuevaEntrada<M>(clave: string, { raiz, ruta }: RutaArchivo): EntradaModelo<M> {
  return {
    clave,
    ruta,
    raiz,
    refs: 0,
    promesa: null as unknown as Promise<ModeloTextoCompartido<M>>,
    shared: null,
    modelo: null,
    lenguaje: 'plaintext',
    encoding: 'utf8',
    truncado: false,
    binario: false,
    unobserve: null,
    sucio: false,
    borrado: false,
    versionGuardadaId: 0,
    oyentesSucio: new Set(),
    oyentesBorrado: new Set(),
    recargando: null,
    descartada: false
  }
}

/** Alta de un titular: crea la entrada la primera vez y sube el refcount. */
export function adquirir<M>(
  ctx: Contexto<M>,
  clave: string,
  ruta: RutaArchivo,
  opts?: { encodingForzado?: string }
): Promise<ModeloTextoCompartido<M>> {
  let e = ctx.entradas.get(clave)
  if (e === undefined) {
    e = nuevaEntrada<M>(clave, ruta)
    ctx.entradas.set(clave, e)
    e.promesa = iniciarCarga(ctx, e, opts?.encodingForzado)
  } else if (e.ruta !== ruta.ruta || e.raiz !== ruta.raiz) {
    // La key deriva del proyecto y la ruta: solo pasa si alguien la construyó a mano.
    throw new Error(`Colisión de key "${clave}": "${e.raiz}|${e.ruta}" vs "${ruta.raiz}|${ruta.ruta}".`)
  }
  // El incremento va ANTES de cualquier await: dos panes montados en el mismo tick con
  // la carga en vuelo dejarían el refcount en 1 y el primer cierre dispondría el modelo.
  e.refs++
  return e.promesa
}

/** Baja de un titular; al llegar a 0 se dispone (o se marca para suicidarse si aún carga). */
export function liberar<M>(ctx: Contexto<M>, clave: string): void {
  const e = ctx.entradas.get(clave)
  if (e === undefined) return
  if (e.refs <= 0) return // el cleanup doble de React en modo estricto no debe romper
  e.refs--
  if (e.refs > 0) return
  if (e.shared === null) {
    // Aún cargando: se marca para que la carga se suicide y se saca del mapa ya.
    e.descartada = true
    ctx.entradas.delete(clave)
    return
  }
  destruir(ctx, e)
}

/** Suscripción al estado sucio; emite el valor actual al suscribirse. */
export function suscribirSucio<M>(
  ctx: Contexto<M>,
  clave: string,
  cb: (sucio: boolean) => void
): () => void {
  const e = ctx.entradas.get(clave)
  if (e === undefined) {
    cb(false)
    return () => {}
  }
  e.oyentesSucio.add(cb)
  // Emisión inmediata: quien llega tarde a un buffer ya sucio pinta el punto en el primer render.
  cb(e.sucio)
  return () => {
    e.oyentesSucio.delete(cb)
  }
}

/** Suscripción al estado «borrado en disco»; emite el actual al suscribirse. */
export function suscribirBorrado<M>(
  ctx: Contexto<M>,
  clave: string,
  cb: (borrado: boolean) => void
): () => void {
  const e = ctx.entradas.get(clave)
  if (e === undefined) {
    cb(false)
    return () => {}
  }
  e.oyentesBorrado.add(cb)
  cb(e.borrado)
  return () => {
    e.oyentesBorrado.delete(cb)
  }
}
