// =============================================================================
// visorClaves: lógica pura del visor de una clave (`DbClavePane`): la cabecera (tipo, TTL,
// memoria, elementos), el cuerpo por tipo (texto, JSON, hex o tabla con detalle), los
// trozos de «Cargar más» y el comando de lectura que se lleva a la consola. Sin React, DOM
// ni IPC; lo prueba `test-visor-claves.mts`. El visor es de solo lectura.
// Decisiones: docs/decisiones/bd/ui-claves-visor.md
// =============================================================================

import type { DbKvBytes, DbKvContenido, DbKvTipo, DbKvValor } from '../../../../../shared/db-claves-ipc.ts'
import { nunca } from '../../../../../shared/nunca.ts'
import { citarRedisCli, pintarBytes, tamanoBytes, unaLinea, volcadoHex } from './bytesClaves.ts'

/** Elementos por trozo al pedir un hash, list, set, zset o stream. */
export const ELEMENTOS_POR_PAGINA = 200

/** Columnas de campos, como mucho, en la tabla de un stream (ver el ADR). */
export const COLUMNAS_STREAM_MAX = 20

/** Bytes del volcado hex, como mucho (el resto se dice). */
export const HEX_MAX_BYTES = 64 * 1024

/** El chip del tipo: el nombre de Redis, en mayúsculas. */
export function etiquetaTipo(tipo: DbKvTipo, tipoServidor?: string): string {
  switch (tipo) {
    case 'string':
    case 'hash':
    case 'list':
    case 'set':
    case 'zset':
    case 'stream':
    case 'json':
      return tipo.toUpperCase()
    case 'otro':
      return tipoServidor ?? 'OTRO'
    default:
      return nunca(tipo, 'etiquetaTipo')
  }
}

/** Cómo se llaman los elementos de cada tipo (singular, plural). */
export function nombreElementos(tipo: 'hash' | 'list' | 'set' | 'zset' | 'stream'): readonly [string, string] {
  switch (tipo) {
    case 'hash':
      return ['campo', 'campos']
    case 'list':
      return ['elemento', 'elementos']
    case 'set':
    case 'zset':
      return ['miembro', 'miembros']
    case 'stream':
      return ['entrada', 'entradas']
    default:
      return nunca(tipo, 'nombreElementos')
  }
}

const NUM = (n: number): string => n.toLocaleString('es-ES')

/**
 * Un tiempo que queda, legible: «2 d 3 h», «3 h 5 min», «4 min 3 s», «12 s», «850 ms».
 * null = no caduca. Lo que ya no es positivo, «caducada».
 */
export function ttlLegible(ms: number | null): string {
  if (ms === null) return 'Sin caducidad'
  if (ms <= 0) return 'Caducada'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const seg = s % 60
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`
  if (m > 0) return seg > 0 ? `${m} min ${seg} s` : `${m} min`
  return `${seg} s`
}

/**
 * El TTL que queda AHORA de uno que se leyó en `leidoEn` (la cuenta atrás de la cabecera).
 * null sigue siendo null; nunca baja de 0.
 */
export function ttlRestante(ttlMs: number | null, leidoEn: number, ahora: number): number | null {
  if (ttlMs === null) return null
  return Math.max(0, ttlMs - Math.max(0, ahora - leidoEn))
}

/** Bytes legibles con la coma española: «512 B», «1,5 KB», «2,3 MB». */
export function bytesLegibles(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const unidades = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < unidades.length - 1) {
    v /= 1024
    u++
  }
  const decimales = v < 10 ? 1 : 0
  return `${v.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} ${unidades[u]}`
}

/** Los elementos cargados de un contenido con elementos (0 en los demás). */
export function cargados(c: DbKvContenido): number {
  switch (c.tipo) {
    case 'hash':
      return c.pares.length
    case 'list':
      return c.elementos.length
    case 'set':
    case 'zset':
      return c.miembros.length
    case 'stream':
      return c.entradas.length
    default:
      return 0
  }
}

/**
 * «3 de 10 campos» (o «10 campos» si ya están todos); null en los tipos sin elementos. El
 * total es el del servidor (HLEN, LLEN…), que no cambia con los trozos.
 */
export function resumenElementos(c: DbKvContenido): string | null {
  switch (c.tipo) {
    case 'hash':
    case 'list':
    case 'set':
    case 'zset':
    case 'stream': {
      const [uno, varios] = nombreElementos(c.tipo)
      const n = cargados(c)
      const nombre = c.total === 1 ? uno : varios
      return n >= c.total || c.siguiente === null ? `${NUM(c.total)} ${nombre}` : `${NUM(n)} de ${NUM(c.total)} ${nombre}`
    }
    default:
      return null
  }
}

/** El aviso de un valor de texto que llegó CORTADO, o null. */
export function avisoTruncado(c: DbKvContenido): string | null {
  if (c.tipo === 'string' && c.truncado) {
    return `Se ve el principio: ${bytesLegibles(tamanoBytes(c.valor))} de ${bytesLegibles(c.bytes)}. Para leerlo entero, usa GETRANGE en la consola.`
  }
  if (c.tipo === 'json' && c.truncado) return 'El documento es más grande que el tope del visor y se ve cortado.'
  return null
}

// --- Texto, JSON y hex -------------------------------------------------------------------

export type ModoVista = 'texto' | 'json' | 'hex'

export const ETIQUETA_MODO: Record<ModoVista, string> = { texto: 'Texto', json: 'JSON', hex: 'Hex' }

/** El texto sangrado a 2 si es JSON (un objeto o una lista); null si no lo es. */
export function formatearJson(texto: string): string | null {
  const t = texto.trim()
  if (t === '' || (t[0] !== '{' && t[0] !== '[')) return null
  // `JSON.parse` solo VALIDA: el sangrado se hace sobre el TEXTO (`sangrarJson`), porque
  // `JSON.stringify(JSON.parse(…))` redondea los enteros de más de 2^53 en silencio
  // (`12345678901234567890` saldría `12345678901234567000`).
  try {
    JSON.parse(t)
  } catch {
    return null
  }
  return sangrarJson(t)
}

/**
 * Sangra un JSON VÁLIDO sin reinterpretarlo: copia cada número y cada cadena tal cual y solo
 * pone saltos, sangría de 2 y un espacio tras `:`. Los vacíos (`{}`, `[]`) quedan en una línea.
 */
export function sangrarJson(t: string): string {
  const e: EstadoSangrado = { out: '', nivel: 0 }
  for (let i = 0; i < t.length; i++) i = pasoSangrado(t, i, e)
  return e.out
}

interface EstadoSangrado {
  out: string
  nivel: number
}

const saltoJson = (nivel: number): string => '\n' + '  '.repeat(nivel)

/** Índice de la comilla que cierra la cadena que abre en `i` (o del final del texto si no cierra). */
function cierreDeCadena(t: string, i: number): number {
  let j = i + 1
  while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1
  return j
}

/** Copia lo que empieza en `t[i]` a `e.out` con su sangría; devuelve el índice del último carácter consumido. */
function pasoSangrado(t: string, i: number, e: EstadoSangrado): number {
  const c = t[i]
  if (c === '"') {
    const fin = cierreDeCadena(t, i)
    e.out += t.slice(i, fin + 1)
    return fin
  }
  if (c === '{' || c === '[') {
    // Vacío: se cierra en la misma línea.
    let j = i + 1
    while (j < t.length && /\s/.test(t[j])) j++
    if (t[j] === (c === '{' ? '}' : ']')) {
      e.out += c + t[j]
      return j
    }
    e.nivel++
    e.out += c + saltoJson(e.nivel)
  } else if (c === '}' || c === ']') {
    e.nivel--
    e.out += saltoJson(e.nivel) + c
  } else if (c === ',') {
    e.out += ',' + saltoJson(e.nivel)
  } else if (c === ':') {
    e.out += ': '
  } else if (!/\s/.test(c)) {
    e.out += c
  }
  return i
}

/** Los modos en que se puede leer unos bytes: hex siempre; texto siempre; JSON si parsea. */
export function modosDe(b: DbKvBytes): ModoVista[] {
  const out: ModoVista[] = ['texto']
  if (b.texto !== undefined && formatearJson(b.texto) !== null) out.push('json')
  out.push('hex')
  return out
}

/** El modo con el que se abre: hex si no es UTF-8, JSON si parsea, texto. */
export function modoInicial(b: DbKvBytes): ModoVista {
  if (b.texto === undefined) return 'hex'
  return formatearJson(b.texto) !== null ? 'json' : 'texto'
}

/**
 * Los bytes en un modo: el texto (o sus escapes si no es UTF-8), el JSON sangrado (o el
 * texto si no parsea) o el volcado hex con su tope (`recortado`).
 */
export function textoEnModo(b: DbKvBytes, modo: ModoVista): { texto: string; recortado: boolean } {
  switch (modo) {
    case 'texto':
      return { texto: pintarBytes(b), recortado: false }
    case 'json':
      return { texto: (b.texto !== undefined ? formatearJson(b.texto) : null) ?? pintarBytes(b), recortado: false }
    case 'hex': {
      const v = volcadoHex(b, HEX_MAX_BYTES)
      return { texto: v.lineas.join('\n'), recortado: v.recortado }
    }
    default:
      return nunca(modo, 'textoEnModo')
  }
}

/** Por encima de esto el JSON se enseña sin colorear (serían cientos de miles de nodos). */
export const COLOREAR_JSON_MAX = 200_000

export type ClaseJson = 'clave' | 'cadena' | 'numero' | 'literal' | 'puntuacion' | 'espacio'

export interface TokenJson {
  clase: ClaseJson
  texto: string
}

/**
 * Los tokens de un JSON YA SANGRADO, para colorearlo como el panel de documentos (clave,
 * cadena, número, literal, puntuación). No valida: lo que no reconoce va como puntuación, y
 * juntar los textos devuelve el original al carácter. Descartado el tokenizador de
 * documentos (`coleccionDocs.tokenizar`): es de la notación del shell y RE-SANGRA el texto,
 * y aquí el sangrado ya lo hizo `JSON.stringify`.
 */
export function tokensJson(texto: string): TokenJson[] {
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)\b|(\s+)|([\s\S])/y
  const out: TokenJson[] = []
  let m: RegExpExecArray | null
  re.lastIndex = 0
  while (re.lastIndex < texto.length && (m = re.exec(texto)) !== null) {
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        out.push({ clase: 'clave', texto: m[1] }, { clase: 'puntuacion', texto: m[2] })
      } else {
        out.push({ clase: 'cadena', texto: m[1] })
      }
    } else if (m[3] !== undefined) out.push({ clase: 'numero', texto: m[3] })
    else if (m[4] !== undefined) out.push({ clase: 'literal', texto: m[4] })
    else if (m[5] !== undefined) out.push({ clase: 'espacio', texto: m[5] })
    else out.push({ clase: 'puntuacion', texto: m[6] })
  }
  return out
}

// --- Trozos ------------------------------------------------------------------------------

/**
 * Suma el trozo NUEVO al valor que ya se ve (sin repetir elementos: los SCAN pueden devolver uno dos veces). Del nuevo se toman los
 * metadatos (TTL, memoria, codificación, total, `siguiente`) y los ms se suman. Si los tipos
 * no casan (la clave se reemplazó entre dos trozos), vale el nuevo tal cual.
 */
export function acumularValor(previo: DbKvValor, nuevo: DbKvValor): DbKvValor {
  const a = previo.contenido
  const b = nuevo.contenido
  const meta = { ...nuevo, ms: previo.ms + nuevo.ms }
  if (a.tipo === 'hash' && b.tipo === 'hash') {
    const vistos = new Set(a.pares.map((p) => p.campo.base64))
    return { ...meta, contenido: { ...b, pares: [...a.pares, ...b.pares.filter((p) => !vistos.has(p.campo.base64))] } }
  }
  if (a.tipo === 'list' && b.tipo === 'list') {
    // LRANGE por índice: los trozos no se solapan (una lista que cambia entre dos trozos se
    // verá descolocada hasta Refrescar).
    return { ...meta, contenido: { ...b, elementos: [...a.elementos, ...b.elementos] } }
  }
  if (a.tipo === 'set' && b.tipo === 'set') {
    const vistos = new Set(a.miembros.map((m) => m.base64))
    return { ...meta, contenido: { ...b, miembros: [...a.miembros, ...b.miembros.filter((m) => !vistos.has(m.base64))] } }
  }
  if (a.tipo === 'zset' && b.tipo === 'zset') {
    const vistos = new Set(a.miembros.map((m) => m.miembro.base64))
    return { ...meta, contenido: { ...b, miembros: [...a.miembros, ...b.miembros.filter((m) => !vistos.has(m.miembro.base64))] } }
  }
  if (a.tipo === 'stream' && b.tipo === 'stream') {
    const vistos = new Set(a.entradas.map((e) => e.id))
    return { ...meta, contenido: { ...b, entradas: [...a.entradas, ...b.entradas.filter((e) => !vistos.has(e.id))] } }
  }
  return nuevo
}

/** El `desde` del trozo siguiente, o null si no hay más (o el tipo no va por trozos). */
export function siguienteDe(c: DbKvContenido): string | null {
  switch (c.tipo) {
    case 'hash':
    case 'list':
    case 'set':
    case 'zset':
    case 'stream':
      return c.siguiente
    default:
      return null
  }
}

// --- La tabla ----------------------------------------------------------------------------

export interface ColumnaValor {
  titulo: string
  /** Números a la derecha y en azul (índice, puntuación). */
  numerica?: true
  /** Ancho sugerido en `ch` (la tabla es monoespaciada). */
  ancho: number
}

export interface CeldaValor {
  /** Una línea (`unaLinea`): lo entero está en el detalle. */
  texto: string
  /** Bytes que no son UTF-8 (se pintan atenuados: son escapes). */
  binario?: true
  /** Ausente en esta entrada (un campo de otra entrada del stream). */
  ausente?: true
}

export interface FilaValor {
  /** Identidad estable de la fila (para la selección al cargar más). */
  clave: string
  celdas: CeldaValor[]
}

export interface TablaValor {
  columnas: ColumnaValor[]
  filas: FilaValor[]
}

const ANCHO_MIN = 6
const ANCHO_MAX = 48
const MUESTRA = 60

function celda(b: DbKvBytes): CeldaValor {
  const c: CeldaValor = { texto: unaLinea(pintarBytes(b), 300) }
  if (b.texto === undefined) c.binario = true
  return c
}

function anchoDe(titulo: string, filas: readonly FilaValor[], k: number): number {
  let max = titulo.length
  for (let i = 0; i < Math.min(filas.length, MUESTRA); i++) {
    const t = filas[i].celdas[k]?.texto ?? ''
    if (t.length > max) max = t.length
    if (max >= ANCHO_MAX) break
  }
  return Math.min(ANCHO_MAX, Math.max(ANCHO_MIN, max)) + 2
}

function conAnchos(titulos: readonly { titulo: string; numerica?: true }[], filas: FilaValor[]): TablaValor {
  const columnas = titulos.map((t, k) => ({ ...t, ancho: anchoDe(t.titulo, filas, k) }))
  return { columnas, filas }
}

/** Los campos del stream, por orden de aparición y con tope (ver el ADR). */
function camposStream(c: Extract<DbKvContenido, { tipo: 'stream' }>): string[] {
  const vistos = new Set<string>()
  const out: string[] = []
  for (const e of c.entradas) {
    for (const f of e.campos) {
      const n = pintarBytes(f.campo)
      if (vistos.has(n)) continue
      vistos.add(n)
      out.push(n)
      if (out.length >= COLUMNAS_STREAM_MAX) return out
    }
  }
  return out
}

/** La tabla de un contenido con elementos; null en los demás (string, json, otro, noExiste). */
export function tablaDeContenido(c: DbKvContenido): TablaValor | null {
  switch (c.tipo) {
    case 'hash':
      return conAnchos(
        [{ titulo: 'Campo' }, { titulo: 'Valor' }],
        c.pares.map((p) => ({ clave: p.campo.base64, celdas: [celda(p.campo), celda(p.valor)] }))
      )
    case 'list':
      return conAnchos(
        [{ titulo: 'Índice', numerica: true }, { titulo: 'Elemento' }],
        c.elementos.map((e, i) => ({ clave: String(i), celdas: [{ texto: String(i) }, celda(e)] }))
      )
    case 'set':
      return conAnchos([{ titulo: 'Miembro' }], c.miembros.map((m) => ({ clave: m.base64, celdas: [celda(m)] })))
    case 'zset':
      return conAnchos(
        [{ titulo: 'Miembro' }, { titulo: 'Puntuación', numerica: true }],
        c.miembros.map((m) => ({ clave: m.miembro.base64, celdas: [celda(m.miembro), { texto: m.puntuacion }] }))
      )
    case 'stream': {
      const campos = camposStream(c)
      return conAnchos(
        [{ titulo: 'ID' }, ...campos.map((t) => ({ titulo: t }))],
        c.entradas.map((e) => {
          const porNombre = new Map(e.campos.map((f) => [pintarBytes(f.campo), f.valor]))
          const celdas: CeldaValor[] = [{ texto: e.id }]
          for (const t of campos) {
            const v = porNombre.get(t)
            celdas.push(v === undefined ? { texto: '', ausente: true } : celda(v))
          }
          return { clave: e.id, celdas }
        })
      )
    }
    case 'string':
    case 'json':
    case 'otro':
    case 'noExiste':
      return null
    default:
      return nunca(c, 'tablaDeContenido')
  }
}

/** Una parte del detalle de la fila elegida: bytes (con sus modos) o un texto sin más. */
export type ParteDetalle = { titulo: string; bytes: DbKvBytes } | { titulo: string; texto: string }

/** Lo que el panel de detalle enseña de la fila `i` de la tabla (o [] si no existe). */
export function detalleDeFila(c: DbKvContenido, i: number): ParteDetalle[] {
  switch (c.tipo) {
    case 'hash': {
      const p = c.pares[i]
      return p ? [{ titulo: 'Campo', bytes: p.campo }, { titulo: 'Valor', bytes: p.valor }] : []
    }
    case 'list': {
      const e = c.elementos[i]
      return e ? [{ titulo: `Elemento ${i}`, bytes: e }] : []
    }
    case 'set': {
      const m = c.miembros[i]
      return m ? [{ titulo: 'Miembro', bytes: m }] : []
    }
    case 'zset': {
      const m = c.miembros[i]
      return m ? [{ titulo: 'Miembro', bytes: m.miembro }, { titulo: 'Puntuación', texto: m.puntuacion }] : []
    }
    case 'stream': {
      const e = c.entradas[i]
      if (!e) return []
      const partes: ParteDetalle[] = [{ titulo: 'ID', texto: e.id }]
      for (const f of e.campos) partes.push({ titulo: pintarBytes(f.campo), bytes: f.valor })
      return partes
    }
    default:
      return []
  }
}

// --- La consola ----------------------------------------------------------------------------

/**
 * El comando de LECTURA que enseña lo mismo que el visor, para seguir en la consola. Los
 * tipos grandes van ACOTADOS (los 100 primeros; SSCAN y no SMEMBERS): pegarlo tal cual no
 * debe traerse un millón de elementos.
 */
export function comandoConsola(tipo: DbKvTipo | 'noExiste', clave: DbKvBytes): string {
  const k = citarRedisCli(clave)
  switch (tipo) {
    case 'string':
      return `GET ${k}`
    case 'hash':
      return `HSCAN ${k} 0 COUNT 100`
    case 'list':
      return `LRANGE ${k} 0 99`
    case 'set':
      return `SSCAN ${k} 0 COUNT 100`
    case 'zset':
      return `ZRANGE ${k} 0 99 WITHSCORES`
    case 'stream':
      return `XRANGE ${k} - + COUNT 100`
    case 'json':
      return `JSON.GET ${k} $`
    case 'otro':
    case 'noExiste':
      return `TYPE ${k}`
    default:
      return nunca(tipo, 'comandoConsola')
  }
}
