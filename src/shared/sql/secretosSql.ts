// =============================================================================
// Tapar contraseñas (`***`) en el texto de una sentencia antes de guardarla en el historial: `IDENTIFIED BY`,
// `PASSWORD '…'`, `password=` dentro de una cadena y la clave de una URI, con lo que va pegado al valor.
// Se apoya en el léxico, no en una regex sobre el texto. Solo tapa la SINTAXIS de los motores, no las
// funciones propias del usuario. Puro, neutral y ES2020 (lo compila también el renderer).
// =============================================================================

import type { DialectoSql } from './dialectosSql.ts'
import { esSignificativo, tokenizar, type Token } from './lexicoSql.ts'

/** Lo que sustituye a una contraseña. */
export const SECRETO_TAPADO = '***'

/**
 * `password=valor` dentro de una cadena de conexión (clave=valor separadas por blancos o
 * `;`). El valor, en este orden: entre comillas de libpq en una cadena SQL normal
 * (`''…''`, con `\''` dentro), en una E'…' (`\'…\'`), en un `$$…$$` (`'…'`), o sin
 * comillas.
 */
const PASSWORD_EN_CADENA = /(\bpassword\s*=\s*)(''(?:\\''|[^'])*''|\\'(?:\\\\|\\[^']|[^\\'])*\\'|'(?:\\.|[^'\\])*'|[^\s;'"\\]+)/gi

/**
 * La contraseña de una URI de conexión dentro de una cadena
 * (`dblink_connect('postgresql://u:clave@host/db')`, `oracle://u:clave@…`): lo que va
 * entre el `usuario:` y la `@`. Sin usuario (`scheme://host:5432`) no casa: ahí el `:`
 * es el del puerto y no hay `@` detrás.
 */
const URI_CON_CLAVE = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:)[^\s@/'"]+@/gi

/** El valor de `PASSWORD_EN_CADENA` tapado, con las mismas comillas. */
function tapadoEnCadena(valor: string): string {
  if (valor.startsWith("''")) return `''${SECRETO_TAPADO}''`
  if (valor.startsWith("\\'")) return `\\'${SECRETO_TAPADO}\\'`
  if (valor.startsWith("'")) return `'${SECRETO_TAPADO}'`
  return SECRETO_TAPADO
}

/** Lo que corta un valor sin comillas pegado a otros tokens (ver la cabecera). */
function cortaValor(t: Token): boolean {
  return t.tipo === 'puntoYComa' || t.tipo === 'coma' || t.tipo === 'parenC' || t.tipo === 'lineaCliente'
}

interface Sustitucion {
  desde: number
  hasta: number
  texto: string
}

/** El token tapado, conservando la forma de comillas (cadena, identificador citado o palabra). */
function tapado(t: Token): string {
  if (t.tipo === 'cadena') return `'${SECRETO_TAPADO}'`
  if (t.tipo === 'identCitado') return `"${SECRETO_TAPADO}"`
  return SECRETO_TAPADO
}

/** ¿Puede ser una contraseña escrita en el texto? (un bind no: su valor no está aquí). */
function esValorEscrito(t: Token | undefined): t is Token {
  return !!t && (t.tipo === 'palabra' || t.tipo === 'identCitado' || t.tipo === 'cadena' || t.tipo === 'numero')
}

function esPalabra(t: Token | undefined, valor: string): boolean {
  return !!t && t.tipo === 'palabra' && t.valor === valor
}

/**
 * `texto` con las contraseñas cambiadas por `***` (ver la cabecera). Si no hay nada
 * que tapar, devuelve el MISMO texto.
 */
export function taparSecretosSql(texto: string, d: DialectoSql): string {
  const sig = tokenizar(texto, d).filter(esSignificativo)
  const cambios: Sustitucion[] = []
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (esPalabra(t, 'IDENTIFIED') && esPalabra(sig[i + 1], 'BY')) {
      i = taparIdentifiedBy(sig, cambios, i)
    } else if (esPalabra(t, 'PASSWORD') && sig[i + 1] && sig[i + 1].tipo === 'cadena') {
      tapar(cambios, sig[i + 1])
      i++
    } else if (t.tipo === 'cadena') {
      taparEnCadena(cambios, t)
    }
  }
  return aplicar(texto, cambios)
}

function tapar(cambios: Sustitucion[], t: Token): void {
  cambios.push({ desde: t.desde, hasta: t.hasta, texto: tapado(t) })
}

/**
 * Tapa `sig[k]` y lo que va PEGADO a él (sin blancos en medio) hasta un `;`, `,` o `)`.
 * Devuelve el índice del último token tapado.
 */
function taparValor(sig: readonly Token[], cambios: Sustitucion[], k: number): number {
  let fin = k
  while (sig[fin + 1] && sig[fin + 1].desde === sig[fin].hasta && !cortaValor(sig[fin + 1])) fin++
  if (fin === k) tapar(cambios, sig[k])
  else cambios.push({ desde: sig[k].desde, hasta: sig[fin].hasta, texto: SECRETO_TAPADO })
  return fin
}

/** `IDENTIFIED BY [VALUES] valor [REPLACE vieja]` en `i`: devuelve el índice del último token tapado (o `i`). */
function taparIdentifiedBy(sig: readonly Token[], cambios: Sustitucion[], i: number): number {
  let k = i + 2
  if (esPalabra(sig[k], 'VALUES') && sig[k + 1] && sig[k + 1].tipo === 'cadena') k++
  if (!esValorEscrito(sig[k])) return i
  const fin = taparValor(sig, cambios, k)
  // ALTER USER x IDENTIFIED BY nueva REPLACE vieja: la vieja también es secreta.
  return esPalabra(sig[fin + 1], 'REPLACE') && esValorEscrito(sig[fin + 2]) ? taparValor(sig, cambios, fin + 2) : fin
}

/** Una cadena con `password=…` o una URI con clave dentro: se tapan sin tocar las comillas. */
function taparEnCadena(cambios: Sustitucion[], t: Token): void {
  PASSWORD_EN_CADENA.lastIndex = 0
  URI_CON_CLAVE.lastIndex = 0
  const conClave = PASSWORD_EN_CADENA.test(t.valor)
  const conUri = URI_CON_CLAVE.test(t.valor)
  if (!conClave && !conUri) return
  PASSWORD_EN_CADENA.lastIndex = 0
  URI_CON_CLAVE.lastIndex = 0
  cambios.push({
    desde: t.desde,
    hasta: t.hasta,
    texto: t.valor
      .replace(PASSWORD_EN_CADENA, (_m, clave: string, valor: string) => clave + tapadoEnCadena(valor))
      .replace(URI_CON_CLAVE, (_m, antes: string) => antes + SECRETO_TAPADO + '@')
  })
}

/** Aplica los cambios de atrás adelante (los offsets siguen valiendo); sin cambios, el MISMO texto. */
function aplicar(texto: string, cambios: Sustitucion[]): string {
  if (cambios.length === 0) return texto
  cambios.sort((a, b) => b.desde - a.desde)
  let r = texto
  for (const c of cambios) r = r.slice(0, c.desde) + c.texto + r.slice(c.hasta)
  return r
}
