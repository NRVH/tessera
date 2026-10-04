// =============================================================================
// camposDocs: lectura de los campos de primer nivel de un documento en texto, su tipo y
// su celda, y el texto rehecho con campos puestos o quitados. Puro (sobre `tokensDocs.ts`):
// el renderer no carga `bson`, así que el valor entero de un campo se lee del texto.
// Lo usa `coleccionDocs.ts` (cambios pendientes y filas de la tabla).
// Decisiones: docs/decisiones/bd/ui-documentos-texto-y-cambios.md
// =============================================================================

import type { DbDocCelda, DbDocDocumento, DbDocTipo } from '../../../../../shared/db-documentos-ipc.ts'
import { compactarTexto, siguienteSignificativo, tokenizar, type Token } from './tokensDocs.ts'

export interface CampoTexto {
  /** El nombre del campo, sin comillas. */
  nombre: string
  /** La clave tal como venía escrita (`"a b"`, `nombre`), para rehacer el documento. */
  claveTexto: string
  /** El texto del valor, recortado. */
  valor: string
}

function nombreDeClave(t: string): string | null {
  if (t.startsWith('"')) {
    try {
      const v: unknown = JSON.parse(t)
      return typeof v === 'string' ? v : null
    } catch {
      return null
    }
  }
  if (t.startsWith("'")) {
    if (t.length < 2 || !t.endsWith("'")) return null
    return t.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return t
}

const esPuntuacion = (t: Token, texto: string): boolean => t.clase === 'puntuacion' && t.texto === texto

/** +1 si el token abre `{`, `[` o `(`; -1 si cierra; 0 en cualquier otro caso. */
function cambioDeProfundidad(t: Token): number {
  if (t.clase !== 'puntuacion') return 0
  if ('{[('.includes(t.texto)) return 1
  return '}])'.includes(t.texto) ? -1 : 0
}

/** El texto del valor que empieza en `desde`, y el índice del `,` o del cierre que lo termina; null si no termina. */
function recorrerValor(tokens: readonly Token[], desde: number): { valor: string; fin: number } | null {
  let profundidad = 0
  let valor = ''
  let j = desde
  for (; j < tokens.length; j++) {
    const v = tokens[j]
    const d = cambioDeProfundidad(v)
    if (d < 0 && profundidad === 0) break
    if (profundidad === 0 && esPuntuacion(v, ',')) break
    profundidad += d
    valor += v.texto
  }
  return j >= tokens.length ? null : { valor, fin: j }
}

/** El campo que empieza en `tokens[k]` y el índice por donde sigue el objeto; null si no se lee. */
function leerCampo(tokens: readonly Token[], k: number): { campo: CampoTexto; siguiente: number } | null {
  const t = tokens[k]
  if (t.clase !== 'clave') return null
  const nombre = nombreDeClave(t.texto)
  if (nombre === null) return null
  const dosPuntos = siguienteSignificativo(tokens, k + 1)
  if (dosPuntos < 0 || tokens[dosPuntos].texto !== ':') return null
  const r = recorrerValor(tokens, dosPuntos + 1)
  if (!r) return null
  const valor = r.valor.trim()
  if (valor === '') return null
  // `fin` es la coma (se salta) o la llave de cierre (la mira la vuelta siguiente).
  const siguiente = tokens[r.fin].texto === ',' ? siguienteSignificativo(tokens, r.fin + 1) : r.fin
  return { campo: { nombre, claveTexto: t.texto, valor }, siguiente }
}

/**
 * Los campos de PRIMER nivel de un documento en texto, en su orden. null si el texto no es un
 * objeto que se pueda leer así (no empieza por `{`, una clave sin `:`, sin cerrar…): quien
 * llama enseña el texto tal cual y no ofrece editar celdas.
 */
export function camposDeTexto(texto: string): CampoTexto[] | null {
  const tokens = tokenizar(texto)
  let k = siguienteSignificativo(tokens, 0)
  if (k < 0 || !esPuntuacion(tokens[k], '{')) return null
  const campos: CampoTexto[] = []
  k = siguienteSignificativo(tokens, k + 1)
  while (k >= 0) {
    if (esPuntuacion(tokens[k], '}')) return siguienteSignificativo(tokens, k + 1) < 0 ? campos : null
    const leido = leerCampo(tokens, k)
    if (!leido) return null
    campos.push(leido.campo)
    k = leido.siguiente
  }
  return null
}

/** Cuántos elementos tiene un array en texto (`[1, 2, [3]]` -> 3); null si no es un array. */
function elementosDeArray(texto: string): number | null {
  const tokens = tokenizar(texto)
  const k = siguienteSignificativo(tokens, 0)
  if (k < 0 || tokens[k].texto !== '[') return null
  let profundidad = 0
  let n = 0
  let hayAlgo = false
  for (let j = k + 1; j < tokens.length; j++) {
    const t = tokens[j]
    if (t.clase === 'espacio') continue
    const d = cambioDeProfundidad(t)
    if (d < 0 && profundidad === 0) return hayAlgo ? n + 1 : n
    if (profundidad === 0 && esPuntuacion(t, ',')) {
      n++
      continue
    }
    profundidad += d
    hayAlgo = true
  }
  return null
}

const TIPO_CONSTRUCTOR: Record<string, DbDocTipo> = {
  ObjectId: 'objectId',
  ISODate: 'date',
  Date: 'date',
  new: 'date',
  NumberLong: 'long',
  Long: 'long',
  NumberDecimal: 'decimal',
  Decimal128: 'decimal',
  NumberInt: 'int',
  Int32: 'int',
  Double: 'double',
  BinData: 'binary',
  Binary: 'binary',
  UUID: 'binary',
  Timestamp: 'timestamp',
  RegExp: 'regex'
}

const TIPO_EJSON: Record<string, DbDocTipo> = {
  $oid: 'objectId',
  $date: 'date',
  $numberLong: 'long',
  $numberDecimal: 'decimal',
  $numberInt: 'int',
  $numberDouble: 'double',
  $binary: 'binary',
  $uuid: 'binary',
  $regularExpression: 'regex',
  $timestamp: 'timestamp'
}

function tipoDeLiteral(texto: string): DbDocTipo {
  if (texto === 'true' || texto === 'false') return 'bool'
  return texto === 'null' || texto === 'undefined' ? 'null' : 'double'
}

function tipoDePuntuacion(t: Token, valor: string): DbDocTipo {
  if (t.texto === '[') return 'array'
  if (t.texto !== '{') return 'otro'
  const campos = camposDeTexto(valor)
  if (campos && campos.length >= 1 && TIPO_EJSON[campos[0].nombre] !== undefined) return TIPO_EJSON[campos[0].nombre]
  return 'objeto'
}

/** El tipo de un valor en texto, por su primer token (solo para pintar lo pendiente). */
export function tipoDeValorTexto(valor: string): DbDocTipo {
  const tokens = tokenizar(valor)
  const k = siguienteSignificativo(tokens, 0)
  if (k < 0) return 'otro'
  const t = tokens[k]
  switch (t.clase) {
    case 'cadena':
      return 'string'
    case 'numero':
      return /[.eE]/.test(t.texto) ? 'double' : 'int'
    case 'literal':
      return tipoDeLiteral(t.texto)
    case 'constructor':
      return TIPO_CONSTRUCTOR[t.texto] ?? 'otro'
    case 'regex':
      return 'regex'
    case 'puntuacion':
      return tipoDePuntuacion(t, valor)
    default:
      return 'otro'
  }
}

/** Tope de lo que pinta una celda editada (el serializador también las recorta). */
export const VISTA_MAX = 200

/** La celda de un valor en texto: un subdocumento se resume (`{ 3 campos }`, `[ 5 ]`) como hace el serializador. */
export function celdaDeValorTexto(valor: string): DbDocCelda {
  const tipo = tipoDeValorTexto(valor)
  if (tipo === 'objeto') {
    const n = camposDeTexto(valor)?.length ?? 0
    return { tipo, vista: n === 1 ? '{ 1 campo }' : `{ ${n} campos }` }
  }
  if (tipo === 'array') return { tipo, vista: `[ ${elementosDeArray(valor) ?? 0} ]` }
  const plano = compactarTexto(valor)
  return { tipo, vista: plano.length > VISTA_MAX ? plano.slice(0, VISTA_MAX - 1) + '…' : plano }
}

/** Un documento de la tabla desde su texto (uno nuevo, o uno reemplazado sin enviar). */
export function documentoDeTexto(idEjson: string, texto: string): DbDocDocumento {
  const celdas: Record<string, DbDocCelda> = {}
  for (const c of camposDeTexto(texto) ?? []) celdas[c.nombre] = celdaDeValorTexto(c.valor)
  return { idEjson, texto, celdas }
}

function claveEscrita(nombre: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(nombre) ? nombre : JSON.stringify(nombre)
}

/**
 * El texto del documento con los campos puestos y quitados (lo que el panel JSON enseña de
 * un documento con celdas pendientes). Si el texto no se puede leer por campos, el de antes.
 */
export function textoConCambios(texto: string, poner: Readonly<Record<string, string>>, quitar: readonly string[]): string {
  const campos = camposDeTexto(texto)
  if (!campos) return texto
  const fuera = new Set(quitar)
  const partes: string[] = []
  const vistos = new Set<string>()
  for (const c of campos) {
    vistos.add(c.nombre)
    if (fuera.has(c.nombre)) continue
    const v = Object.prototype.hasOwnProperty.call(poner, c.nombre) ? poner[c.nombre] : c.valor
    partes.push(`${c.claveTexto}: ${v}`)
  }
  for (const [nombre, v] of Object.entries(poner)) if (!vistos.has(nombre)) partes.push(`${claveEscrita(nombre)}: ${v}`)
  return partes.length === 0 ? '{}' : `{ ${partes.join(', ')} }`
}

/** El valor en texto de un campo de primer nivel (para editar su celda), o null si no está o no se lee. */
export function valorDeCampo(texto: string, campo: string): string | null {
  const c = camposDeTexto(texto)?.find((x) => x.nombre === campo)
  return c ? compactarTexto(c.valor) : null
}

/** Las columnas de `a` y, detrás, las de `b` que no estuvieran (las páginas y lo editado). */
export function unirColumnas(a: readonly string[], b: readonly string[]): string[] {
  const vistas = new Set(a)
  const out = [...a]
  for (const c of b) {
    if (vistas.has(c)) continue
    vistas.add(c)
    out.push(c)
  }
  return out
}
