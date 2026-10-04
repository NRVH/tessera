// =============================================================================
// Posición del error del servidor -> offset del texto que envió el renderer, entre bytes UTF-8 (Oracle),
// puntos de código (PG) y UTF-16 (Monaco). La usa SOLO el main; cada servidor es un algoritmo (`switch`
// con `nunca`). Incluye las conversiones y la cuenta de bytes UTF-8, la única de `shared/`.
// Neutral y ES2020.
// Decisiones: docs/decisiones/bd/sql-posicion-error.md
// =============================================================================

import { reglasDe, type DialectoSql } from './dialectosSql.ts'
import { tokenizar, type Token } from './lexicoSql.ts'
import { claveDeNombre, normalizarIdent } from './identificadoresSql.ts'
import { indiceDeLineas, offsetDePosicion, type Sentencia } from './divisorSql.ts'
import { nunca } from '../nunca.ts'

/** Unidades UTF-16 que ocupan los primeros `n` puntos de código de `texto`. */
export function puntosDeCodigoAUtf16(texto: string, n: number): number {
  let i = 0
  let cuenta = 0
  const objetivo = Math.max(0, Math.floor(n))
  while (cuenta < objetivo && i < texto.length) {
    const c = texto.charCodeAt(i)
    const par = c >= 0xd800 && c <= 0xdbff && i + 1 < texto.length
    const c2 = par ? texto.charCodeAt(i + 1) : 0
    i += par && c2 >= 0xdc00 && c2 <= 0xdfff ? 2 : 1
    cuenta++
  }
  return i
}

/** Puntos de código de `texto` antes del offset UTF-16 `u`. */
export function utf16APuntosDeCodigo(texto: string, u: number): number {
  let cuenta = 0
  const fin = Math.min(Math.max(0, u), texto.length)
  for (let i = 0; i < fin; i++) {
    const c = texto.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < fin) {
      const c2 = texto.charCodeAt(i + 1)
      if (c2 >= 0xdc00 && c2 <= 0xdfff) i++
    }
    cuenta++
  }
  return cuenta
}

// --- Bytes UTF-8 ----------------------------------------------------------------------
// LA ÚNICA CUENTA DE BYTES UTF-8 DE `shared/`. La usan las posiciones de error (el offset
// de Oracle y la columna de ALL_ERRORS van en bytes) y el guion de Oracle de
// `escrituraSql/oracle.ts` (SQL*Plus cuenta bytes por línea), que la importa de aquí; es la
// excepción al «solo el main» de la cabecera, y no arrastra nada que el renderer no
// cargue ya. `src/tdb/erroresSesionOracle.cjs` lleva la suya porque corre en otro proceso, en
// CommonJS, sin acceso a estos módulos.

/**
 * Bytes UTF-8 del carácter que empieza en `texto[i]`, sin mirar más allá de `hasta`. Da 4
 * SOLO para un par sustituto completo, que ocupa DOS unidades: quien recorre el texto
 * avanza 2 cuando da 4, y 1 en otro caso. Un sustituto suelto cuenta 3, que es lo que
 * escribe `Buffer.from` (U+FFFD); también la mitad de un par que `hasta` corta.
 */
export function bytesUtf8DelCaracter(texto: string, i: number, hasta: number = texto.length): number {
  const c = texto.charCodeAt(i)
  if (c < 0x80) return 1
  if (c < 0x800) return 2
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < hasta) {
    const c2 = texto.charCodeAt(i + 1)
    if (c2 >= 0xdc00 && c2 <= 0xdfff) return 4
  }
  return 3
}

/** Bytes UTF-8 de `texto[desde, hasta)`, por defecto el texto entero: `Buffer.byteLength` sin codificarlo. */
export function bytesUtf8(texto: string, desde = 0, hasta: number = texto.length): number {
  let n = 0
  for (let i = desde; i < hasta; ) {
    const b = bytesUtf8DelCaracter(texto, i, hasta)
    n += b
    i += b === 4 ? 2 : 1
  }
  return n
}

/**
 * Puntos de código COMPLETOS que caben en los primeros `bytes` bytes UTF-8 de
 * `texto`. Un offset que cae a mitad de un carácter apunta a ese carácter.
 * Un sustituto suelto ocupa 3 bytes (lo que escribe `Buffer.from`).
 */
export function bytesUtf8APuntosDeCodigo(texto: string, bytes: number): number {
  let acumulado = 0
  let cuenta = 0
  let i = 0
  while (i < texto.length) {
    const ancho = bytesUtf8DelCaracter(texto, i)
    if (acumulado + ancho > bytes) break
    acumulado += ancho
    cuenta++
    i += ancho === 4 ? 2 : 1
  }
  return cuenta
}

/** `err.position` de PG (base 1, a veces string) a puntos de código base 0. */
export function offsetCpDePosicionPg(posicion: string | number | null | undefined): number | null {
  if (posicion === null || posicion === undefined || posicion === '') return null
  const n = typeof posicion === 'number' ? posicion : parseInt(posicion, 10)
  return Number.isFinite(n) && n >= 1 ? n - 1 : null
}

/**
 * Offset UTF-16 dentro de `s.texto` (lo enviado) -> offset en el texto que se
 * partió (el modelo, o el `sql` que recibió el main). Lo que cae en el prefijo
 * sintético va al inicio del contenido real; todo se acota a la sentencia.
 */
export function offsetEnviadoAModelo(s: Sentencia, offsetUtf16EnTexto: number): number {
  const o = Math.max(0, Math.floor(offsetUtf16EnTexto))
  const relativo = o < s.mapa.prefijoSintetico ? 0 : o - s.mapa.prefijoSintetico
  return Math.max(s.desde, Math.min(s.hastaContenido, s.mapa.base + relativo))
}

/** `line 3, column 7` / `línea 3, columna 7` de un ORA-06550. */
export function lineaColumnaOra06550(mensaje: string): { linea: number; columna: number } | null {
  if (!/ORA-06550/.test(mensaje)) return null
  const m = /\b(?:line|l[ií]nea)\s+(\d+)\s*,\s*(?:column|columna)\s+(\d+)/i.exec(mensaje)
  if (!m) return null
  return { linea: parseInt(m[1], 10), columna: parseInt(m[2], 10) }
}

/**
 * Offset UTF-16 de `linea`/`columna` (1-based) dentro de `texto`. La columna va en
 * puntos de código por defecto, o en BYTES UTF-8 con `unidad: 'bytes'`: es como la da
 * Oracle en ORA-06550 (medido en 11.2 y 21c con AL32UTF8: una ñ cuenta 2, igual que en
 * ALL_ERRORS). Contarla en caracteres corría la marca un puesto por cada ñ o tilde
 * anterior en la línea.
 */
export function offsetDeLineaColumna(
  texto: string,
  linea: number,
  columna: number,
  unidad: 'caracteres' | 'bytes' = 'caracteres'
): number {
  const indice = indiceDeLineas(texto)
  const inicioLinea = offsetDePosicion(indice, linea, 1)
  const l = Math.max(1, Math.min(linea, indice.length))
  const finLinea = l < indice.length ? indice[l] : texto.length
  const resto = texto.slice(inicioLinea, finLinea)
  const cp = unidad === 'bytes' ? bytesUtf8APuntosDeCodigo(resto, columna - 1) : columna - 1
  return inicioLinea + Math.min(resto.replace(/[\r\n]+$/, '').length, puntosDeCodigoAUtf16(resto, cp))
}

/** Lo que el trabajador sabe de la posición de un error del servidor. */
export interface PosicionServidor {
  /**
   * Puntos de código, base 0, relativos a `s.texto`. El trabajador ya pasó los
   * bytes UTF-8 de Oracle a puntos de código y restó 1 a la posición de PG.
   * null/undefined = el servidor no dio posición.
   */
  offsetCp?: number | null
  mensaje?: string
  /** PG: consulta interna de una función SQL y su posición (base 1). */
  consultaInterna?: string
  posicionInterna?: number
  /** PG: contexto `where` ("PL/pgSQL function inline_code_block line 3 at RAISE"). */
  donde?: string
  /**
   * SQL Server: la LÍNEA del error (`lineNumber` de tedious), base 1, relativa al
   * texto ENVIADO (`s.texto`). SQL Server no da columna: en un error de sintaxis (102/156)
   * es la línea del token; en uno de nombres (207/208), la línea donde EMPIEZA la sentencia
   * (medido). El envoltorio de solo lectura va en la MISMA línea, así que no la desplaza.
   */
  linea?: number | null
  /**
   * SQL Server: el objeto donde ocurrió (`procName`). Dentro de un EXEC la línea es
   * del CUERPO de ese procedimiento, no del texto; dentro de un CREATE PROC es la del lote,
   * con `objeto` = el que se crea (medido).
   */
  objeto?: string | null
}

// --- SQL Server: línea, objeto y el nombre del mensaje ------------------------------------

/** Las partes de un nombre `a.b.[c]` tal como las escribe el servidor en un mensaje o en procName. */
function partesDeNombre(nombre: string, d: DialectoSql): string[] {
  return nombre.split('.').map((p) => normalizarIdent(p, d))
}

/**
 * ¿`objeto` (el procName del error) es el que crea o redefine esta sentencia? Compara el
 * nombre (y el esquema, si los dos lo traen) como el motor (`claveDeNombre`).
 */
function esObjetoDeLaSentencia(s: Sentencia, objeto: string, d: DialectoSql): boolean {
  const o = s.objetoCreado
  if (!o) return false
  const partes = partesDeNombre(objeto, d)
  if (claveDeNombre(partes[partes.length - 1], d) !== claveDeNombre(o.nombre, d)) return false
  const esquema = partes.length >= 2 ? partes[partes.length - 2] : null
  return esquema === null || o.esquema === null || claveDeNombre(esquema, d) === claveDeNombre(o.esquema, d)
}

/** Lo primero entre comillas simples de un mensaje del servidor, o null. */
function nombreEntreComillas(mensaje: string): string | null {
  const m = /'([^']+)'/.exec(mensaje)
  return m ? m[1] : null
}

/** El texto con el que un token se compara con un nombre del mensaje. */
function textoDeToken(t: Token, texto: string): string {
  return t.tipo === 'identCitado' ? t.valor : texto.slice(t.desde, t.hasta)
}

/**
 * Offset de la primera aparición de `nombre` como token (o como `a.b.c` seguido) desde `desde`,
 * o null. Los nombres y palabras se comparan como el motor (sin caja); lo demás, exacto. Si el
 * nombre calificado entero no aparece, se busca su última parte (`'pruebas.dbo.t'` de un
 * mensaje que escribe el nombre completo cuando el texto solo dice `t`).
 */
function buscarNombre(texto: string, desde: number, nombre: string, d: DialectoSql): number | null {
  const tokens = tokenizar(texto, d, desde).filter((t) => t.tipo !== 'comentario')
  const igual = (t: Token | undefined, parte: string): boolean => {
    if (!t) return false
    if (t.tipo === 'palabra' || t.tipo === 'identCitado') return claveDeNombre(textoDeToken(t, texto), d) === claveDeNombre(parte, d)
    return textoDeToken(t, texto) === parte
  }
  const buscar = (partes: readonly string[]): number | null => {
    for (let i = 0; i < tokens.length; i++) {
      let ok = true
      for (let k = 0; k < partes.length && ok; k++) {
        ok = igual(tokens[i + 2 * k], partes[k]) && (k === 0 || tokens[i + 2 * k - 1].tipo === 'punto')
      }
      if (ok) return tokens[i].desde
    }
    return null
  }
  const partes = nombre.indexOf('.') > 0 && nombre.indexOf('.') < nombre.length - 1 ? partesDeNombre(nombre, d) : [nombre]
  const entero = buscar(partes)
  if (entero !== null || partes.length === 1) return entero
  return buscar([partes[partes.length - 1]])
}

/** Primer carácter no blanco de la línea `n` (1-based) contando desde `desde`. */
function inicioDeLineaDesde(texto: string, desde: number, n: number): number | null {
  let i = desde
  for (let l = 1; l < n; l++) {
    const salto = texto.slice(i).search(/\r\n|\n|\r/)
    if (salto < 0) return null
    i += salto + (texto.startsWith('\r\n', i + salto) ? 2 : 1)
  }
  while (i < texto.length && (texto[i] === ' ' || texto[i] === '\t')) i++
  return i
}

/**
 * Offset (en el texto que se partió) donde marcar el error de la sentencia `s`,
 * o null si el servidor no dio ninguna pista de posición.
 */
export function offsetDeError(s: Sentencia, p: PosicionServidor, d: DialectoSql): number | null {
  // Un dialecto fuera del registro da «Dialecto desconocido», no el «caso sin contemplar» del `nunca`.
  reglasDe(d)
  // Cómo da la posición cada SERVIDOR es un algoritmo, no una bandera: `switch` que cierra con `nunca`.
  switch (d) {
    case 'postgres':
      return offsetPostgres(s, p, d)
    case 'oracle':
      return offsetOracle(s, p)
    case 'sqlite':
      return offsetSqlite(s, p)
    case 'sqlserver':
      return offsetSqlserver(s, p, d)
    default:
      return nunca(d, 'offsetDeError')
  }
}

/** PG: `position` llega a base 0 (un 0 es el primer carácter); respaldos: consulta interna y `where`. */
function offsetPostgres(s: Sentencia, p: PosicionServidor, d: DialectoSql): number | null {
  const cp = p.offsetCp
  if (cp !== null && cp !== undefined && cp >= 0) return offsetEnviadoAModelo(s, puntosDeCodigoAUtf16(s.texto, cp))
  return offsetPgConsultaInterna(s, p) ?? offsetPgDonde(s, p, d)
}

function offsetPgConsultaInterna(s: Sentencia, p: PosicionServidor): number | null {
  if (!(p.consultaInterna && p.posicionInterna && p.posicionInterna >= 1)) return null
  const idx = s.texto.indexOf(p.consultaInterna)
  if (idx < 0) return null
  return offsetEnviadoAModelo(s, idx + puntosDeCodigoAUtf16(p.consultaInterna, p.posicionInterna - 1))
}

/** Un servidor con `lc_messages` en español escribe «en la línea N» (como el ORA-06550). */
function offsetPgDonde(s: Sentencia, p: PosicionServidor, d: DialectoSql): number | null {
  const m = p.donde ? /\b(?:line|l[ií]nea) (\d+)\b/.exec(p.donde) : null
  if (!m) return null
  const cuerpo = tokenizar(s.texto, d).find((t) => t.tipo === 'cadena' && t.valor[0] === '$')
  if (!cuerpo) return null
  const etiqueta = /^\$[^$]*\$/.exec(cuerpo.valor)
  const inicioCuerpo = cuerpo.desde + (etiqueta ? etiqueta[0].length : 0)
  const o = inicioDeLineaDesde(s.texto, inicioCuerpo, parseInt(m[1], 10))
  return o !== null ? offsetEnviadoAModelo(s, o) : null
}

/** Oracle: un offset 0 es «sin posición» (ORA-01017, errores de ejecución); respaldo: ORA-06550. */
function offsetOracle(s: Sentencia, p: PosicionServidor): number | null {
  const cp = p.offsetCp
  if (cp !== null && cp !== undefined && cp > 0) return offsetEnviadoAModelo(s, puntosDeCodigoAUtf16(s.texto, cp))
  const lc = p.mensaje ? lineaColumnaOra06550(p.mensaje) : null
  if (lc) return offsetEnviadoAModelo(s, offsetDeLineaColumna(s.texto, lc.linea, lc.columna, 'bytes'))
  return null
}

/** SQLite no da posición: la calcula el trabajador (prefijo más corto que da el mismo error) en `offsetCp`. */
function offsetSqlite(s: Sentencia, p: PosicionServidor): number | null {
  const cp = p.offsetCp
  if (cp !== null && cp !== undefined && cp >= 0) return offsetEnviadoAModelo(s, puntosDeCodigoAUtf16(s.texto, cp))
  return null
}

/**
 * SQL Server da LÍNEA (base 1, del texto enviado) y no columna. Con `objeto` (procName) la línea
 * es del CUERPO de ese objeto: sin posición, salvo que sea el que esta sentencia crea o redefine.
 * Si el mensaje nombra algo entre comillas simples, se marca su primera aparición como token desde
 * el principio de esa línea; si no aparece, el primer carácter no blanco de la línea.
 */
function offsetSqlserver(s: Sentencia, p: PosicionServidor, d: DialectoSql): number | null {
  const linea = p.linea
  if (linea === null || linea === undefined || !Number.isInteger(linea) || linea < 1) return null
  if (p.objeto && !esObjetoDeLaSentencia(s, p.objeto, d)) return null
  const o = inicioDeLineaDesde(s.texto, 0, linea)
  if (o === null) return null
  const nombre = p.mensaje ? nombreEntreComillas(p.mensaje) : null
  const k = nombre !== null ? buscarNombre(s.texto, o, nombre, d) : null
  return offsetEnviadoAModelo(s, k !== null ? k : o)
}

// --- Errores de compilación de PL/SQL (ALL_ERRORS) ------------------------------------

/**
 * Dónde empieza el CUERPO de un disparador: el primer `DECLARE`, `BEGIN` o
 * `COMPOUND` a profundidad 0 tras la palabra TRIGGER (la cabecera puede llevar un
 * `WHEN (…)` con paréntesis). null si no hay (un disparador `CALL`).
 */
function inicioCuerpoTrigger(texto: string, desde: number): number | null {
  let profundidad = 0
  // motor-fijo: ALL_ERRORS y los disparadores con cuerpo PL/SQL solo existen en Oracle.
  for (const t of tokenizar(texto, 'oracle', desde)) {
    if (t.tipo === 'parenA') profundidad++
    else if (t.tipo === 'parenC') profundidad = Math.max(0, profundidad - 1)
    else if (
      t.tipo === 'palabra' &&
      profundidad === 0 &&
      (t.valor === 'DECLARE' || t.valor === 'BEGIN' || t.valor === 'COMPOUND')
    ) {
      return t.desde
    }
  }
  return null
}

function esPosicionEntera(n: number): boolean {
  return Number.isInteger(n) && n >= 1
}

/** Principio de la línea `linea` (1 = la del `ancla`), contando solo `\n`; null si el texto no llega. */
function inicioDeLineaPedida(texto: string, ancla: number, linea: number): number | null {
  let inicio = texto.lastIndexOf('\n', ancla - 1) + 1
  for (let l = 1; l < linea; l++) {
    const salto = texto.indexOf('\n', inicio)
    if (salto < 0) return null
    inicio = salto + 1
  }
  return inicio
}

/**
 * Offset (en el texto que se partió) de un error de ALL_ERRORS tras un
 * `CREATE … PROCEDURE|FUNCTION|PACKAGE [BODY]|TYPE [BODY]|TRIGGER`, o null si no se
 * puede situar (línea 0, «Compilation unit analysis terminated»). Medido contra la
 * 11.2 (thick) y la 21c (thin), con los mismos números en las dos:
 *   - ALL_SOURCE guarda la unidad desde la palabra del tipo: la LÍNEA 1 es la de
 *     `PROCEDURE` (no la de `CREATE`, que puede ir en otra) y su columna cuenta desde
 *     esa palabra; las demás líneas, desde su principio.
 *   - En un DISPARADOR la numeración empieza en su cuerpo: el `DECLARE`, el `BEGIN`
 *     o el `COMPOUND TRIGGER`, no en la cabecera.
 *   - Las líneas se parten SOLO por `\n` (con CRLF el `\r` queda al final de la
 *     línea y no mueve nada) y la columna cuenta BYTES del juego de caracteres de la
 *     base (un tabulador es 1; una ñ, 2 en AL32UTF8). Se asume UTF-8, igual que con
 *     `err.offset`: en una base WE8… un carácter no ASCII ANTES del error en su
 *     misma línea desplazaría la marca a la derecha.
 * El resultado se acota a la línea (una columna de más cae al final) y a la sentencia.
 */
export function offsetDeErrorCompilacion(s: Sentencia, linea: number, columna: number): number | null {
  const o = s.objetoCreado
  if (!o || !esPosicionEntera(linea) || !esPosicionEntera(columna)) return null
  const texto = s.texto
  const iTipo = o.offsetTipo - s.mapa.base + s.mapa.prefijoSintetico
  if (iTipo < 0 || iTipo > texto.length) return null
  const ancla = o.tipo === 'TRIGGER' ? inicioCuerpoTrigger(texto, iTipo) : iTipo
  if (ancla === null) return null
  const inicio = inicioDeLineaPedida(texto, ancla, linea)
  if (inicio === null) return null
  let fin = texto.indexOf('\n', inicio)
  if (fin < 0) fin = texto.length
  if (fin > inicio && texto.charCodeAt(fin - 1) === 13) fin--
  const bytesAntes = linea === 1 ? bytesUtf8(texto, inicio, ancla) : 0
  const resto = texto.slice(inicio, fin)
  const cp = bytesUtf8APuntosDeCodigo(resto, bytesAntes + columna - 1)
  return offsetEnviadoAModelo(s, inicio + Math.min(resto.length, puntosDeCodigoAUtf16(resto, cp)))
}
