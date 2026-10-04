// =============================================================================
// Cómo se llama cada agente ante el usuario, en un solo sitio para el main y el renderer.
// `Record<AgentKind, string>` y no un `switch`: al añadir un agente, el typecheck obliga
// a darle nombre aquí. No va en `agent-terminal-ipc.ts` porque no viaja por ningún canal.
// Sin dependencias de valor (solo un tipo): lo importan los `test-*.mts` bajo `node`.
// =============================================================================

import type { AgentKind } from './agent-terminal-ipc.ts'

/** Cómo se nombra cada agente en banners, motivos, títulos y errores. */
export const ETIQUETA_AGENTE: Readonly<Record<AgentKind, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex'
}
