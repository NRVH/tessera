// =============================================================================
// Lógica pura del deslizador del límite de contenedores: de la posición de la barra al valor
// guardado y al revés (el último paso es «Sin límite»), el degradado verde-amarillo-rojo de su
// pista y el cupo que viaja con cada apertura de un agente en Docker. Sin React.
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
function porcentajeDePaso(paso: number, cortes: CortesSemaforo): number {
  return ((paso - PASO_MINIMO) / (pasoMaximo(cortes) - PASO_MINIMO)) * 100
}

/**
 * Las paradas del degradado de la pista, en porcentaje: el color cambia a mitad de camino entre el
 * último paso de un color y el primero del siguiente, para que el pulgar sobre un paso se vea de su color.
 */
export function paradasDegradado(cortes: CortesSemaforo): { verdeHasta: number; amarilloHasta: number } {
  const medio = (paso: number): number => (porcentajeDePaso(paso, cortes) + porcentajeDePaso(paso + 1, cortes)) / 2
  return { verdeHasta: medio(cortes.verdeHasta), amarilloHasta: medio(cortes.amarilloHasta) }
}

/** El `background` de la pista: verde, amarillo y rojo con los cortes del equipo. */
export function degradadoPista(cortes: CortesSemaforo): string {
  const p = paradasDegradado(cortes)
  const v = p.verdeHasta.toFixed(2)
  const a = p.amarilloHasta.toFixed(2)
  return `linear-gradient(to right, var(--green) 0%, var(--green) ${v}%, var(--yellow) ${v}%, var(--yellow) ${a}%, var(--red) ${a}%, var(--red) 100%)`
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
