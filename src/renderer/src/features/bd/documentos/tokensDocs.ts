// =============================================================================
// tokensDocs: tokenizador léxico del texto de un documento en notación del shell y su
// formato (sangrado y compactado). Puro: sin React, DOM, IPC ni `process`.
// No interpreta ni evalúa nada: lo que se envía es el texto tal cual.
// Lo usan `camposDocs.ts` y `coleccionDocs.ts`.
// Decisiones: docs/decisiones/bd/ui-documentos-texto-y-cambios.md
// =============================================================================

export type ClaseToken =
  | 'clave'
  | 'cadena'
  | 'numero'
  | 'literal'
  | 'constructor'
  | 'regex'
  | 'puntuacion'
  | 'espacio'
  | 'otro'

export interface Token {
  clase: ClaseToken
  texto: string
}

/** Lo que consume un paso del tokenizador: hasta dónde llegó y si lo siguiente es un valor. */
interface Paso {
  fin: number
  esperaValor: boolean
}

const RE_NUMERO = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y
const RE_IDENT = /[A-Za-z_$][\w$]*/y
const RE_ESPACIO = /\s+/y
const LITERALES = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'])
const PUNTUACION = '{}[](),:'

function ultimoSignificativo(tokens: Token[]): Token | undefined {
  for (let k = tokens.length - 1; k >= 0; k--) if (tokens[k].clase !== 'espacio') return tokens[k]
  return undefined
}

function pasoEspacio(texto: string, i: number, out: Token[], esperaValor: boolean): Paso | null {
  RE_ESPACIO.lastIndex = i
  const esp = RE_ESPACIO.exec(texto)
  if (!esp) return null
  out.push({ clase: 'espacio', texto: esp[0] })
  return { fin: i + esp[0].length, esperaValor }
}

function pasoCadena(texto: string, i: number, out: Token[]): Paso | null {
  const c = texto[i]
  if (c !== '"' && c !== "'") return null
  const n = texto.length
  let j = i + 1
  while (j < n && texto[j] !== c) j += texto[j] === '\\' ? 2 : 1
  j = Math.min(j + 1, n)
  out.push({ clase: 'cadena', texto: texto.slice(i, j) })
  return { fin: j, esperaValor: false }
}

/** Dónde acaba el cuerpo de una regex que empieza en `i`, o -1 si no cierra en su línea. */
function cierreRegex(texto: string, i: number): number {
  const n = texto.length
  let j = i + 1
  let enClase = false
  while (j < n) {
    const d = texto[j]
    if (d === '\\') {
      j += 2
      continue
    }
    if (d === '\n') break
    if (d === '[') enClase = true
    else if (d === ']') enClase = false
    else if (d === '/' && !enClase) break
    j++
  }
  return j < n && texto[j] === '/' ? j : -1
}

function pasoRegex(texto: string, i: number, out: Token[], esperaValor: boolean): Paso | null {
  if (texto[i] !== '/' || !esperaValor) return null
  let j = cierreRegex(texto, i)
  if (j < 0) return null
  j++
  while (j < texto.length && /[a-z]/i.test(texto[j])) j++
  out.push({ clase: 'regex', texto: texto.slice(i, j) })
  return { fin: j, esperaValor: false }
}

function pasoPuntuacion(texto: string, i: number, out: Token[]): Paso | null {
  const c = texto[i]
  if (!PUNTUACION.includes(c)) return null
  const previo = ultimoSignificativo(out)
  if (previo && c === ':' && ['cadena', 'otro', 'literal', 'numero'].includes(previo.clase)) {
    previo.clase = 'clave'
  } else if (previo && c === '(' && previo.clase === 'otro' && /^[A-Za-z_$]/.test(previo.texto)) {
    previo.clase = 'constructor'
  }
  out.push({ clase: 'puntuacion', texto: c })
  return { fin: i + 1, esperaValor: '{[(,:'.includes(c) }
}

function pasoNumero(texto: string, i: number, out: Token[], esperaValor: boolean): Paso | null {
  RE_NUMERO.lastIndex = i
  const num = RE_NUMERO.exec(texto)
  if (!num || !(/[0-9.]/.test(texto[i]) || esperaValor)) return null
  out.push({ clase: 'numero', texto: num[0] })
  return { fin: i + num[0].length, esperaValor: false }
}

function pasoIdentificador(texto: string, i: number, out: Token[]): Paso | null {
  RE_IDENT.lastIndex = i
  const id = RE_IDENT.exec(texto)
  if (!id) return null
  const palabra = id[0]
  out.push({ clase: LITERALES.has(palabra) ? 'literal' : palabra === 'new' ? 'constructor' : 'otro', texto: palabra })
  return { fin: i + palabra.length, esperaValor: palabra === 'new' }
}

const PASOS = [pasoEspacio, pasoCadena, pasoRegex, pasoPuntuacion, pasoNumero, pasoIdentificador]

/**
 * Parte el texto de un documento en tokens. Nunca lanza: lo que no reconoce es 'otro'. Una
 * cadena o un identificador seguidos de `:` son 'clave'; un identificador seguido de `(`,
 * 'constructor' (`ObjectId(`, `ISODate(`, `NumberLong(`); `/…/i` en posición de valor, regex.
 */
export function tokenizar(texto: string): Token[] {
  const out: Token[] = []
  let i = 0
  let esperaValor = true
  while (i < texto.length) {
    let paso: Paso | null = null
    for (const f of PASOS) {
      paso = f(texto, i, out, esperaValor)
      if (paso) break
    }
    if (!paso) {
      out.push({ clase: 'otro', texto: texto[i] })
      paso = { fin: i + 1, esperaValor: false }
    }
    i = paso.fin
    esperaValor = paso.esperaValor
  }
  return out
}

/** El siguiente token significativo (no espacio) desde `desde`, o -1. */
export function siguienteSignificativo(tokens: readonly Token[], desde: number): number {
  for (let k = desde; k < tokens.length; k++) if (tokens[k].clase !== 'espacio') return k
  return -1
}

const CIERRE: Record<string, string> = { '{': '}', '[': ']' }

interface EstadoFormato {
  out: Token[]
  sangria: string
  nivel: number
  parentesis: number
}

function saltoDeLinea(e: EstadoFormato): void {
  e.out.push({ clase: 'espacio', texto: '\n' + e.sangria.repeat(e.nivel) })
}

const espacio = (): Token => ({ clase: 'espacio', texto: ' ' })

/** Abre `{` o `[`: vacío se queda junto; dentro de paréntesis, en línea; si no, sangra. Devuelve el índice que sigue. */
function formatearApertura(e: EstadoFormato, tokens: readonly Token[], k: number): number {
  const t = tokens[k]
  const s = siguienteSignificativo(tokens, k + 1)
  if (s >= 0 && tokens[s].clase === 'puntuacion' && tokens[s].texto === CIERRE[t.texto]) {
    e.out.push(t, tokens[s])
    return s
  }
  if (e.parentesis > 0) {
    e.out.push(t, espacio())
    return k
  }
  e.out.push(t)
  e.nivel++
  saltoDeLinea(e)
  return k
}

function formatearCierre(e: EstadoFormato, t: Token): void {
  if (e.parentesis > 0) {
    e.out.push(espacio(), t)
    return
  }
  e.nivel = Math.max(0, e.nivel - 1)
  saltoDeLinea(e)
  e.out.push(t)
}

/** Formatea el token de puntuación `tokens[k]`; devuelve el índice del último token consumido. */
function formatearPuntuacion(e: EstadoFormato, tokens: readonly Token[], k: number): number {
  const t = tokens[k]
  switch (t.texto) {
    case '(':
      e.parentesis++
      e.out.push(t)
      return k
    case ')':
      e.parentesis = Math.max(0, e.parentesis - 1)
      e.out.push(t)
      return k
    case '{':
    case '[':
      return formatearApertura(e, tokens, k)
    case '}':
    case ']':
      formatearCierre(e, t)
      return k
    case ',':
      e.out.push(t)
      if (e.parentesis > 0) e.out.push(espacio())
      else saltoDeLinea(e)
      return k
    case ':':
      e.out.push(t, espacio())
      return k
    default:
      e.out.push(t)
      return k
  }
}

/**
 * El documento SANGRADO para el panel JSON: una clave por línea, `{}` y `[]` vacíos juntos, y
 * lo que va entre paréntesis (`ObjectId("…")`, `Timestamp({ t: 1, i: 2 })`) en una línea. Lo
 * que ya venía sangrado se rehace igual: los espacios de fuera de las cadenas se descartan.
 */
export function formatearTokens(tokens: readonly Token[], sangria = '  '): Token[] {
  const e: EstadoFormato = { out: [], sangria, nivel: 0, parentesis: 0 }
  for (let k = siguienteSignificativo(tokens, 0); k >= 0; k = siguienteSignificativo(tokens, k + 1)) {
    if (tokens[k].clase !== 'puntuacion') e.out.push(tokens[k])
    else k = formatearPuntuacion(e, tokens, k)
  }
  return e.out
}

export function textoDeTokens(tokens: readonly Token[]): string {
  return tokens.map((t) => t.texto).join('')
}

/** El documento sangrado, como texto (el panel JSON al editar). */
export function formatearDocumento(texto: string): string {
  return textoDeTokens(formatearTokens(tokenizar(texto)))
}

/** Un valor en UNA línea y sin espacios de sobra (`{ a: 1 }` -> `{a: 1}`): el editor de celda. */
export function compactarTexto(texto: string): string {
  let s = ''
  for (const t of tokenizar(texto)) {
    if (t.clase === 'espacio') continue
    s += t.texto
    if (t.clase === 'puntuacion' && (t.texto === ',' || t.texto === ':')) s += ' '
  }
  return s
}
