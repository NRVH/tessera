// =============================================================================
// Exportar una clave de Redis a JSON: leer la clave ENTERA (todos los trozos del visor, sin repetir
// elementos) y componer el documento `{ clave, tipo, ttlMs, valor }`. Lo que no se puede exportar entero
// (un valor cortado por el tope del visor, un tipo desconocido) se rechaza con su motivo: nunca se
// guarda un archivo a medias. Puro, sin React ni DOM; la prueba es `test-exportar-clave.mts`.
// Decisiones: docs/decisiones/bd/ui-claves-exportar-json.md
// =============================================================================

import type { DbKvBytes, DbKvContenido, DbKvValor } from '../../../../../shared/db-claves-ipc.ts'
import type { DbRespuesta } from '../../../../../shared/db-explorador-ipc.ts'
import { nunca } from '../../../../../shared/nunca.ts'
import { acumularValor, avisoTruncado, cargados, sangrarJson, siguienteDe } from './visorClaves.ts'

/** Elementos, como mucho, de una exportación: más cabe mal en memoria y en un archivo que se abre a mano. */
export const TOPE_ELEMENTOS_EXPORTACION = 1_000_000

/** Elementos por trozo al leer para exportar (el visor pide menos porque pinta; aquí solo se junta). */
export const ELEMENTOS_POR_TROZO_EXPORTACION = 5000

export type LecturaEntera = { ok: true; valor: DbKvValor } | { ok: false; mensaje: string }

/** Por qué este contenido no se exporta, o null si sí. */
export function motivoNoExportable(c: DbKvContenido): string | null {
  switch (c.tipo) {
    case 'noExiste':
      return 'La clave ya no existe.'
    case 'otro':
      return `El tipo ${c.tipoServidor} lo añade un módulo del servidor: el visor no sabe leerlo, así que tampoco exportarlo.`
    case 'string':
    case 'json':
      return avisoTruncado(c)
    case 'hash':
    case 'list':
    case 'set':
    case 'zset':
    case 'stream':
      return null
    default:
      return nunca(c, 'motivoNoExportable')
  }
}

/**
 * Lee la clave entera: el primer trozo (que decide si se puede exportar) y los siguientes hasta que no
 * quede ninguno, se llegue al tope de elementos o `cancelada()`. `pedir(desde)` es una lectura del visor.
 */
export async function leerClaveEntera(
  pedir: (desde: string | undefined) => Promise<DbRespuesta<DbKvValor>>,
  cancelada: () => boolean,
  alProgreso?: (elementos: number) => void
): Promise<LecturaEntera> {
  const primero = await pedir(undefined)
  if (!primero.ok) return { ok: false, mensaje: primero.error.mensaje }
  const motivo = motivoNoExportable(primero.valor.contenido)
  if (motivo !== null) return { ok: false, mensaje: motivo }
  let acumulado = primero.valor
  for (;;) {
    const desde = siguienteDe(acumulado.contenido)
    if (desde === null) return { ok: true, valor: acumulado }
    if (cancelada()) return { ok: false, mensaje: 'Exportación detenida.' }
    const n = cargados(acumulado.contenido)
    if (n > TOPE_ELEMENTOS_EXPORTACION) {
      return { ok: false, mensaje: `La clave tiene más de ${TOPE_ELEMENTOS_EXPORTACION.toLocaleString('es-ES')} elementos: es demasiado grande para exportarla de una vez.` }
    }
    alProgreso?.(n)
    const siguiente = await pedir(desde)
    if (!siguiente.ok) return { ok: false, mensaje: siguiente.error.mensaje }
    acumulado = acumularValor(acumulado, siguiente.valor)
  }
}

type JsonBytes = string | { base64: string }

/** Unos bytes en JSON: su texto si es UTF-8, y si no sus bytes en base64. */
function bytesJson(b: DbKvBytes): JsonBytes {
  return b.texto !== undefined ? b.texto : { base64: b.base64 }
}

type Par = { campo: DbKvBytes; valor: DbKvBytes }

/** Pares campo/valor como objeto si todos los campos son texto y distintos; si no, como lista de pares. */
function paresJson(pares: readonly Par[], comoObjeto: boolean): unknown {
  const textos = pares.map((p) => p.campo.texto)
  if (comoObjeto && textos.every((t) => t !== undefined) && new Set(textos).size === textos.length) {
    return Object.fromEntries(pares.map((p) => [p.campo.texto as string, bytesJson(p.valor)]))
  }
  return pares.map((p) => ({ campo: bytesJson(p.campo), valor: bytesJson(p.valor) }))
}

/** La puntuación como número si Redis la dio finita; `inf` y `-inf` no son JSON, quedan como texto. */
function puntuacionJson(p: string): number | string {
  const n = Number(p)
  return Number.isFinite(n) ? n : p
}

/** El `valor` del documento (ya exportable: ver `motivoNoExportable`). `json` va como texto del servidor. */
function valorJson(c: DbKvContenido): { texto: string } | { valor: unknown } {
  switch (c.tipo) {
    case 'string':
      return { valor: bytesJson(c.valor) }
    case 'json':
      return { texto: sangrarJson(c.texto) }
    case 'hash':
      return { valor: paresJson(c.pares, true) }
    case 'list':
      return { valor: c.elementos.map(bytesJson) }
    case 'set':
      return { valor: c.miembros.map(bytesJson) }
    case 'zset':
      return { valor: c.miembros.map((m) => ({ miembro: bytesJson(m.miembro), puntuacion: puntuacionJson(m.puntuacion) })) }
    case 'stream':
      // Siempre como lista de pares: un campo puede repetirse y su orden cuenta.
      return { valor: c.entradas.map((e) => ({ id: e.id, campos: paresJson(e.campos, false) })) }
    case 'otro':
    case 'noExiste':
      return { valor: null }
    default:
      return nunca(c, 'valorJson')
  }
}

/** El documento JSON de una clave leída entera. */
export function documentoJsonDeClave(nombre: DbKvBytes, v: DbKvValor): string {
  const c = v.contenido
  const tipo = c.tipo === 'otro' ? c.tipoServidor : c.tipo
  const cabecera = JSON.stringify({ clave: bytesJson(nombre), tipo, ttlMs: v.ttlMs }, null, 2)
  const cuerpo = valorJson(c)
  const texto = 'texto' in cuerpo ? cuerpo.texto : JSON.stringify(cuerpo.valor, null, 2)
  // La cabecera acaba en `\n}`: el valor entra como un campo más, sangrado a 2.
  return `${cabecera.slice(0, -2)},\n  "valor": ${texto.replace(/\n/g, '\n  ')}\n}\n`
}
