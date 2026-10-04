// =============================================================================
// Lo que comparten los catálogos y las sesiones por motor: leer valores tolerantes de una fila
// (número, booleano, lista de PG), los avisos y errores de lo que un motor no tiene, y los
// esqueletos de un motor sin escribir. Módulo hoja: no importa nada del explorador, solo `shared/`.
// Decisiones: docs/decisiones/bd/motores-codigo-por-motor.md
// =============================================================================

import type { DbMotor } from '../../../../shared/db-ipc.ts'
import type { DbFk, DbRelacionesFk, DbRestriccionInfo } from '../../../../shared/db-explorador-ipc.ts'
import { etiquetaMotor, etiquetasSqlDonde, IDS_MOTORES_SQL, MOTORES, type DescriptorSql } from '../../../../shared/motores/index.ts'
import type { FilaCatalogo } from './tipos.ts'

export function texto(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'string' ? v : String(v)
}

export function textoOpcional(v: unknown): string | undefined {
  const t = texto(v).trim()
  return t === '' ? undefined : t
}

/** Número de un NUMBER/int que puede llegar como número, bigint o texto exacto. */
export function aNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'bigint') return Number(v)
  const n = Number(texto(v).trim())
  return Number.isFinite(n) ? n : null
}

/** Booleano de PG (`true`/`'t'`), de Oracle (`1`/`'Y'`/`'YES'`) o de un CASE numérico. */
export function aBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const t = texto(v).trim().toUpperCase()
  return t === 'T' || t === 'TRUE' || t === 'Y' || t === 'YES' || t === '1'
}

/**
 * Lista de un array de PG: ya parseado (`['a','b']`) o como literal de texto
 * (`{a,b}`, `{"a,b","c\"d"}`). Los `NULL` sin comillas se descartan.
 */
export function aLista(v: unknown): string[] {
  if (v === null || v === undefined) return []
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map((x) => texto(x))
  const s = texto(v).trim()
  if (!s.startsWith('{') || !s.endsWith('}')) return s === '' ? [] : [s]
  return elementosDeLiteral(s.slice(1, -1))
}

/** Un elemento entre comillas desde la de apertura en `i`: su texto y la posición tras la de cierre. */
function elementoCitado(cuerpo: string, i: number): { elem: string; siguiente: number } {
  let elem = ''
  i++
  while (i < cuerpo.length && cuerpo[i] !== '"') {
    if (cuerpo[i] === '\\' && i + 1 < cuerpo.length) i++
    elem += cuerpo[i]
    i++
  }
  return { elem, siguiente: i + 1 }
}

/** Un elemento sin comillas desde `i` hasta la coma: su texto y la posición de la coma. */
function elementoSinComillas(cuerpo: string, i: number): { elem: string; siguiente: number } {
  let elem = ''
  while (i < cuerpo.length && cuerpo[i] !== ',') {
    elem += cuerpo[i]
    i++
  }
  return { elem, siguiente: i }
}

/** Los elementos del cuerpo de un literal `{a,b}` de PG; los `NULL` sin comillas se descartan. */
function elementosDeLiteral(cuerpo: string): string[] {
  const salida: string[] = []
  let i = 0
  while (i < cuerpo.length) {
    const citado = cuerpo[i] === '"'
    const { elem, siguiente } = citado ? elementoCitado(cuerpo, i) : elementoSinComillas(cuerpo, i)
    if (citado || (elem !== '' && elem.toUpperCase() !== 'NULL')) salida.push(elem)
    i = siguiente + 1 // la coma
  }
  return salida
}

/** Lo que lanza una pieza de un motor que todavía es un ESQUELETO (ver la cabecera). */
export class ErrorPendiente extends Error {}

/**
 * Una pieza del catálogo o de la sesión del main que el motor `motor` todavía no tiene
 * escrita: lanza `ErrorPendiente` con su nombre.
 */
export function pendiente(motor: DbMotor, parte: 'Catálogo' | 'Sesión', que: string): never {
  throw new ErrorPendiente(`${parte} de ${etiquetaMotor(motor)}: «${que}» todavía no está implementado.`)
}

/** ¿Lanza `f` un `ErrorPendiente`? (Para que los tests dejen fuera a un motor en esqueleto.) */
export function enEsqueleto(f: () => unknown): boolean {
  try {
    f()
    return false
  } catch (e) {
    return e instanceof ErrorPendiente
  }
}

/** Lo que un motor no tiene («sinónimos», «fuente de tabla»…); el nombre sale de su descriptor. */
export function noDisponible(motor: DbMotor, que: string): never {
  throw new Error(`Catálogo: «${que}» no existe en ${etiquetaMotor(motor)}`)
}

/**
 * El aviso de una capacidad que el motor NO tiene, nombrando los motores SQL del registro que
 * SÍ la tienen, en el orden de `MOTORES`: «Solo Oracle tiene sinónimos.»; con dos o más,
 * «Solo Oracle y SQL Server tienen sinónimos.». `tiene` lee la capacidad del descriptor.
 */
export function soloMotoresCon(que: string, tiene: (d: DescriptorSql) => boolean): string {
  const cuantos = IDS_MOTORES_SQL.filter((m) => tiene(MOTORES[m])).length
  if (cuantos === 0) return `Ningún motor tiene ${que}.`
  return `Solo ${etiquetasSqlDonde(tiene)} ${cuantos === 1 ? 'tiene' : 'tienen'} ${que}.`
}

/** El destino de un sinónimo, leído de su fila de `sqlResolverSinonimo`. */
export interface DestinoSinonimo {
  esquema: string
  nombre: string
  /** `@enlace` si el destino es remoto; su tipo no se puede preguntar aquí. */
  dblink: string | null
  /** La BASE del destino si es OTRA que la del sinónimo (nombre de tres partes); solo en un motor con nivel «Bases». */
  base?: string
}

/**
 * Filas: `[table_owner, table_name, db_link]` (y, en SQL Server, `base` del destino en una
 * cuarta columna); null si no hay sinónimo (o no se ve).
 */
export function mapearSinonimo(filas: readonly FilaCatalogo[]): DestinoSinonimo | null {
  const f = filas[0]
  if (!f) return null
  const nombre = texto(f[1])
  if (nombre === '') return null
  const destino: DestinoSinonimo = { esquema: texto(f[0]), nombre, dblink: textoOpcional(f[2]) ?? null }
  const base = f.length > 3 ? textoOpcional(f[3]) : undefined
  if (base !== undefined) destino.base = base
  return destino
}

/** Tipo de restricción del contrato por su letra: Oracle (P/U/R) y PG (p/u/f/c/x). */
export const TIPO_RESTRICCION: Record<string, DbRestriccionInfo['tipo']> = {
  P: 'pk',
  U: 'unica',
  R: 'fk',
  p: 'pk',
  u: 'unica',
  f: 'fk',
  c: 'check',
  x: 'exclusion'
}

/** Pone una FK en las salientes, en las entrantes o en las dos (la que apunta a sí misma). */
export function clasificarFk(fk: DbFk, esquema: string, objeto: string, r: DbRelacionesFk): void {
  if (fk.desde.esquema === esquema && fk.desde.tabla === objeto) r.salientes.push(fk)
  // Una FK de la tabla a sí misma (el jefe de un empleado) es las dos cosas.
  if (fk.hacia.esquema === esquema && fk.hacia.tabla === objeto) r.entrantes.push(fk)
}

/** Aviso de una fuente que no llegó (en todos los motores). */
export const AVISO_SIN_FUENTE = 'No hay fuente visible: el objeto no existe o faltan privilegios para verlo.'
