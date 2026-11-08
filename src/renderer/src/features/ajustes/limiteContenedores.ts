// =============================================================================
// Lógica pura del deslizador del límite de contenedores: de la posición de la barra al valor
// guardado y al revés (el último paso es «Sin límite»), el relleno de su pista, la marca del valor
// recomendado y el cupo que viaja con cada apertura de un agente en Docker. Sin React.
// Depende de `shared/semaforoContenedores`.
// =============================================================================

import {
  SIN_LIMITE,
  limiteEfectivo,
  cortesSemaforo,
  type CortesSemaforo,
  type PoliticaCupo,
  type PrimeroEnPararse
} from '../../../../shared/semaforoContenedores.ts'

/** Posición más baja de la barra: un contenedor. */
export const PASO_MINIMO = 1

/** Posición más alta de la barra: la que sigue al máximo y significa «Sin límite». */
export function pasoMaximo(cortes: CortesSemaforo): number {
  return cortes.maximo + 1
}

/** La posición de la barra para un límite: lo que pase del máximo cae en él y `SIN_LIMITE` en el último paso. */
export function pasoDeLimite(limite: number, cortes: CortesSemaforo): number {
  if (limite === SIN_LIMITE) return pasoMaximo(cortes)
  return Math.min(Math.max(Math.trunc(limite), PASO_MINIMO), cortes.maximo)
}

/** El límite que guarda una posición de la barra. */
export function limiteDePaso(paso: number, cortes: CortesSemaforo): number {
  const p = Math.min(Math.max(Math.trunc(paso), PASO_MINIMO), pasoMaximo(cortes))
  return p > cortes.maximo ? SIN_LIMITE : p
}

/** Dónde cae una posición a lo largo de la pista, de 0 a 100. */
export function porcentajeDePaso(paso: number, cortes: CortesSemaforo): number {
  return ((paso - PASO_MINIMO) / (pasoMaximo(cortes) - PASO_MINIMO)) * 100
}

/**
 * El `background` de la pista: rellena hasta la posición elegida y neutra después. El riesgo no se pinta en
 * la pista: lo dicen el punto y el aviso, y solo cuando lo hay.
 */
export function pistaConRelleno(paso: number, cortes: CortesSemaforo): string {
  const p = porcentajeDePaso(paso, cortes).toFixed(2)
  return `linear-gradient(to right, var(--limite-relleno) 0%, var(--limite-relleno) ${p}%, var(--limite-vacio) ${p}%, var(--limite-vacio) 100%)`
}

/**
 * Dónde se dibuja una marca sobre la pista, alineada con el centro del pulgar de ese paso: el pulgar
 * (18 px) no llega a los extremos, así que la posición se corrige con su medio ancho.
 */
export function posicionMarca(paso: number, cortes: CortesSemaforo): string {
  const p = porcentajeDePaso(paso, cortes)
  return `calc(${p.toFixed(2)}% + ${(9 - 0.18 * p).toFixed(2)}px)`
}

/**
 * El cupo que viaja con la apertura de un agente en Docker. Sin límite guardado y sin saber cuánta
 * memoria tiene Docker no hay recomendado que aplicar: no se manda nada y no se bloquea por una conjetura.
 */
export function cupoDeApertura(
  guardado: number | undefined,
  memoriaBytes: number | null,
  primero: PrimeroEnPararse,
  protegerTrabajando: boolean
): PoliticaCupo | undefined {
  if (guardado === undefined && memoriaBytes === null) return undefined
  const limite = guardado !== undefined ? guardado : limiteEfectivo(undefined, cortesSemaforo(memoriaBytes ?? 0))
  return { limite, primero, protegerTrabajando }
}
