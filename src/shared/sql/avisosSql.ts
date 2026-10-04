// =============================================================================
// Avisos léxicos de la consola, amarillos y NO BLOQUEANTES: separador que falta, cadena o comentario
// sin cerrar, paréntesis desequilibrados, `/` que falta tras un bloque PL/SQL, `GO n`, escritura en
// solo lectura y formato fijado. La gramática la valida el servidor al ejecutar. Los rellena el divisor
// en `Sentencia.avisos`. Neutral y ES2020.
// Decisiones: docs/decisiones/bd/sql-avisos-lexicos.md
// =============================================================================

import { deDialecto, reglasDe, type DialectoSql, type ReglasDialecto } from './dialectosSql.ts'
import { esSaltoDeLinea, esSignificativo, finDeLinea, type Token } from './lexicoSql.ts'
import { PALABRAS_CONECTORAS, VERBOS_AVISO, VERBOS_AVISO_DIALECTO } from './palabrasSql.ts'
import {
  esAlcanceDeLote,
  formatoFijadoPorTessera,
  permitidaEnSoloLectura,
  type Clasificacion
} from './clasificarSql.ts'
import type { Sentencia } from './divisorSql.ts'
import { conjunto } from './conjuntoSql.ts'

export type TipoAviso =
  | 'faltaPuntoYComa'
  | 'faltaBarra'
  | 'sinCerrar'
  | 'parentesis'
  | 'escribeEnSoloLectura'
  | 'formatoFijado'
  /** `GO n` (SQL Server): repetir el lote, que Tessera no admite (ver `lexicoSql.ts`). */
  | 'loteRepetido'

export interface AvisoSql {
  tipo: TipoAviso
  /** Offsets UTF-16 en el texto completo. */
  desde: number
  hasta: number
  mensaje: string
}

const CLAUSULAS_DE_ALTER = conjunto('DROP ADD MODIFY ALTER GRANT REVOKE RENAME')
const RAMAS_DE_MERGE = conjunto('INSERT UPDATE DELETE')
const PRINCIPAL_INSERT = conjunto('SELECT VALUES')
/** `INSERT … EXEC p` (donde EXEC es un verbo del aviso: SQL Server). */
const PRINCIPAL_INSERT_CON_EXEC = conjunto('SELECT VALUES EXEC EXECUTE')
const PRINCIPAL_WITH = conjunto('SELECT VALUES TABLE INSERT UPDATE DELETE MERGE')
/** Tras la unidad PL/SQL cerrada, qué indica que empieza otra sentencia. */
const INICIO_TRAS_BLOQUE = conjunto(
  'SELECT INSERT UPDATE DELETE MERGE WITH CREATE DROP ALTER TRUNCATE GRANT REVOKE COMMIT ROLLBACK ' +
    'CALL DECLARE BEGIN EXEC EXECUTE'
)

/** El token empieza en la columna 1 de su línea (o en el inicio del rango). */
function enColumnaUno(texto: string, t: Token, inicio: number): boolean {
  return t.desde === inicio || esSaltoDeLinea(texto.charCodeAt(t.desde - 1))
}

function profundidades(sig: readonly Token[]): number[] {
  const prof: number[] = new Array(sig.length)
  let p = 0
  for (let i = 0; i < sig.length; i++) {
    if (sig[i].tipo === 'parenC' && p > 0) p--
    prof[i] = p
    if (sig[i].tipo === 'parenA') p++
  }
  return prof
}

function palabra(t: Token | undefined): string | null {
  return t && t.tipo === 'palabra' ? t.valor : null
}

/** `WITH x AS`, `WITH x (`, `WITH RECURSIVE`: un WITH con forma de CTE. */
function esWithDeCte(sig: readonly Token[], k: number): boolean {
  const a = sig[k + 1]
  const b = sig[k + 2]
  if (!a) return false
  if (palabra(a) === 'RECURSIVE') return true
  if (palabra(a) === 'ORDINALITY') return false
  if (a.tipo !== 'palabra' && a.tipo !== 'identCitado') return false
  return !!b && (palabra(b) === 'AS' || b.tipo === 'parenA')
}

/** ¿El token puede ser el FINAL de una sentencia? */
function puedeCerrar(t: Token): boolean {
  switch (t.tipo) {
    case 'identCitado':
    case 'cadena':
    case 'numero':
    case 'bind':
    case 'parenC':
      return true
    case 'operador':
      return t.valor === '*'
    case 'palabra':
      return !PALABRAS_CONECTORAS.has(t.valor)
    default:
      return false
  }
}

function avisosFaltaPuntoYComa(
  texto: string,
  sig: readonly Token[],
  cls: Clasificacion,
  inicio: number,
  salida: AvisoSql[],
  d: DialectoSql,
  r: ReglasDialecto
): void {
  const inicial = primeraPalabraAMirar(sig, cls, d, r)
  if (!inicial) return
  const { i0, primera } = inicial
  const propios = deDialecto(VERBOS_AVISO_DIALECTO, d)
  let principal: ReadonlySet<string> | null = consultaPrincipalDe(primera, propios)
  // CREATE solo tiene consulta principal tras su `AS` (CTAS, vista): sin él,
  // `CREATE TABLE t (…)\nSELECT …` son dos sentencias.
  let armarTrasAs = primera === 'CREATE'
  const exentos = exentosDe(primera)
  const prof = profundidades(sig)
  for (let k = i0 + 1; k < sig.length; k++) {
    // Nivel de la SENTENCIA (0), no el del primer verbo: en `(SELECT …)\nSELECT …`
    // la segunda consulta está fuera del paréntesis de la primera.
    if (prof[k] !== 0) continue
    const w = palabra(sig[k])
    if (!w) continue
    if (armarTrasAs && w === 'AS') {
      principal = PRINCIPAL_INSERT
      armarTrasAs = false
    } else if (principal && principal.has(w)) {
      // La consulta principal de un INSERT/CTAS/WITH es parte de la sentencia.
      principal = null
    } else if (principal && w === 'WITH') {
      // `INSERT INTO t (a)\nWITH x AS (…)\nSELECT …`: el WITH abre la consulta principal.
    } else if (empiezaOtraSentencia(texto, sig, k, w, inicio, propios, exentos)) {
      salida.push(avisoFaltaPuntoYComa(sig[k], r))
    }
  }
}

/** Primera palabra de la sentencia (tras los paréntesis iniciales) y su índice; null si no hay nada que mirar. */
function primeraPalabraAMirar(
  sig: readonly Token[],
  cls: Clasificacion,
  d: DialectoSql,
  r: ReglasDialecto
): { i0: number; primera: string } | null {
  if (cls.plsql || cls.clase === 'cliente' || sig.length < 2) return null
  // SQLite: el cuerpo BEGIN … END de un disparador lleva sus sentencias en columna 1.
  if (r.triggerBeginEnd && cls.verbo === 'CREATE TRIGGER') return null
  // SQL Server: una construcción de alcance de lote va entera hasta el GO: dentro, el `;` es opcional.
  if (esAlcanceDeLote(sig, d)) return null
  let i0 = 0
  while (sig[i0] && sig[i0].tipo === 'parenA') i0++
  const primera = palabra(sig[i0])
  if (!primera || primera === 'GRANT' || primera === 'REVOKE') return null
  if (primera === 'CREATE' && palabra(sig[i0 + 1]) === 'SCHEMA') return null
  return hayBeginAtomic(sig) ? null : { i0, primera }
}

/** PG: el cuerpo `BEGIN ATOMIC` de una función SQL lleva `;` internos. */
function hayBeginAtomic(sig: readonly Token[]): boolean {
  for (let k = 0; k < sig.length - 1; k++) {
    if (palabra(sig[k]) === 'BEGIN' && palabra(sig[k + 1]) === 'ATOMIC') return true
  }
  return false
}

/** Los verbos que abren la consulta principal (parte de la sentencia) según el verbo inicial. */
function consultaPrincipalDe(primera: string, propios: ReadonlySet<string>): ReadonlySet<string> | null {
  if (primera === 'INSERT') return propios.has('EXEC') ? PRINCIPAL_INSERT_CON_EXEC : PRINCIPAL_INSERT
  if (primera === 'WITH' || primera === 'EXPLAIN') return PRINCIPAL_WITH
  return null
}

function exentosDe(primera: string): ReadonlySet<string> | null {
  return primera === 'ALTER' ? CLAUSULAS_DE_ALTER : primera === 'MERGE' ? RAMAS_DE_MERGE : null
}

/** ¿La palabra `w` en `sig[k]` empieza otra sentencia pegada a la anterior (columna 1 y detrás de algo que cierra)? */
function empiezaOtraSentencia(
  texto: string,
  sig: readonly Token[],
  k: number,
  w: string,
  inicio: number,
  propios: ReadonlySet<string>,
  exentos: ReadonlySet<string> | null
): boolean {
  if (!(VERBOS_AVISO.has(w) || propios.has(w)) || !enColumnaUno(texto, sig[k], inicio)) return false
  if (w === 'WITH' && !esWithDeCte(sig, k)) return false
  if (exentos && exentos.has(w)) return false
  return puedeCerrar(sig[k - 1])
}

function avisoFaltaPuntoYComa(t: Token, r: ReglasDialecto): AvisoSql {
  return {
    tipo: 'faltaPuntoYComa',
    desde: t.desde,
    hasta: t.hasta,
    // En SQL Server no es un error del servidor: las EJECUTA juntas (medido).
    mensaje: r.sinSeparadorSeEjecutanJuntas
      ? '¿Falta «;» al final de la línea anterior? Sin él, el servidor ejecuta las dos sentencias juntas.'
      : '¿Falta «;» al final de la línea anterior? Sin él, las dos sentencias se envían juntas.'
  }
}

/** `GO n` en su línea (SQL Server): ver `Token.loteRepetido`. Marca de GO al final de la línea. */
function avisosLoteRepetido(texto: string, tokens: readonly Token[], salida: AvisoSql[]): void {
  for (const t of tokens) {
    if (!t.loteRepetido) continue
    let hasta = finDeLinea(texto, t.desde)
    const comentario = texto.indexOf('--', t.desde)
    if (comentario >= 0 && comentario < hasta) hasta = comentario
    while (hasta > t.hasta && /\s/.test(texto[hasta - 1])) hasta--
    salida.push({
      tipo: 'loteRepetido',
      desde: t.desde,
      hasta,
      mensaje:
        'Tessera no repite lotes: «GO n» no se admite y, tal cual, el servidor lo leería como parte de la sentencia y daría un error. Deja el GO solo (o repite el lote a mano).'
    })
  }
}

interface Nivel {
  esperaBegin: boolean
}

function avisosFaltaBarra(sig: readonly Token[], cls: Clasificacion, r: ReglasDialecto, salida: AvisoSql[]): void {
  if (!debeMirarBarra(sig, cls, r)) return
  // La especificación de un TYPE (`AS OBJECT (…)`, `AS TABLE OF …`) termina en su primer `;`.
  const cierraEnPrimerPuntoYComa = cls.objetoCreado ? cls.objetoCreado.tipo === 'TYPE' : false
  const e: EstadoBloque = { pila: [], cabecera: false, hubo: false, cerrada: false }
  let parens = 0
  for (let k = 0; k < sig.length; k++) {
    const t = sig[k]
    if (e.cerrada) {
      if (empiezaOtraSentenciaTrasBloque(t)) salida.push(avisoFaltaBarra(t))
      return
    }
    if (t.tipo === 'parenA') parens++
    else if (t.tipo === 'parenC') parens = Math.max(0, parens - 1)
    if (parens > 0) continue
    if (t.tipo === 'puntoYComa') puntoYComaDeBloque(e, cierraEnPrimerPuntoYComa)
    else {
      const w = palabra(t)
      if (w) k += palabraDeBloque(e, sig, k, w)
    }
  }
}

/** Solo donde la `/` termina una unidad (SQL*Plus) y no en un disparador COMPOUND ni en Java (no casan con la pila). */
function debeMirarBarra(sig: readonly Token[], cls: Clasificacion, r: ReglasDialecto): boolean {
  if (!r.barraTermina || !cls.plsql || cls.clase === 'rutina') return false
  return !sig.some((t) => palabra(t) === 'COMPOUND' || palabra(t) === 'JAVA')
}

interface EstadoBloque {
  pila: Nivel[]
  /** Se vio PROCEDURE/FUNCTION/PACKAGE y falta su IS/AS. */
  cabecera: boolean
  /** Un `END` acaba de cerrar un nivel. */
  hubo: boolean
  cerrada: boolean
}

const ABRE_CABECERA = new Set(['PROCEDURE', 'FUNCTION', 'PACKAGE'])
const ABRE_NIVEL = new Set(['CASE', 'IF', 'LOOP'])

function puntoYComaDeBloque(e: EstadoBloque, cierraEnPrimerPuntoYComa: boolean): void {
  e.cabecera = false // declaración adelantada: `PROCEDURE p;`
  if ((e.hubo || cierraEnPrimerPuntoYComa) && e.pila.length === 0) e.cerrada = true
  e.hubo = false
}

/** Actualiza la pila con la palabra `w` de `sig[k]`; devuelve cuántos tokens más consume (`END IF`). */
function palabraDeBloque(e: EstadoBloque, sig: readonly Token[], k: number, w: string): number {
  if (w === 'END') {
    const sig1 = palabra(sig[k + 1])
    e.pila.pop()
    e.hubo = true
    return sig1 === 'IF' || sig1 === 'LOOP' || sig1 === 'CASE' ? 1 : 0
  }
  if (ABRE_CABECERA.has(w)) e.cabecera = true
  else if (ABRE_NIVEL.has(w)) e.pila.push({ esperaBegin: false })
  // TYPE BODY: la cabecera la abre BODY (TYPE solo no abre nivel).
  else if (w === 'BODY' && palabra(sig[k - 1]) === 'TYPE') e.cabecera = true
  else if ((w === 'IS' || w === 'AS') && e.cabecera) {
    e.pila.push({ esperaBegin: true })
    e.cabecera = false
  } else if (w === 'DECLARE') e.pila.push({ esperaBegin: true })
  else if (w === 'BEGIN') abreBegin(e)
  return 0
}

/** Un BEGIN cierra la espera del nivel de DECLARE/IS/AS; sin nivel esperando, abre uno. */
function abreBegin(e: EstadoBloque): void {
  const tope = e.pila[e.pila.length - 1]
  if (tope && tope.esperaBegin) tope.esperaBegin = false
  else e.pila.push({ esperaBegin: false })
}

/** Tras cerrarse la unidad, un token que empieza línea y es un verbo, DECLARE, BEGIN o `<<`. */
function empiezaOtraSentenciaTrasBloque(t: Token): boolean {
  const w = palabra(t)
  const esInicio = (w !== null && INICIO_TRAS_BLOQUE.has(w)) || (t.tipo === 'operador' && t.valor.indexOf('<<') === 0)
  return t.inicioDeLinea && esInicio
}

function avisoFaltaBarra(t: Token): AvisoSql {
  return {
    tipo: 'faltaBarra',
    desde: t.desde,
    hasta: t.hasta,
    mensaje: '¿Falta «/» tras el bloque PL/SQL? Sin ella, lo que sigue se envía dentro del bloque.'
  }
}

function mensajeSinCerrar(t: Token): string {
  if (t.tipo === 'comentario') return 'Comentario sin cerrar.'
  if (t.tipo === 'identCitado' || t.tipo === 'bind') return 'Identificador entre comillas sin cerrar.'
  if (t.valor[0] === '$') return 'Cadena entre dólares sin cerrar.'
  return 'Cadena sin cerrar.'
}

function avisosSinCerrar(texto: string, tokens: readonly Token[], salida: AvisoSql[]): void {
  for (const t of tokens) {
    if (!t.sinCerrar) continue
    // Se marca solo su primera línea: marcar hasta el final pintaría todo el archivo.
    const hasta = Math.max(t.desde + 1, finDeLinea(texto, t.desde, t.hasta))
    salida.push({ tipo: 'sinCerrar', desde: t.desde, hasta, mensaje: mensajeSinCerrar(t) })
  }
}

function avisosParentesis(sig: readonly Token[], salida: AvisoSql[]): void {
  const abiertos: Token[] = []
  for (const t of sig) {
    if (t.tipo === 'parenA') abiertos.push(t)
    else if (t.tipo === 'parenC') {
      if (abiertos.length > 0) abiertos.pop()
      else salida.push({ tipo: 'parentesis', desde: t.desde, hasta: t.hasta, mensaje: 'Este «)» no cierra ningún paréntesis.' })
    }
  }
  for (const t of abiertos) {
    salida.push({ tipo: 'parentesis', desde: t.desde, hasta: t.hasta, mensaje: 'Paréntesis sin cerrar.' })
  }
}

/**
 * Avisos léxicos de UNA sentencia. `tokens` son los de la sentencia (con
 * comentarios, sin el terminador); `inicio` es el inicio del rango que se
 * partió, que cuenta como columna 1. Los usa el divisor para rellenar
 * `Sentencia.avisos`.
 */
export function avisosDeSentencia(
  texto: string,
  tokens: readonly Token[],
  d: DialectoSql,
  cls: Clasificacion,
  inicio = 0
): AvisoSql[] {
  const r = reglasDe(d)
  const salida: AvisoSql[] = []
  const sig = tokens.filter(esSignificativo)
  avisosSinCerrar(texto, tokens, salida)
  if (cls.clase !== 'cliente') avisosParentesis(sig, salida)
  avisosFaltaPuntoYComa(texto, sig, cls, inicio, salida, d, r)
  if (r.separadorLote !== null) avisosLoteRepetido(texto, tokens, salida)
  avisosFaltaBarra(sig, cls, r, salida)
  const formato = formatoFijadoPorTessera(cls, d)
  if (formato && sig[0]) {
    salida.push({ tipo: 'formatoFijado', desde: sig[0].desde, hasta: sig[0].hasta, mensaje: formato })
  }
  return salida
}

/** Longitud de la primera palabra de la sentencia (el rango del aviso de solo lectura). */
function finPrimeraPalabra(s: Sentencia): number {
  const m = /^\S+/.exec(s.texto.slice(s.mapa.prefijoSintetico))
  const n = m ? m[0].length : 1
  return Math.min(s.hastaContenido, s.mapa.base + n)
}

/** Aviso «escribe en una conexión de solo lectura», o null si la sentencia pasa. */
export function avisoSoloLectura(s: Sentencia, d: DialectoSql): AvisoSql | null {
  const p = permitidaEnSoloLectura(s, d)
  if (p.ok) return null
  return { tipo: 'escribeEnSoloLectura', desde: s.desde, hasta: Math.max(s.desde + 1, finPrimeraPalabra(s)), mensaje: p.motivo }
}

/**
 * Todos los avisos de un conjunto de sentencias, añadiendo los de solo lectura
 * si la conexión lo es. Es lo que pinta la consola como marcadores amarillos.
 */
export function avisosConSoloLectura(
  sentencias: readonly Sentencia[],
  d: DialectoSql,
  soloLectura: boolean
): AvisoSql[] {
  reglasDe(d) // valida también sin solo lectura, cuando el dialecto no llega a mirarse
  const salida: AvisoSql[] = []
  for (const s of sentencias) {
    for (const a of s.avisos) salida.push(a)
    if (soloLectura) {
      const a = avisoSoloLectura(s, d)
      if (a) salida.push(a)
    }
  }
  return salida
}
