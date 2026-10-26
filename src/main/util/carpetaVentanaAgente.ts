// =============================================================================
// Dónde trabajan las ventanas de agente: la carpeta del usuario, como al abrir una terminal y
// escribir el nombre del CLI. Bajo el arnés de pruebas se puede cambiar por una temporal.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================
import { homedir } from 'node:os'
import { lanzadaPorElArnes } from '../../shared/arnesE2e.ts'

/** Variable que solo se lee con la app lanzada por el arnés de interfaz. */
export const VARIABLE_CARPETA_PRUEBAS = 'TESSERA_E2E_CARPETA_VENTANA_AGENTE'

/** La carpeta de trabajo de las ventanas de agente. */
export function carpetaVentanaAgente(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): string {
  const deArnes = lanzadaPorElArnes(argv) ? env[VARIABLE_CARPETA_PRUEBAS]?.trim() : undefined
  return deArnes ? deArnes : homedir()
}
