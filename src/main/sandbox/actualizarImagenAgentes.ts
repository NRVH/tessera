// =============================================================================
// Actualizar los agentes en Docker: inicia Docker si hace falta, rehornea la imagen sin caché (los CLI más recientes), lee
// las versiones horneadas y recrea los contenedores, contando el progreso línea a línea. Hasta que la imagen nueva está
// lista no se detiene nada; el self-update dentro del contenedor no persiste y los paneles vivos se recuperan solos.
// Lo registra `sandbox/ipc.ts` (`AGENTS_UPDATE.RUN`).
// Decisiones: docs/decisiones/sandbox/imagen-y-extras.md
// =============================================================================
import type { ResultadoActualizacionAgentes } from '../../shared/agents-update-ipc.ts'
import type { GestorSandbox } from './GestorSandbox.ts'
import { txSandbox } from './textos.ts'

type SandboxActualizable = Pick<GestorSandbox, 'asegurarDocker' | 'reconstruirImagen' | 'leerVersionesImagenAgentes' | 'detenerTodosLosContenedores'>

/** Nunca lanza. `antesDeParar` detiene lo que no se recupera solo al perder su contenedor. */
export async function actualizarImagenAgentes(
  sandbox: SandboxActualizable,
  emitirLinea: (linea: string) => void,
  antesDeParar: () => Promise<void> = () => Promise.resolve()
): Promise<ResultadoActualizacionAgentes> {
  const t = txSandbox().actualizar
  try {
    const docker = await sandbox.asegurarDocker(() => emitirLinea(t.iniciandoDocker))
    if (!docker.ok) throw new Error(docker.detalle.split('\n')[0])
    emitirLinea(t.reconstruyendo)
    await sandbox.reconstruirImagen(emitirLinea)
    const versiones = await sandbox.leerVersionesImagenAgentes()
    emitirLinea(t.horneado(versiones.codex, versiones.claude))
    emitirLinea(t.recreando)
    await antesDeParar()
    await sandbox.detenerTodosLosContenedores()
    emitirLinea(t.listo)
    return { ok: true, ...versiones }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    emitirLinea(t.error(error))
    return { ok: false, codex: '?', claude: '?', error }
  }
}
