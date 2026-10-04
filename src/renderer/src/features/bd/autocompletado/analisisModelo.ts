// =============================================================================
// Memoria de la división en sentencias de un modelo de consola: el texto y sus
// sentencias, partidos UNA vez por versión del modelo y dialecto.
// Puro (solo `divisorSql`): la comparten el proveedor, la precarga de FKs y los avisos
// léxicos de la consola, y vive aparte para que ninguno importe de otro.
// Decisiones: docs/decisiones/bd/ui-autocompletado-espera-y-division.md
// =============================================================================

import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { dividirSentencias, type Sentencia } from '../../../../../shared/sql/divisorSql.ts'

/** Lo que el análisis usa de un modelo (lo cumple `editor.ITextModel`). */
export interface ModeloAnalizable {
  getVersionId(): number
  getValue(): string
}

/** El texto de una versión del modelo y sus sentencias, en un dialecto. */
export interface Analisis {
  version: number
  dialecto: DialectoSql
  texto: string
  sentencias: readonly Sentencia[]
}

const analisis = new WeakMap<object, Analisis>()

/** Texto y sentencias del modelo, partidos una vez por versión y dialecto. */
export function analisisDe(modelo: ModeloAnalizable, d: DialectoSql): Analisis {
  const version = modelo.getVersionId()
  const previo = analisis.get(modelo)
  if (previo && previo.version === version && previo.dialecto === d) return previo
  const texto = modelo.getValue()
  const nuevo: Analisis = { version, dialecto: d, texto, sentencias: dividirSentencias(texto, d) }
  analisis.set(modelo, nuevo)
  return nuevo
}
