// =============================================================================
// `conjunto`: un conjunto de palabras a partir de un texto separado por blancos.
// Lo usan el vocabulario, el clasificador y los avisos para escribir sus listas legibles.
// Neutral y ES2020.
// =============================================================================

export function conjunto(texto: string): ReadonlySet<string> {
  return new Set(texto.split(/\s+/).filter((p) => p.length > 0))
}
