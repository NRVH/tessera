// =============================================================================
// Operaciones del registro que tocan el disco: guardar, convertir, recargar y revisar el borrado.
// Puro (sin Monaco). Las guardas post-await comparan la entrada por identidad: el buffer puede
// haberse cerrado y su key reciclada para otro archivo mientras se esperaba.
// Lo usa `registroModelosCore.ts`. Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import { marcarBorrado, recalcularSucio, fotoEntrada } from './registroModelosEntradas.ts'
import { txEditor } from './textos.ts'
import {
  esArchivoInexistente,
  GuardadoModeloBloqueado,
  rutaDe,
  type PeticionConversion,
  type Contexto,
  type EntradaModelo,
  type TextoCargado,
  type ModeloTextoCompartido,
  type ResultadoEscritura
} from './registroModelosTipos.ts'

function exigirEntrada<M>(ctx: Contexto<M>, clave: string): EntradaModelo<M> {
  const e = ctx.entradas.get(clave)
  if (!e) throw new Error(`Buffer no adquirido: "${clave}".`)
  return e
}

/** Guardas comunes a `save` y `convert`: escribir en estos casos DESTRUIRÍA datos. */
function asegurarEditable<M>(e: EntradaModelo<M>, verb: 'guardar' | 'convertir'): M {
  const t = txEditor()
  if (e.binario || e.modelo === null) {
    throw new GuardadoModeloBloqueado(
      verb === 'guardar' ? t.noSePuedeGuardarBinario : t.noSePuedeConvertirBinario
    )
  }
  if (e.truncado) {
    throw new GuardadoModeloBloqueado(
      verb === 'guardar' ? t.noSePuedeGuardarTruncado : t.noSePuedeConvertirTruncado
    )
  }
  return e.modelo
}

/** Re-pregunta si el archivo sigue en disco y ajusta la marca. NO TOCA EL BUFFER. */
export async function revisarBorrado<M>(ctx: Contexto<M>, clave: string): Promise<boolean> {
  const e = ctx.entradas.get(clave)
  if (e === undefined) return false
  let hay: boolean
  try {
    hay = await ctx.deps.existe(rutaDe(e))
  } catch {
    // La pregunta falló: en la duda se deja la marca como estaba.
    return e.borrado
  }
  if (ctx.entradas.get(clave) !== e) return false
  marcarBorrado(e, !hay)
  return e.borrado
}

/**
 * Buffer limpio y marcado, tras re-preguntar al disco: la marca puede ser un falso positivo
 * (un `git checkout` desenlaza y recrea los archivos), y escribir ahí machacaría el archivo
 * vigente. Devuelve `true` si hay que abortar el guardado. Síncrona: el `await` va en `guardar`.
 */
function marcaEraFalsa<M>(ctx: Contexto<M>, clave: string, e: EntradaModelo<M>, sigue: boolean): boolean {
  if (ctx.entradas.get(clave) !== e) return true // se cerró mientras preguntábamos
  if (!sigue) return false
  marcarBorrado(e, false)
  return true
}

/** Guarda con la codificación de la entrada. `null` si no había nada que guardar. */
export async function guardar<M>(ctx: Contexto<M>, clave: string): Promise<ResultadoEscritura | null> {
  const e = exigirEntrada(ctx, clave)
  const modelo = asegurarEditable(e, 'guardar')
  // `!e.borrado` es lo que hace que Ctrl+S recree un archivo borrado por fuera.
  if (!e.sucio && !e.borrado) return null
  // Sucio: se escribe sin preguntar, mandan las ediciones. Limpio y marcado: se re-pregunta.
  if (!e.sucio) {
    let sigue: boolean
    try {
      sigue = await ctx.deps.existe(rutaDe(e))
    } catch {
      // No se pudo preguntar: se sigue con el guardado que el usuario pidió con Ctrl+S.
      sigue = false
    }
    if (marcaEraFalsa(ctx, clave, e, sigue)) return null
  }

  // La versión se captura ANTES del await: si se sigue escribiendo, el buffer queda sucio.
  const versionAlGuardar = ctx.deps.versionId(modelo)
  const contenido = ctx.deps.obtenerValor(modelo) // respeta el EOL del modelo; sin normalizar
  const res = await ctx.deps.escribir(rutaDe(e), contenido, e.encoding)

  if (ctx.entradas.get(clave) !== e) return res // se cerró durante la escritura
  e.versionGuardadaId = versionAlGuardar
  marcarBorrado(e, false)
  recalcularSucio(ctx, e)
  return res
}

/** Cambia EOL y/o codificación y ESCRIBE. `null` si la petición no cambiaba nada. */
export async function convertir<M>(
  ctx: Contexto<M>,
  clave: string,
  req: PeticionConversion
): Promise<ResultadoEscritura | null> {
  const e = exigirEntrada(ctx, clave)
  const modelo = asegurarEditable(e, 'convertir')

  const siguienteEncoding = req.encodingId ?? e.encoding
  const eolActual = ctx.deps.obtenerEol(modelo)
  const siguienteEol = req.eol ?? eolActual
  // No-op: reescribir lo que ya hay movería el mtime y dispararía el watcher para nada.
  if (siguienteEncoding === e.encoding && siguienteEol === eolActual) return null

  if (siguienteEol !== eolActual) ctx.deps.fijarEol(modelo, siguienteEol)
  // Después del cambio de EOL: cambiarlo cuenta como edición y mueve la versión.
  const versionAlGuardar = ctx.deps.versionId(modelo)
  const contenido = ctx.deps.obtenerValor(modelo)
  const res = await ctx.deps.escribir(rutaDe(e), contenido, siguienteEncoding)

  if (ctx.entradas.get(clave) !== e) return res
  marcarBorrado(e, false)
  e.encoding = siguienteEncoding
  e.shared = fotoEntrada(e)
  e.versionGuardadaId = versionAlGuardar
  recalcularSucio(ctx, e)
  return res
}

/** Aplica al modelo lo leído de disco: nada si el texto es igual, `setValue` si difiere. */
function aplicarLectura<M>(ctx: Contexto<M>, e: EntradaModelo<M>, modelo: M, res: TextoCargado): void {
  // Con el contenido igual no se toca el modelo: `setValue` limpia la pila de deshacer y
  // el eco del watcher tras el propio Ctrl+S dejaría sin deshacer en cada guardado.
  if (ctx.deps.obtenerValor(modelo) !== res.contenido) ctx.deps.fijarValor(modelo, res.contenido)
  ctx.deps.fijarLenguaje(modelo, res.lenguaje)
  // El punto limpio se re-ancla SIEMPRE, también en el no-op.
  e.versionGuardadaId = ctx.deps.versionId(modelo)
}

async function recargar<M>(
  ctx: Contexto<M>,
  clave: string,
  e: EntradaModelo<M>,
  encodingForzado?: string
): Promise<ModeloTextoCompartido<M>> {
  // Que el archivo haya desaparecido no es un fallo: se conserva el buffer, se marca y
  // Ctrl+S lo recrea. Cualquier otro fallo de lectura sí sube.
  let res: TextoCargado
  try {
    res = await ctx.deps.cargar(rutaDe(e), encodingForzado)
  } catch (err) {
    if (!esArchivoInexistente(err)) throw err
    if (ctx.entradas.get(clave) === e) marcarBorrado(e, true)
    return fotoEntrada(e)
  }
  if (ctx.entradas.get(clave) !== e) return fotoEntrada(e) // se cerró mientras leíamos
  marcarBorrado(e, false) // volvió a existir

  if (e.modelo !== null && !res.binario) aplicarLectura(ctx, e, e.modelo, res)
  // Si el archivo cambió de TIPO (texto <-> binario) solo se actualizan los metadatos:
  // vaciar el buffer destruiría ediciones y crear un modelo rompería la invariante.
  e.lenguaje = res.lenguaje
  e.encoding = res.encoding
  e.truncado = res.truncado
  e.binario = res.binario
  e.shared = fotoEntrada(e)
  recalcularSucio(ctx, e)
  return e.shared
}

/** Re-lee de disco MUTANDO el modelo in-place. Single-flight por key. */
export function recargarDeDisco<M>(
  ctx: Contexto<M>,
  clave: string,
  opts?: { encodingForzado?: string }
): Promise<ModeloTextoCompartido<M>> {
  const e = ctx.entradas.get(clave)
  if (e === undefined) return Promise.reject(new Error(`Buffer no adquirido: "${clave}".`))
  // Single-flight: el token de la pestaña y el del diff pueden subir en el mismo tick.
  if (e.recargando !== null) return e.recargando

  const p = recargar(ctx, clave, e, opts?.encodingForzado)
  e.recargando = p
  return p.finally(() => {
    if (e.recargando === p) e.recargando = null
  })
}
