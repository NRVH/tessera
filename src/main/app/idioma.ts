// =============================================================================
// El idioma del proceso main: se resuelve una vez al arrancar (la variable de las pruebas, el
// ajuste guardado o el idioma del sistema) y se deja en el entorno para que lo hereden `tdb` y
// `tssh`. La ventana lo recibe como argumento (`ventana.ts`).
// Depende de `shared/i18n` y de los ajustes guardados.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { app } from 'electron'
import { VARIABLE_IDIOMA, VARIABLE_IDIOMA_FORZADO, esIdioma, fijarIdioma, resolverIdioma, type Idioma } from '../../shared/i18n'
import { loadWorkspaceSettings } from '../workspace/workspaceStateStore'

/** Tras `whenReady`, antes del menú y de la ventana: los dos ya hablan el idioma elegido. */
export function fijarIdiomaDeArranque(): Idioma {
  const forzado = process.env[VARIABLE_IDIOMA_FORZADO]
  const idioma = esIdioma(forzado)
    ? forzado
    : resolverIdioma(loadWorkspaceSettings().idioma, app.getPreferredSystemLanguages())
  fijarIdioma(idioma)
  process.env[VARIABLE_IDIOMA] = idioma
  return idioma
}

/**
 * El relevo de la actualización: su `userData` es otro y no ve los ajustes, así que habla el idioma
 * que le deja en el entorno la Tessera que lo lanzó; sin él, el del sistema.
 */
export function fijarIdiomaHeredado(): Idioma {
  const heredado = process.env[VARIABLE_IDIOMA]
  const idioma = esIdioma(heredado) ? heredado : resolverIdioma('sistema', app.getPreferredSystemLanguages())
  fijarIdioma(idioma)
  return idioma
}
