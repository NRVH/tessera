// =============================================================================
// Formatear SQL en la consola: sql-formatter sentencia a sentencia (cargado con
// `import()` dinámico), con una guarda que no deja cambiar nada que no sea blanco o caja,
// y su aplicación en el editor en una sola parada de deshacer. Sin Monaco en tiempo de
// ejecución: `test:db-formateo-sql` lo prueba bajo `node` con un editor falso.
// Decisiones: docs/decisiones/bd/ui-consola-formato-y-salida.md
// =============================================================================

import type { IPosition, IRange } from 'monaco-editor'
import type { FormatOptions } from 'sql-formatter'
import type { DbMotor } from '../../../../../shared/db-ipc.ts'
import { descriptorSql, type FormateadorMotor } from '../../../../../shared/motores/index.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { dividirSentencias, type Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import { tokenizar, type Token } from '../../../../../shared/sql/lexicoSql.ts'

/** Las opciones de sql-formatter (su porqué, en el ADR de la cabecera). */
export const OPCIONES_FORMATO: Partial<FormatOptions> = {
  keywordCase: 'upper',
  dataTypeCase: 'upper',
  functionCase: 'preserve',
  identifierCase: 'preserve',
  indentStyle: 'standard',
  tabWidth: 4,
  useTabs: false,
  logicalOperatorNewline: 'before',
  expressionWidth: 100,
  denseOperators: false,
  newlineBeforeSemicolon: false
}

/** Formatea UNA sentencia sin terminador. Lanza si sql-formatter no la entiende. */
export type Formateador = (sql: string, d: DialectoSql) => string

let carga: Promise<Formateador> | null = null

async function importarFormateador(): Promise<Formateador> {
  const { formatDialect, plsql, postgresql, sqlite, transactsql } = await import('sql-formatter')
  // Un `Record` por nombre de dialecto de sql-formatter: si un motor pide uno que aquí
  // no se importa, no compila (en vez de caer en el de otro motor).
  const DIALECTOS: Readonly<Record<FormateadorMotor['dialecto'], typeof plsql>> = { plsql, postgresql, sqlite, transactsql }
  return (sql, d) => {
    const f = descriptorSql(d).sql.formateador
    // Sin `parametros` NO se pasa la clave `paramTypes` (se queda la de la librería).
    return formatDialect(sql, {
      dialect: DIALECTOS[f.dialecto],
      ...OPCIONES_FORMATO,
      ...(f.parametros ? { paramTypes: f.parametros } : {})
    })
  }
}

/** sql-formatter, cargado la primera vez. Si falla la carga, la siguiente reintenta. */
export function cargarFormateador(): Promise<Formateador> {
  if (!carga) {
    const p = importarFormateador()
    carga = p
    p.catch(() => {
      if (carga === p) carga = null
    })
  }
  return carga
}

// --- Qué se formatea ---------------------------------------------------------------

/** Por qué una sentencia se dejó como estaba. */
export type MotivoOmision =
  /** Línea de SQL*Plus o de psql. */
  | 'cliente'
  /** Bloque PL/SQL o CREATE de una unidad: sql-formatter lo aplana. */
  | 'plsql'
  /** Una clase que sql-formatter deja peor (GRANT, ALTER SESSION, EXPLAIN…). */
  | 'clase'
  /** sql-formatter no la entendió (lanzó). */
  | 'error'
  /** El resultado no daba los mismos tokens, o dejaba de ser una sentencia. */
  | 'guarda'

const DDL_FORMATEABLE: ReadonlySet<string> = new Set(['CREATE TABLE', 'CREATE VIEW', 'CREATE MATERIALIZED VIEW'])

/** null si la sentencia se formatea; si no, por qué no. */
export function motivoParaNoFormatear(s: Sentencia): MotivoOmision | null {
  if (s.clase === 'cliente') return 'cliente'
  if (s.plsql || s.clase === 'plsql') return 'plsql'
  switch (s.clase) {
    case 'consulta':
      return s.verbo === 'SELECT' || s.verbo === 'VALUES' ? null : 'clase'
    case 'dml':
      return null
    case 'bloqueo':
      return s.verbo === 'SELECT' ? null : 'clase'
    case 'ddl':
      return DDL_FORMATEABLE.has(s.verbo) ? null : 'clase'
    default:
      return 'clase'
  }
}

// --- La guarda ---------------------------------------------------------------------

function sinBlancosRepetidos(t: string): string {
  return t.replace(/\s+/g, ' ').trim()
}

function haySalto(t: string, desde: number, hasta: number): boolean {
  return /[\r\n]/.test(t.slice(desde, hasta))
}

/**
 * ¿`a` y `b` dan los mismos tokens para el léxico (ver «LA GUARDA»)? Y dos cadenas
 * seguidas (con solo comentarios entre ellas) siguen separadas por un salto de línea
 * en los dos textos o en ninguno: en PG, `'foo'` + salto + `'bar'` es UNA cadena
 * (`'foobar'`, la continuación del estándar) y en la misma línea es un error de
 * sintaxis. sql-formatter las junta en una línea (medido), y el léxico, que no ve los
 * blancos, daba los mismos tokens: formatear rompía una sentencia válida.
 */
export function mismosTokens(a: string, b: string, d: DialectoSql): boolean {
  const ta = tokenizar(a, d)
  const tb = tokenizar(b, d)
  if (ta.length !== tb.length) return false
  /** Índice de la última cadena, si desde ella solo ha habido comentarios. */
  let cadenaPrevia = -1
  for (let i = 0; i < ta.length; i++) {
    const x = ta[i]
    const y = tb[i]
    if (x.tipo !== y.tipo || x.sinCerrar !== y.sinCerrar) return false
    if (x.tipo === 'comentario') {
      if (sinBlancosRepetidos(x.valor) !== sinBlancosRepetidos(y.valor)) return false
    } else if (x.valor !== y.valor) {
      return false
    }
    if (x.tipo === 'cadena') {
      if (cadenaPrevia >= 0 && haySalto(a, ta[cadenaPrevia].hasta, x.desde) !== haySalto(b, tb[cadenaPrevia].hasta, y.desde)) {
        return false
      }
      cadenaPrevia = i
    } else if (x.tipo !== 'comentario') {
      cadenaPrevia = -1
    }
  }
  return true
}

/** ¿`texto` sigue siendo UNA sentencia de la clase `clase` para el divisor? */
function unaSentencia(texto: string, d: DialectoSql, clase: string): boolean {
  const ss = dividirSentencias(texto, d)
  return ss.length === 1 && ss[0].clase === clase
}

// --- Retoques sobre la salida de sql-formatter ------------------------------------------

function esNombre(t: Token): boolean {
  return t.tipo === 'palabra' || t.tipo === 'identCitado'
}

/**
 * Quita el espacio que sql-formatter pone entre un nombre y su `(` donde el original
 * los tenía pegados (`mi_func(a)`, `t(a, b)`). Si los tokens no se alinean, no toca
 * nada: la guarda lo rechazará después.
 */
export function pegarParentesis(original: string, formateado: string, d: DialectoSql): string {
  const ta = tokenizar(original, d)
  const tb = tokenizar(formateado, d)
  if (ta.length !== tb.length) return formateado
  let salida = ''
  let desde = 0
  for (let i = 1; i < tb.length; i++) {
    if (tb[i].tipo !== 'parenA' || !esNombre(tb[i - 1]) || ta[i].tipo !== 'parenA' || !esNombre(ta[i - 1])) continue
    if (ta[i].desde !== ta[i - 1].hasta) continue
    const hueco = formateado.slice(tb[i - 1].hasta, tb[i].desde)
    if (hueco === '' || !/^[ \t]+$/.test(hueco)) continue
    salida += formateado.slice(desde, tb[i - 1].hasta)
    desde = tb[i].desde
  }
  return salida + formateado.slice(desde)
}

/** La sangría de la línea de `pos` si antes de `pos` en esa línea solo hay blancos; si no, ''. */
function sangriaDePartida(texto: string, pos: number): string {
  const ini = texto.lastIndexOf('\n', pos - 1) + 1
  const antes = texto.slice(ini, pos)
  return /^[ \t]*$/.test(antes) ? antes : ''
}

// --- Formatear un texto ---------------------------------------------------------------

/** Un cambio sobre el texto original: `[desde, hasta)` pasa a ser `texto`. */
export interface Reemplazo {
  desde: number
  hasta: number
  texto: string
}

export interface ResultadoFormato {
  /** El texto entero ya formateado. */
  texto: string
  /** Los cambios, uno por sentencia que cambia, en orden y sin solaparse. */
  reemplazos: Reemplazo[]
  /** Las sentencias que se dejaron como estaban, con su motivo. */
  omitidas: Array<{ desde: number; hasta: number; motivo: MotivoOmision; detalle?: string }>
}

type Intento = { ok: true; texto: string } | { ok: false; motivo: MotivoOmision; detalle?: string }

function formatearSentencia(original: string, s: Sentencia, d: DialectoSql, f: Formateador, eol: string, sangria: string): Intento {
  const entrada = eol === '\r\n' ? original.split('\r\n').join('\n') : original
  let salida: string
  try {
    salida = f(entrada, d)
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    return { ok: false, motivo: 'error', detalle: m.split('\n')[0] }
  }
  salida = pegarParentesis(entrada, salida.replace(/\s+$/, ''), d)
  if (sangria !== '') salida = salida.split('\n').map((l, i) => (i === 0 || l === '' ? l : sangria + l)).join('\n')
  if (eol === '\r\n') salida = salida.split('\n').join('\r\n')
  if (!mismosTokens(original, salida, d) || !unaSentencia(salida, d, s.clase)) return { ok: false, motivo: 'guarda' }
  return { ok: true, texto: salida }
}

/** Aplica `reemplazos` (ordenados, sin solaparse) sobre `texto`. */
export function aplicarReemplazos(texto: string, reemplazos: readonly Reemplazo[]): string {
  let r = ''
  let desde = 0
  for (const x of reemplazos) {
    r += texto.slice(desde, x.desde) + x.texto
    desde = x.hasta
  }
  return r + texto.slice(desde)
}

/**
 * Formatea `texto` (o solo `rango`, tratado como texto independiente, como una
 * selección que se ejecuta) con el formateador `f`. Síncrono y puro: `f` ya cargado.
 */
export function formatearTexto(
  texto: string,
  d: DialectoSql,
  f: Formateador,
  rango?: { desde: number; hasta: number },
  eolModelo?: string
): ResultadoFormato {
  const sentencias = dividirSentencias(texto, d, rango ?? {})
  // El fin de línea del MODELO, si se sabe: deducirlo del texto falla en una consola de
  // una sola línea (no hay ningún salto del que deducirlo), y en Windows el modelo es
  // CRLF: se formateaba con `\n`, Monaco lo convertía a `\r\n` al insertarlo, y el cursor
  // calculado sobre el texto con `\n` se quedaba un carácter corto por cada salto.
  const eol = eolModelo === '\r\n' || eolModelo === '\n' ? eolModelo : texto.indexOf('\r\n') >= 0 ? '\r\n' : '\n'
  const reemplazos: Reemplazo[] = []
  const omitidas: ResultadoFormato['omitidas'] = []
  for (const s of sentencias) {
    if (s.hastaContenido <= s.desde) continue
    const motivo = motivoParaNoFormatear(s)
    if (motivo !== null) {
      omitidas.push({ desde: s.desde, hasta: s.hastaContenido, motivo })
      continue
    }
    const original = texto.slice(s.desde, s.hastaContenido)
    const r = formatearSentencia(original, s, d, f, eol, sangriaDePartida(texto, s.desde))
    if (!r.ok) {
      omitidas.push(
        r.detalle !== undefined
          ? { desde: s.desde, hasta: s.hastaContenido, motivo: r.motivo, detalle: r.detalle }
          : { desde: s.desde, hasta: s.hastaContenido, motivo: r.motivo }
      )
    } else if (r.texto !== original) {
      reemplazos.push({ desde: s.desde, hasta: s.hastaContenido, texto: r.texto })
    }
  }
  return { texto: aplicarReemplazos(texto, reemplazos), reemplazos, omitidas }
}

/** Formatea `texto` entero para el motor (lo que se pide desde fuera del editor). */
export async function formatearSql(texto: string, motor: DbMotor): Promise<string> {
  const f = await cargarFormateador()
  return formatearTexto(texto, dialectoDeMotor(motor), f).texto
}

/** Como `formatearSql`, con los reemplazos y las sentencias que se dejaron (y por qué). */
export async function formatearSqlDetallado(
  texto: string,
  motor: DbMotor,
  rango?: { desde: number; hasta: number }
): Promise<ResultadoFormato> {
  const f = await cargarFormateador()
  return formatearTexto(texto, dialectoDeMotor(motor), f, rango)
}

// --- El cursor ----------------------------------------------------------------------

function esBlancoCar(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'
}

/**
 * Dónde cae en `nuevo` el offset `offset` de `original`, sabiendo que solo cambiaron
 * los blancos (y la caja): tras el mismo carácter no blanco si iba pegado a lo de
 * detrás o entre blancos; delante del mismo si iba pegado a lo de delante.
 */
export function mapearOffset(original: string, nuevo: string, offset: number): number {
  const o = Math.max(0, Math.min(offset, original.length))
  let n = 0
  for (let i = 0; i < o; i++) if (!esBlancoCar(original[i])) n++
  let j = 0
  if (n > 0) {
    let cuenta = 0
    for (; j < nuevo.length; j++) {
      if (esBlancoCar(nuevo[j])) continue
      if (++cuenta === n) {
        j++
        break
      }
    }
  }
  const pegadoAtras = o > 0 && !esBlancoCar(original[o - 1])
  const pegadoDelante = o < original.length && !esBlancoCar(original[o])
  if (pegadoAtras || !pegadoDelante) return j
  while (j < nuevo.length && esBlancoCar(nuevo[j])) j++
  return j
}

/** Un offset del texto ANTES de `reemplazos`, llevado al texto de después. */
export function mapearTrasReemplazos(texto: string, reemplazos: readonly Reemplazo[], offset: number): number {
  let delta = 0
  for (const r of reemplazos) {
    if (offset < r.desde) break
    if (offset <= r.hasta) return r.desde + delta + mapearOffset(texto.slice(r.desde, r.hasta), r.texto, offset - r.desde)
    delta += r.texto.length - (r.hasta - r.desde)
  }
  return offset + delta
}

// --- En el editor -----------------------------------------------------------------------

/** Lo que se usa del modelo (lo cumple `editor.ITextModel`). */
export interface ModeloFormateable {
  isDisposed(): boolean
  getValue(): string
  /** `\r\n` o `\n`: con el que Monaco guardará lo que se inserte (ver `formatearTexto`). */
  getEOL(): string
  getOffsetAt(p: IPosition): number
  getPositionAt(offset: number): IPosition
}

/** Lo que se usa del editor (lo cumple `editor.IStandaloneCodeEditor`). */
export interface EditorFormateable {
  getModel(): ModeloFormateable | null
  getRawOptions(): { readOnly?: boolean }
  getSelection(): IRange | null
  getPosition(): IPosition | null
  pushUndoStop(): boolean
  executeEdits(fuente: string, edits: Array<{ range: IRange; text: string }>): boolean
  setPosition(p: IPosition): void
  setSelection(r: IRange): void
  revealPositionInCenterIfOutsideViewport(p: IPosition): void
}

function rangoDe(modelo: ModeloFormateable, desde: number, hasta: number): IRange {
  const a = modelo.getPositionAt(desde)
  const b = modelo.getPositionAt(hasta)
  return { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column }
}

/**
 * Formatea la selección del editor o, sin ella, el modelo entero, en UNA parada de
 * deshacer. Devuelve si cambió algo (false también si es de solo lectura).
 */
export async function formatearEnEditor(ed: EditorFormateable, motor: DbMotor): Promise<boolean> {
  const f = await cargarFormateador()
  // Desde aquí todo es síncrono: nadie puede teclear entre leer el modelo y editarlo.
  const modelo = ed.getModel()
  if (!modelo || modelo.isDisposed() || ed.getRawOptions().readOnly === true) return false
  const texto = modelo.getValue()
  const sel = ed.getSelection()
  const conSeleccion = sel !== null && (sel.startLineNumber !== sel.endLineNumber || sel.startColumn !== sel.endColumn)
  const rango = conSeleccion
    ? {
        desde: modelo.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn }),
        hasta: modelo.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn })
      }
    : undefined
  const r = formatearTexto(texto, dialectoDeMotor(motor), f, rango, modelo.getEOL())
  if (r.reemplazos.length === 0) return false
  const pos = ed.getPosition()
  const cursor = pos ? modelo.getOffsetAt(pos) : 0
  const edits = r.reemplazos.map((x) => ({ range: rangoDe(modelo, x.desde, x.hasta), text: x.texto }))
  ed.pushUndoStop()
  const hecho = ed.executeEdits('tessera.formatearSql', edits)
  ed.pushUndoStop()
  if (!hecho) return false
  if (rango) {
    ed.setSelection(rangoDe(modelo, mapearTrasReemplazos(texto, r.reemplazos, rango.desde), mapearTrasReemplazos(texto, r.reemplazos, rango.hasta)))
  } else {
    const p = modelo.getPositionAt(mapearTrasReemplazos(texto, r.reemplazos, cursor))
    ed.setPosition(p)
    ed.revealPositionInCenterIfOutsideViewport(p)
  }
  return true
}
