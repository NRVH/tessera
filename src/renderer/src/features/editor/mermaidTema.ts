// =============================================================================
// Decide el fondo de un diagrama a partir de la configuración declarada que analiza mermaid.
// Sin tema propio devuelve null para que se aplique la paleta de la app.
// Puro, sin DOM: lo usa `mermaidRender` y lo prueba `test-mermaid-tema.mts`.
// Decisiones: docs/decisiones/editor/diagramas-mermaid.md
// =============================================================================

export interface ConfigDeclarada {
  theme?: unknown
  themeVariables?: unknown
  themeCSS?: unknown
}

/** Devuelve el fondo del tema declarado, o null si corresponde la paleta de la app. */
export function fondoDeTemaPropio(config: ConfigDeclarada): string | null {
  const tema = typeof config.theme === 'string' ? config.theme.trim() : ''
  const variables = config.themeVariables !== null && typeof config.themeVariables === 'object'
    ? config.themeVariables as Record<string, unknown>
    : {}
  const css = typeof config.themeCSS === 'string' ? config.themeCSS.trim() : ''
  if (!tema && Object.keys(variables).length === 0 && !css) return null

  const fondo = typeof variables.background === 'string' ? variables.background.trim() : ''
  if (fondo && fondo.length <= 64) return fondo
  // Un tema oscuro va sobre el fondo de la app; solo el tema base atiende darkMode.
  if (tema === 'dark' || (tema === 'base' && variables.darkMode === true)) return 'transparent'
  // Los demás temas están pensados para una página clara.
  return '#ffffff'
}
