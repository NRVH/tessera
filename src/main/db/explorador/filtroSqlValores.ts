// =============================================================================
// Piezas por dialecto del filtro guiado: cómo se escribe un número, una fecha, un LIKE o un
// booleano en cada motor, y el acumulador de parámetros con el marcador de su dialecto.
// Puro (sin electron ni `process`); lo usa `filtroSql.ts`, que reexporta lo público.
// Decisiones: docs/decisiones/bd/rejilla-filtro-guiado-sql.md
// =============================================================================

import { leerNumero } from '../../../shared/filtroGuiado.ts'
import { nunca } from '../../../shared/nunca.ts'
import { marcadorPosicional, type DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import type { BindEntradaLob, BindValorSqlite } from './protocoloTrabajador.ts'

/** Un valor del filtro listo para el trabajador. */
export type ValorFiltroSql = string | number | BindValorSqlite

// --- Números ---------------------------------------------------------------------

interface NumeroPartido {
  /** Normalizado: sin `+`, sin ceros a la izquierda ni decimales a cero a la derecha. */
  texto: string
  entera: string
  fraccion: string
  /** Entero que cabe en un int8 (-2^63 … 2^63-1). */
  int8: boolean
}

const MIN_INT8 = -(2n ** 63n)
const MAX_INT8 = 2n ** 63n - 1n

/** Parte un número del filtro (`leerNumero`) en su forma canónica; null si no lo es. */
export function partirNumero(valor: string): NumeroPartido | null {
  const t = leerNumero(valor)
  if (t === null) return null
  let s = t
  let signo = ''
  if (s.charAt(0) === '-') {
    signo = '-'
    s = s.slice(1)
  }
  const punto = s.indexOf('.')
  let entera = punto < 0 ? s : s.slice(0, punto)
  let fraccion = punto < 0 ? '' : s.slice(punto + 1)
  entera = entera.replace(/^0+/, '')
  if (entera === '') entera = '0'
  fraccion = fraccion.replace(/0+$/, '')
  if (entera === '0' && fraccion === '') signo = ''
  const texto = signo + entera + (fraccion ? '.' + fraccion : '')
  let int8 = false
  if (fraccion === '') {
    const b = BigInt(texto)
    int8 = b >= MIN_INT8 && b <= MAX_INT8
  }
  return { texto, entera, fraccion, int8 }
}

/** SQL Server: el mayor DECIMAL. */
const PRECISION_SQLSERVER = 38

/** Un valor que se enlaza y su expresión en función del marcador que le toque. */
export interface ValorConExpr {
  valor: ValorFiltroSql
  expr: (m: string) => string
}

/** La expresión del número y el valor que se enlaza; o el problema. */
function numeroSql(d: DialectoSql, n: NumeroPartido): ValorConExpr | string {
  switch (d) {
    case 'oracle': {
      const modelo = '9'.repeat(n.entera.length) + (n.fraccion ? 'D' + '9'.repeat(n.fraccion.length) : '')
      return { valor: n.texto, expr: (m) => `TO_NUMBER(${m}, '${modelo}', 'NLS_NUMERIC_CHARACTERS=''.,''')` }
    }
    case 'postgres':
      return { valor: n.texto, expr: (m) => `CAST(${m} AS ${n.int8 ? 'bigint' : 'numeric'})` }
    case 'sqlserver': {
      if (n.int8) return { valor: n.texto, expr: (m) => `CAST(${m} AS BIGINT)` }
      if (n.entera.length + n.fraccion.length > PRECISION_SQLSERVER) {
        return `Este motor compara números de hasta ${PRECISION_SQLSERVER} cifras.`
      }
      return { valor: n.texto, expr: (m) => `CAST(${m} AS DECIMAL(${PRECISION_SQLSERVER}, ${n.fraccion.length}))` }
    }
    case 'sqlite':
      return { valor: { sqlite: n.int8 ? 'entero' : 'real', valor: n.texto }, expr: (m) => m }
    default:
      return nunca(d, 'numeroSql')
  }
}

/** El número como expresión con su valor, o el problema. */
export function numero(d: DialectoSql, valor: string | undefined): ValorConExpr | string {
  const n = partirNumero(valor ?? '')
  return n === null ? 'No es un número (usa punto decimal: 12.5).' : numeroSql(d, n)
}

// --- Fechas --------------------------------------------------------------------

/** Un instante del filtro (el principio de `dia` si `hora` es null): el valor que se enlaza y su expresión. */
export function fechaSql(d: DialectoSql, dia: string, hora: string | null): ValorConExpr {
  switch (d) {
    case 'oracle':
      return { valor: `${dia} ${hora ?? '00:00:00'}`, expr: (m) => `TO_DATE(${m}, 'YYYY-MM-DD HH24:MI:SS')` }
    case 'postgres':
    case 'sqlite':
      return { valor: hora === null ? dia : `${dia} ${hora}`, expr: (m) => m }
    case 'sqlserver':
      return { valor: `${dia}T${hora ?? '00:00:00'}`, expr: (m) => m }
    default:
      return nunca(d, 'fechaSql')
  }
}

// --- Texto ---------------------------------------------------------------------

/** La columna como texto para LIKE y para compararla con ''. */
export function comoTexto(d: DialectoSql, c: string): string {
  switch (d) {
    case 'oracle':
    case 'sqlite':
      return c
    case 'postgres':
      return `CAST(${c} AS text)`
    case 'sqlserver':
      return `CAST(${c} AS NVARCHAR(MAX))`
    default:
      return nunca(d, 'comoTexto')
  }
}

/** Escapa los comodines de LIKE con `!` (el `ESCAPE '!'`). */
export function escaparLike(d: DialectoSql, s: string): string {
  let especiales: RegExp
  switch (d) {
    case 'sqlserver':
      especiales = /[!%_[]/g
      break
    case 'oracle':
    case 'postgres':
    case 'sqlite':
      especiales = /[!%_]/g
      break
    default:
      return nunca(d, 'escaparLike')
  }
  return s.replace(especiales, (x) => '!' + x)
}

/** El LIKE sin mayúsculas del dialecto, con `ESCAPE '!'`. */
export function likeSql(d: DialectoSql, c: string, m: string): string {
  switch (d) {
    case 'oracle':
    case 'sqlite':
      return `LOWER(${c}) LIKE LOWER(${m}) ESCAPE '!'`
    case 'postgres':
      return `${comoTexto(d, c)} ILIKE ${m} ESCAPE '!'`
    case 'sqlserver':
      return `LOWER(${comoTexto(d, c)}) LIKE LOWER(${m}) ESCAPE '!'`
    default:
      return nunca(d, 'likeSql')
  }
}

/** Oracle: la cadena vacía ES NULL, así que «vacío» de texto es solo `IS NULL`. */
export function vacioEsNull(d: DialectoSql): boolean {
  switch (d) {
    case 'oracle':
      return true
    case 'postgres':
    case 'sqlite':
    case 'sqlserver':
      return false
    default:
      return nunca(d, 'vacioEsNull')
  }
}

/** El valor de un booleano del filtro en el dialecto. */
export function booleanoSql(d: DialectoSql, b: boolean): ValorFiltroSql {
  switch (d) {
    case 'postgres':
      return b ? 'true' : 'false'
    case 'oracle':
    case 'sqlserver':
      return b ? 1 : 0
    case 'sqlite':
      return { sqlite: 'entero', valor: b ? '1' : '0' }
    default:
      return nunca(d, 'booleanoSql')
  }
}

// --- Parámetros ----------------------------------------------------------------

/** Acumula los parámetros con el marcador de su dialecto. */
export class Parametros {
  readonly valores: ValorFiltroSql[] = []
  readonly nombrados: Record<string, string | number | BindEntradaLob> = {}
  private n = 0
  // Sin propiedades de parámetro (`private readonly d` en el constructor): el type-stripping
  // de `node` no las admite (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX) y los tests corren así.
  private readonly d: DialectoSql
  private readonly porNombre: boolean
  constructor(d: DialectoSql, porNombre: boolean) {
    this.d = d
    this.porNombre = porNombre
  }

  /** Añade un valor y devuelve su marcador. */
  poner(v: ValorFiltroSql): string {
    this.n++
    if (this.porNombre) {
      // Por nombre (Oracle) solo llegan texto y números: la clase de SQLite es de SQLite.
      this.nombrados['f' + this.n] = typeof v === 'object' ? v.valor : v
      return ':f' + this.n
    }
    this.valores.push(v)
    return marcadorPosicional(this.d, this.n)
  }

  /**
   * El texto de «=» y «≠». En Oracle se enlaza como CHAR (`{ entrada: 'char' }`) para que
   * compare con relleno contra CHAR(n)/NCHAR(n), como un literal; en los demás, tal cual.
   */
  ponerTexto(v: string): string {
    if (!this.porNombre) return this.poner(v)
    this.n++
    this.nombrados['f' + this.n] = { entrada: 'char', valor: v }
    return ':f' + this.n
  }

  /** Enlaza el valor y devuelve su expresión con el marcador que le tocó. */
  expr(x: ValorConExpr): string {
    return x.expr(this.poner(x.valor))
  }
}
