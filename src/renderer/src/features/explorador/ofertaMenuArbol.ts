// =============================================================================
// Qué ofrece el menú contextual del árbol según el estado git de la fila. Puro: sin React ni DOM,
// se prueba con `node`. La letra es la de `buildDecorations` (feature git): `U` es la de conflicto,
// la misma regla que reparte la sección Conflictos del panel de git, donde descartar no se ofrece.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

/** Letra de la decoración de un archivo en conflicto (la primera en la precedencia de `badgeLetter`). */
const LETRA_CONFLICTO = 'U'

/**
 * ¿El menú ofrece «Descartar cambios…»? Solo para UN archivo con cambios y que no esté en
 * conflicto: descartarlo lo revertiría a HEAD y perdería el lado entrante y la resolución a medias.
 */
export function ofreceDescartar(letra: string | undefined, elementos: number, esCarpeta: boolean): boolean {
  return elementos <= 1 && !esCarpeta && letra !== undefined && letra !== LETRA_CONFLICTO
}
