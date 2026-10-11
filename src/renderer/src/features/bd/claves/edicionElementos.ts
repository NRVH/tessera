// =============================================================================
// Editar los tipos con elementos de Redis (list, set, zset, stream) y crear una clave desde el árbol:
// de cada acción sale UN comando de la consola, con los argumentos citados como los escribe la consola, y
// de su respuesta, lo que se le dice al usuario. Hermana de `edicionClaves.ts` (string, hash, caducidad,
// renombrar, borrar), que delega aquí lo que no es suyo. Pura, sin React ni DOM; la prueba es
// `test-visor-claves.mts`.
// Decisiones: docs/decisiones/bd/ui-claves-edicion-elementos.md
// =============================================================================

import type { DbKvBytes, DbKvRespuesta } from '../../../../../shared/db-claves-ipc.ts'
import { citarRedisCli } from './bytesClaves.ts'
import type { ComandoClave, EntradasClave, TextosAccion } from './edicionClaves.ts'

/** Los tipos con elementos que el visor edita (el hash vive en `edicionClaves.ts`). */
export type TipoConElementos = 'list' | 'set' | 'zset' | 'stream'

/** Los tipos con los que se crea una clave desde el árbol. */
export type TipoCreable = 'string' | 'hash' | TipoConElementos

export const TIPOS_CREABLES: readonly TipoCreable[] = ['string', 'hash', 'list', 'set', 'zset', 'stream']

/** Lo que se edita de una list, un set, un zset o un stream (o la clave nueva que se crea). */
export type AccionElemento =
  | { tipo: 'anadir'; de: TipoConElementos }
  /** `LSET` por índice: lo que se leyó en esa posición. */
  | { tipo: 'elemento'; indice: number; actual: string }
  | { tipo: 'puntuacion'; miembro: DbKvBytes; actual: string }
  | { tipo: 'quitar'; de: 'list' | 'set' | 'zset'; elemento: DbKvBytes }
  | { tipo: 'quitarEntrada'; id: string }
  | { tipo: 'crear' }

const texto = (s: string): string => citarRedisCli({ texto: s, base64: '' })

const PUNTUACION = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/
const PUNTUACION_INFINITA = /^[+-]?inf$/i

/** La puntuación de un zset tal como la acepta Redis (número o ±inf), o null. */
export function puntuacionValida(s: string): string | null {
  const t = s.trim()
  return PUNTUACION.test(t) || PUNTUACION_INFINITA.test(t) ? t : null
}

/** Los textos del diálogo de cada acción. */
export function textosElemento(a: AccionElemento, nombre = ''): TextosAccion {
  const base = { etiqueta: null, etiquetaDos: null, multilinea: false, peligro: false }
  switch (a.tipo) {
    case 'anadir':
      return textosAnadir(a.de)
    case 'elemento':
      return { ...base, titulo: `Editar el elemento ${a.indice}`, etiqueta: 'Valor', boton: 'Guardar', multilinea: true }
    case 'puntuacion':
      return { ...base, titulo: `Puntuación de «${nombre}»`, etiqueta: 'Puntuación', boton: 'Guardar' }
    case 'quitar':
      return { ...base, titulo: `Borrar «${nombre}»`, boton: a.de === 'list' ? 'Borrar el elemento' : 'Borrar el miembro', peligro: true }
    case 'quitarEntrada':
      return { ...base, titulo: `Borrar la entrada ${a.id}`, boton: 'Borrar la entrada', peligro: true }
    case 'crear':
      return { ...base, titulo: 'Nueva clave', boton: 'Crear' }
  }
}

function textosAnadir(de: TipoConElementos): TextosAccion {
  const base = { etiquetaDos: null, multilinea: false, peligro: false, boton: 'Añadir' }
  switch (de) {
    case 'list':
      return { ...base, titulo: 'Añadir un elemento', etiqueta: 'Valor (se añade al final)', multilinea: true }
    case 'set':
      return { ...base, titulo: 'Añadir un miembro', etiqueta: 'Miembro' }
    case 'zset':
      return { ...base, titulo: 'Añadir un miembro', etiqueta: 'Miembro', etiquetaDos: 'Puntuación' }
    case 'stream':
      return { ...base, titulo: 'Añadir una entrada', etiqueta: 'Campo', etiquetaDos: 'Valor' }
  }
}

/** Los cuadros que pide cada tipo al crear una clave (el nombre y el tipo son aparte). */
export function cuadrosDeCreacion(tipo: TipoCreable): { etiqueta: string; etiquetaDos: string | null; multilinea: boolean } {
  switch (tipo) {
    case 'string':
      return { etiqueta: 'Valor', etiquetaDos: null, multilinea: true }
    case 'hash':
      return { etiqueta: 'Campo', etiquetaDos: 'Valor', multilinea: false }
    case 'list':
      return { etiqueta: 'Primer elemento', etiquetaDos: null, multilinea: true }
    case 'set':
      return { etiqueta: 'Primer miembro', etiquetaDos: null, multilinea: false }
    case 'zset':
      return { etiqueta: 'Primer miembro', etiquetaDos: 'Puntuación', multilinea: false }
    case 'stream':
      return { etiqueta: 'Campo de la primera entrada', etiquetaDos: 'Valor', multilinea: false }
  }
}

/** Lo que el diálogo trae escrito al abrirse. */
export function entradasInicialesElemento(a: AccionElemento): EntradasClave {
  return a.tipo === 'elemento' || a.tipo === 'puntuacion' ? { uno: a.actual, dos: '' } : { uno: '', dos: '' }
}

/** Añadir un elemento a una clave que ya tiene ese tipo (`k` ya citada). */
function comandoAnadir(k: string, de: TipoConElementos, e: EntradasClave): ComandoClave {
  switch (de) {
    case 'list':
      return { ok: true, texto: `RPUSH ${k} ${texto(e.uno)}` }
    case 'set':
      return e.uno === '' ? { ok: false, motivo: 'Escribe el miembro.' } : { ok: true, texto: `SADD ${k} ${texto(e.uno)}` }
    case 'zset': {
      if (e.uno === '') return { ok: false, motivo: 'Escribe el miembro.' }
      const p = puntuacionValida(e.dos)
      return p === null ? { ok: false, motivo: 'La puntuación tiene que ser un número (o inf, -inf).' } : { ok: true, texto: `ZADD ${k} ${p} ${texto(e.uno)}` }
    }
    case 'stream':
      return e.uno === '' ? { ok: false, motivo: 'Escribe el nombre del campo.' } : { ok: true, texto: `XADD ${k} * ${texto(e.uno)} ${texto(e.dos)}` }
  }
}

/** El comando de la acción sobre la clave `k` (ya citada), o por qué todavía no se puede. */
export function comandoElemento(k: string, a: AccionElemento, e: EntradasClave): ComandoClave {
  switch (a.tipo) {
    case 'anadir':
      return comandoAnadir(k, a.de, e)
    case 'elemento':
      return { ok: true, texto: `LSET ${k} ${a.indice} ${texto(e.uno)}` }
    case 'puntuacion': {
      const p = puntuacionValida(e.uno)
      // `XX`: solo si el miembro sigue ahí; sin él, ZADD lo crearía de nuevo.
      return p === null ? { ok: false, motivo: 'La puntuación tiene que ser un número (o inf, -inf).' } : { ok: true, texto: `ZADD ${k} XX ${p} ${citarRedisCli(a.miembro)}` }
    }
    case 'quitar': {
      const el = citarRedisCli(a.elemento)
      // `LREM … 1`: borra la primera coincidencia; el visor solo lo ofrece cuando es la de esa fila.
      return { ok: true, texto: a.de === 'list' ? `LREM ${k} 1 ${el}` : `${a.de === 'set' ? 'SREM' : 'ZREM'} ${k} ${el}` }
    }
    case 'quitarEntrada':
      return { ok: true, texto: `XDEL ${k} ${a.id}` }
    case 'crear':
      return { ok: false, motivo: 'Escribe el nombre de la clave.' }
  }
}

/**
 * El comando que crea la clave `nombre` con su primer valor. El `string` va con `NX`: si el nombre
 * apareció entre la comprobación y el envío, no se pisa.
 */
export function comandoCrear(nombre: string, tipo: TipoCreable, e: EntradasClave): ComandoClave {
  if (nombre === '') return { ok: false, motivo: 'Escribe el nombre de la clave.' }
  const k = texto(nombre)
  if (tipo === 'string') return { ok: true, texto: `SET ${k} ${texto(e.uno)} NX` }
  if (tipo === 'hash') return e.uno === '' ? { ok: false, motivo: 'Escribe el nombre del campo.' } : { ok: true, texto: `HSET ${k} ${texto(e.uno)} ${texto(e.dos)}` }
  return comandoAnadir(k, tipo, e)
}

/** Lo que se le dice al usuario según la respuesta de Redis: hecho, o por qué no. */
export function resultadoElemento(a: AccionElemento, r: DbKvRespuesta): { ok: true; aviso: string } | { ok: false; mensaje: string } {
  if (r.tipo === 'error') return { ok: false, mensaje: r.texto }
  const cero = r.tipo === 'entero' && r.valor === '0'
  switch (a.tipo) {
    case 'anadir':
      return resultadoAnadir(a.de, cero)
    case 'elemento':
      return { ok: true, aviso: 'Elemento guardado' }
    case 'puntuacion':
      return { ok: true, aviso: 'Puntuación guardada' }
    case 'quitar':
      return cero ? { ok: false, mensaje: 'Ya no estaba.' } : { ok: true, aviso: a.de === 'list' ? 'Elemento borrado' : 'Miembro borrado' }
    case 'quitarEntrada':
      return cero ? { ok: false, mensaje: 'La entrada ya no existía.' } : { ok: true, aviso: 'Entrada borrada' }
    case 'crear':
      return r.tipo === 'nulo' ? { ok: false, mensaje: 'Ya existe una clave con ese nombre: no se ha tocado.' } : { ok: true, aviso: 'Clave creada' }
  }
}

function resultadoAnadir(de: TipoConElementos, cero: boolean): { ok: true; aviso: string } | { ok: false; mensaje: string } {
  switch (de) {
    case 'list':
      return { ok: true, aviso: 'Elemento añadido' }
    case 'set':
      return cero ? { ok: false, mensaje: 'Ya era miembro del conjunto.' } : { ok: true, aviso: 'Miembro añadido' }
    case 'zset':
      // Un miembro que ya estaba solo cambia su puntuación: ZADD da 0 y no es un fallo.
      return { ok: true, aviso: cero ? 'Puntuación actualizada' : 'Miembro añadido' }
    case 'stream':
      return { ok: true, aviso: 'Entrada añadida' }
  }
}
