// =============================================================================
// Fija el idioma de la ventana con el que resolvió el main (llega por el preload). Es el PRIMER
// import de `main.tsx`: así ningún módulo lee un texto antes de que el idioma esté puesto.
// Depende de `shared/i18n` y de `window.tessera.idioma`.
// =============================================================================

import { fijarIdioma } from '../../../shared/i18n'

fijarIdioma(window.tessera.idioma)
document.documentElement.lang = window.tessera.idioma
