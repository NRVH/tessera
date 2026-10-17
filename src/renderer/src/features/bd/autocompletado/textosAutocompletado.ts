// =============================================================================
// Textos del autocompletado SQL: el nombre del ítem y de la acción de código que expanden un
// `*` en la lista de columnas. Sin JSX ni DOM; los leen `expandirEstrella.ts` y
// `proveedorSqlMonaco.ts`.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

export const txAutocompletado = crearTextos(
  {
    expandirColumnas: 'Expandir columnas'
  },
  {
    expandirColumnas: 'Expand columns'
  }
)
