// =============================================================================
// Lanzamiento del pty de una sesión de terminal: `docker exec -it` dentro del contenedor
// del perfil (con el cwd neutro que resuelve el registro de montajes), o el shell nativo del
// sistema en la ruta real del proyecto, o un ejecutable propio sin shell delante (las sesiones
// SSH). Decide los argumentos y el entorno; el pty lo crea `adaptadores/pty.ts`. Lo usa `TerminalService`.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================
import type { IPty } from 'node-pty'
import os from 'node:os'
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

/** El entorno sin esas variables, sin distinguir mayúsculas (en Windows `Ssh_Askpass` es la misma). */
function sinVariables(env: Record<string, string>, nombres: readonly string[]): Record<string, string> {
  const fuera = new Set(nombres.map((n) => n.toUpperCase()))
  return Object.fromEntries(Object.entries(env).filter(([k]) => !fuera.has(k.toUpperCase())))
}

/**
 * Pty que lanza el ejecutable de la sesión DIRECTAMENTE, sin shell del sistema delante: así su
 * código de salida llega intacto y sus argumentos no pasan por el citado de ninguna shell. Corre
 * en el host con cwd en HOME y el entorno heredado menos `quitarEnv`, más `extraEnv`: lo propio
 * sobrevive aunque se llame igual que lo que no se hereda (el programa de contraseñas de Tessera).
 */
export function lanzarPtyDirecto(record: SessionRecord): IPty {
  const ejecutable = record.ejecutable
  if (!ejecutable) throw new Error(`La sesión "${record.id}" no tiene un ejecutable propio que lanzar.`)
  const env = mergeEnv(sinVariables(cleanEnv(), ejecutable.quitarEnv ?? []), record.extraEnv)
  // Solo el nombre del ejecutable y cuántos argumentos: la línea lleva el destino de la conexión.
  dbLog(
    'pty',
    `directa session=${record.id} archivo=${path.basename(ejecutable.archivo)} args=${ejecutable.args.length} ` +
      `extraEnvKeys=${Object.keys(record.extraEnv ?? {}).length}`
  )
  return lanzarPty(ejecutable.archivo, ejecutable.args, {
    cols: record.cols,
    rows: record.rows,
    cwd: os.homedir(),
    env
  })
}

/** El pty de una sesión según su tipo: un ejecutable propio, el shell nativo o `docker exec`. */
export function lanzarPtyDeSesion(record: SessionRecord): IPty {
  if (record.ejecutable) return lanzarPtyDirecto(record)
  return record.host ? lanzarPtyNativo(record) : lanzarPtyDocker(record)
}
