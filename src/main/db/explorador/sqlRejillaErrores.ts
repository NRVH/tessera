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
