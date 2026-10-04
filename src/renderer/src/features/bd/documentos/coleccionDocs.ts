// =============================================================================
// coleccionDocs: lógica pura de la pestaña de colección de documentos: los cambios pendientes
// de «Enviar» (por `_id`), las filas de la tabla, los textos y la consulta (modo guiado / JSON).
// Sin React, DOM, IPC ni `process`. Reexporta la lectura del texto (`tokensDocs`, `camposDocs`).
// Decisiones: docs/decisiones/bd/ui-documentos-texto-y-cambios.md
// =============================================================================

import type {
  DbDocCambio,
  DbDocCampoMuestra,
  DbDocCelda,
  DbDocConsultar,
  DbDocDocumento,
  DbDocResultadoEnvio,
  DbDocTipo
} from '../../../../../shared/db-documentos-ipc.ts'
import type { DbErrorSql } from '../../../../../shared/db-explorador-ipc.ts'
import {
  categoriaDeDocTipos,
  filtroVacio,
  type DbFiltroGuiado,
  type DbOrdenColumna
} from '../../../../../shared/filtroGuiado.ts'
import type { ColumnaFiltrable } from '../filtro/modeloFiltro.ts'
import { celdaDeValorTexto, documentoDeTexto, textoConCambios, unirColumnas } from './camposDocs.ts'

export {
  camposDeTexto,
  celdaDeValorTexto,
  textoConCambios,
  tipoDeValorTexto,
  unirColumnas,
  valorDeCampo
} from './camposDocs.ts'
export {
  compactarTexto,
  formatearDocumento,
  formatearTokens,
  tokenizar
} from './tokensDocs.ts'

// --- Cambios pendientes ----------------------------------------------------------------------

export type CambioDoc =
  | { tipo: 'actualizar'; poner: Readonly<Record<string, string>>; quitar: readonly string[] }
  | { tipo: 'reemplazar'; documento: string }
  | { tipo: 'borrar' }

export interface EdicionDocs {
  /** Un cambio por documento (por `idEjson`), en el orden en que se tocaron. */
  docs: ReadonlyArray<{ idEjson: string; cambio: CambioDoc }>
  /** Documentos nuevos (texto en notación del shell), en orden. */
  insertados: readonly string[]
}

export const EDICION_VACIA: EdicionDocs = { docs: [], insertados: [] }

export function numCambiosDocs(e: EdicionDocs): number {
  return e.docs.length + e.insertados.length
}

export function cambioDeDoc(e: EdicionDocs, idEjson: string): CambioDoc | undefined {
  return e.docs.find((d) => d.idEjson === idEjson)?.cambio
}

/** Pone (o quita, con null) el cambio de un documento; el orden de los demás no se mueve. */
function conCambio(e: EdicionDocs, idEjson: string, cambio: CambioDoc | null): EdicionDocs {
  const i = e.docs.findIndex((d) => d.idEjson === idEjson)
  if (cambio === null) {
    if (i < 0) return e
    return { ...e, docs: [...e.docs.slice(0, i), ...e.docs.slice(i + 1)] }
  }
  if (i < 0) return { ...e, docs: [...e.docs, { idEjson, cambio }] }
  const docs = [...e.docs]
  docs[i] = { idEjson, cambio }
  return { ...e, docs }
}

/** Por qué un campo no se puede editar desde su celda, o null. `_id` es la identidad: MongoDB no deja cambiarla. */
export function motivoNoEditarCampo(campo: string): string | null {
  return campo === '_id' ? 'El _id es la identidad del documento: el servidor no deja cambiarlo' : null
}

/**
 * Pone un campo de primer nivel (la celda editada). En un documento ya reemplazado se
 * aplica sobre su texto nuevo; en uno borrado, nada. `_id`, nada (ver `motivoNoEditarCampo`).
 */
export function ponerCampo(e: EdicionDocs, idEjson: string, campo: string, valor: string): EdicionDocs {
  if (motivoNoEditarCampo(campo) !== null) return e
  const previo = cambioDeDoc(e, idEjson)
  if (previo?.tipo === 'borrar') return e
  if (previo?.tipo === 'reemplazar') {
    return conCambio(e, idEjson, { tipo: 'reemplazar', documento: textoConCambios(previo.documento, { [campo]: valor }, []) })
  }
  const poner = { ...(previo?.poner ?? {}), [campo]: valor }
  const quitar = (previo?.quitar ?? []).filter((q) => q !== campo)
  return conCambio(e, idEjson, { tipo: 'actualizar', poner, quitar })
}

/** Quita un campo de primer nivel (`$unset`). Mismas reglas que `ponerCampo`. */
export function quitarCampo(e: EdicionDocs, idEjson: string, campo: string): EdicionDocs {
  if (motivoNoEditarCampo(campo) !== null) return e
  const previo = cambioDeDoc(e, idEjson)
  if (previo?.tipo === 'borrar') return e
  if (previo?.tipo === 'reemplazar') {
    return conCambio(e, idEjson, { tipo: 'reemplazar', documento: textoConCambios(previo.documento, {}, [campo]) })
  }
  const poner: Record<string, string> = { ...(previo?.poner ?? {}) }
  delete poner[campo]
  const quitar = [...(previo?.quitar ?? []).filter((q) => q !== campo), campo]
  return conCambio(e, idEjson, { tipo: 'actualizar', poner, quitar })
}

/** Deshace lo pendiente de UN campo; si el documento se queda sin nada, sale de la lista. */
export function restaurarCampo(e: EdicionDocs, idEjson: string, campo: string): EdicionDocs {
  const previo = cambioDeDoc(e, idEjson)
  if (previo?.tipo !== 'actualizar') return e
  const poner: Record<string, string> = { ...previo.poner }
  delete poner[campo]
  const quitar = previo.quitar.filter((q) => q !== campo)
  const vacio = Object.keys(poner).length === 0 && quitar.length === 0
  return conCambio(e, idEjson, vacio ? null : { tipo: 'actualizar', poner, quitar })
}

/** Reemplaza el documento entero (el panel JSON editado): pisa lo pendiente de sus celdas. */
export function reemplazarDoc(e: EdicionDocs, idEjson: string, documento: string): EdicionDocs {
  if (cambioDeDoc(e, idEjson)?.tipo === 'borrar') return e
  return conCambio(e, idEjson, { tipo: 'reemplazar', documento })
}

/** Marca o desmarca el borrado (borrar pisa lo pendiente del documento, como en la rejilla SQL). */
export function alternarBorrado(e: EdicionDocs, idEjson: string): EdicionDocs {
  return conCambio(e, idEjson, cambioDeDoc(e, idEjson)?.tipo === 'borrar' ? null : { tipo: 'borrar' })
}

/** Deshace todo lo pendiente de un documento. */
export function descartarDoc(e: EdicionDocs, idEjson: string): EdicionDocs {
  return conCambio(e, idEjson, null)
}

export function insertarDoc(e: EdicionDocs, documento: string): EdicionDocs {
  return { ...e, insertados: [...e.insertados, documento] }
}

export function editarInsertado(e: EdicionDocs, i: number, documento: string): EdicionDocs {
  if (i < 0 || i >= e.insertados.length) return e
  const insertados = [...e.insertados]
  insertados[i] = documento
  return { ...e, insertados }
}

export function quitarInsertado(e: EdicionDocs, i: number): EdicionDocs {
  if (i < 0 || i >= e.insertados.length) return e
  return { ...e, insertados: [...e.insertados.slice(0, i), ...e.insertados.slice(i + 1)] }
}

/** Lo que viaja en `DbDocEnviar.cambios`, en el orden de la interfaz (ver el ADR). */
export function cambiosDeEdicion(e: EdicionDocs): DbDocCambio[] {
  const out: DbDocCambio[] = []
  for (const { idEjson, cambio } of e.docs) {
    if (cambio.tipo === 'actualizar') out.push({ tipo: 'actualizar', idEjson, poner: { ...cambio.poner }, quitar: [...cambio.quitar] })
    else if (cambio.tipo === 'reemplazar') out.push({ tipo: 'reemplazar', idEjson, documento: cambio.documento })
    else out.push({ tipo: 'borrar', idEjson })
  }
  for (const documento of e.insertados) out.push({ tipo: 'insertar', documento })
  return out
}

/** La inversa de `cambiosDeEdicion`. */
export function edicionDeCambios(cambios: readonly DbDocCambio[]): EdicionDocs {
  const docs: Array<{ idEjson: string; cambio: CambioDoc }> = []
  const insertados: string[] = []
  for (const c of cambios) {
    if (c.tipo === 'insertar') insertados.push(c.documento)
    else if (c.tipo === 'actualizar') docs.push({ idEjson: c.idEjson, cambio: { tipo: 'actualizar', poner: { ...c.poner }, quitar: [...c.quitar] } })
    else if (c.tipo === 'reemplazar') docs.push({ idEjson: c.idEjson, cambio: { tipo: 'reemplazar', documento: c.documento } })
    else docs.push({ idEjson: c.idEjson, cambio: { tipo: 'borrar' } })
  }
  return { docs, insertados }
}

/** Lo que sigue pendiente tras un envío que dejó aplicados los `aplicados` primeros. */
export function restanTrasEnvio(e: EdicionDocs, aplicados: number): EdicionDocs {
  if (aplicados <= 0) return e
  return edicionDeCambios(cambiosDeEdicion(e).slice(aplicados))
}

/** A qué fila corresponde el cambio `indice` de `cambiosDeEdicion` (para marcar la que falló). */
export function claveDelCambio(e: EdicionDocs, indice: number): string | null {
  if (indice < 0) return null
  if (indice < e.docs.length) return claveDoc(e.docs[indice].idEjson)
  const i = indice - e.docs.length
  return i < e.insertados.length ? claveNuevo(i) : null
}

// --- Filas de la tabla ---------------------------------------------------------------------

export type EstadoFilaDocs = 'normal' | 'cambiado' | 'reemplazado' | 'borrado' | 'nuevo'

export interface FilaDocs {
  /** Estable entre recargas: `doc:<idEjson>` o `nuevo:<i>`. */
  clave: string
  documento: DbDocDocumento
  estado: EstadoFilaDocs
  /** Campos con un valor sin enviar (se pintan como la celda cambiada de la rejilla SQL). */
  cambiados: ReadonlySet<string>
  /** Con `estado: 'nuevo'`: su posición en `EdicionDocs.insertados`. */
  insertado?: number
}

export const claveDoc = (idEjson: string): string => `doc:${idEjson}`
export const claveNuevo = (i: number): string => `nuevo:${i}`

const NINGUNO: ReadonlySet<string> = new Set()

/** Las filas que pinta la tabla: lo cargado con lo pendiente aplicado y, detrás, los nuevos. */
export function filasConEdicion(documentos: readonly DbDocDocumento[], e: EdicionDocs): FilaDocs[] {
  const porId = new Map(e.docs.map((d) => [d.idEjson, d.cambio]))
  const out: FilaDocs[] = []
  for (const d of documentos) {
    const clave = claveDoc(d.idEjson)
    const cambio = porId.get(d.idEjson)
    if (!cambio) {
      out.push({ clave, documento: d, estado: 'normal', cambiados: NINGUNO })
    } else if (cambio.tipo === 'borrar') {
      out.push({ clave, documento: d, estado: 'borrado', cambiados: NINGUNO })
    } else if (cambio.tipo === 'reemplazar') {
      const nuevo = documentoDeTexto(d.idEjson, cambio.documento)
      const cambiados = new Set<string>()
      for (const [k, c] of Object.entries(nuevo.celdas)) if (d.celdas[k]?.vista !== c.vista) cambiados.add(k)
      for (const k of Object.keys(d.celdas)) if (!(k in nuevo.celdas)) cambiados.add(k)
      out.push({ clave, documento: nuevo, estado: 'reemplazado', cambiados })
    } else {
      const celdas: Record<string, DbDocCelda> = { ...d.celdas }
      for (const [k, v] of Object.entries(cambio.poner)) celdas[k] = celdaDeValorTexto(v)
      for (const k of cambio.quitar) delete celdas[k]
      out.push({
        clave,
        documento: { idEjson: d.idEjson, texto: textoConCambios(d.texto, cambio.poner, cambio.quitar), celdas },
        estado: 'cambiado',
        cambiados: new Set([...Object.keys(cambio.poner), ...cambio.quitar])
      })
    }
  }
  e.insertados.forEach((texto, i) => {
    out.push({ clave: claveNuevo(i), documento: documentoDeTexto('', texto), estado: 'nuevo', cambiados: NINGUNO, insertado: i })
  })
  return out
}

/** Las columnas de la página y, detrás, los campos que solo traiga lo editado o lo nuevo. */
export function columnasConEdicion(columnas: readonly string[], filas: readonly FilaDocs[]): string[] {
  const extra: string[] = []
  for (const f of filas) if (f.estado !== 'normal') extra.push(...Object.keys(f.documento.celdas))
  return unirColumnas(columnas, extra)
}

// --- Textos ---------------------------------------------------------------------------------

export function textoCambiosDocs(n: number): string {
  return n === 1 ? '1 cambio' : `${n.toLocaleString('es-ES')} cambios`
}

/** Lo que se pregunta antes de enviar varios cambios a un servidor sin transacciones. */
export const TEXTO_SIN_TRANSACCION =
  'Este servidor no admite transacciones: si falla un cambio, los anteriores quedan aplicados y los siguientes no se envían.'

/** El aviso tras «Enviar» (se dice siempre qué entró). */
export function resumenEnvio(r: DbDocResultadoEnvio, total: number): { tono: 'exito' | 'error'; titulo: string; detalle?: string } {
  if (!r.fallo) {
    return { tono: 'exito', titulo: r.aplicados === 1 ? '1 cambio aplicado' : `${r.aplicados.toLocaleString('es-ES')} cambios aplicados` }
  }
  const que = `El cambio ${r.fallo.indice + 1} falló: ${r.fallo.mensaje}`
  if (r.transaccion || r.aplicados === 0) {
    return { tono: 'error', titulo: 'No se aplicó ningún cambio', detalle: r.transaccion ? `${que}. Se deshizo todo.` : `${que}.` }
  }
  return {
    tono: 'error',
    titulo: `Se aplicaron ${r.aplicados} de ${textoCambiosDocs(total)}`,
    detalle: `${que}. Los siguientes no se enviaron y siguen pendientes.`
  }
}

/** Los campos de la barra de la pestaña y la etiqueta que la barra les pone. */
export const CAMPOS_BARRA = ['filtro', 'proyeccion', 'orden'] as const
export type CampoBarra = (typeof CAMPOS_BARRA)[number]
export function esCampoBarra(c: unknown): c is CampoBarra {
  return c === 'filtro' || c === 'proyeccion' || c === 'orden'
}

/** Documento con el que arranca «Añadir documento» (el `_id` lo pone el servidor si falta). */
export const DOCUMENTO_NUEVO = '{\n  \n}'

// --- La consulta: modo guiado / JSON y orden de la cabecera ----------------------------------

/** Los tres campos de texto de la barra JSON. */
export interface BarraDocs {
  filtro: string
  proyeccion: string
  orden: string
}
export const BARRA_DOCS_VACIA: BarraDocs = { filtro: '', proyeccion: '', orden: '' }

export type ModoFiltroDocs = 'guiado' | 'json'

/** Lo que pide (o pidió) la pestaña: el modo que se ve y lo aplicado de CADA modo. */
export interface ConsultaColeccion {
  modo: ModoFiltroDocs
  /** Lo último aplicado en la barra JSON (se conserva mientras se ve la guiada). */
  barra: BarraDocs
  /** Lo último aplicado en la barra guiada. */
  guiado: DbFiltroGuiado
  /** El orden de la cabecera, por prioridad. Vale en los dos modos. */
  orden: DbOrdenColumna[]
}

export const CONSULTA_INICIAL: ConsultaColeccion = {
  modo: 'guiado',
  barra: BARRA_DOCS_VACIA,
  guiado: { union: 'todas', condiciones: [] },
  orden: []
}

type CamposConsulta = Pick<DbDocConsultar, 'filtro' | 'proyeccion' | 'orden' | 'filtroGuiado' | 'ordenColumnas'>

/**
 * Los campos de `DbDocConsultar` de una consulta: en modo guiado, el filtro guiado (y nada de
 * texto); en modo JSON, los tres textos. El orden de la cabecera va en los dos, salvo que
 * haya orden de texto (no debería: ver el ADR; si pasa, gana el texto, que es
 * lo que el usuario ve escrito). Los opcionales vacíos NO viajan.
 */
export function camposDeConsulta(c: ConsultaColeccion): CamposConsulta {
  const r: CamposConsulta =
    c.modo === 'guiado'
      ? { filtro: '', proyeccion: '', orden: '' }
      : { filtro: c.barra.filtro, proyeccion: c.barra.proyeccion, orden: c.barra.orden }
  if (c.modo === 'guiado' && !filtroVacio(c.guiado)) r.filtroGuiado = c.guiado
  if (c.orden.length > 0 && r.orden.trim() === '') r.ordenColumnas = c.orden
  return r
}

/** ¿Dos consultas piden lo MISMO al servidor? (para no repetir la petición al cambiar de modo). */
export function mismaPeticion(a: ConsultaColeccion, b: ConsultaColeccion): boolean {
  return JSON.stringify(camposDeConsulta(a)) === JSON.stringify(camposDeConsulta(b))
}

/** El clic en la cabecera: el orden nuevo, y el orden de TEXTO vaciado (son excluyentes). */
export function consultaConOrden(c: ConsultaColeccion, orden: DbOrdenColumna[]): ConsultaColeccion {
  return { ...c, orden, barra: c.barra.orden === '' ? c.barra : { ...c.barra, orden: '' } }
}

/** Aplicar la barra JSON: un orden de texto no vacío deja sin efecto el de la cabecera. */
export function consultaJsonAplicada(c: ConsultaColeccion, barra: BarraDocs): ConsultaColeccion {
  return { ...c, modo: 'json', barra, orden: barra.orden.trim() === '' ? c.orden : [] }
}

/** ¿La consulta filtra algo? (el «Ningún documento cumple el filtro» del estado vacío). */
export function consultaFiltra(c: ConsultaColeccion): boolean {
  return c.modo === 'guiado' ? !filtroVacio(c.guiado) : c.barra.filtro.trim() !== ''
}

/** ¿Hay una proyección aplicada? (el documento que se ve es PARCIAL: no se reemplaza entero). */
export function consultaProyecta(c: ConsultaColeccion): boolean {
  return c.modo === 'json' && c.barra.proyeccion.trim() !== ''
}

/**
 * El filtro que se lleva «Abrir consola». En modo guiado es `{}`: el texto compilado del
 * filtro guiado vive en el main y aquí no se reconstruye.
 */
export function filtroParaConsola(c: ConsultaColeccion): string {
  return c.modo === 'json' ? c.barra.filtro.trim() || '{}' : '{}'
}

/** A dónde va un error de la consulta: a una fila de la barra guiada, a un campo JSON o a la tabla. */
export type DestinoError =
  | { tipo: 'guiado'; condicion: number | null }
  | { tipo: 'campo'; campo: CampoBarra }
  | { tipo: 'general' }

export function destinoDelError(e: DbErrorSql, modo: ModoFiltroDocs): DestinoError {
  if (modo === 'guiado' && e.campo === 'filtro') {
    const i = e.condicion
    return { tipo: 'guiado', condicion: typeof i === 'number' && Number.isInteger(i) && i >= 0 ? i : null }
  }
  // Un error del ORDEN de la cabecera en modo guiado (claves numéricas, un tope) va bajo la
  // barra guiada: como error general sustituiría una tabla cuyos documentos están bien.
  if (modo === 'guiado' && e.campo === 'orden') return { tipo: 'guiado', condicion: null }
  if (modo === 'json' && esCampoBarra(e.campo)) return { tipo: 'campo', campo: e.campo }
  return { tipo: 'general' }
}

/**
 * Por qué un campo NO se ofrece en el filtro guiado ni se ordena por la cabecera, o null. El
 * main rechaza un nombre que empiece por `$` y lee `a.b` como RUTA (el campo `b` dentro
 * de `a`): un campo de primer nivel que se llame literalmente `a.b` filtraría otra cosa. Para
 * esos está el modo JSON.
 */
export function motivoNoGuiarCampo(nombre: string): string | null {
  if (nombre === '') return 'Un campo sin nombre no se puede filtrar ni ordenar desde aquí: usa JSON.'
  if (nombre.charAt(0) === '$') return 'Un campo que empieza por «$» no se puede filtrar ni ordenar desde aquí: usa JSON.'
  if (nombre.indexOf('.') >= 0) {
    return 'El punto se lee como una ruta (a.b es el campo b dentro de a): para este campo, usa JSON.'
  }
  return null
}

/** Los tipos de un campo en la página, del más frecuente al menos (a igualdad, el primero visto). */
function tiposEnPagina(documentos: readonly DbDocDocumento[], campo: string): DbDocTipo[] {
  const cuenta = new Map<DbDocTipo, number>()
  for (const d of documentos) {
    const t = d.celdas[campo]?.tipo
    if (t !== undefined) cuenta.set(t, (cuenta.get(t) ?? 0) + 1)
  }
  // `sort` es estable (ES2019): a igual cuenta queda el orden de aparición.
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
}

/**
 * Las columnas de la barra guiada: primero los campos de la MUESTRA (su categoría sale de los
 * tipos muestreados; si la muestra solo vio null, de la página) y detrás las columnas de la
 * página que la muestra no traía (categoría por los tipos de sus celdas). Sin los campos que
 * no se pueden guiar (`motivoNoGuiarCampo`). `campos` null = la muestra aún no ha llegado.
 */
export function columnasFiltrables(
  campos: readonly DbDocCampoMuestra[] | null,
  columnas: readonly string[],
  documentos: readonly DbDocDocumento[]
): ColumnaFiltrable[] {
  const r: ColumnaFiltrable[] = []
  const vistos = new Set<string>()
  const poner = (nombre: string, tipos: readonly DbDocTipo[]): void => {
    if (vistos.has(nombre)) return
    vistos.add(nombre)
    if (motivoNoGuiarCampo(nombre) !== null) return
    r.push({ nombre, categoria: categoriaDeDocTipos(tipos) })
  }
  for (const c of campos ?? []) {
    poner(c.nombre, c.tipos.some((t) => t !== 'null') ? c.tipos : tiposEnPagina(documentos, c.nombre))
  }
  for (const c of columnas) poner(c, tiposEnPagina(documentos, c))
  return r
}
