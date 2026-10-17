// =============================================================================
// Maximizado y oculto de la columna del agente, POR PERFIL: cada perfil vuelve como se dejó, sin
// que lo que se hizo en otro lo cambie. Efímero (no se persiste), como `maximizadoPorPerfil`.
// Puro: lo prueba `test-columna-por-perfil.mts`. Decisiones: docs/decisiones/layout/oculto-manda-sobre-maximizado.md
// =============================================================================
import type { MotivoCcOculto } from '../editor'

/** Lo que un perfil dejó en su columna del agente. */
export interface ColumnaPerfil {
  /** Maximizado CRUDO sobre el editor; lo que se pinta es el coherente (`maximizadoCoherente`). */
  maximizada: boolean
  /** Por qué está oculta, o 'no'. */
  oculta: MotivoCcOculto
}

/** La de un perfil que nunca tocó su columna. */
export const COLUMNA_INICIAL: ColumnaPerfil = { maximizada: false, oculta: 'no' }

/** La columna del perfil `perfil` ('' = sin perfil). */
export function columnaDe(mapa: Readonly<Record<string, ColumnaPerfil>>, perfil: string): ColumnaPerfil {
  return mapa[perfil] ?? COLUMNA_INICIAL
}

/** `mapa` con la columna de `perfil` cambiada por `cambio`; el MISMO objeto si no cambia nada. */
export function conColumna(
  mapa: Readonly<Record<string, ColumnaPerfil>>,
  perfil: string,
  cambio: Partial<ColumnaPerfil> | ((actual: ColumnaPerfil) => Partial<ColumnaPerfil>)
): Readonly<Record<string, ColumnaPerfil>> {
  const actual = columnaDe(mapa, perfil)
  const siguiente = { ...actual, ...(typeof cambio === 'function' ? cambio(actual) : cambio) }
  if (siguiente.maximizada === actual.maximizada && siguiente.oculta === actual.oculta) return mapa
  return { ...mapa, [perfil]: siguiente }
}
