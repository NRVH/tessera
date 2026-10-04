// =============================================================================
// Piezas de validación que comparten los controladores de documentos (MongoDB) y de claves (Redis): el error interno de
// un handler, `invalida` y los comprobadores de forma. Solo tipos y funciones puras.
// Decisiones: docs/decisiones/bd/documentos-controlador.md
// =============================================================================

import type { DbErrorSql, DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'

/** Tope de un identificador (perfil, consola, petición, nombre de base o colección; holgado). */
export const MAX_NOMBRE = 1024

/** Lo que responde un handler cuando se escapa una excepción. */
export const INTERNO: { ok: false; error: DbErrorSql } = {
  ok: false,
  error: { motivo: 'interno', mensaje: 'Error interno del explorador de bases de datos.' }
}

/** Resultado de validar la forma de una petición: la misma forma que una respuesta del canal. */
export type Validado<T> = DbRespuesta<T>

/** Una petición inválida, con el motivo. */
export function invalida(que: string): { ok: false; error: DbErrorSql } {
  return { ok: false, error: { motivo: 'interno', mensaje: `Petición inválida: ${que}.` } }
}

/** ¿Es un identificador no vacío y acotado? */
export function esNombre(v: unknown): v is string {
  return typeof v === 'string' && v !== '' && v.length <= MAX_NOMBRE
}

/** ¿Es un entero entre `min` y `max`, ambos incluidos? */
export function esEnteroEn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

/** El `peticionId` opcional de una petición: ausente = `undefined`, inválido = `null`. */
export function peticionIdDe(r: Record<string, unknown>): string | undefined | null {
  if (r.peticionId === undefined) return undefined
  return esNombre(r.peticionId) ? r.peticionId : null
}

/** Pasa lo validado al gestor, o devuelve el error de validación tal cual. */
export function conValidado<T>(
  p: Validado<T>,
  siguiente: (valor: T) => Promise<DbRespuesta<unknown>>
): Promise<DbRespuesta<unknown>> | { ok: false; error: DbErrorSql } {
  return p.ok ? siguiente(p.valor) : p
}
