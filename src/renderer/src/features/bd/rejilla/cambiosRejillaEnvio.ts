// =============================================================================
// De los cambios de la rejilla al contrato de «Enviar»: los `DbCambioFila` en su orden,
// con la clave y los originales de cada fila, y la vista previa con el constructor del main.
// Puro; lo reexporta `cambiosRejilla.ts`.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-cambios.md
// =============================================================================

import type { DbMotor } from '../../../../../shared/db-ipc.ts'
import type {
  DbCambioFila,
  DbCelda,
  DbColumnaResultado,
  DbIdentidadFila,
  DbOriginalesFila,
  DbTipoLogico,
  DbValorEdicion
} from '../../../../../shared/db-explorador-ipc.ts'
import { COLUMNA_ROWID, ErrorDml, sentenciaDeCambio, vistaTerminada, type ObjetoDml } from '../../../../../shared/sql/dmlRejilla.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import {
  comparacionOriginal,
  FAMILIA_COMPARABLE,
  valorOriginalComparable,
  type ComparacionOriginal
} from '../../../../../shared/sql/originalesSql.ts'
import type { CambiosRejilla, FilaEditada, RefFila } from './cambiosRejillaModelo.ts'

/** Lo que hace falta de la pestaña para convertir los cambios en el contrato. */
export interface ContextoEnvio {
  /** TODAS las columnas del resultado (con la oculta del ROWID, si la hay). */
  columnas: readonly DbColumnaResultado[]
  identidad: DbIdentidadFila
  /** Las filas cargadas del servidor. */
  filas: readonly (readonly DbCelda[])[]
  /** ¿Llegó recortada esta celda del servidor? (una clave recortada no sirve para buscar) */
  recortada?: (f: number, c: number) => boolean
  /**
   * Con el ROWID, las columnas que el MAIN compara (`DbTablaAbierta.comparables`). No se
   * manda el original de ninguna fuera de ella; sin la lista, de ninguna: lo que se
   * enseña en la vista previa tiene que ser lo que corre.
   */
  comparables?: readonly string[]
  /**
   * El dialecto de la conexión: la regla de TIPO de los originales es de cada motor
   * (`comparacionOriginal`). Ausente = la de Oracle (las pruebas de Oracle lo dejan fuera);
   * la pantalla lo pasa siempre.
   */
  dialecto?: DialectoSql
}

/** Los cambios listos para el main con la fila de cada uno, o la fila que no se pudo. */
export type ResultadoEnvio =
  | { ok: true; cambios: DbCambioFila[]; origen: RefFila[] }
  | { ok: false; error: string; fila: RefFila }

function claveDe(ctx: ContextoEnvio, f: number): { ok: true; clave: DbCelda[] } | { ok: false; error: string } {
  const fila = ctx.filas[f]
  if (!fila) return { ok: false, error: 'La fila ya no está cargada: vuelve a abrir la tabla.' }
  const id = ctx.identidad
  if (id.tipo === 'ninguna') return { ok: false, error: id.motivo || 'Esta tabla no se puede editar.' }
  const columnas = id.tipo === 'rowid' ? [id.columna] : id.columnas
  const nombres = ctx.columnas.map((c) => c.nombre)
  const clave: DbCelda[] = []
  for (const k of columnas) {
    // Por NOMBRE EXACTO: en PG "ID" e id son columnas distintas. Con 'rowid' es la
    // ÚLTIMA (la oculta), aunque otra se llamara igual.
    const c = id.tipo === 'rowid' ? nombres.length - 1 : nombres.indexOf(k)
    if (c < 0 || nombres[c] !== k) return { ok: false, error: `La columna ${k} de la clave no está en el resultado.` }
    if (ctx.recortada?.(f, c)) return { ok: false, error: `El valor de ${k} (clave) llegó recortado: no sirve para encontrar la fila.` }
    clave.push(c < fila.length ? fila[c] : null)
  }
  return { ok: true, clave }
}

function valoresPorNombre(
  columnas: readonly DbColumnaResultado[],
  valores: ReadonlyMap<number, DbValorEdicion>
): Record<string, DbValorEdicion> {
  const out: Record<string, DbValorEdicion> = {}
  // En el orden de las columnas de la tabla, no en el de edición: la vista previa se lee
  // mejor, y dos envíos de lo mismo dan el mismo SQL.
  const orden = [...valores.keys()].sort((a, b) => a - b)
  for (const c of orden) {
    const col = columnas[c]
    if (col) out[col.nombre] = valores.get(c) ?? null
  }
  return out
}

// --- Concurrencia optimista ---------------------------------------------------------

/**
 * Cómo se compara una columna con lo leído, o null si no se compara. La regla del TIPO y
 * la del VALOR son las del main (`shared/sql/originalesSql.ts`); aquí solo se QUITA de
 * más: la columna oculta del ROWID y la que trae otra familia lógica que la de su tipo.
 */
function comparacionDe(col: DbColumnaResultado, d: DialectoSql = 'oracle'): ComparacionOriginal | null {
  if (col.nombre === COLUMNA_ROWID) return null
  const comparacion = comparacionOriginal(d, col.tipoMotor)
  return comparacion !== null && FAMILIA_COMPARABLE[comparacion] === col.tipoLogico ? comparacion : null
}

/** ¿Se puede comprobar esta COLUMNA con lo leído? (por su tipo; la celda se mira aparte) */
export function columnaComparable(col: DbColumnaResultado, d?: DialectoSql): boolean {
  return comparacionDe(col, d) !== null
}

/** Los nombres que aparecen más de una vez: no se sabe a cuál de ellos se refiere el main. */
function nombresRepetidos(columnas: readonly DbColumnaResultado[]): Set<string> {
  const vistos = new Set<string>()
  const repetidos = new Set<string>()
  for (const col of columnas) {
    if (vistos.has(col.nombre)) repetidos.add(col.nombre)
    vistos.add(col.nombre)
  }
  return repetidos
}

/**
 * El original de la celda `c` si se compara, o undefined. Una recortada no es el valor
 * entero, y fuera de la fila no se inventa un NULL que no se leyó; el valor pasa la MISMA
 * regla que aplica el main (con U+FFFD, un número «~», una fecha antes de Cristo… fuera).
 */
function originalDeCelda(ctx: ContextoEnvio, f: number, c: number, fila: readonly DbCelda[]): DbValorEdicion | undefined {
  const comparacion = comparacionDe(ctx.columnas[c], ctx.dialecto)
  if (comparacion === null || c >= fila.length || ctx.recortada?.(f, c)) return undefined
  const v = fila[c]
  return valorOriginalComparable(comparacion, v) ? v : undefined
}

/**
 * Los valores LEÍDOS de las columnas comparables de la fila `f`, para el WHERE del
 * UPDATE/DELETE (`DbOriginalesFila`). Solo con la identidad 'rowid': la PK identifica
 * la fila por su VALOR y no le hace falta. `undefined` si no hay ninguna que comparar
 * (el cambio va entonces solo por su ROWID).
 */
function originalesDe(ctx: ContextoEnvio, f: number): DbOriginalesFila | undefined {
  if (ctx.identidad.tipo !== 'rowid') return undefined
  const fila = ctx.filas[f]
  if (!fila) return undefined
  // Solo las que el main dice que compara: sin su lista, ninguna (ver `ContextoEnvio`).
  const delMain = new Set(ctx.comparables ?? [])
  if (delMain.size === 0) return undefined
  const repetidos = nombresRepetidos(ctx.columnas)
  const ultima = ctx.columnas.length - 1 // la oculta del ROWID: ya es la identidad
  const out: DbOriginalesFila = {}
  let n = 0
  for (let c = 0; c < ultima; c++) {
    const nombre = ctx.columnas[c].nombre
    if (repetidos.has(nombre) || !delMain.has(nombre)) continue
    const v = originalDeCelda(ctx, f, c, fila)
    if (v === undefined) continue
    out[nombre] = v
    n++
  }
  return n > 0 ? out : undefined
}

/**
 * Los cambios en el orden de envío (borrados, actualizaciones, inserciones) y la fila de
 * la rejilla de cada uno. Falla, con la fila, si una clave no se puede leer. Con la
 * identidad 'rowid', los UPDATE y DELETE llevan además los valores leídos de la fila.
 */
export function aCambiosFila(c: CambiosRejilla, ctx: ContextoEnvio): ResultadoEnvio {
  const cambios: DbCambioFila[] = []
  const origen: RefFila[] = []
  const indices = [...c.editadas.keys()].sort((a, b) => a - b)
  for (const f of indices) {
    const e = c.editadas.get(f) as FilaEditada
    if (!e.borrada) continue
    const k = claveDe(ctx, f)
    if (!k.ok) return { ok: false, error: k.error, fila: { tipo: 'servidor', f } }
    const originales = originalesDe(ctx, f)
    cambios.push(originales ? { tipo: 'borrar', clave: k.clave, originales } : { tipo: 'borrar', clave: k.clave })
    origen.push({ tipo: 'servidor', f })
  }
  for (const f of indices) {
    const e = c.editadas.get(f) as FilaEditada
    if (e.borrada || e.valores.size === 0) continue
    const k = claveDe(ctx, f)
    if (!k.ok) return { ok: false, error: k.error, fila: { tipo: 'servidor', f } }
    const valores = valoresPorNombre(ctx.columnas, e.valores)
    const originales = originalesDe(ctx, f)
    cambios.push(
      originales ? { tipo: 'actualizar', clave: k.clave, valores, originales } : { tipo: 'actualizar', clave: k.clave, valores }
    )
    origen.push({ tipo: 'servidor', f })
  }
  for (const n of c.nuevas) {
    cambios.push({ tipo: 'insertar', valores: valoresPorNombre(ctx.columnas, n.valores) })
    origen.push({ tipo: 'nueva', id: n.id })
  }
  return { ok: true, cambios, origen }
}

/** Qué fila de la rejilla corresponde al cambio `indice` (el del error del main). */
export function filaDeIndice(origen: readonly RefFila[], indice: number): RefFila | null {
  return Number.isInteger(indice) && indice >= 0 && indice < origen.length ? origen[indice] : null
}

/** La vista previa del envío, o el cambio que no se pudo construir. */
export type PreviaEnvio =
  | { ok: true; lineas: string[]; texto: string }
  | { ok: false; error: string; indice: number }

/**
 * La vista previa, sentencia a sentencia (con `sentenciaDeCambio`, la misma que ejecuta
 * el main). Si una no se puede construir (un INSERT sin valores en Oracle, una clave con
 * NULL…), dice cuál: la pestaña señala su fila sin abrir el diálogo.
 */
export function previaEnvio(
  motor: DbMotor,
  objeto: ObjetoDml,
  identidad: DbIdentidadFila,
  cambios: readonly DbCambioFila[],
  tipos: Readonly<Record<string, DbTipoLogico | undefined>> = {}
): PreviaEnvio {
  const lineas: string[] = []
  for (let i = 0; i < cambios.length; i++) {
    try {
      // Con su terminador: `;`, o la `/` de un bloque si un nombre no se puede escribir tal
      // cual para SQL*Plus (`dmlRejilla`).
      lineas.push(vistaTerminada(sentenciaDeCambio(motor, objeto, identidad, cambios[i], tipos)))
    } catch (err) {
      if (err instanceof ErrorDml) return { ok: false, error: err.message, indice: i }
      throw err
    }
  }
  return { ok: true, lineas, texto: lineas.join('\n') }
}

/** Tipos lógicos por nombre de columna, para los literales de la vista previa. */
export function tiposPorNombre(columnas: readonly DbColumnaResultado[]): Record<string, DbTipoLogico> {
  const out: Record<string, DbTipoLogico> = {}
  for (const c of columnas) out[c.nombre] = c.tipoLogico
  return out
}

/**
 * El mensaje de un envío que falló, para el usuario. Un UPDATE/DELETE que no tocó
 * EXACTAMENTE una fila no es un error del servidor: la fila cambió o ya no está.
 */
export function mensajeFallo(error: { mensaje: string; codigo?: string }, filas: number | undefined): string {
  if (filas !== undefined && filas !== 1) {
    return filas === 0
      ? 'La fila cambió o ya no existe: el cambio no encontró ninguna fila con la clave que se leyó.'
      : `El cambio tocaba ${filas} filas en vez de una: la clave no identifica una sola fila.`
  }
  return error.codigo ? `[${error.codigo}] ${error.mensaje}` : error.mensaje
}
