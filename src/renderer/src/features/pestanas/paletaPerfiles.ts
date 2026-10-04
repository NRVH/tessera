// =============================================================================
// paletaPerfiles: los colores con los que NACE un perfil nuevo. Vive aparte de
// ProfileTabs (.tsx) para que su prueba, que corre con `node` a secas, valide la paleta
// real. Todos están dentro de la banda de `tintaPerfil` (colorPerfil.ts), cuyos límites
// no se repiten aquí, y sus matices distan más de 18° entre sí para no confundir dos
// perfiles de un vistazo.
// Decisiones: docs/decisiones/renderer/color-de-perfil-cenizo.md
// =============================================================================

/** Paleta por defecto para perfiles nuevos, en orden de asignación. */
export const PALETTE_PERFILES = [
  '#7c9e8a', // salvia
  '#7590b3', // pizarra
  '#8d85ad', // lavanda ceniza
  '#b09267', // ámbar quemado
  '#b07f79', // terracota
  '#6f9aa3', // petróleo
  '#a37f9c', // ciruela
  '#98a071' // oliva
] as const

/**
 * Un color de la paleta que NO esté ya en uso, para que dos perfiles nuevos
 * seguidos no nazcan iguales. Si se agotan (más perfiles que colores), cae en la
 * salvia: repetir es mejor que inventar un color fuera de la banda.
 */
export function colorPorDefecto(usados: readonly string[]): string {
  const enUso = new Set(usados.map((c) => c.toLowerCase()))
  return PALETTE_PERFILES.find((c) => !enUso.has(c.toLowerCase())) ?? PALETTE_PERFILES[0]
}
