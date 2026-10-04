// =============================================================================
// Tipos y constantes compartidos por el compositor de SQL de la pestaña de tabla: la petición,
// la consulta compuesta con sus rangos, el error con su campo y la clave del paginado 'keyset'.
// Sin lógica de composición: `sqlRejilla.ts` los reexporta, así que nadie importa de aquí fuera.
// Decisiones: docs/decisiones/bd/rejilla-sql-fragmentos.md
// =============================================================================

import type { DbFiltroGuiado, DbOrdenColumna } from '../../../shared/filtroGuiado.ts'
import type { FormaPaginado } from '../../../shared/motores/index.ts'
import type { DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import type { BindEntradaLob, BindValorSqlite } from './protocoloTrabajador.ts'
import type { ValorFiltroSql } from './filtroSql.ts'

/** Los dos campos que escribe el usuario (coincide con `DbErrorSql.campo`). */
export type CampoRejilla = 'where' | 'orderBy'

export interface ObjetoRejilla {
  /** Exacto, como lo devuelve el catálogo (ya plegado por el motor). */
  esquema: string
  nombre: string
  /** Oracle: enlace del sinónimo ya resuelto (`ALL_SYNONYMS.DB_LINK`). */
  dblink?: string | null
  /** La BASE del nivel «Bases» (SQL Server sin base fija): nombre de tres partes. Ausente = la de la sesión. */
  base?: string | null
}

export interface PeticionConsultaTabla {
  dialecto: DialectoSql
  objeto: ObjetoRejilla
  /** Texto del campo WHERE tal cual (sin la palabra WHERE). */
  where?: string | null
  /** Texto del campo ORDER BY tal cual (sin las palabras ORDER BY). */
  orderBy?: string | null
  /** El filtro guiado; excluyente con `where`. Sin condiciones = ausente. */
  filtro?: DbFiltroGuiado | null
  /** El orden de la cabecera; excluyente con `orderBy`. Vacío = ausente. */
  orden?: readonly DbOrdenColumna[] | null
  /** Columnas de la PK en orden, exactas del catálogo. Solo las usa `limitOffset`. */
  pkColumnas?: readonly string[]
  /** Filas a leer (el llamador pasa página + 1 para saber si hay más). */
  n?: number
  /** Filas que se saltan (0-based). */
  desde?: number
  forma: FormaPaginado
  /** Añadir el ROWID como ÚLTIMA columna, para editar una tabla sin PK. Rechazado si el motor no lo lee y con `dblink`. */
  rowid?: boolean
  /** SQLite: el alias que lee la dirección de la fila (`rowid`, `_rowid_` u `oid`). Sin él, el de la sesión del motor. */
  aliasRowid?: string | null
  /** 'keyset': con qué se ordena y se continúa una pestaña sin ORDER BY del usuario. Sin clave, cae a 'limitOffset'. */
  clave?: ClaveKeyset | null
  /** 'keyset': la clave de la ÚLTIMA fila leída (del trabajador); ausente = primera página. */
  despues?: readonly ValorClave[] | null
}

/** La clave del paginado 'keyset': el rowid (por su alias) o las columnas de la PK, en orden. */
export type ClaveKeyset = { tipo: 'rowid'; alias: string } | { tipo: 'pk'; columnas: readonly string[] }

/** Un valor de la clave de la última fila, como lo devuelve el trabajador (texto, null o con su clase de almacenamiento). */
export type ValorClave = string | null | BindValorSqlite

/** Alias de las columnas de la clave del keyset: citadas, con el prefijo de Tessera. */
export const PREFIJO_COLUMNA_CLAVE = '__TESSERA_CLAVE_'

export interface PeticionConteo {
  dialecto: DialectoSql
  objeto: ObjetoRejilla
  where?: string | null
  /** El mismo filtro guiado que la rejilla (excluyente con `where`). */
  filtro?: DbFiltroGuiado | null
  /** Se acepta por simetría con la rejilla y se IGNORA: un recuento no tiene orden. */
  orden?: readonly DbOrdenColumna[] | null
}

/**
 * Posicionales (PG: `[n, desde]`, o `[]`; SQLite keyset: la clave de la última fila y `n`;
 * con filtro guiado, sus valores DELANTE) o con nombre (Oracle: ROWNUM `{ hasta, desde }` y
 * el filtro `{ f1, … }`).
 */
export type BindsRejilla = Array<number | ValorClave | ValorFiltroSql> | Record<string, string | number | BindEntradaLob>

export interface ConsultaRejilla {
  sql: string
  binds: BindsRejilla
  /** `[inicio, fin)` UTF-16 de cada fragmento del usuario dentro de `sql`; `filtro`, el de cada condición del filtro guiado. */
  rangos: { where?: [number, number]; orderBy?: [number, number]; filtro?: Array<[number, number]> }
  /** Columnas añadidas al final que el llamador debe quitar (`COLUMNA_RN` de ROWNUM). */
  columnasExtraAlFinal: 0 | 1
  /** 'keyset': las ÚLTIMAS N columnas son la clave, que el trabajador quita de la página y devuelve aparte. Ausente o 0 = no hay. */
  columnasClave?: number
  /** Se pagina re-ejecutando sin un orden determinista: lo dice la píldora. */
  sinOrdenEstable?: true
}

export interface ErrorRejilla {
  /** Mensaje para el usuario, en español. */
  error: string
  /** Campo culpable; `null` si el fallo no es de un fragmento. 'filtro' es el filtro guiado, con `condicion` si es de una. */
  campo: CampoRejilla | 'filtro' | null
  /** UTF-16, relativa al campo. `null` si no aplica (siempre con 'filtro'). */
  posicion: number | null
  /** Con `campo: 'filtro'`: el índice de la condición culpable, si es de una. */
  condicion?: number
}

export type ResultadoRejilla = ConsultaRejilla | ErrorRejilla

export type ValidacionFragmento = { vacio: boolean } | ErrorRejilla

/** Dónde cae un error del servidor: un campo de texto con su posición, o una condición del filtro guiado. */
export type UbicacionErrorRejilla = { campo: CampoRejilla; posicion: number } | { campo: 'filtro'; condicion: number }

/** ¿El resultado es un error? */
export function esErrorRejilla(r: ResultadoRejilla | ValidacionFragmento): r is ErrorRejilla {
  return 'error' in r
}

/** Un `ErrorRejilla` con su campo y su posición. */
export function fallo(error: string, campo: CampoRejilla | 'filtro' | null, posicion: number | null): ErrorRejilla {
  return { error, campo, posicion }
}

/**
 * Lo que un `ErrorRejilla` aporta a un `DbErrorSql` (campo, posición, condición), para que
 * los que lo convierten no lo repitan.
 */
export function detalleDeErrorRejilla(e: ErrorRejilla): { campo?: CampoRejilla | 'filtro'; posicion?: number; condicion?: number } {
  const r: { campo?: CampoRejilla | 'filtro'; posicion?: number; condicion?: number } = {}
  if (e.campo) r.campo = e.campo
  if (e.posicion !== null) r.posicion = e.posicion
  if (e.condicion !== undefined) r.condicion = e.condicion
  return r
}
