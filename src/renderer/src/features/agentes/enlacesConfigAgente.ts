// =============================================================================
// Dónde documenta cada CLI las opciones de su archivo: Tessera enlaza en vez de mantener una lista
// propia, porque cambian con cada versión.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================

import type { AgenteConConfig } from '../../../../shared/configAgente-ipc'

export const AGENTE_ENLACE_OPCIONES: Readonly<Record<AgenteConConfig, string>> = {
  'claude-code': 'https://code.claude.com/docs/en/settings',
  codex: 'https://developers.openai.com/codex/config-reference'
}
