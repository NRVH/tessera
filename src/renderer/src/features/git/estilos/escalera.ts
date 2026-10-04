// =============================================================================
// Escalera de tamaños de letra del CSS de git: tres peldaños relativos a `--ui-font`
// (el cuarto, el normal, es `var(--ui-font)` a secas). La usan los trozos de `estilos/`.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================

/** El asunto de un commit en la ficha de detalle: lo único que manda sobre lo que lo rodea. */
export const TITULO = 'calc(var(--ui-font) + 1px)'
/** Lo que acompaña al contenido: autor, fecha, ruta en gris, metadatos, errores. */
export const META = 'calc(var(--ui-font) - 1px)'
/** Chips, badges, conteos y cabeceras en mayúsculas; el `max` es un suelo de legibilidad. */
export const MICRO = 'max(9px, calc(var(--ui-font) - 2px))'
