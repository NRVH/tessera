// =============================================================================
// Colores del resaltado de coincidencias de xterm (`ISearchDecorationOptions`, que
// exige #RRGGBB). Repiten a propósito los tokens `--search-match*` del tema, porque
// xterm no lee variables CSS: si cambias uno, cambia el otro (theme/atomOneDark.ts).
// =============================================================================

import type { ISearchDecorationOptions } from '@xterm/addon-search'

/** Colores del resaltado de coincidencias del SearchAddon de xterm. */
export const SEARCH_DECORATIONS: ISearchDecorationOptions = {
  matchBackground: '#37455a',
  matchOverviewRuler: '#6aa8ff',
  activeMatchBackground: '#7a5a25',
  activeMatchBorder: '#e8c583',
  activeMatchColorOverviewRuler: '#e8c583'
}
