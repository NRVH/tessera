// =============================================================================
// Las operaciones largas del explorador SFTP (subidas, descargas, borrados) en lógica pura: aplicar
// cada evento de progreso a la lista, cuándo hay que refrescar la carpeta, qué texto y qué
// porcentaje se enseñan y cómo se cuentan los conflictos de un plan. Sin React ni DOM; se fija bajo
// `node` (`test-sftp.mts`). Depende de los textos y del formato de tamaños.
// =============================================================================

import type { SftpProgreso } from '../../../../shared/sftp-ipc.ts'
import { formatoTamano } from './listadoSftp.ts'
import { txSftp } from './textos.ts'

/** Lo que la tira enseña de cada operación: es el propio evento de progreso. */
export type OperacionSftp = SftpProgreso

/** ¿Terminó (bien, mal o cancelada)? */
export function esFinal(fase: SftpProgreso['fase']): boolean {
  return fase !== 'en-curso'
}

/**
 * Pone al día la operación del evento, o la añade al final si aún no estaba (el evento puede llegar
 * antes que la respuesta que la anuncia). Una operación ya terminada no vuelve a «en curso» por un
 * evento tardío.
 */
export function aplicarProgreso(lista: readonly OperacionSftp[], p: SftpProgreso): OperacionSftp[] {
  const i = lista.findIndex((o) => o.opId === p.opId)
  if (i === -1) return [...lista, p]
  if (esFinal(lista[i].fase) && !esFinal(p.fase)) return [...lista]
  return lista.map((o, j) => (j === i ? p : o))
}

/** La lista sin esa operación. */
export function quitarOperacion(lista: readonly OperacionSftp[], opId: string): OperacionSftp[] {
  return lista.filter((o) => o.opId !== opId)
}

/**
 * ¿Hay que volver a listar la carpeta que se ve? Al terminar una subida o un borrado que tocó esa
 * carpeta (también si falló o se canceló a medias: algo pudo cambiar). Una descarga no cambia nada
 * en el servidor.
 */
export function debeRefrescar(p: SftpProgreso, carpetaVisible: string | null): boolean {
  if (!esFinal(p.fase) || p.tipo === 'descarga' || carpetaVisible === null) return false
  return p.carpetaRemota === carpetaVisible
}

/** ¿Se quita sola de la tira? Las hechas y las canceladas; un error se queda hasta cerrarlo a mano. */
export function seQuitaSola(fase: SftpProgreso['fase']): boolean {
  return fase === 'hecha' || fase === 'cancelada'
}

/** Cuánto va, de 0 a 100; `null` si no se sabe el total (la barra es indeterminada). */
export function porcentaje(o: OperacionSftp): number | null {
  if (o.total === null || o.total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((o.hechos / o.total) * 100)))
}

/** El verbo de la operación, según su fase. */
export function verboOperacion(o: OperacionSftp): string {
  const [enCurso, hecha, error, cancelada] = txSftp()[o.tipo]
  if (o.fase === 'en-curso') return enCurso
  if (o.fase === 'hecha') return hecha
  return o.fase === 'error' ? error : cancelada
}

/** El avance: bytes de un total en transferencias, elementos en un borrado; vacío si aún no hay nada. */
export function textoAvance(o: OperacionSftp): string {
  if (o.tipo === 'borrado') {
    if (o.total === null) return o.hechos > 0 ? txSftp().elementos(o.hechos) : ''
    return txSftp().elementosDe(o.hechos, o.total)
  }
  if (o.total === null) return o.hechos > 0 ? formatoTamano(o.hechos) : ''
  return `${formatoTamano(o.hechos)} de ${formatoTamano(o.total)}`
}

/** El título del aviso de un plan con conflictos: «Reemplazar 1 elemento» / «Reemplazar 3 elementos». */
export function tituloConflictos(n: number): string {
  return txSftp().tituloConflictos(n)
}

const MAX_NOMBRES_CONFLICTO = 8

/** El cuerpo del aviso: qué nombres ya existen (hasta 8) y que se pisarán. */
export function mensajeConflictos(conflictos: readonly string[]): string {
  const vistos = conflictos.slice(0, MAX_NOMBRES_CONFLICTO).map((n) => `• ${n}`)
  const resto = conflictos.length - vistos.length
  const t = txSftp()
  if (resto > 0) vistos.push(t.yMas(resto))
  const existe = t.yaExiste(conflictos.length !== 1)
  return `${existe}:\n${vistos.join('\n')}\n\n${t.siContinuas}`
}

/** El cuerpo del aviso de borrado: cuántos elementos y que las carpetas se van con todo lo que tienen. */
export function mensajeBorrado(nombres: readonly string[], hayCarpetas: boolean): string {
  const t = txSftp()
  const cuantos = nombres.length === 1 ? t.unElemento(nombres[0]) : t.elementos(nombres.length)
  const carpetas = hayCarpetas ? `\n${t.carpetasConTodo}` : ''
  return `${t.mensajeBorrado(cuantos)}${carpetas}\n${t.noSePuedeDeshacer}`
}

/** El título del aviso de borrado. */
export function tituloBorrado(n: number): string {
  return txSftp().tituloBorrado(n)
}
