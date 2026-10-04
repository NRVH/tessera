// =============================================================================
// Formatos de filas de «Copiar como» y de exportar (TSV, CSV, JSON, INSERT, Markdown), con un solo
// serializador para los dos caminos y escritura por trozos. Los literales y el guion INSERT de cada
// motor los pide a `shared/escrituraSql/`. Puro, neutral y ES2020.
// Decisiones: docs/decisiones/bd/contratos-formatos-de-filas.md
// =============================================================================

import type { DbMotor } from './db-ipc'
import type { DbCelda, DbFormatoFilas, DbTipoLogico } from './db-explorador-ipc'
import { celda, type Filas } from './escrituraSql/comun.ts'
import { escrituraSql } from './escrituraSql/index.ts'
import { dialectoDeMotor } from './sql/dialectosSql.ts'
import { citarSiHaceFalta } from './sql/identificadoresSql.ts'

export interface ColumnaFormato {
  readonly nombre: string
  /** Sin él, la celda se trata como texto (INSERT entrecomilla, JSON emite cadena). */
  readonly tipoLogico?: DbTipoLogico
  /**
   * Tipo en el motor (`BLOB`, `RAW(16)`, `LONG RAW`…), el de `DbColumnaResultado`. Sólo
   * lo mira el INSERT de Oracle para elegir la variable de un binario grande (ver
   * `escrituraSql/oracle.ts`); sin él se asume BLOB.
   */
  readonly tipoMotor?: string
}

export interface OpcionesFormato {
  motor: DbMotor
  /** Tabla de los INSERT, YA citada. Por defecto `tabla`. */
  tablaInsert?: string
  /** TSV y CSV: primera línea con los nombres. Por defecto `true`. */
  cabecera?: boolean
  /** CSV: BOM UTF-8 al principio (exportar). Por defecto `false`. */
  bom?: boolean
  /**
   * TSV y CSV: salto de línea tras la última fila. Un ARCHIVO lo lleva (exportar);
   * lo COPIADO no, porque pegado en una hoja añadiría una fila vacía.
   */
  saltoFinal?: boolean
}

export interface EscritorFilas {
  /** Lo que va antes de la primera fila: BOM, cabecera, `[`. */
  inicio(): string
  /** Un trozo de filas; se llama tantas veces como páginas. */
  filas(filas: readonly (readonly DbCelda[])[]): string
  /** Lo que cierra el archivo: `]` de JSON y el salto final. */
  fin(): string
}

/** Extensión de archivo de cada formato (sin punto). */
export const EXTENSION_FORMATO: Record<DbFormatoFilas, string> = {
  tsv: 'tsv',
  csv: 'csv',
  json: 'json',
  insert: 'sql',
  markdown: 'md'
}

/** Nombre visible de cada formato, para menús y el filtro del diálogo de guardar. */
export const NOMBRE_FORMATO: Record<DbFormatoFilas, string> = {
  tsv: 'TSV',
  csv: 'CSV',
  json: 'JSON',
  insert: 'SQL INSERT',
  markdown: 'Markdown'
}

const BOM = String.fromCharCode(0xfeff)
const NUMERAL_JSON = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/

// --- Campos de texto -----------------------------------------------------------

/** El valor de una celda como texto plano (NULL vacío). */
export function valorPlano(v: DbCelda | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return v
}

const TSV_COMILLAS = /[\t\r\n"]/
const CSV_COMILLAS = /[,\r\n"]/

/** Un campo TSV, entrecomillado a lo Excel si hace falta. */
export function campoTsv(s: string): string {
  return TSV_COMILLAS.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** Un campo CSV (RFC 4180). */
export function campoCsv(s: string): string {
  return CSV_COMILLAS.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** Una celda de tabla Markdown: `|` escapado y saltos de línea como `<br>`. */
export function campoMarkdown(v: DbCelda | undefined): string {
  if (v === null || v === undefined) return 'NULL'
  return valorPlano(v).replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>')
}

// --- JSON ----------------------------------------------------------------------

/** `.5` -> `0.5`, `-.5` -> `-0.5`, `+3` -> `3`; null si no es un numeral. */
export function numeralJson(s: string): string | null {
  let t = s.trim()
  if (t.startsWith('+')) t = t.slice(1)
  if (t.startsWith('.')) t = '0' + t
  else if (t.startsWith('-.')) t = '-0' + t.slice(1)
  if (t.endsWith('.')) t = t.slice(0, -1)
  return NUMERAL_JSON.test(t) ? t : null
}

/** Una celda como valor JSON (ya serializado). */
export function valorJson(v: DbCelda | undefined, tipo: DbTipoLogico | undefined): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (tipo === 'numero') {
    const n = numeralJson(v)
    if (n !== null) return n
  }
  return JSON.stringify(v)
}

/** Claves JSON únicas: la segunda `ID` pasa a `ID (2)`, como las pestañas de resultado. */
export function clavesUnicas(nombres: readonly string[]): string[] {
  const usadas = new Set<string>()
  const salida: string[] = []
  for (const n of nombres) {
    let clave = n
    for (let k = 2; usadas.has(clave); k++) clave = `${n} (${k})`
    usadas.add(clave)
    salida.push(clave)
  }
  return salida
}

// --- Literales SQL ---------------------------------------------------------------

/**
 * Una celda como literal SQL del motor. Un binario de Oracle de más de 2000 bytes NO
 * tiene literal que valga (ORA-01704); el INSERT de `crearEscritor` lo saca a un bloque.
 */
export function literalSql(v: DbCelda | undefined, tipo: DbTipoLogico | undefined, motor: DbMotor): string {
  return segmentosLiteral(v, tipo, motor, true).join(' ')
}

/**
 * El literal para COMPARAR con una columna (`"COL" = …` en el WHERE de la vista previa de
 * «Enviar»). Igual que `literalSql`, salvo que el texto largo de Oracle NO va en TO_CLOB:
 * Oracle no compara un CLOB con `=` (ORA-00932, medido en la 11.2 y la 21c), y el valor
 * que se compara salió de un VARCHAR2 o un CHAR, así que cabe en uno.
 */
export function literalComparacionSql(v: DbCelda | undefined, tipo: DbTipoLogico | undefined, motor: DbMotor): string {
  return segmentosLiteral(v, tipo, motor, false).join(' ')
}

/**
 * El literal en SEGMENTOS: juntos con un espacio son `literalSql`, y entre dos se puede
 * partir la línea. NULL es NULL en cualquier motor; lo demás lo escribe el motor con su
 * algoritmo (`escrituraSql`). `comoClob`: el texto largo de Oracle en
 * TO_CLOB (ver `literalComparacionSql`).
 */
function segmentosLiteral(v: DbCelda | undefined, tipo: DbTipoLogico | undefined, motor: DbMotor, comoClob: boolean): string[] {
  if (v === null || v === undefined) return ['NULL']
  return escrituraSql(motor, 'segmentosLiteral').segmentosLiteral(v, tipo, comoClob)
}

// --- Escritores ------------------------------------------------------------------

/** Crea el escritor por trozos de un formato. */
export function crearEscritor(
  formato: DbFormatoFilas,
  columnas: readonly ColumnaFormato[],
  opciones: OpcionesFormato
): EscritorFilas {
  switch (formato) {
    case 'tsv':
    case 'csv':
      return escritorSeparado(formato, columnas, opciones)
    case 'json':
      return escritorJson(columnas)
    case 'insert': {
      const tabla = opciones.tablaInsert || 'tabla'
      const nombres = columnas.map((c) => citarSiHaceFalta(c.nombre, dialectoDeMotor(opciones.motor)))
      const cabeza = `INSERT INTO ${tabla} (${nombres.join(', ')}) VALUES (`
      // El guion de cada motor es un algoritmo propio (el de Oracle, para SQL*Plus): lo
      // escribe su módulo de `escrituraSql`, nunca una rama «si no» de otro motor.
      return escrituraSql(opciones.motor, 'crearEscritor (insert)').escritorInsert(cabeza, columnas, tabla, nombres)
    }
    case 'markdown':
      return escritorMarkdown(columnas)
  }
}

/** TSV y CSV: mismas líneas con otro separador, otro fin de línea y otro entrecomillado. */
function escritorSeparado(formato: 'tsv' | 'csv', columnas: readonly ColumnaFormato[], opciones: OpcionesFormato): EscritorFilas {
  const conCabecera = opciones.cabecera !== false
  const n = columnas.length
  const sep = formato === 'tsv' ? '\t' : ','
  const eol = formato === 'tsv' ? '\n' : '\r\n'
  const campo = formato === 'tsv' ? campoTsv : campoCsv
  // Sin salto final: la primera línea que se escribe no lleva salto delante.
  let primera = true
  const linea = (partes: string[]): string => {
    const s = (primera ? '' : eol) + partes.join(sep)
    primera = false
    return s
  }
  return {
    inicio: () => {
      const bom = formato === 'csv' && opciones.bom ? BOM : ''
      return bom + (conCabecera && n > 0 ? linea(columnas.map((c) => campo(c.nombre))) : '')
    },
    filas: (filas: Filas) => {
      let s = ''
      for (const f of filas) {
        const partes: string[] = []
        for (let c = 0; c < n; c++) partes.push(campo(valorPlano(celda(f, c))))
        s += linea(partes)
      }
      return s
    },
    fin: () => (opciones.saltoFinal && !primera ? eol : '')
  }
}

/** JSON: un array con un objeto por línea. */
function escritorJson(columnas: readonly ColumnaFormato[]): EscritorFilas {
  const n = columnas.length
  const claves = clavesUnicas(columnas.map((c) => c.nombre)).map((k) => JSON.stringify(k))
  let primera = true
  return {
    inicio: () => '[',
    filas: (filas: Filas) => {
      let s = ''
      for (const f of filas) {
        const partes: string[] = []
        for (let c = 0; c < n; c++) {
          partes.push(claves[c] + ': ' + valorJson(celda(f, c), columnas[c].tipoLogico))
        }
        s += (primera ? '\n  ' : ',\n  ') + '{' + partes.join(', ') + '}'
        primera = false
      }
      return s
    },
    fin: () => (primera ? ']\n' : '\n]\n')
  }
}

/** Markdown: tabla GFM con los números alineados a la derecha. */
function escritorMarkdown(columnas: readonly ColumnaFormato[]): EscritorFilas {
  const n = columnas.length
  return {
    inicio: () => {
      if (n === 0) return ''
      const cab = '| ' + columnas.map((c) => campoMarkdown(c.nombre)).join(' | ') + ' |\n'
      const sep = '| ' + columnas.map((c) => (c.tipoLogico === 'numero' ? '---:' : '---')).join(' | ') + ' |\n'
      return cab + sep
    },
    filas: (filas: Filas) => {
      let s = ''
      for (const f of filas) {
        const partes: string[] = []
        for (let c = 0; c < n; c++) partes.push(campoMarkdown(celda(f, c)))
        s += '| ' + partes.join(' | ') + ' |\n'
      }
      return s
    },
    fin: () => ''
  }
}

/** Todo de una vez: lo que usa «Copiar como». */
export function formatearFilas(
  formato: DbFormatoFilas,
  columnas: readonly ColumnaFormato[],
  filas: Filas,
  opciones: OpcionesFormato
): string {
  const e = crearEscritor(formato, columnas, opciones)
  return e.inicio() + e.filas(filas) + e.fin()
}
