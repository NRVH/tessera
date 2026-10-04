// =============================================================================
// Datos públicos del proyecto: autoría, repositorio y licencia.
// Un único sitio para lo que citan el «Acerca de», el README y `LICENSE`: si cambia
// aquí, hay que cambiarlo allí.
// La URL del repositorio vale `null` mientras no exista el público, y el «Acerca de»
// no pinta el enlace (sería un 404 servido desde la propia app).
// =============================================================================

/** Nombre completo del autor, tal como figura en `LICENSE`. */
export const AUTOR = 'Noé Roberto Vázquez Herrera'

/** Perfiles públicos del autor: lo que lo distingue sin ambigüedad de cualquier homónimo. */
export const ENLACES_AUTOR: ReadonlyArray<{ etiqueta: string; url: string }> = [
  { etiqueta: 'GitHub', url: 'https://github.com/NRVH' },
  { etiqueta: 'LinkedIn', url: 'https://www.linkedin.com/in/noe-vazquez-03863423a/' }
]

/** URL pública del repositorio, la que enseña el «Acerca de». */
export const REPO_URL: string | null = 'https://github.com/NRVH/tessera'

/** Licencia con la que se publica el código (ver LICENSE en la raíz). */
export const LICENCIA = 'MIT'
