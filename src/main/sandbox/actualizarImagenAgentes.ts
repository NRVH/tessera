// =============================================================================
// «Actualizar agentes» del modo Docker: rehornea la imagen sin caché (los CLI más recientes),
// lee las versiones horneadas y recrea los contenedores, contando el progreso línea a línea.
// El self-update dentro del contenedor no persiste; los paneles vivos se recuperan solos.
// Lo registra `sandbox/ipc.ts` (`AGENTS_UPDATE.RUN`).
// Decisiones: docs/decisiones/sandbox/imagen-y-extras.md
// =============================================================================
import type { AgentsUpdateResult } from '../../shared/agents-update-ipc.ts'
import type { SandboxManager } from './SandboxManager.ts'
import { txSandbox } from './textos.ts'

/** Rehornea la imagen, lee las versiones y recrea los contenedores; nunca lanza. */
export async function actualizarImagenAgentes(
  sandbox: SandboxManager,
  emitirLinea: (line: string) => void
): Promise<AgentsUpdateResult> {
  const t = txSandbox().actualizar
  try {
    emitirLinea(t.reconstruyendo)
    await sandbox.rebuildImage(emitirLinea)
    const versions = await sandbox.agentImageVersions()
    emitirLinea(t.horneado(versions.codex, versions.claude))
    emitirLinea(t.recreando)
    await sandbox.stopAllContainers()
    emitirLinea(t.listo)
    return { ok: true, ...versions }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    emitirLinea(t.error(error))
    return { ok: false, codex: '?', claude: '?', error }
  }
}
