// =============================================================================
// consolaDocs: lógica pura de la consola de documentos. Parte el texto en sentencias del
// shell (con su propio léxico, no el de SQL), elige la que ejecuta Ctrl/⌘+Enter y escribe los
// textos de los resultados. Sin React, DOM ni Monaco: lo prueba `test-consola-docs.mts`.
// Decisiones: docs/decisiones/bd/ui-documentos-texto-y-cambios.md
// =============================================================================

import type { DbDocResultado } from '../../../../../shared/db-documentos-ipc.ts'
import { cantidad } from '../consola/salidaConsola.ts'

/** Qué cerró la sentencia. */
export type TerminadorShell = 'puntoYComa' | 'lineaEnBlanco' | 'finDeTexto'

export interface SentenciaShell {
  /** Posición (0..n-1) dentro del resultado de la división. */
  indice: number
  /** Primer carácter de CÓDIGO (sin blancos ni comentarios delante). Offset del texto entero. */
  desde: number
  /** Tras el último carácter de código (sin el `;` ni los comentarios de detrás). */
  hastaContenido: number
  /** Tras el `;` si lo hay; si no, igual a `hastaContenido`. */
  hasta: number
  terminador: TerminadorShell
  /** EXACTAMENTE lo que se envía: `texto.slice(desde, hastaContenido)`. */
  texto: string
}

/** Lo que ejecuta la consola: la sentencia del cursor, las de la selección o todas. */
export type ModoEjecucionShell =
  | { tipo: 'cursor'; cursor: number }
  | { tipo: 'seleccion'; desde: number; hasta: number }
  | { tipo: 'todo' }

/** Palabras tras las que `/` abre una regex y no es una división. */
const PALABRAS_ANTES_DE_REGEX: ReadonlySet<string> = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await'
])

const ABRE: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' }

// Por CÓDIGO y no con literales: el espacio duro, el BOM y los separadores de línea
// Unicode son invisibles en el fuente (y `test:fuentes-limpias` los rechaza con razón).
/** Separadores de línea Unicode (LS y PS), que el analizador de JS cuenta como saltos. */
const SEPARADORES_LINEA: ReadonlySet<number> = new Set([0x2028, 0x2029])
/** Blancos «raros» de JS: espacio duro y BOM. */
const BLANCOS_RAROS: ReadonlySet<number> = new Set([0xa0, 0xfeff])

function esSalto(c: string): boolean {
  return c === '\n' || c === '\r' || SEPARADORES_LINEA.has(c.charCodeAt(0))
}

function esBlanco(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\f' || c === '\v' || BLANCOS_RAROS.has(c.charCodeAt(0))
}

function esInicioIdentificador(c: string): boolean {
  return /[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 127
}

function esParteIdentificador(c: string): boolean {
  return /[\w$]/.test(c) || c.charCodeAt(0) > 127
}

/** Lo que va sabiendo el divisor mientras recorre el texto. */
interface EstadoDivisor {
  texto: string
  fin: number
  salida: SentenciaShell[]
  /** Lo abierto: '(' '[' '{' y '`' (la `${` de una plantilla, que se cierra con `}`). */
  pila: string[]
  inicio: number
  ultimo: number
  /**
   * ¿Una `/` ahora abre una regex? Es división tras un valor (identificador, número, cadena, `)`,
   * `]`) y tras `}`: en el shell una `}` cierra un objeto, y detrás viene `)` o `,`, no una regex.
   */
  regexPosible: boolean
}

/** Marca `[desde, hasta)` como código de la sentencia en curso. */
function codigo(e: EstadoDivisor, desde: number, hasta: number): void {
  if (e.inicio < 0) e.inicio = desde
  e.ultimo = hasta
}

function cerrar(e: EstadoDivisor, hasta: number, terminador: TerminadorShell): void {
  if (e.inicio >= 0) {
    e.salida.push({
      indice: e.salida.length,
      desde: e.inicio,
      hastaContenido: e.ultimo,
      hasta: Math.max(hasta, e.ultimo),
      terminador,
      texto: e.texto.slice(e.inicio, e.ultimo)
    })
  }
  e.inicio = -1
  e.ultimo = -1
  e.pila.length = 0
  e.regexPosible = true
}

/** Fin de una cadena '…' o "…": tras la comilla, o el salto si no se cierra en su línea. */
function finCadena(e: EstadoDivisor, i: number, q: string): number {
  let j = i + 1
  while (j < e.fin) {
    const ch = e.texto[j]
    if (ch === '\\') j += 2
    else if (ch === q) return j + 1
    else if (esSalto(ch)) return j
    else j++
  }
  return e.fin
}

/** Recorre una plantilla desde `j` (tras la `` ` `` o la `}` de su `${…}`). */
function recorrerPlantilla(e: EstadoDivisor, j: number): { fin: number; abierta: boolean } {
  while (j < e.fin) {
    const ch = e.texto[j]
    if (ch === '\\') j += 2
    else if (ch === '`') return { fin: j + 1, abierta: false }
    else if (ch === '$' && e.texto[j + 1] === '{') return { fin: j + 2, abierta: true }
    else j++
  }
  return { fin: e.fin, abierta: false }
}

/** Fin de una regex `/…/flags`, o -1 si no lo es (llega al fin de línea sin cerrarse). */
function finRegex(e: EstadoDivisor, i: number): number {
  let j = i + 1
  let enClase = false
  while (j < e.fin) {
    const ch = e.texto[j]
    if (esSalto(ch)) return -1
    if (ch === '\\') {
      j += 2
      continue
    }
    if (enClase) {
      if (ch === ']') enClase = false
    } else if (ch === '[') {
      enClase = true
    } else if (ch === '/') {
      j++
      while (j < e.fin && /[A-Za-z]/.test(e.texto[j])) j++
      return j
    }
    j++
  }
  return -1
}

// Cada paso devuelve el índice por donde sigue el recorrido, o -1 si no le toca.

/** Un salto: si a profundidad 0 va seguido de una línea en blanco, cierra la sentencia abierta. */
function pasoSalto(e: EstadoDivisor, i: number): number {
  const c = e.texto[i]
  if (!esSalto(c)) return -1
  if (e.pila.length === 0 && e.inicio >= 0) {
    let j = i + (c === '\r' && e.texto[i + 1] === '\n' ? 2 : 1)
    while (j < e.fin && esBlanco(e.texto[j])) j++
    if (j < e.fin && esSalto(e.texto[j])) {
      cerrar(e, e.ultimo, 'lineaEnBlanco')
      return j
    }
  }
  return i + 1
}

function pasoBlanco(e: EstadoDivisor, i: number): number {
  return esBlanco(e.texto[i]) ? i + 1 : -1
}

/** Los comentarios no son código: no abren ni alargan la sentencia (los de dentro viajan igual). */
function pasoComentario(e: EstadoDivisor, i: number): number {
  if (e.texto[i] !== '/') return -1
  if (e.texto[i + 1] === '/') {
    while (i < e.fin && !esSalto(e.texto[i])) i++
    return i
  }
  if (e.texto[i + 1] !== '*') return -1
  const k = e.texto.indexOf('*/', i + 2)
  return k < 0 || k + 2 > e.fin ? e.fin : k + 2
}

function pasoCadena(e: EstadoDivisor, i: number): number {
  const c = e.texto[i]
  if (c !== '"' && c !== "'") return -1
  const k = finCadena(e, i, c)
  codigo(e, i, k)
  e.regexPosible = false
  return k
}

/** Tramo de plantilla ya recorrido: la `${` abierta se apila y su `}` devuelve a la plantilla. */
function cerrarTramoPlantilla(e: EstadoDivisor, i: number, r: { fin: number; abierta: boolean }): number {
  codigo(e, i, r.fin)
  if (r.abierta) e.pila.push('`')
  e.regexPosible = r.abierta
  return r.fin
}

function pasoPlantilla(e: EstadoDivisor, i: number): number {
  if (e.texto[i] !== '`') return -1
  return cerrarTramoPlantilla(e, i, recorrerPlantilla(e, i + 1))
}

function pasoRegex(e: EstadoDivisor, i: number): number {
  if (e.texto[i] !== '/' || !e.regexPosible) return -1
  const k = finRegex(e, i)
  if (k <= 0) return -1
  codigo(e, i, k)
  e.regexPosible = false
  return k
}

function pasoPuntoYComa(e: EstadoDivisor, i: number): number {
  if (e.texto[i] !== ';') return -1
  if (e.pila.length === 0) {
    cerrar(e, i + 1, 'puntoYComa')
  } else {
    codigo(e, i, i + 1)
    e.regexPosible = true
  }
  return i + 1
}

function pasoApertura(e: EstadoDivisor, i: number): number {
  const c = e.texto[i]
  if (c !== '(' && c !== '[' && c !== '{') return -1
  e.pila.push(c)
  codigo(e, i, i + 1)
  e.regexPosible = true
  return i + 1
}

function pasoCierre(e: EstadoDivisor, i: number): number {
  const c = e.texto[i]
  if (c !== ')' && c !== ']' && c !== '}') return -1
  const tope = e.pila[e.pila.length - 1]
  if (c === '}' && tope === '`') {
    e.pila.pop()
    return cerrarTramoPlantilla(e, i, recorrerPlantilla(e, i + 1))
  }
  // Un cierre que no casa con lo abierto se ignora (el main dirá el error).
  if (tope === ABRE[c]) e.pila.pop()
  codigo(e, i, i + 1)
  e.regexPosible = false
  return i + 1
}

function pasoIdentificador(e: EstadoDivisor, i: number): number {
  if (!esInicioIdentificador(e.texto[i])) return -1
  let j = i + 1
  while (j < e.fin && esParteIdentificador(e.texto[j])) j++
  codigo(e, i, j)
  e.regexPosible = PALABRAS_ANTES_DE_REGEX.has(e.texto.slice(i, j))
  return j
}

function pasoNumero(e: EstadoDivisor, i: number): number {
  if (!/[0-9]/.test(e.texto[i])) return -1
  let j = i + 1
  while (j < e.fin && /[\w.]/.test(e.texto[j])) j++
  codigo(e, i, j)
  e.regexPosible = false
  return j
}

const PASOS_DIVISOR = [
  pasoSalto,
  pasoBlanco,
  pasoComentario,
  pasoCadena,
  pasoPlantilla,
  pasoRegex,
  pasoPuntoYComa,
  pasoApertura,
  pasoCierre,
  pasoIdentificador,
  pasoNumero
]

function avanzar(e: EstadoDivisor, i: number): number {
  for (const paso of PASOS_DIVISOR) {
    const k = paso(e, i)
    if (k >= 0) return k
  }
  // Operador o puntuación (`.`, `,`, `:`, `=`, `!`…): tras ellos, `/` abre una regex.
  codigo(e, i, i + 1)
  e.regexPosible = true
  return i + 1
}

/**
 * Divide el texto de la consola en sentencias del shell. Con `rango` (una selección) se
 * parte SOLO ese tramo, como texto independiente, pero los offsets siguen siendo del
 * texto entero (los del modelo de Monaco). Corta en `;` a profundidad 0 y en una línea en
 * blanco a profundidad 0; un salto suelto no corta (`db.c.find()\n  .limit(5)` es una).
 * Lo que se envía empieza en el primer carácter de código y acaba en el último.
 */
export function dividirSentenciasShell(texto: string, rango?: { desde: number; hasta: number }): SentenciaShell[] {
  const ini = rango ? Math.max(0, Math.min(rango.desde, texto.length)) : 0
  const fin = rango ? Math.max(ini, Math.min(rango.hasta, texto.length)) : texto.length
  const e: EstadoDivisor = { texto, fin, salida: [], pila: [], inicio: -1, ultimo: -1, regexPosible: true }
  let i = ini
  while (i < fin) i = avanzar(e, i)
  cerrar(e, e.ultimo, 'finDeTexto')
  return e.salida
}

/** ¿Hay un salto de línea en `[desde, hasta)`? */
function haySalto(texto: string, desde: number, hasta: number): boolean {
  for (let i = desde; i < hasta; i++) if (esSalto(texto[i])) return true
  return false
}

/**
 * La sentencia que ejecuta Ctrl/⌘+Enter sin selección, con las MISMAS reglas que la
 * consola SQL (`sentenciaEnCursor` de `divisorSql.ts`):
 * 1. justo tras su `;` (`a;|b`) → la anterior;
 * 2. dentro de una sentencia → esa;
 * 3. al final de la línea de una sentencia (solo blancos o comentarios detrás) → esa;
 * 4. en los blancos iniciales de la línea de la siguiente → la siguiente;
 * 5. en otro caso → null.
 */
export function sentenciaShellEnCursor(
  sentencias: readonly SentenciaShell[],
  texto: string,
  cursor: number
): SentenciaShell | null {
  let previa: SentenciaShell | null = null
  let siguiente: SentenciaShell | null = null
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

/** Lo que envía Ejecutar según el modo. Una selección vacía cuenta como cursor. */
export function sentenciasShellAEjecutar(texto: string, modo: ModoEjecucionShell): SentenciaShell[] {
  if (modo.tipo === 'todo') return dividirSentenciasShell(texto)
  if (modo.tipo === 'seleccion' && modo.hasta > modo.desde) {
    return dividirSentenciasShell(texto, { desde: modo.desde, hasta: modo.hasta })
  }
  const cursor = modo.tipo === 'cursor' ? modo.cursor : modo.desde
  const s = sentenciaShellEnCursor(dividirSentenciasShell(texto), texto, cursor)
  return s ? [s] : []
}

// --- Textos de los resultados ---------------------------------------------------------

/**
 * El método del shell de una sentencia (`insertOne`, `updateMany`, `drop`…), para NOMBRAR
 * la escritura en la confirmación de producción. NO clasifica (eso lo hace el trabajador,
 * `mongoComun.clasificar`: el renderer no decide qué escribe): solo pone nombre a lo
 * que el main ya rechazó por 'produccion'. Sin método reconocible, «Escritura».
 */
export function verboSentencia(texto: string): string {
  const coleccion = /^\s*db\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*(?:'[^']*'|"[^"]*")\s*\]|\.\s*getCollection\s*\([^)]*\))\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(texto)
  if (coleccion) return coleccion[1]
  const deBase = /^\s*db\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(texto)
  if (deBase) return deBase[1]
  return 'Escritura'
}

type ResultadoEscritura = Extract<DbDocResultado, { tipo: 'escritura' }>

/**
 * El resumen legible de una escritura, como lo diría mongosh pero en frase: «1 insertado»,
 * «3 coincidentes, 2 modificados», «Ningún documento cambió». Se dice lo que no es cero,
 * más «0 modificados» cuando algo coincidió y no cambió nada (un `$set` al mismo valor): es
 * justo el dato que sorprende y que el usuario busca.
 */
export function resumenEscritura(r: Pick<ResultadoEscritura, 'casados' | 'modificados' | 'insertados' | 'borrados'>): string {
  const partes: string[] = []
  if (r.insertados > 0) partes.push(cantidad(r.insertados, 'insertado', 'insertados'))
  if (r.casados > 0) partes.push(cantidad(r.casados, 'coincidente', 'coincidentes'))
  if (r.modificados > 0 || r.casados > 0) partes.push(cantidad(r.modificados, 'modificado', 'modificados'))
  if (r.borrados > 0) partes.push(cantidad(r.borrados, 'borrado', 'borrados'))
  return partes.length === 0 ? 'Ningún documento cambió' : partes.join(', ')
}

/** La línea de la Salida de un resultado (sin el eco, que va antes). */
export function textoResultadoDocs(r: DbDocResultado): string {
  switch (r.tipo) {
    case 'documentos': {
      const n = r.pagina.documentos.length
      const docs = n === 0 ? 'Ningún documento' : cantidad(n, 'documento', 'documentos')
      const mas = r.pagina.lector !== null ? ' (hay más)' : ''
      return `${docs}${mas} en ${formatoMs(r.pagina.ms)}`
    }
    case 'valor':
      return 'Valor devuelto'
    case 'escritura':
      return resumenEscritura(r)
    case 'base':
      return `Base de la consola: ${r.base}`
  }
}

function formatoMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1).replace('.', ',')} s`
}

/**
 * La base de la consola tras un resultado: la que diga el resultado (`use x`, o la que el
 * main releyó), o la de antes si el resultado no la trae (null).
 */
export function baseTrasResultado(actual: string | null, r: DbDocResultado): string | null {
  if (r.tipo === 'base') return r.base
  return r.base ?? actual
}

/**
 * Las columnas tras pedir más: las que ya había, en su orden, y detrás las nuevas de la
 * página (los documentos no tienen esquema: una página puede traer campos que la primera
 * no tenía). Si no hay nuevas, devuelve el MISMO arreglo (la tabla no se rehace).
 */
export function unirColumnas(actuales: readonly string[], nuevas: readonly string[]): string[] {
  const vistas = new Set(actuales)
  const extra = nuevas.filter((c) => !vistas.has(c))
  return extra.length === 0 ? (actuales as string[]) : actuales.concat(extra)
}
