// =============================================================================
// Valor completo de una celda (visor de valor): el SQL que vuelve a buscar la fila por su
// clave primaria y la lectura del resultado. Puro, sin electron ni drivers.
// Lo que cambia por motor (binario, booleano, marcador) lo dan `motores/sesion*.ts` y el dialecto.
// La clave llega como el texto que pintó la rejilla y viaja con binds de texto: vale porque son
// números exactos y fechas con el formato que Tessera fija en la sesión. Sin PK, se rechaza.
// =============================================================================

import type {
  DbCelda,
  DbColumnaInfo,
  DbColumnaResultado,
  DbTipoLogico,
  DbValor
} from '../../../shared/db-explorador-ipc.ts'
import { marcadorPosicional, type DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import { citar } from '../../../shared/sql/identificadoresSql.ts'
import { motorExplorador } from './motores/index.ts'

export interface ColumnaClave {
  nombre: string
  /** RAW/BLOB/bytea: el valor llega como '0x…' y hay que convertirlo en el servidor. */
  binario: boolean
}

export interface PeticionConsultaValor {
  dialecto: DialectoSql
  esquema: string
  nombre: string
  columna: string
  pk: readonly ColumnaClave[]
  /** Valores de la PK en el orden de `pk`, tal como los tiene la rejilla. */
  clave: readonly DbCelda[]
  /** La base del nivel «Bases» (SQL Server sin base fija); ausente = la de la sesión. */
  base?: string
}

export type ConsultaValor = { sql: string; binds: string[] } | { error: string }

export function esErrorValor(c: ConsultaValor): c is { error: string } {
  return 'error' in c
}

const HEX = /^0x[0-9a-f]*$/i

/** ¿Es binaria la columna, según el tipo que da el catálogo? (La regla, en `motores/sesion*.ts`.) */
export function esTipoBinario(tipo: string, d: DialectoSql): boolean {
  const t = tipo.trim().toUpperCase()
  return motorExplorador(d).sesion.esTipoBinario(t)
}

/** Las columnas de la PK con su marca de binario, desde las columnas del catálogo. */
export function columnasClave(
  pk: readonly string[],
  columnas: readonly DbColumnaInfo[],
  d: DialectoSql
): ColumnaClave[] {
  return pk.map((nombre) => {
    const c = columnas.find((x) => x.nombre === nombre)
    return { nombre, binario: c ? esTipoBinario(c.tipo, d) : false }
  })
}

/**
 * `SELECT "COL" FROM "E"."O" WHERE "PK1" = :1 AND …` (Oracle) o con `$1…` (PG).
 * Nunca lanza con un dialecto conocido: lo que no cuadra vuelve como `{ error }`.
 */
export function construirConsultaValor(p: PeticionConsultaValor): ConsultaValor {
  if (p.pk.length === 0) {
    return { error: 'La tabla no tiene clave primaria: no hay forma fiable de volver a encontrar la fila.' }
  }
  if (p.clave.length !== p.pk.length) {
    return { error: 'La clave de la fila no cuadra con la clave primaria de la tabla: vuelve a abrirla.' }
  }
  if (!p.esquema || !p.nombre || !p.columna) return { error: 'Falta el objeto o la columna.' }
  const binds: string[] = []
  const condiciones: string[] = []
  const sesion = motorExplorador(p.dialecto).sesion
  for (let i = 0; i < p.pk.length; i++) {
    const v = p.clave[i]
    if (v === null || v === undefined) return { error: 'La clave de la fila tiene un valor nulo.' }
    let bind: string
    if (typeof v === 'boolean') bind = sesion.bindBooleano(v)
    else bind = v
    const marca = marcadorPosicional(p.dialecto, i + 1)
    let lado = marca
    if (p.pk[i].binario) {
      if (!HEX.test(bind)) return { error: 'La clave binaria no llegó como hexadecimal.' }
      bind = bind.slice(2)
      lado = sesion.ladoClaveBinaria(marca)
    }
    binds.push(bind)
    condiciones.push(`${citar(p.pk[i].nombre)} = ${lado}`)
  }
  const base = p.base ? `${citar(p.base)}.` : ''
  return {
    sql: `SELECT ${citar(p.columna)} FROM ${base}${citar(p.esquema)}.${citar(p.nombre)}\nWHERE ${condiciones.join(' AND ')}`,
    binds
  }
}

/** Lo que el trabajador devolvió para esa consulta (una fila, una columna). */
export interface LecturaValor {
  columnas: readonly DbColumnaResultado[]
  filasJson: string
  nFilas: number
  recortes?: ReadonlyArray<readonly [number, number, number]>
}

/** `DbValor` desde la lectura, o null si la fila ya no existe. */
export function valorDeLectura(r: LecturaValor): DbValor | null {
  if (r.nFilas < 1) return null
  const filas = JSON.parse(r.filasJson) as unknown
  if (!Array.isArray(filas) || !Array.isArray(filas[0])) return null
  const celda = (filas[0] as unknown[])[0]
  const tipoLogico: DbTipoLogico = r.columnas[0]?.tipoLogico ?? 'otro'
  let valor: string | null
  if (celda === null || celda === undefined) valor = null
  else if (typeof celda === 'boolean') valor = celda ? 'true' : 'false'
  else valor = String(celda)
  const recorte = (r.recortes ?? []).find((x) => x[0] === 0 && x[1] === 0)
  let longitud: number
  if (recorte) longitud = recorte[2]
  else if (valor === null) longitud = 0
  else if (tipoLogico === 'binario' && /^0x/i.test(valor)) longitud = (valor.length - 2) / 2
  else longitud = valor.length
  return { valor, tipoLogico, longitud, recortado: recorte !== undefined }
}
