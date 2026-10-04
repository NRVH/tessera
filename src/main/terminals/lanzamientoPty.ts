// =============================================================================
// Lanzamiento del pty de una sesión de terminal: `docker exec -it` dentro del contenedor
// del perfil (con el cwd neutro que resuelve el registro de montajes), o el shell nativo del
// sistema en la ruta real del proyecto. Decide los argumentos y el entorno; el pty lo crea
// `adaptadores/pty.ts`. Lo usa `TerminalService`.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================
import type { IPty } from 'node-pty'
import path from 'node:path'
import type { Profile } from '../profiles/types.ts'
import type { SandboxManager } from '../sandbox/SandboxManager.ts'
import { normalizarRutaResuelta } from '../sandbox/rutasSandbox.ts'
import { dbLog } from '../db/dbLog.ts'
import { shellNativoPara, VAR_SHELL_AISLADA } from './shellNativo.ts'
import { mergeEnv, primerPath } from './entornoPty.ts'
import { cleanEnv, envDocker } from './entornoDocker.ts'
import { lanzarPty } from './adaptadores/pty.ts'
import type { SessionRecord } from './tiposSesion.ts'

/**
 * El workspacePath neutro de un proyecto en el contenedor, según el registro de montajes del
 * sandbox; acepta la ruta del host (normalizada como la guarda SandboxManager), el nombre o
 * el propio workspacePath.
 */
export async function resolverWorkspacePath(sandbox: SandboxManager, profile: Profile, project: string): Promise<string> {
  const mounts = await sandbox.listProjects(profile)
  const normalized = normalizarRutaResuelta(path.resolve(project)).toLowerCase()

  const byHost = mounts.find((m) => m.projectHostPath.toLowerCase() === normalized)
  if (byHost) return byHost.workspacePath

  const byWorkspace = mounts.find((m) => m.workspacePath === project || m.workspacePath.endsWith(`/${project}`))
  if (byWorkspace) return byWorkspace.workspacePath

  throw new Error(
    `El proyecto "${project}" no está montado en el perfil "${profile.id}". ` +
      'Llama a SandboxManager.addProject() antes de abrir una terminal.'
  )
}

/** Pty en modo contenedor: `docker exec -it` con cwd neutro dentro del contenedor. */
export function lanzarPtyDocker(record: SessionRecord): IPty {
  // Con `launch` (agente): `bash -lc <launch>`; sin él, el shell interactivo `bash -il`.
  const shellArgs = record.launch ? ['bash', '-lc', record.launch] : ['bash', '-il']
  return lanzarPty(
    'docker',
    [
      'exec',
      '-it',
      '-e',
      'TERM=xterm-256color', // docker exec no hereda TERM del host
      '-e',
      'GIT_PAGER=cat', // git no abre `less` en la terminal embebida; no toca el PAGER global
      ...envDocker(record.extraEnv),
      '-w',
      record.workspacePath,
      record.containerName,
      ...shellArgs
    ],
    { cols: record.cols, rows: record.rows, cwd: process.cwd(), env: cleanEnv() }
  )
}

/**
 * Pty en modo nativo: el shell del sistema con cwd en la ruta real del proyecto. Con
 * `launch` el shell corre ese comando (el agente es el proceso en primer plano); sin él, es
 * interactivo. El ejecutable del agente se resuelve por el PATH del sistema.
 */
export function lanzarPtyNativo(record: SessionRecord): IPty {
  // Qué shell y con qué argumentos lo decide `shellNativo.ts` (puro y con test).
  const { archivo, args } = shellNativoPara(
    record.launch,
    process.env.SHELL,
    undefined,
    process.env[VAR_SHELL_AISLADA] === '1'
  )
  // `extraEnv` se fusiona sobre el entorno heredado y el PATH se antepone, no se sustituye:
  // cómo (delimitador y caja de la clave) depende del sistema y lo decide `entornoPty.ts`.
  const env = mergeEnv(cleanEnv(), record.extraEnv)
  // Único punto donde el entorno pasa de intención a proceso; solo nombres, ningún secreto.
  dbLog(
    'pty',
    `host session=${record.id} extraEnvKeys=${Object.keys(record.extraEnv ?? {}).length} ` +
      `launch=${record.launch ? 'agente' : 'interactiva'} PATH[0]=${primerPath(env)}`
  )
  return lanzarPty(archivo, args, {
    cols: record.cols,
    rows: record.rows,
    cwd: record.workspacePath,
    env
  })
}
