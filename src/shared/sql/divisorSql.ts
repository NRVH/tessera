// =============================================================================
// Divisor de sentencias SQL y sentencia bajo el cursor: rangos EXACTOS en el modelo y el texto que
// se envía. Lo usan el renderer (glifos, Ejecutar) y el main, que VUELVE A PARTIR cada sentencia y
// rechaza si no sale exactamente una. Offsets UTF-16 del texto completo, también con `desde/hasta`.
// Neutral y ES2020. Reglas por dialecto: banderas de `dialectosSql.ts`.
// Decisiones: docs/decisiones/bd/sql-lexico-y-divisor-compartidos.md
// =============================================================================

import { reglasDe, type DialectoSql, type ReglasDialecto } from './dialectosSql.ts'
import {
  comandoSqlPlus,
  conComandosPunto,
  conComandosSqlplus,
  esCabeceraDeTrigger,
  recortarDerecha
} from './divisorSqlCliente.ts'
import { esBlanco, esSaltoDeLinea, finDeLinea, leerToken, tokenizar, esSignificativo, type Token } from './lexicoSql.ts'
import { clasificar, esAlcanceDeLote, esInicioBloquePlsql, type Clasificacion } from './clasificarSql.ts'
import { avisosDeSentencia, type AvisoSql } from './avisosSql.ts'

/**
 * Qué cerró la sentencia. `lineaCliente`: la cortó un metacomando de psql. `separadorLote`: la
 * cerró un `GO` en su línea (SQL Server).
 */
export type Terminador = 'puntoYComa' | 'barra' | 'finDeLinea' | 'finDeTexto' | 'lineaCliente' | 'separadorLote'

/**
 * Cómo se traduce una posición de `texto` a una del modelo: el carácter
 * `texto[prefijoSintetico]` está en el offset `base` del modelo; lo anterior es
 * sintético (el `BEGIN ` de un EXEC) y no existe en el modelo.
 */
export interface MapaEnvio {
  base: number
  prefijoSintetico: number
}

export interface Sentencia extends Clasificacion {
  /** Posición (0..n-1) dentro del resultado de la división. */
  indice: number
  desde: number
  hastaContenido: number
  hasta: number
  terminador: Terminador
  /** EXACTAMENTE lo que se envía al servidor. */
  texto: string
  mapa: MapaEnvio
  avisos: AvisoSql[]
}

export interface OpcionesDivision {
  /** Inicio del rango a partir (una selección). Cuenta como inicio de línea. */
  desde?: number
  hasta?: number
}

export type ModoEjecucion =
  | { tipo: 'cursor'; cursor: number }
  | { tipo: 'seleccion'; desde: number; hasta: number }
  | { tipo: 'todo' }

interface EnCurso {
  desde: number
  tokens: Token[]
  /** Tokens significativos hasta el primer `;` (para decidir si es un bloque). */
  significativos: Token[]
  ultimoContenido: number
  /**
   * ¿El `;` NO parte? Un bloque PL/SQL (Oracle, hasta la `/`) o una construcción de alcance de
   * lote (SQL Server, hasta el GO). null hasta el primer `;`, que es cuando hace falta saberlo.
   */
  bloque: boolean | null
  /** Profundidad dentro de un cuerpo BEGIN ATOMIC (PG) o BEGIN…END de disparador (SQLite). */
  atomico: number
  /** SQLite: el cuerpo del disparador ya se cerró (un segundo BEGIN no abre otro). */
  cuerpoCerrado: boolean
}

/** Lo que una división tiene a mano: el texto, el rango, las reglas y lo emitido hasta ahora. */
interface Division {
  texto: string
  d: DialectoSql
  r: ReglasDialecto
  inicio: number
  fin: number
  salida: Sentencia[]
}

function emitir(
  v: Division,
  desde: number,
  hastaContenido: number,
  hasta: number,
  terminador: Terminador,
  tokens: readonly Token[],
  envio?: { texto: string; mapa: MapaEnvio }
): void {
  const { texto, d, r, salida } = v
  const cls = clasificar(tokens, d, texto)
  let enviado = envio ? envio.texto : texto.slice(desde, hastaContenido)
  // SQL Server (`conservaPuntoYComaFinal`): un MERGE sin su `;` final no se ejecuta (10713), así que
  // viaja con él. Va DETRÁS del contenido y no mueve el `mapa`; solo para MERGE, para que la
  // partición del renderer y la del main den el mismo texto.
  if (!envio && r.conservaPuntoYComaFinal && cls.verbo === 'MERGE' && enviado[enviado.length - 1] !== ';') enviado += ';'
  salida.push({
    ...cls,
    indice: salida.length,
    desde,
    hastaContenido,
    hasta,
    terminador,
    texto: enviado,
    mapa: envio ? envio.mapa : { base: desde, prefijoSintetico: 0 },
    avisos: avisosDeSentencia(texto, tokens, d, cls, v.inicio)
  })
}

function cerrar(v: Division, e: EnCurso, terminador: Terminador, hastaTerminador: number | null): void {
  const hc = e.ultimoContenido
  emitir(v, e.desde, hc, hastaTerminador !== null ? hastaTerminador : hc, terminador, e.tokens)
}

/** Línea de cliente (SQL*Plus / psql) desde `t`, que es su primer token. Devuelve dónde sigue el escaneo. */
function emitirCliente(v: Division, t: Token): number {
  const { texto } = v
  const finL = recortarDerecha(texto, t.desde, finDeLinea(texto, t.desde, v.fin))
  const linea: Token = { tipo: 'lineaCliente', desde: t.desde, hasta: finL, valor: texto.slice(t.desde, finL), inicioDeLinea: true }
  emitir(v, t.desde, finL, finL, 'finDeLinea', [linea])
  return finL
}

/** `EXEC p(1)` -> `BEGIN p(1); END;`. Devuelve dónde sigue el escaneo. */
function emitirExec(v: Division, t: Token): number {
  const { texto } = v
  const finL = recortarDerecha(texto, t.desde, finDeLinea(texto, t.desde, v.fin))
  let a = t.hasta
  while (a < finL && esBlanco(texto.charCodeAt(a))) a++
  let b = finL
  if (b > a && texto[b - 1] === ';') b = recortarDerecha(texto, a, b - 1)
  if (b <= a) return emitirCliente(v, t)
  const tokens = tokenizar(texto, v.d, t.desde, b)
  const prefijo = 'BEGIN '
  emitir(v, t.desde, b, finL, 'finDeLinea', tokens, {
    texto: prefijo + texto.slice(a, b) + '; END;',
    mapa: { base: a, prefijoSintetico: prefijo.length }
  })
  return finL
}

/** `pos` está en la columna 1 de su línea (el inicio del rango cuenta como tal). */
function enColumnaUno(v: Division, p: number): boolean {
  return p === v.inicio || esSaltoDeLinea(v.texto.charCodeAt(p - 1))
}

/**
 * Fuera de una sentencia: lo que sigue a un token que no es de comentario o separador. Devuelve
 * dónde sigue el escaneo si el token era una línea de cliente, o la sentencia que empieza en él.
 */
function pasoFuera(v: Division, t: Token): EnCurso | number {
  if (t.tipo === 'comentario' || t.tipo === 'puntoYComa' || t.tipo === 'barraSola' || t.tipo === 'separadorLote') return t.hasta
  if (t.tipo === 'lineaCliente') return emitirCliente(v, t)
  if (conComandosSqlplus(v.r.comandosCliente) && t.inicioDeLinea) {
    const cmd = comandoSqlPlus(v.texto, t, v.r, v.inicio, v.fin)
    if (cmd) return cmd === 'exec' ? emitirExec(v, t) : emitirCliente(v, t)
  }
  // `.tables` de `sqlite3`: un `.` en la COLUMNA 1 fuera de una sentencia; la línea entera, sin léxico.
  if (conComandosPunto(v.r.comandosCliente) && v.texto.charCodeAt(t.desde) === 46 && enColumnaUno(v, t.desde)) {
    return emitirCliente(v, t)
  }
  return { desde: t.desde, tokens: [t], significativos: [t], ultimoContenido: t.hasta, bloque: null, atomico: 0, cuerpoCerrado: false }
}

/** SQLite: el `BEGIN` del cuerpo de un CREATE [TEMP] TRIGGER abre un nivel que cierra su `END` (contando CASE…END). */
function cuerpoDeDisparador(e: EnCurso, t: Token): void {
  if (e.atomico === 0 && !e.cuerpoCerrado && t.valor === 'BEGIN' && esCabeceraDeTrigger(e.significativos)) e.atomico = 1
  else if (e.atomico > 0 && t.valor === 'CASE') e.atomico++
  else if (e.atomico > 0 && t.valor === 'END') {
    e.atomico--
    if (e.atomico === 0) e.cuerpoCerrado = true
  }
}

function ultimoSignificativo(tokens: readonly Token[]): Token | null {
  for (let i = tokens.length - 1; i >= 0; i--) if (esSignificativo(tokens[i])) return tokens[i]
  return null
}

/** PG: el cuerpo `BEGIN ATOMIC … END` de una función SQL no se parte por sus `;`. */
function cuerpoAtomico(e: EnCurso, t: Token): void {
  if (t.valor === 'ATOMIC') {
    const previo = ultimoSignificativo(e.tokens)
    if (previo && previo.tipo === 'palabra' && previo.valor === 'BEGIN') e.atomico = 1
  } else if (e.atomico > 0 && t.valor === 'CASE') e.atomico++
  else if (e.atomico > 0 && t.valor === 'END') e.atomico--
}

/**
 * Dentro de una sentencia: el token `t` la cierra, la sigue o cierra una línea de cliente.
 * Devuelve dónde sigue el escaneo si la sentencia se cerró, o -1 si sigue abierta.
 */
function pasoDentro(v: Division, e: EnCurso, t: Token): number {
  switch (t.tipo) {
    case 'comentario':
      e.tokens.push(t)
      return -1
    case 'barraSola':
    case 'separadorLote':
      // El GO en su línea (SQL Server) cierra también un bloque de alcance de lote.
      cerrar(v, e, t.tipo === 'barraSola' ? 'barra' : 'separadorLote', t.hasta)
      return t.hasta
    case 'lineaCliente':
      cerrar(v, e, 'lineaCliente', null)
      return emitirCliente(v, t)
    case 'puntoYComa':
      if (e.bloque === null) e.bloque = esInicioBloquePlsql(e.significativos, v.d) || esAlcanceDeLote(e.significativos, v.d)
      if (!e.bloque && e.atomico === 0) {
        cerrar(v, e, 'puntoYComa', t.hasta)
        return t.hasta
      }
      break
    default:
      if (e.bloque === null) e.significativos.push(t)
  }
  if (t.tipo === 'palabra') {
    if (v.r.triggerBeginEnd) cuerpoDeDisparador(e, t)
    if (v.r.cuerpoAtomico) cuerpoAtomico(e, t)
  }
  e.tokens.push(t)
  e.ultimoContenido = t.hasta
  return -1
}

/**
 * Parte `texto` (o su rango `[desde, hasta)`, tratado como texto independiente)
 * en sentencias. Los offsets son siempre del texto completo.
 */
export function dividirSentencias(texto: string, d: DialectoSql, op: OpcionesDivision = {}): Sentencia[] {
  const inicio = Math.max(0, Math.min(op.desde !== undefined ? op.desde : 0, texto.length))
  const fin = Math.max(inicio, Math.min(op.hasta !== undefined ? op.hasta : texto.length, texto.length))
  const v: Division = { texto, d, r: reglasDe(d), inicio, fin, salida: [] }
  let pos = inicio
  let e: EnCurso | null = null
  for (;;) {
    const t = leerToken(texto, pos, v.r, inicio, fin)
    if (!e) {
      if (!t) break
      const paso = pasoFuera(v, t)
      if (typeof paso === 'number') {
        pos = paso
      } else {
        e = paso
        pos = t.hasta
      }
      continue
    }
    if (!t) {
      cerrar(v, e, 'finDeTexto', null)
      break
    }
    const sigue = pasoDentro(v, e, t)
    if (sigue >= 0) {
      e = null
      pos = sigue
    } else {
      pos = t.hasta
    }
  }
  return v.salida
}

/** ¿Hay un salto de línea en `[desde, hasta)`? */
function haySalto(texto: string, desde: number, hasta: number): boolean {
  for (let i = desde; i < hasta; i++) if (esSaltoDeLinea(texto.charCodeAt(i))) return true
  return false
}

/**
 * La sentencia que ejecuta Ctrl+Enter sin selección:
 * 1. justo tras su terminador (`a;|b`) → la anterior;
 * 2. dentro de una sentencia → esa;
 * 3. al final de la línea de una sentencia (solo blancos o comentarios detrás
 *    en la MISMA línea) → la anterior;
 * 4. en los blancos iniciales de la línea de la siguiente → la siguiente;
 * 5. en otro caso → null (la barra dice «Coloca el cursor en una sentencia o
 *    selecciona texto»).
 */
export function sentenciaEnCursor(sentencias: readonly Sentencia[], texto: string, cursor: number): Sentencia | null {
  let previa: Sentencia | null = null
  let siguiente: Sentencia | null = null
  for (const s of sentencias) {
    if (s.hasta === cursor && s.hasta > s.desde) return s
    if (s.desde <= cursor && cursor < s.hasta) return s
    if (s.hasta <= cursor) previa = s
    else if (s.desde > cursor && !siguiente) siguiente = s
  }
  if (previa && !haySalto(texto, previa.hasta, cursor)) return previa
  if (siguiente && !haySalto(texto, cursor, siguiente.desde)) return siguiente
  return null
}

/**
 * Lo que envía Ejecutar según el modo: la sentencia bajo el cursor, las de la
 * selección (partida como texto independiente, offsets del modelo) o todas.
 * Una selección vacía cuenta como cursor.
 */
export function sentenciasAEjecutar(texto: string, d: DialectoSql, modo: ModoEjecucion): Sentencia[] {
  if (modo.tipo === 'todo') return dividirSentencias(texto, d)
  if (modo.tipo === 'seleccion' && modo.hasta > modo.desde) {
    return dividirSentencias(texto, d, { desde: modo.desde, hasta: modo.hasta })
  }
  const cursor = modo.tipo === 'cursor' ? modo.cursor : modo.desde
  const s = sentenciaEnCursor(dividirSentencias(texto, d), texto, cursor)
  return s ? [s] : []
}

// --- Líneas y columnas (1-based, como Monaco) -----------------------------------

/**
 * Offsets de inicio de cada línea. `\r\n`, `\n` y `\r` sueltos cuentan como un
 * salto (los mismos que reconoce Monaco).
 */
export function indiceDeLineas(texto: string): Int32Array {
  const inicios: number[] = [0]
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    if (c === 13) {
      if (i + 1 < texto.length && texto.charCodeAt(i + 1) === 10) i++
      inicios.push(i + 1)
    } else if (c === 10) {
      inicios.push(i + 1)
    }
  }
  return Int32Array.from(inicios)
}

/** Línea y columna (1-based, columna en unidades UTF-16 como Monaco) de un offset. */
export function posicionDeOffset(indice: Int32Array, offset: number): { linea: number; columna: number } {
  let lo = 0
  let hi = indice.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (indice[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return { linea: lo + 1, columna: offset - indice[lo] + 1 }
}

/** Offset de una línea y columna 1-based (acotado al texto indexado). */
export function offsetDePosicion(indice: Int32Array, linea: number, columna: number): number {
  const l = Math.max(1, Math.min(linea, indice.length))
  return indice[l - 1] + Math.max(0, columna - 1)
}
