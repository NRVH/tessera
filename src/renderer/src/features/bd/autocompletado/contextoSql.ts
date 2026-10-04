// =============================================================================
// Contexto del autocompletado SQL: qué tiene sentido escribir donde está el cursor
// (nada, palabras clave, objetos, columnas o miembros de `X.`), a partir de los
// tokens del léxico compartido. Puro; lo usan el proveedor de Monaco y las pruebas.
// Las piezas viven en `tokensSql`, `referenciasSql`, `clausulasSql` y `estrellaSql`;
// aquí se reexporta lo que usan los demás módulos.
// Decisiones: docs/decisiones/bd/ui-autocompletado-contexto.md
// =============================================================================

import type { DbTipoObjeto } from '../../../../../shared/db-explorador-ipc.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { dividirSentencias, sentenciaEnCursor, type Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import { esParteIdent, tokenizar, type Token } from '../../../../../shared/sql/lexicoSql.ts'
import { decidir, recorrer, type Nivel, type Posicion } from './clausulasSql.ts'
import { admiteTresPartes, referencias, type RefTabla } from './referenciasSql.ts'
import { crudo, esIdent, esPalabra, nombreDe, significativos } from './tokensSql.ts'

export { admiteTresPartes, referencias, type RefTabla } from './referenciasSql.ts'
export { TIPOS_RELACION } from './clausulasSql.ts'
export { estrellaEn, type EstrellaSelect } from './estrellaSql.ts'

/** Lo que el autocompletado sabe de un JOIN a medio escribir. */
export interface InfoJoin {
  /** Tablas de la MISMA consulta a la izquierda del JOIN (FROM y JOIN anteriores), en orden. */
  previas: RefTabla[]
  /** Nombres y alias ya usados en la sentencia (para no repetir alias), plegados. */
  usados: string[]
  /** Caja de la palabra que se escribió (`join`/`JOIN`): la de las que se insertan (ON, AND). */
  caja: 'mayus' | 'minus'
}

/** Lo que el autocompletado sabe de la condición del ON de un JOIN. */
export interface InfoCondicion {
  /** La tabla del JOIN cuyo ON se está escribiendo. */
  nueva: RefTabla
  /** Las de la izquierda, en orden. */
  previas: RefTabla[]
  caja: 'mayus' | 'minus'
}

export type Contexto =
  | { tipo: 'ninguno' }
  | { tipo: 'palabrasClave'; prefijo: string }
  | {
      tipo: 'objetos'
      prefijo: string
      /** `ESQ.` escrito delante, ya plegado; null = todos los esquemas del índice. */
      esquema: string | null
      /** `BASE.ESQ.` escrito delante (nombres de tres partes). */
      base?: string
      /** Solo estos tipos; sin él, cualquiera. */
      tipos?: readonly DbTipoObjeto[]
      /** Tras `JOIN`: se sugieren primero las tablas relacionadas por FK, con su ON. */
      join?: InfoJoin
    }
  | {
      tipo: 'columnas'
      prefijo: string
      tablas: RefTabla[]
      /** No hay tablas de las que sacar columnas: se ofrecen también objetos. */
      conObjetos: boolean
      /** La posición admite también palabras clave (AND, FROM, DISTINCT…). */
      conClaves: boolean
      /** Al principio de un operando del ON de un JOIN: se sugieren primero las condiciones de FK. */
      condicion?: InfoCondicion
    }
  | {
      tipo: 'miembro'
      prefijo: string
      /** Lo escrito antes del punto, parte a parte y plegado: `a.b.` -> ['A', 'B']. */
      calificador: string[]
      /** Referencias de la sentencia, para resolver un alias. */
      tablas: RefTabla[]
    }

type ContextoObjetos = Extract<Contexto, { tipo: 'objetos' }>
type ContextoColumnas = Extract<Contexto, { tipo: 'columnas' }>

/** Palabra de identificador que rodea a un offset. */
export interface PalabraCursor {
  desde: number
  hasta: number
  /** La palabra entera, `[desde, hasta)`. */
  palabra: string
  /** Lo tecleado hasta el cursor, `[desde, offset)`: el `filterText` de Monaco. */
  prefijo: string
}

/** Caja de una palabra tal como se escribió: minúsculas si no lleva ninguna mayúscula. */
function cajaDeToken(t: Token | null, texto: string | undefined): 'mayus' | 'minus' {
  if (!t || texto === undefined) return 'mayus'
  const c = texto.slice(t.desde, t.hasta)
  return /[A-Z]/.test(c) || !/[a-z]/.test(c) ? 'mayus' : 'minus'
}

/** Tras `JOIN ` (nada más escrito en la cláusula): las tablas de la izquierda. */
function infoJoin(pila: readonly Nivel[], usados: readonly RefTabla[], texto: string | undefined): InfoJoin | undefined {
  const n = pila[pila.length - 1]
  if (n.clausula !== 'JOIN' || n.tras.length > 0 || !n.joinConOn) return undefined
  const nombres: string[] = []
  for (const r of usados) {
    const x = r.alias !== null ? r.alias : r.nombre
    if (nombres.indexOf(x) < 0) nombres.push(x)
  }
  return { previas: [...n.refs], usados: nombres, caja: cajaDeToken(n.palabraClausula, texto) }
}

function inicioDeOperando(tras: readonly Token[]): boolean {
  const u = tras[tras.length - 1]
  return u === undefined || esPalabra(u, 'AND')
}

/**
 * Al principio de un operando del ON de un JOIN (`ON ¦`, `ON a = b AND ¦`, también
 * dentro de `ON (¦`): la tabla del JOIN y las de su izquierda.
 */
function infoCondicion(pila: readonly Nivel[], texto: string | undefined): InfoCondicion | undefined {
  let n = pila[pila.length - 1]
  if (n.clausula === null && n.clase === 'grupo' && n.previo === 'ON' && pila.length >= 2) {
    // `ON (¦`: el grupo es transparente; manda el nivel que lleva el ON.
    if (!inicioDeOperando(n.tras)) return undefined
    n = pila[pila.length - 2]
  } else if (n.clausula !== 'ON' || !inicioDeOperando(n.tras)) {
    return undefined
  }
  if (n.clausula !== 'ON' || n.ultimaJoin === null || !n.joinConOn) return undefined
  const k = n.refs.indexOf(n.ultimaJoin)
  if (k <= 0) return undefined
  return { nueva: n.ultimaJoin, previas: n.refs.slice(0, k), caja: cajaDeToken(n.palabraClausula, texto) }
}

/**
 * Trozo de la sentencia entre el `;` (o `/`, o el `GO` en su línea) anterior al cursor y
 * el siguiente. Cubre a quien llama a `analizarContexto` con los tokens de un texto
 * ENTERO: sin ello, en `SELECT a FROM t x⏎GO⏎x.¦` el alias `x` del lote anterior resolvía.
 */
function trozoDelCursor(tokens: readonly Token[], limite: number): Token[] {
  let ini = 0
  let fin = tokens.length
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.tipo !== 'puntoYComa' && t.tipo !== 'barraSola' && t.tipo !== 'separadorLote') continue
    if (t.hasta <= limite) ini = i + 1
    else {
      fin = i
      break
    }
  }
  return significativos(tokens.slice(ini, fin))
}

/**
 * Con el cursor justo al final de `t`: dentro si no está cerrado, si es un `--` (llega
 * al fin de línea) o si se está tecleando un número o un bind.
 */
function dentroAlFinal(t: Token): boolean {
  const comentarioDeLinea = t.tipo === 'comentario' && t.valor.slice(0, 2) === '--'
  return t.sinCerrar === true || comentarioDeLinea || t.tipo === 'numero' || t.tipo === 'bind' || t.tipo === 'lineaCliente'
}

/** La palabra a medio escribir bajo el cursor; null si el cursor está donde no se sugiere nada. */
function palabraBajoCursor(tokens: readonly Token[], cursor: number): { palabra: Token | null } | null {
  let palabra: Token | null = null
  for (const t of tokens) {
    if (t.desde >= cursor) break
    if (cursor > t.hasta) continue
    // Aquí t.desde < cursor <= t.hasta.
    if (t.tipo === 'palabra') {
      palabra = t
      continue
    }
    if (cursor < t.hasta || dentroAlFinal(t)) return null
  }
  return { palabra }
}

/** `a.b.¦`: la cadena de calificadores pegada al cursor y dónde empieza en `antes`. */
function calificadorPegado(
  antes: readonly Token[],
  limite: number,
  d: DialectoSql,
  texto: string | undefined
): { calificador: string[]; inicio: number } {
  const calificador: string[] = []
  let i = antes.length
  while (
    i >= 2 &&
    antes[i - 1].tipo === 'punto' &&
    esIdent(antes[i - 2]) &&
    antes[i - 2].hasta === antes[i - 1].desde &&
    antes[i - 1].hasta === (i === antes.length ? limite : antes[i].desde)
  ) {
    calificador.unshift(nombreDe(antes[i - 2], d, texto))
    i -= 2
  }
  return { calificador, inicio: i }
}

/** Lo que `analizarContexto` ya sabe al decidir el contexto. */
interface Situacion {
  pila: Nivel[]
  trozo: Token[]
  palabra: Token | null
  prefijo: string
  d: DialectoSql
  texto: string | undefined
}

function contextoObjetos(s: Situacion, esquema: string | null, tipos: readonly DbTipoObjeto[] | undefined): ContextoObjetos {
  // La palabra a medio escribir (`join d¦`) no es un nombre «usado»: si contara, el
  // alias `d` de la sugerencia saldría `d1`.
  const usados = s.palabra ? s.trozo.filter((t) => t !== s.palabra) : s.trozo
  const join = infoJoin(s.pila, referencias(usados, s.d, s.texto), s.texto)
  const c: ContextoObjetos = tipos
    ? { tipo: 'objetos', prefijo: s.prefijo, esquema, tipos }
    : { tipo: 'objetos', prefijo: s.prefijo, esquema }
  if (join) c.join = join
  return c
}

function contextoColumnas(s: Situacion, soloDe: RefTabla | null, conClaves: boolean): ContextoColumnas {
  const tablas = soloDe ? [soloDe] : referencias(s.trozo, s.d, s.texto)
  const c: ContextoColumnas = { tipo: 'columnas', prefijo: s.prefijo, tablas, conObjetos: tablas.length === 0, conClaves }
  const condicion = infoCondicion(s.pila, s.texto)
  if (condicion) c.condicion = condicion
  return c
}

/** Con `a.b.` delante: objetos de ese esquema en posición de objeto; si no, un miembro. */
function contextoCalificado(s: Situacion, pos: Posicion, calificador: string[]): Contexto {
  if (pos.tipo === 'objetos') {
    const c = contextoObjetos(s, calificador[calificador.length - 1], pos.tipos)
    // `FROM ventas.dbo.¦`: los objetos de ESE esquema de OTRA base.
    if (calificador.length >= 2 && admiteTresPartes(s.d)) c.base = calificador[calificador.length - 2]
    return c
  }
  return { tipo: 'miembro', prefijo: s.prefijo, calificador, tablas: referencias(s.trozo, s.d, s.texto) }
}

/**
 * Qué se puede sugerir en `cursor` (mismas coordenadas que los tokens). `texto`
 * es el texto del que salieron los tokens: con él, el prefijo conserva su caja y
 * el plegado de PG es exacto.
 */
export function analizarContexto(tokens: readonly Token[], cursor: number, d: DialectoSql, texto?: string): Contexto {
  const bajo = palabraBajoCursor(tokens, cursor)
  if (bajo === null) return { tipo: 'ninguno' }
  const palabra = bajo.palabra
  const limite = palabra ? palabra.desde : cursor
  const prefijo = palabra ? crudo(palabra, texto).slice(0, cursor - palabra.desde) : ''
  const trozo = trozoDelCursor(tokens, limite)
  const antes = trozo.filter((t) => t.hasta <= limite)
  const { calificador, inicio } = calificadorPegado(antes, limite, d, texto)
  const pila = recorrer(antes.slice(0, inicio), d, texto)
  const pos = decidir(pila)
  const s: Situacion = { pila, trozo, palabra, prefijo, d, texto }
  if (calificador.length > 0) return contextoCalificado(s, pos, calificador)
  switch (pos.tipo) {
    case 'ninguno':
      return { tipo: 'ninguno' }
    case 'claves':
      return { tipo: 'palabrasClave', prefijo }
    case 'objetos':
      return contextoObjetos(s, null, pos.tipos)
    case 'columnas':
      return contextoColumnas(s, pos.soloDe, pos.conClaves)
  }
}

/**
 * `analizarContexto` sobre el texto entero del modelo: elige la sentencia bajo el
 * cursor (`sentenciaEnCursor`, las reglas de Ejecutar) y tokeniza su rango ESTIRADO
 * HASTA EL CURSOR, porque el divisor deja fuera los blancos y comentarios finales.
 * Sin sentencia, se tokeniza desde el final de la anterior. `sentencias` es opcional
 * para que el proveedor pase las que ya tiene memorizadas por versión del modelo.
 */
export function contextoEnTexto(texto: string, cursor: number, d: DialectoSql, sentencias?: readonly Sentencia[]): Contexto {
  const ss = sentencias ?? dividirSentencias(texto, d)
  const s = sentenciaEnCursor(ss, texto, cursor)
  let desde = 0
  let hasta = cursor
  if (s) {
    desde = Math.min(s.desde, cursor)
    hasta = Math.max(s.hasta, cursor)
  } else {
    for (const x of ss) if (x.hasta <= cursor) desde = x.hasta
  }
  return analizarContexto(tokenizar(texto, d, desde, hasta), cursor, d, texto)
}

/**
 * La palabra de identificador alrededor de `offset`: letras (también las no
 * ASCII, como el léxico), dígitos, `_`, `$` y `#` (este último solo en Oracle;
 * en PG `#` es un operador). Es el rango que reemplaza una sugerencia.
 */
export function palabraEnCursor(texto: string, offset: number, d: DialectoSql = 'oracle'): PalabraCursor {
  const o = Math.max(0, Math.min(offset, texto.length))
  let desde = o
  while (desde > 0 && esParteIdent(texto.charCodeAt(desde - 1), d)) desde--
  let hasta = o
  while (hasta < texto.length && esParteIdent(texto.charCodeAt(hasta), d)) hasta++
  return { desde, hasta, palabra: texto.slice(desde, hasta), prefijo: texto.slice(desde, o) }
}
