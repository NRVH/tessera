// =============================================================================
// Traduce la posición de un error del servidor (offset UTF-16, línea o punto de código) al
// campo del usuario que lo causó (WHERE, ORDER BY o una condición del filtro guiado).
// Puro; usa los rangos que dejó `componerBase` en la consulta. Lo reexporta `sqlRejilla.ts`.
// Decisiones: docs/decisiones/bd/rejilla-sql-fragmentos.md
// =============================================================================

import { esBlanco } from '../../../shared/sql/lexicoSql.ts'
import { puntosDeCodigoAUtf16 } from '../../../shared/sql/posicionErrorSql.ts'
import type { CampoRejilla, ConsultaRejilla, UbicacionErrorRejilla } from './sqlRejillaTipos.ts'

function siguienteNoBlanco(sql: string, desde: number): number {
  let i = desde
  while (i < sql.length && esBlanco(sql.charCodeAt(i))) i++
  return i
}

/**
 * Traduce un offset del error (UTF-16 en `consulta.sql`) a `campo` + posición relativa al
 * campo; `null` si cae fuera de los fragmentos del usuario. El servidor suele señalar el
 * token que SIGUE a lo que falla (el `)` de cierre, el `LIMIT`): un offset entre el final del
 * fragmento y el siguiente no blanco se atribuye al campo, al final.
 */
export function campoDeError(consulta: ConsultaRejilla, offsetUtf16EnSql: number): UbicacionErrorRejilla | null {
  if (!Number.isFinite(offsetUtf16EnSql)) return null
  const campos: CampoRejilla[] = ['where', 'orderBy']
  for (const campo of campos) {
    const r = consulta.rangos[campo]
    if (!r) continue
    const [ini, fin] = r
    if (offsetUtf16EnSql < ini) continue
    if (offsetUtf16EnSql <= fin) return { campo, posicion: offsetUtf16EnSql - ini }
    if (offsetUtf16EnSql <= siguienteNoBlanco(consulta.sql, fin)) return { campo, posicion: fin - ini }
  }
  // Una condición del filtro guiado: cada una es su línea, sin solaparse. Lo que cae justo
  // detrás de la última (el `)` de cierre) es de la última, como en el WHERE.
  const filtro = consulta.rangos.filtro
  if (filtro && filtro.length > 0) {
    for (let i = 0; i < filtro.length; i++) {
      const [ini, fin] = filtro[i]
      if (offsetUtf16EnSql >= ini && offsetUtf16EnSql <= fin) return { campo: 'filtro', condicion: i }
    }
    const fin = filtro[filtro.length - 1][1]
    if (offsetUtf16EnSql > fin && offsetUtf16EnSql <= siguienteNoBlanco(consulta.sql, fin)) {
      return { campo: 'filtro', condicion: filtro.length - 1 }
    }
  }
  return null
}

/**
 * Igual que `campoDeError`, desde la LÍNEA (base 1) de un error de SQL Server, que no da
 * columna: se toma el principio de esa línea. Un error de nombres da la línea donde EMPIEZA
 * la sentencia, que no es de ningún campo.
 */
export function campoDeErrorEnLinea(
  consulta: ConsultaRejilla,
  linea: number
): UbicacionErrorRejilla | null {
  if (!Number.isInteger(linea) || linea < 1) return null
  let i = 0
  for (let l = 1; l < linea; l++) {
    const salto = consulta.sql.indexOf('\n', i)
    if (salto < 0) return null
    i = salto + 1
  }
  return campoDeError(consulta, i)
}

/**
 * Una columna que no existe sin posición útil del servidor (SQL Server da la línea donde empieza la
 * sentencia; en SQLite la posición puede caer en otro fragmento): el fragmento que la nombra, por este
 * orden: el ORDER BY, la condición del filtro guiado o el WHERE libre. El orden va primero porque es el
 * que deja la pestaña sin salida (sin resultado no hay cabecera en la que quitarlo); quitarlo es inocuo.
 */
export function campoDeColumnaInexistente(consulta: ConsultaRejilla, nombre: string): UbicacionErrorRejilla | null {
  if (nombre === '') return null
  // Fuera de los literales de texto, y como identificador entero: «ID» no está en «CLIENTE_ID» ni en 'ID'.
  const nombra = ([ini, fin]: [number, number]): boolean =>
    identificadorEn(consulta.sql.slice(ini, fin).replace(/'(?:[^']|'')*'/g, "''"), nombre)
  const { where, filtro, orderBy } = consulta.rangos
  if (orderBy && nombra(orderBy)) return { campo: 'orderBy', posicion: 0 }
  const i = (filtro ?? []).findIndex(nombra)
  if (i >= 0) return { campo: 'filtro', condicion: i }
  return where && nombra(where) ? { campo: 'where', posicion: 0 } : null
}

/**
 * ¿`texto` nombra `nombre` como COLUMNA: identificador entero (sin letras, cifras ni `_@#$` pegados) y
 * no como calificador (`"t".` delante de otra columna, que en SQLite lleva cada condición)?
 */
function identificadorEn(texto: string, nombre: string): boolean {
  const esDeNombre = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_@#$]/u.test(c)
  for (let i = texto.indexOf(nombre); i >= 0; i = texto.indexOf(nombre, i + 1)) {
    let fin = i + nombre.length
    if (esDeNombre(texto[i - 1]) || esDeNombre(texto[fin])) continue
    if (texto[fin] === '"' || texto[fin] === ']' || texto[fin] === '`') fin++
    if (texto[fin] !== '.') return true
  }
  return false
}

/**
 * Igual que `campoDeError`, desde el `offsetCp` que manda el trabajador (puntos de código
 * base 0 del SQL enviado): la conversión vive aquí, junto al SQL que la produjo.
 */
export function campoDeErrorEnPuntosDeCodigo(
  consulta: ConsultaRejilla,
  offsetCp: number
): UbicacionErrorRejilla | null {
  if (!Number.isFinite(offsetCp) || offsetCp < 0) return null
  return campoDeError(consulta, puntosDeCodigoAUtf16(consulta.sql, offsetCp))
}
