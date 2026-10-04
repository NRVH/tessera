// =============================================================================
// consolaClaves: lógica pura de la consola de claves: parte el texto en comandos (uno por
// línea), elige los que ejecuta Ctrl/⌘+Enter, pinta cada respuesta como la consola de línea
// de comandos de Redis y lleva el registro que se enseña debajo. Sin React, DOM ni Monaco;
// lo prueba `test-consola-claves.mts`.
// Decisiones: docs/decisiones/bd/ui-claves-comandos-y-registro.md
// =============================================================================

import type { DbKvBytes, DbKvRespuesta } from '../../../../../shared/db-claves-ipc.ts'
import type { DbErrorSql } from '../../../../../shared/db-explorador-ipc.ts'
import { formatoDuracion } from '../consola/marcasConsola.ts'
import { cantidad, horaDe, textoError, type AccionSalida, type IrAPosicion } from '../consola/salidaConsola.ts'

// --- Partir en comandos ----------------------------------------------------------------

/** Un comando de la consola: una línea con algo que no es comentario. */
export interface ComandoConsola {
  /** Posición (0..n-1) dentro de la lista que se ejecuta. */
  indice: number
  /** Línea del texto (0-based). */
  linea: number
  /** Primer carácter del comando (sin los blancos de delante). Offset UTF-16 del texto entero. */
  desde: number
  /** Tras el último carácter del comando (sin los blancos de detrás). */
  hasta: number
  /** EXACTAMENTE lo que se envía: `texto.slice(desde, hasta)`. */
  texto: string
}

/** Lo que ejecuta la consola: el comando del cursor, los de la selección o todos. */
export type ModoEjecucionClaves =
  | { tipo: 'cursor'; cursor: number }
  | { tipo: 'seleccion'; desde: number; hasta: number }
  | { tipo: 'todo' }

interface LineaTexto {
  inicio: number
  /** Antes del salto de línea. */
  fin: number
}

function lineasDe(texto: string): LineaTexto[] {
  const out: LineaTexto[] = []
  const re = /\r\n|\n|\r/g
  let inicio = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) {
    out.push({ inicio, fin: m.index })
    inicio = m.index + m[0].length
  }
  out.push({ inicio, fin: texto.length })
  return out
}

/** La línea (0-based) que contiene `offset`: la última que empieza en él o antes. */
function lineaDe(lineas: readonly LineaTexto[], offset: number): number {
  let a = 0
  let b = lineas.length - 1
  while (a < b) {
    const m = (a + b + 1) >> 1
    if (lineas[m].inicio <= offset) a = m
    else b = m - 1
  }
  return a
}

/** El comando de una línea, o null si está en blanco o es un comentario. */
function comandoDeLinea(texto: string, l: LineaTexto, linea: number): Omit<ComandoConsola, 'indice'> | null {
  const bruto = texto.slice(l.inicio, l.fin)
  const delante = /^\s*/.exec(bruto)?.[0].length ?? 0
  const recortado = bruto.slice(delante).replace(/\s+$/, '')
  if (recortado === '' || recortado.startsWith('#')) return null
  const desde = l.inicio + delante
  return { linea, desde, hasta: desde + recortado.length, texto: recortado }
}

function numerar(lista: Omit<ComandoConsola, 'indice'>[]): ComandoConsola[] {
  return lista.map((c, indice) => ({ indice, ...c }))
}

/** Todos los comandos del texto, en orden. */
export function comandosDeTexto(texto: string): ComandoConsola[] {
  const lineas = lineasDe(texto)
  const out: Omit<ComandoConsola, 'indice'>[] = []
  lineas.forEach((l, i) => {
    const c = comandoDeLinea(texto, l, i)
    if (c) out.push(c)
  })
  return numerar(out)
}

/** Los comandos que ejecuta un modo (selección, cursor o todo; ver el ADR). */
export function comandosAEjecutar(texto: string, modo: ModoEjecucionClaves): ComandoConsola[] {
  if (modo.tipo === 'todo') return comandosDeTexto(texto)
  const lineas = lineasDe(texto)
  if (modo.tipo === 'seleccion' && modo.hasta > modo.desde) {
    const a = lineaDe(lineas, modo.desde)
    let b = lineaDe(lineas, modo.hasta)
    // Acabar al principio de una línea no la selecciona.
    if (b > a && lineas[b].inicio === modo.hasta) b--
    const out: Omit<ComandoConsola, 'indice'>[] = []
    for (let i = a; i <= b; i++) {
      const c = comandoDeLinea(texto, lineas[i], i)
      if (c) out.push(c)
    }
    return numerar(out)
  }
  const cursor = modo.tipo === 'cursor' ? modo.cursor : modo.desde
  const i = lineaDe(lineas, Math.max(0, Math.min(cursor, texto.length)))
  const propia = comandoDeLinea(texto, lineas[i], i)
  if (propia) return numerar([propia])
  // Una línea EN BLANCO justo debajo de un comando (no un comentario): ese comando.
  const enBlanco = texto.slice(lineas[i].inicio, lineas[i].fin).trim() === ''
  if (enBlanco && i > 0) {
    const anterior = comandoDeLinea(texto, lineas[i - 1], i - 1)
    if (anterior) return numerar([anterior])
  }
  return []
}

// --- El comando ----------------------------------------------------------------------------

/** Los comandos con SUBCOMANDO (`CONFIG SET`, `CLIENT LIST`…): su verbo son dos palabras. */
const CONTENEDORES: ReadonlySet<string> = new Set([
  'ACL',
  'CLIENT',
  'CLUSTER',
  'COMMAND',
  'CONFIG',
  'DEBUG',
  'FUNCTION',
  'LATENCY',
  'MEMORY',
  'MODULE',
  'OBJECT',
  'PUBSUB',
  'SCRIPT',
  'SLOWLOG',
  'XGROUP',
  'XINFO'
])

/** Las primeras palabras de un comando, sin comillas (no hace falta más para nombrarlo). */
function primerasPalabras(texto: string, n: number): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"?|'((?:[^'\\]|\\.)*)'?|(\S+)/g
  let m: RegExpExecArray | null
  while (out.length < n && (m = re.exec(texto)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

/** El verbo de un comando, en mayúsculas: `FLUSHDB`, `CONFIG SET`. '' si no hay nada. */
export function verboComando(texto: string): string {
  const [a = '', b = ''] = primerasPalabras(texto.trim(), 2)
  const v = a.toUpperCase()
  return CONTENEDORES.has(v) && b !== '' ? `${v} ${b.toUpperCase()}` : v
}

/** Los informes de TEXTO que redis-cli pinta en crudo, línea a línea. */
const SALIDA_CRUDA: ReadonlySet<string> = new Set([
  'INFO',
  'LOLWUT',
  'CLIENT LIST',
  'CLIENT INFO',
  'CLUSTER INFO',
  'CLUSTER NODES',
  'MEMORY DOCTOR',
  'MEMORY MALLOC-STATS',
  'LATENCY DOCTOR',
  'LATENCY GRAPH'
])

/** ¿Pinta redis-cli en crudo la respuesta de este comando? */
export function salidaCruda(texto: string): boolean {
  return SALIDA_CRUDA.has(verboComando(texto))
}

/** Tope del eco de un comando en el registro. */
export const MAX_ECO_COMANDO = 2000

/** `db0> GET a`, recortado a `MAX_ECO_COMANDO`. */
export function ecoComando(base: number, texto: string): string {
  const linea = `db${base}> ${texto}`
  return linea.length <= MAX_ECO_COMANDO ? linea : linea.slice(0, MAX_ECO_COMANDO - 1) + '…'
}

// --- La base -------------------------------------------------------------------------------

/**
 * La base de la consola tras un comando: la que devuelve el main (`DbKvResultado.base`,
 * que cambia con `SELECT n`); si no es un entero válido, la de antes.
 */
export function baseTrasResultado(actual: number, r: { base: number }): number {
  return Number.isInteger(r.base) && r.base >= 0 ? r.base : actual
}

/** La nota del registro cuando la base cambia. */
export function textoCambioBase(base: number): string {
  return `Base de la consola: db${base}`
}

/** Lo que se teclea en el filtro del selector de base (`3`, `db3`) → el número, o null. */
export function baseDeFiltro(filtro: string): number | null {
  const m = /^\s*(?:db)?(\d{1,5})\s*$/i.exec(filtro)
  return m ? Number(m[1]) : null
}

// --- La respuesta, como redis-cli ------------------------------------------------------------

/** Tono de una línea del registro. */
export type TonoLinea = 'normal' | 'error' | 'aviso' | 'tenue'

export interface LineaRespuesta {
  texto: string
  tono: TonoLinea
}

/** Líneas de una respuesta como mucho (ver el ADR). */
export const MAX_LINEAS_RESPUESTA = 500
/** Caracteres de una línea como mucho. */
export const MAX_LARGO_LINEA = 10_000

function escapeAscii(n: number): string | null {
  switch (n) {
    case 0x5c:
      return '\\\\'
    case 0x22:
      return '\\"'
    case 0x0a:
      return '\\n'
    case 0x0d:
      return '\\r'
    case 0x09:
      return '\\t'
    case 0x07:
      return '\\a'
    case 0x08:
      return '\\b'
  }
  if (n < 0x20 || n === 0x7f) return '\\x' + n.toString(16).padStart(2, '0')
  return null
}

/**
 * Unos bytes entre comillas, como redis-cli: `\\`, `\"`, `\n`, `\r`, `\t`, `\a`, `\b` y
 * `\xHH` para el resto de controles. El UTF-8 válido, legible; lo demás, `\xHH` por byte.
 */
export function citarBytes(b: DbKvBytes): string {
  let out = '"'
  if (b.texto !== undefined) {
    for (const ch of b.texto) {
      const n = ch.codePointAt(0) ?? 0
      out += n < 0x80 ? (escapeAscii(n) ?? ch) : ch
    }
    return out + '"'
  }
  let binario: string
  try {
    binario = atob(b.base64)
  } catch {
    return out + b.base64 + '"'
  }
  for (let i = 0; i < binario.length; i++) {
    const n = binario.charCodeAt(i)
    out += n < 0x80 ? (escapeAscii(n) ?? binario[i]) : '\\x' + n.toString(16).padStart(2, '0')
  }
  return out + '"'
}

/** Las líneas de un nodo, RELATIVAS: la primera va tras el índice del padre. */
function lineasDeNodo(r: DbKvRespuesta): LineaRespuesta[] {
  switch (r.tipo) {
    case 'simple':
      return [{ texto: r.texto, tono: 'normal' }]
    case 'error':
      return [{ texto: `(error) ${r.texto}`, tono: 'error' }]
    case 'entero':
      return [{ texto: `(integer) ${r.valor}`, tono: 'normal' }]
    case 'bytes':
      return [{ texto: citarBytes(r.valor), tono: 'normal' }]
    case 'nulo':
      return [{ texto: '(nil)', tono: 'normal' }]
    case 'lista': {
      if (r.elementos.length === 0) return [{ texto: '(empty array)', tono: 'normal' }]
      const ancho = String(r.elementos.length).length
      const sangria = ' '.repeat(ancho + 2)
      const out: LineaRespuesta[] = []
      r.elementos.forEach((el, i) => {
        const hijas = lineasDeNodo(el)
        const etiqueta = `${String(i + 1).padStart(ancho, ' ')}) `
        hijas.forEach((h, k) => out.push({ texto: (k === 0 ? etiqueta : sangria) + h.texto, tono: h.tono }))
      })
      return out
    }
  }
}

function recortarLinea(l: LineaRespuesta): LineaRespuesta {
  return l.texto.length <= MAX_LARGO_LINEA ? l : { texto: l.texto.slice(0, MAX_LARGO_LINEA) + ' …', tono: l.tono }
}

/**
 * Una respuesta de Redis en líneas, como la pinta redis-cli. Con `cruda` (ver `salidaCruda`), un texto se parte en sus líneas sin comillas ni escapes. Con tope de
 * `MAX_LINEAS_RESPUESTA` líneas y una final que dice cuántas quedaron fuera.
 */
export function formatearRespuesta(r: DbKvRespuesta, cruda = false): LineaRespuesta[] {
  let lineas: LineaRespuesta[]
  if (cruda && r.tipo === 'bytes' && r.valor.texto !== undefined) {
    lineas = r.valor.texto
      .replace(/(\r\n|\n|\r)$/, '')
      .split(/\r\n|\n|\r/)
      .map((texto) => ({ texto, tono: 'normal' as const }))
  } else {
    lineas = lineasDeNodo(r)
  }
  if (lineas.length > MAX_LINEAS_RESPUESTA) {
    const fuera = lineas.length - MAX_LINEAS_RESPUESTA
    lineas = lineas.slice(0, MAX_LINEAS_RESPUESTA)
    lineas.push({ texto: `… ${cantidad(fuera, 'línea más', 'líneas más')} sin mostrar`, tono: 'tenue' })
  }
  return lineas.map(recortarLinea)
}

// --- Los errores --------------------------------------------------------------------------

const PREFIJO_TESSERA = 'TESSERA-'
/** El código del error de sintaxis del trabajador (el de documentos, reutilizado). */
export const CODIGO_SINTAXIS = 'TESSERA-SINTAXIS'
const YA_DICE_NO_ENVIADO = /no se envi[oó]/i

function noEnviado(mensaje: string): string {
  const m = mensaje.trim() || 'Error desconocido'
  return YA_DICE_NO_ENVIADO.test(m) ? m : `No se envió: ${m}`
}

/**
 * La línea de un comando que FALLÓ (no la de uno que el usuario decidió no enviar, que es
 * `lineaNoEnviado`). Un error del SERVIDOR (WRONGTYPE, NOPERM…) y uno de sintaxis, como
 * redis-cli: `(error) …`. Un rechazo de Tessera (solo lectura, no admitido): «No se envió:
 * …», sin el código interno. El resto, con `textoError` (el de las otras consolas).
 */
export function lineaDeError(e: Pick<DbErrorSql, 'motivo' | 'codigo' | 'mensaje'>): LineaRespuesta {
  const codigo = (e.codigo ?? '').trim()
  const mensaje = (e.mensaje ?? '').trim()
  const deTessera = codigo.startsWith(PREFIJO_TESSERA)
  if (e.motivo === 'servidor') {
    if (codigo === CODIGO_SINTAXIS) return { texto: `(error) ${mensaje || 'Error de sintaxis'}`, tono: 'error' }
    if (deTessera) return { texto: noEnviado(mensaje), tono: 'error' }
    const conCodigo = codigo !== '' && mensaje.slice(0, codigo.length).toUpperCase() !== codigo.toUpperCase()
    return { texto: `(error) ${conCodigo ? `${codigo} ` : ''}${mensaje || 'Error desconocido'}`, tono: 'error' }
  }
  if (e.motivo === 'soloLectura' || e.motivo === 'peligroso' || e.motivo === 'produccion' || deTessera) {
    return { texto: noEnviado(mensaje), tono: 'error' }
  }
  return { texto: textoError({ codigo: e.codigo, mensaje: e.mensaje }), tono: 'error' }
}

/** La línea de un comando que el usuario decidió NO enviar (canceló la confirmación). */
export function lineaNoEnviado(e: Pick<DbErrorSql, 'mensaje'>): LineaRespuesta {
  return { texto: noEnviado(e.mensaje ?? ''), tono: 'tenue' }
}

/** Los textos del diálogo de un comando PELIGROSO que el main devolvió sin enviar. */
export function confirmacionPeligroso(o: {
  verbo: string
  alias: string
  base: number
  mensaje: string
  produccion: boolean
}): { titulo: string; mensaje: string; confirmar: string } {
  const verbo = o.verbo || 'el comando'
  const donde = `Se ejecutará en «${o.alias}»${o.produccion ? ', una conexión de PRODUCCIÓN,' : ''} sobre la base db${o.base}.`
  const motivo = o.mensaje.trim()
  return {
    titulo: `¿Ejecutar ${verbo}?`,
    mensaje: motivo ? `${motivo}\n\n${donde}` : donde,
    confirmar: `Ejecutar ${verbo}`
  }
}

// --- El registro ---------------------------------------------------------------------------

export type EstadoComando = 'corriendo' | 'ok' | 'error' | 'cancelada'

export interface EntradaComando {
  readonly tipo: 'comando'
  readonly id: number
  readonly hora: string
  /** El eco (`db0> GET a`). */
  readonly eco: string
  readonly estado: EstadoComando
  /** Milisegundos de la respuesta; null mientras corre. */
  readonly ms: number | null
  readonly lineas: readonly LineaRespuesta[]
  /** «ir a la posición» de un error con posición. */
  readonly ir?: IrAPosicion
}

export interface EntradaNota {
  readonly tipo: 'nota'
  readonly id: number
  readonly hora: string
  readonly tono: TonoLinea
  readonly texto: string
  readonly accion?: AccionSalida
}

export type EntradaRegistro = EntradaComando | EntradaNota

export interface RegistroConsola {
  readonly entradas: readonly EntradaRegistro[]
  /** Próximo id; nunca se reutiliza, ni tras limpiar (la lista lo usa como `key`). */
  readonly siguienteId: number
}

/** Entradas que guarda el registro como mucho. */
export const MAX_ENTRADAS_REGISTRO = 500
/** Líneas (ecos, respuestas y notas) que guarda el registro como mucho. */
export const MAX_LINEAS_REGISTRO = 5000

export function registroVacio(): RegistroConsola {
  return { entradas: [], siguienteId: 1 }
}

function lineasDeEntrada(e: EntradaRegistro): number {
  return e.tipo === 'nota' ? 1 : 1 + e.lineas.length
}

/** Quita las entradas más viejas hasta caber en los topes (siempre queda la última). */
function recortar(entradas: EntradaRegistro[]): EntradaRegistro[] {
  let total = 0
  for (const e of entradas) total += lineasDeEntrada(e)
  let desde = 0
  while (entradas.length - desde > 1 && (entradas.length - desde > MAX_ENTRADAS_REGISTRO || total > MAX_LINEAS_REGISTRO)) {
    total -= lineasDeEntrada(entradas[desde])
    desde++
  }
  return desde === 0 ? entradas : entradas.slice(desde)
}

/** Añade un comando que empieza a correr; devuelve el registro y el id de su entrada. */
export function agregarComando(
  r: RegistroConsola,
  c: { base: number; texto: string },
  ahora: number
): { registro: RegistroConsola; id: number } {
  const id = r.siguienteId
  const e: EntradaComando = { tipo: 'comando', id, hora: horaDe(ahora), eco: ecoComando(c.base, c.texto), estado: 'corriendo', ms: null, lineas: [] }
  return { registro: { entradas: recortar(r.entradas.concat(e)), siguienteId: id + 1 }, id }
}

/** Completa el comando `id` (si sigue en el registro) con su estado, sus ms y su respuesta. */
export function terminarComando(
  r: RegistroConsola,
  id: number,
  fin: { estado: Exclude<EstadoComando, 'corriendo'>; ms: number | null; lineas: readonly LineaRespuesta[]; ir?: IrAPosicion }
): RegistroConsola {
  const i = r.entradas.findIndex((e) => e.id === id)
  const previa = i >= 0 ? r.entradas[i] : undefined
  if (!previa || previa.tipo !== 'comando') return r
  const hecha: EntradaComando = {
    ...previa,
    estado: fin.estado,
    ms: fin.ms,
    lineas: fin.lineas,
    ...(fin.ir ? { ir: fin.ir } : {})
  }
  const entradas = r.entradas.slice()
  entradas[i] = hecha
  return { entradas: recortar(entradas), siguienteId: r.siguienteId }
}

/** Añade una nota suelta (un fallo al guardar, el aviso del Stop, el cambio de base). */
export function agregarNota(
  r: RegistroConsola,
  n: { tono: TonoLinea; texto: string; accion?: AccionSalida },
  ahora: number
): RegistroConsola {
  const e: EntradaNota = {
    tipo: 'nota',
    id: r.siguienteId,
    hora: horaDe(ahora),
    tono: n.tono,
    texto: n.texto,
    ...(n.accion ? { accion: n.accion } : {})
  }
  return { entradas: recortar(r.entradas.concat(e)), siguienteId: r.siguienteId + 1 }
}

/** «Limpiar el registro». Los ids siguen contando. */
export function limpiarRegistro(r: RegistroConsola): RegistroConsola {
  return r.entradas.length === 0 ? r : { entradas: [], siguienteId: r.siguienteId }
}

/** Lo que se lee a la derecha del eco: `3 ms`, `1 s 20 ms`; vacío mientras corre. */
export function textoMs(ms: number | null): string {
  if (ms === null) return ''
  return ms < 1 ? '<1 ms' : formatoDuracion(ms)
}
