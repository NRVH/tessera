// =============================================================================
// Validación gramatical local de la consola: qué sentencias se piden, cómo se traduce el mensaje y dónde
// se subraya. Solo PostgreSQL tiene gramática (`reglasDe(d).gramaticaLocal`); el parser corre en el main y
// este módulo puro lo usan los dos lados, con `CacheSintaxis` por texto. La posición sale en puntos de
// código y se sitúa con las mismas funciones que la del servidor. No bloquea: decide el servidor.
// Decisiones: docs/decisiones/bd/motores-sintaxis-local.md
// =============================================================================

import type { TipoAviso } from './avisosSql.ts'
import { reglasDe, type DialectoSql, type GramaticaLocal } from './dialectosSql.ts'
import { etiquetaMotor } from '../motores/index.ts'
import type { Sentencia } from './divisorSql.ts'
import { esSignificativo, tokenizar, type Token } from './lexicoSql.ts'
import { offsetEnviadoAModelo, puntosDeCodigoAUtf16 } from './posicionErrorSql.ts'

/**
 * Lo que el main dice de UN texto: válido, un error con su posición (puntos de código base 0
 * en el texto enviado), o null = no se pudo validar (el parser no cargó, el texto pasa del
 * tope): no se subraya nada y se vuelve a preguntar en la siguiente pausa.
 */
export type VeredictoSintaxis = { ok: true } | { ok: false; mensaje: string; offsetCp: number } | null

/** Un error de sintaxis situado en el MODELO (offsets UTF-16). */
export interface ErrorSintaxisSql {
  desde: number
  hasta: number
  mensaje: string
}

/** Tope de UNA sentencia que se valida (UTF-16). */
export const TOPE_TEXTO_SINTAXIS = 256 * 1024
/** Tope de textos por petición. */
export const TOPE_TEXTOS_SINTAXIS = 2000
/** Tope de la suma de los textos de una petición (UTF-16). */
export const TOPE_TOTAL_SINTAXIS = 4 * 1024 * 1024
/**
 * Tope de sentencias de un texto que se validan (las primeras). Tiene que ser MENOR que la
 * caché (`CacheSintaxis`, 20 000): si lo validado no cupiera entero en ella, cada lote
 * echaría al anterior y la consola pediría lotes para siempre sin que nadie teclease
 * (con una caché del mismo tamaño que un lote).
 */
export const MAX_SENTENCIAS_SINTAXIS = 10_000

/**
 * De dónde sale el subrayado, para el `source` del marcador (se ve al pasar el ratón). El
 * nombre sale del registro: la gramática lleva el id de su motor.
 */
export function fuenteSintaxis(g: GramaticaLocal): string {
  return `gramática de ${etiquetaMotor(g)}, sin ejecutar`
}

/** Avisos léxicos que ya explican el fallo de la sentencia: con ellos no se pide la gramática. */
const TAPA_LA_GRAMATICA: ReadonlySet<TipoAviso> = new Set<TipoAviso>([
  'sinCerrar',
  'parentesis',
  'faltaPuntoYComa',
  'faltaBarra',
  'loteRepetido'
])

/** Las sentencias que se piden a la gramática local del dialecto (vacío si no tiene). */
export function sentenciasAValidar(sentencias: readonly Sentencia[], d: DialectoSql): Sentencia[] {
  if (reglasDe(d).gramaticaLocal === null) return []
  const salida: Sentencia[] = []
  for (const s of sentencias) {
    if (salida.length >= MAX_SENTENCIAS_SINTAXIS) break
    if (
      s.clase !== 'cliente' &&
      s.texto.trim() !== '' &&
      s.texto.length <= TOPE_TEXTO_SINTAXIS &&
      !s.avisos.some((a) => TAPA_LA_GRAMATICA.has(a.tipo))
    ) {
      salida.push(s)
    }
  }
  return salida
}

/**
 * El mensaje de libpg_query en español. Los dos que salen casi siempre se traducen; el resto
 * (errores del léxico del propio PG, como un escape Unicode inválido) va tal cual detrás de
 * «Error de sintaxis:», porque traducirlos a medias mentiría más que dejarlos en inglés.
 */
export function mensajeSintaxis(crudo: string): string {
  const cerca = /^syntax error at or near "([\s\S]*)"$/.exec(crudo)
  if (cerca) return `Error de sintaxis cerca de «${cerca[1]}».`
  if (crudo === 'syntax error at end of input') return 'La sentencia está incompleta: se acaba antes de lo que pide la gramática.'
  const hondo = /^memory exhausted at or near "([\s\S]*)"$/.exec(crudo)
  if (hondo) return `Anidamiento demasiado profundo cerca de «${hondo[1]}».`
  return `Error de sintaxis: ${crudo}`
}

/** Tokens significativos de la sentencia, en offsets del modelo. */
function tokensDe(texto: string, s: Sentencia, d: DialectoSql): Token[] {
  return tokenizar(texto, d, s.desde, s.hastaContenido).filter(esSignificativo)
}

/**
 * El error del veredicto situado en el modelo `texto` (el que se partió en `s`), o null si
 * el veredicto no es un error. Subraya el token de la posición; al final de la sentencia, el
 * último token.
 */
export function errorDeSintaxis(
  texto: string,
  s: Sentencia,
  v: VeredictoSintaxis,
  d: DialectoSql
): ErrorSintaxisSql | null {
  reglasDe(d) // valida el dialecto también cuando no hay nada que situar
  if (v === null || v.ok) return null
  const mensaje = mensajeSintaxis(v.mensaje)
  const u = puntosDeCodigoAUtf16(s.texto, v.offsetCp)
  const alFinal = u >= s.texto.length
  const pos = offsetEnviadoAModelo(s, u)
  const tokens = tokensDe(texto, s, d)
  if (tokens.length === 0) return { desde: s.desde, hasta: Math.max(s.desde + 1, s.hastaContenido), mensaje }
  let t: Token | undefined
  if (alFinal || pos >= s.hastaContenido) {
    t = tokens[tokens.length - 1]
  } else {
    for (const k of tokens) {
      if (k.hasta > pos) {
        t = k
        break
      }
    }
    if (!t) t = tokens[tokens.length - 1]
  }
  return { desde: t.desde, hasta: Math.max(t.desde + 1, t.hasta), mensaje }
}

/** Los textos de `aValidar` que la caché no sabe todavía, sin repetir (lo que se pide al main). */
export function pendientesDeSintaxis(aValidar: readonly Sentencia[], cache: CacheSintaxis): string[] {
  const vistos = new Set<string>()
  const pendientes: string[] = []
  for (const s of aValidar) {
    if (vistos.has(s.texto)) continue
    vistos.add(s.texto)
    if (cache.de(s.texto) === undefined) pendientes.push(s.texto)
  }
  return pendientes
}

/**
 * El primer LOTE de `pendientes` que cabe en una petición (`TOPE_TEXTOS_SINTAXIS` textos y
 * `TOPE_TOTAL_SINTAXIS` caracteres). Sin esto, una consola de 5 000 INSERT pedía siempre
 * más de lo que el main acepta y no se validaba nunca; con él, la pausa siguiente pide el
 * lote siguiente (lo ya sabido está en la caché).
 */
export function loteDeSintaxis(pendientes: readonly string[]): string[] {
  const lote: string[] = []
  let total = 0
  for (const t of pendientes) {
    if (lote.length >= TOPE_TEXTOS_SINTAXIS || total + t.length > TOPE_TOTAL_SINTAXIS) break
    lote.push(t)
    total += t.length
  }
  return lote
}

/** Los errores de `aValidar` que la caché ya sabe, situados en el modelo `texto`. */
export function erroresDeSintaxis(
  texto: string,
  aValidar: readonly Sentencia[],
  cache: CacheSintaxis,
  d: DialectoSql
): ErrorSintaxisSql[] {
  reglasDe(d) // valida el dialecto también con la lista vacía
  const errores: ErrorSintaxisSql[] = []
  for (const s of aValidar) {
    const v = cache.de(s.texto)
    if (v === undefined) continue
    const e = errorDeSintaxis(texto, s, v, d)
    if (e) errores.push(e)
  }
  return errores
}

/**
 * Veredictos ya sabidos, por el TEXTO exacto de la sentencia (LRU con tope). Teclear dentro
 * de una sentencia cambia solo la suya: las demás no vuelven a cruzar el IPC. Un `null` no se
 * guarda: significa «no se pudo», y la siguiente pausa lo vuelve a intentar.
 */
export class CacheSintaxis {
  private readonly vistos = new Map<string, Exclude<VeredictoSintaxis, null>>()
  private readonly tope: number
  private readonly topeCaracteres: number
  private caracteres = 0

  /**
   * Dos topes: de entradas (mayor que `MAX_SENTENCIAS_SINTAXIS`, ver allí) y de caracteres
   * (mayor que lo que se analiza en vivo, 2 MiB): así lo que se valida en una pausa cabe
   * siempre entero y solo se echan versiones viejas de sentencias editadas, que sin el tope
   * de caracteres podían sumar cientos de MB (una sentencia de 200 KB editada mil veces).
   * Cada pausa toca con `de` todo lo que valida, así que lo vigente es siempre lo más reciente.
   */
  constructor(tope = 20_000, topeCaracteres = 8 * 1024 * 1024) {
    this.tope = tope
    this.topeCaracteres = topeCaracteres
  }

  /** El veredicto sabido, o undefined si hay que pedirlo. */
  de(texto: string): Exclude<VeredictoSintaxis, null> | undefined {
    const v = this.vistos.get(texto)
    if (v === undefined) return undefined
    // Refresca su puesto en el LRU (el Map conserva el orden de inserción).
    this.vistos.delete(texto)
    this.vistos.set(texto, v)
    return v
  }

  guardar(texto: string, v: VeredictoSintaxis): void {
    if (v === null) return
    if (this.vistos.has(texto)) {
      this.vistos.delete(texto)
      this.caracteres -= texto.length
    }
    this.vistos.set(texto, v)
    this.caracteres += texto.length
    while (this.vistos.size > this.tope || (this.caracteres > this.topeCaracteres && this.vistos.size > 1)) {
      const primero = this.vistos.keys().next()
      if (primero.done) break
      this.vistos.delete(primero.value)
      this.caracteres -= primero.value.length
    }
  }

  get tamano(): number {
    return this.vistos.size
  }
}
