// =============================================================================
// Editar una clave de Redis desde su visor: de cada acción (el valor de un string, un campo de un hash,
// la caducidad, renombrar, borrar) sale UN comando de la consola, con los argumentos citados como los
// escribe la consola, y de su respuesta, lo que se le dice al usuario. El comando va por la consola de Redis del
// main, que decide la política (producción, peligrosos). Los tipos con elementos y la creación de claves
// son de `edicionElementos.ts`. Pura, sin React ni DOM; la usan
// `useEdicionClave.ts` y `DialogoEdicionClave.tsx`, y la prueba `test-visor-claves.mts`.
// Decisiones: docs/decisiones/bd/ui-claves-visor.md
// =============================================================================

import type { DbKvBytes, DbKvRespuesta } from '../../../../../shared/db-claves-ipc.ts'
import { citarRedisCli } from './bytesClaves.ts'
import { comandoElemento, entradasInicialesElemento, resultadoElemento, textosElemento, type AccionElemento } from './edicionElementos.ts'
import { txEdicionClaves } from './textosEdicionClaves.ts'

/** Lo que se edita. Un campo `null` es un campo NUEVO del hash, con su nombre en el primer cuadro. */
export type AccionClave =
  | { tipo: 'valor'; actual: string }
  | { tipo: 'campo'; campo: DbKvBytes | null; actual: string }
  | { tipo: 'quitarCampo'; campo: DbKvBytes }
  | { tipo: 'ttl'; segundos: number | null }
  | { tipo: 'renombrar'; actual: string }
  | { tipo: 'borrar' }
  | AccionElemento

/** Los textos de un diálogo de edición. `peligro` = borra algo. */
export interface TextosAccion {
  titulo: string
  etiqueta: string | null
  etiquetaDos: string | null
  boton: string
  peligro: boolean
  multilinea: boolean
}

/** Lo escrito en el diálogo: `uno` es el cuadro principal, `dos` el valor de un campo nuevo. */
export interface EntradasClave {
  uno: string
  dos: string
}

export type ComandoClave = { ok: true; texto: string } | { ok: false; motivo: string }

const texto = (s: string): string => citarRedisCli({ texto: s, base64: '' })

/** Los textos del diálogo de cada acción. `peligro` = borra algo. */
export function textosAccion(a: AccionClave, nombreCampo?: string): TextosAccion {
  const t = txEdicionClaves()
  switch (a.tipo) {
    case 'valor':
      return { titulo: t.tituloEditarValor, etiqueta: t.valor, etiquetaDos: null, boton: t.guardar, peligro: false, multilinea: true }
    case 'campo':
      return a.campo === null
        ? { titulo: t.tituloAnadirCampo, etiqueta: t.campo, etiquetaDos: t.valor, boton: t.anadirBoton, peligro: false, multilinea: false }
        : { titulo: t.editarElCampo(nombreCampo ?? ''), etiqueta: t.valor, etiquetaDos: null, boton: t.guardar, peligro: false, multilinea: true }
    case 'quitarCampo':
      return { titulo: t.borrarElCampoTitulo(nombreCampo ?? ''), etiqueta: null, etiquetaDos: null, boton: t.borrarElCampoBoton, peligro: true, multilinea: false }
    case 'ttl':
      return { titulo: t.tituloCaducidad, etiqueta: t.segundosHastaCaducar, etiquetaDos: null, boton: t.guardar, peligro: false, multilinea: false }
    case 'renombrar':
      return { titulo: t.tituloRenombrar, etiqueta: t.nombreNuevo, etiquetaDos: null, boton: t.renombrarBoton, peligro: false, multilinea: false }
    case 'borrar':
      return { titulo: t.tituloBorrarClave, etiqueta: null, etiquetaDos: null, boton: t.borrarClaveBoton, peligro: true, multilinea: false }
    default:
      return textosElemento(a, nombreCampo)
  }
}

/**
 * El texto que se edita de unos bytes (el valor de un string o de un campo), o por qué no se edita
 * aquí: unos bytes que no son texto se reescribirían como otro texto, y un valor cortado, a medias.
 */
export function textoEditable(b: DbKvBytes, truncado = false): { ok: true; texto: string } | { ok: false; motivo: string } {
  const t = txEdicionClaves()
  if (truncado) return { ok: false, motivo: t.valorGrande }
  if (b.texto === undefined) return { ok: false, motivo: t.valorBytes }
  // Un cuadro de texto convierte cada CR en LF: guardar, aun sin tocar nada, cambiaría los bytes.
  if (b.texto.includes('\r')) return { ok: false, motivo: t.valorConCr }
  return { ok: true, texto: b.texto }
}

/** Lo que el diálogo trae escrito al abrirse. */
export function entradasIniciales(a: AccionClave): EntradasClave {
  if (a.tipo === 'valor' || a.tipo === 'campo' || a.tipo === 'renombrar') return { uno: a.tipo === 'campo' && a.campo === null ? '' : a.actual, dos: '' }
  if (a.tipo === 'ttl') return { uno: a.segundos === null ? '' : String(a.segundos), dos: '' }
  if (a.tipo === 'quitarCampo' || a.tipo === 'borrar') return { uno: '', dos: '' }
  return entradasInicialesElemento(a)
}

/**
 * El comando de la acción, o por qué todavía no se puede. `conTtl`: la clave caduca, y reescribir un
 * string con `SET` se lo quitaría, así que va con `KEEPTTL`.
 */
export function comandoDeAccion(clave: DbKvBytes, a: AccionClave, e: EntradasClave, conTtl: boolean): ComandoClave {
  const k = citarRedisCli(clave)
  switch (a.tipo) {
    case 'valor':
      return { ok: true, texto: `SET ${k} ${texto(e.uno)}${conTtl ? ' KEEPTTL' : ''}` }
    case 'campo': {
      if (a.campo !== null) return { ok: true, texto: `HSET ${k} ${citarRedisCli(a.campo)} ${texto(e.uno)}` }
      if (e.uno === '') return { ok: false, motivo: txEdicionClaves().escribeCampo }
      return { ok: true, texto: `HSET ${k} ${texto(e.uno)} ${texto(e.dos)}` }
    }
    case 'quitarCampo':
      return { ok: true, texto: `HDEL ${k} ${citarRedisCli(a.campo)}` }
    case 'ttl':
      return comandoTtl(k, e.uno.trim())
    case 'renombrar':
      return comandoRenombrar(k, e.uno, a.actual)
    case 'borrar':
      return { ok: true, texto: `DEL ${k}` }
    default:
      return comandoElemento(k, a, e)
  }
}

/** Vacío = que no caduque (`PERSIST`); si no, segundos enteros mayores que 0 (`EXPIRE`). */
function comandoTtl(k: string, t: string): ComandoClave {
  if (t === '') return { ok: true, texto: `PERSIST ${k}` }
  if (!/^\d+$/.test(t) || Number(t) <= 0 || !Number.isSafeInteger(Number(t))) return { ok: false, motivo: txEdicionClaves().escribeSegundos }
  return { ok: true, texto: `EXPIRE ${k} ${Number(t)}` }
}

/**
 * El nombre actual de la clave como texto editable, o por qué no se renombra aquí: un nombre que no es
 * UTF-8 se enseña con escapes, y lo escrito se enviaría como esos caracteres, no como sus bytes.
 */
export function nombreRenombrable(clave: DbKvBytes): { ok: true; texto: string } | { ok: false; motivo: string } {
  return clave.texto === undefined ? { ok: false, motivo: txEdicionClaves().nombreBytes } : { ok: true, texto: clave.texto }
}

/** RENAMENX y no RENAME: si ya hay una clave con ese nombre, no se pisa. */
function comandoRenombrar(k: string, nuevo: string, actual: string): ComandoClave {
  if (nuevo === '') return { ok: false, motivo: txEdicionClaves().escribeNombreNuevo }
  if (nuevo === actual) return { ok: false, motivo: txEdicionClaves().mismoNombre }
  return { ok: true, texto: `RENAMENX ${k} ${texto(nuevo)}` }
}

/** Lo que se le dice al usuario según la respuesta de Redis al `comando` que se envió: hecho, o por qué no. */
export function resultadoDeAccion(a: AccionClave, comando: string, r: DbKvRespuesta): { ok: true; aviso: string } | { ok: false; mensaje: string } {
  if (r.tipo === 'error') return { ok: false, mensaje: r.texto }
  const cero = r.tipo === 'entero' && r.valor === '0'
  const t = txEdicionClaves()
  switch (a.tipo) {
    case 'valor':
      return { ok: true, aviso: t.valorGuardado }
    case 'campo':
      return { ok: true, aviso: a.campo === null ? t.campoAnadido : t.campoGuardado }
    case 'quitarCampo':
      return cero ? { ok: false, mensaje: t.campoNoExistia } : { ok: true, aviso: t.campoBorrado }
    case 'ttl':
      // PERSIST da 0 si la clave no caducaba: no es un fallo. EXPIRE da 0 si la clave ya no existe.
      if (comando.startsWith('PERSIST ')) return { ok: true, aviso: t.yaNoCaduca }
      return cero ? { ok: false, mensaje: t.claveNoExiste } : { ok: true, aviso: t.caducidadGuardada }
    case 'renombrar':
      return cero ? { ok: false, mensaje: t.nombreOcupado } : { ok: true, aviso: t.claveRenombrada }
    case 'borrar':
      return cero ? { ok: false, mensaje: t.claveNoExistia } : { ok: true, aviso: t.claveBorrada }
    default:
      return resultadoElemento(a, r)
  }
}
