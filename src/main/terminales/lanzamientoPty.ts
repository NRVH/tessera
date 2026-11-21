// =============================================================================
// Lanzamiento del pty de una sesión de terminal: `docker exec -it` dentro del contenedor
// del perfil (con el cwd neutro que resuelve el registro de montajes), o el shell nativo del
// sistema en la ruta real del proyecto, o un ejecutable propio sin shell delante (las sesiones
// SSH). Decide los argumentos y el entorno; el pty lo crea `adaptadores/pty.ts`. Lo usa `ServicioTerminal`.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================
import type { IPty } from 'node-pty'
import os from 'node:os'
import path from 'node:path'
import type { Perfil } from '../perfiles/types.ts'
import type { GestorSandbox } from '../sandbox/GestorSandbox.ts'
import { normalizarRutaResuelta } from '../sandbox/rutasSandbox.ts'
import { registroBd } from '../db/registroBd.ts'
import { shellNativoPara, VAR_SHELL_AISLADA } from './shellNativo.ts'
import { ASIGNACIONES_TERMINAL_CONTENEDOR, ENTORNO_COLOR, fusionarEntorno, primerPath } from './entornoPty.ts'
import { limpiarEntorno, envDocker } from './entornoDocker.ts'
import { lanzarPty } from './adaptadores/pty.ts'
import type { RegistroSesion } from './tiposSesion.ts'
import { argumentosShellContenedor } from '../agentes/gitEnContenedor.ts'

/**
 * El rutaWorkspace neutro de un proyecto en el contenedor, según el registro de montajes del
 * sandbox; acepta la ruta del host (normalizada como la guarda GestorSandbox), el nombre o
 * el propio rutaWorkspace.
 */
export async function resolverRutaWorkspace(sandbox: GestorSandbox, perfil: Perfil, proyecto: string): Promise<string> {
  const montajes = await sandbox.listarProyectos(perfil)
  const normalizado = normalizarRutaResuelta(path.resolve(proyecto)).toLowerCase()

  const porHost = montajes.find((m) => m.projectHostPath.toLowerCase() === normalizado)
  if (porHost) return porHost.rutaWorkspace

  const porWorkspace = montajes.find((m) => m.rutaWorkspace === proyecto || m.rutaWorkspace.endsWith(`/${proyecto}`))
  if (porWorkspace) return porWorkspace.rutaWorkspace

  throw new Error(
    `El proyecto "${proyecto}" no está montado en el perfil "${perfil.id}". ` +
      'Llama a GestorSandbox.addProject() antes de abrir una terminal.'
  )
}

/** Pty en modo contenedor: `docker exec -it` con cwd neutro dentro del contenedor. */
export function lanzarPtyDocker(registro: RegistroSesion): IPty {
  // Con `comandoLanzamiento` (agente): `bash -lc <comandoLanzamiento>`; sin él, el shell interactivo `bash -il`.
  const shellArgs = argumentosShellContenedor(registro.comandoLanzamiento)
  return lanzarPty(
    'docker',
    [
      'exec',
      '-it',
      ...ASIGNACIONES_TERMINAL_CONTENEDOR.flatMap((asignacion) => ['-e', asignacion]), // docker exec no hereda el entorno del host
      '-e',
      'GIT_PAGER=cat', // git no abre `less` en la terminal embebida; no toca el PAGER global
      ...envDocker(registro.extraEnv),
      '-w',
      registro.rutaWorkspace,
      registro.nombreContenedor,
      ...shellArgs
    ],
    { cols: registro.cols, rows: registro.rows, cwd: process.cwd(), env: limpiarEntorno() }
  )
}

/**
 * Pty en modo nativo: el shell del sistema con cwd en la ruta real del proyecto. Con
 * `comandoLanzamiento` el shell corre ese comando (el agente es el proceso en primer plano); sin él, es
 * interactivo. El ejecutable del agente se resuelve por el PATH del sistema.
 */
export function lanzarPtyNativo(registro: RegistroSesion): IPty {
  // Qué shell y con qué argumentos lo decide `shellNativo.ts` (puro y con test).
  const { archivo, args } = shellNativoPara(
    registro.comandoLanzamiento,
    process.env.SHELL,
    undefined,
    process.env[VAR_SHELL_AISLADA] === '1'
  )
  // `extraEnv` se fusiona sobre el entorno heredado y el PATH se antepone, no se sustituye:
  // cómo (delimitador y caja de la clave) depende del sistema y lo decide `entornoPty.ts`.
  const env = fusionarEntorno(limpiarEntorno(), { ...ENTORNO_COLOR, ...registro.extraEnv })
  // Único punto donde el entorno pasa de intención a proceso; solo nombres, ningún secreto.
  registroBd(
    'pty',
    `host session=${registro.id} extraEnvKeys=${Object.keys(registro.extraEnv ?? {}).length} ` +
      `launch=${registro.comandoLanzamiento ? 'agente' : 'interactiva'} PATH[0]=${primerPath(env)}`
  )
  return lanzarPty(archivo, args, {
    cols: registro.cols,
    rows: registro.rows,
    cwd: registro.rutaWorkspace,
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
export function lanzarPtyDirecto(registro: RegistroSesion): IPty {
  const ejecutable = registro.ejecutable
  if (!ejecutable) throw new Error(`La sesión "${registro.id}" no tiene un ejecutable propio que lanzar.`)
  const env = fusionarEntorno(sinVariables(limpiarEntorno(), ejecutable.quitarEnv ?? []), registro.extraEnv)
  // Solo el nombre del ejecutable y cuántos argumentos: la línea lleva el destino de la conexión.
  registroBd(
    'pty',
    `directa session=${registro.id} archivo=${path.basename(ejecutable.archivo)} args=${ejecutable.args.length} ` +
      `extraEnvKeys=${Object.keys(registro.extraEnv ?? {}).length}`
  )
  return lanzarPty(ejecutable.archivo, ejecutable.args, {
    cols: registro.cols,
    rows: registro.rows,
    cwd: os.homedir(),
    env
  })
}

/** El pty de una sesión según su tipo: un ejecutable propio, el shell nativo o `docker exec`. */
export function lanzarPtyDeSesion(registro: RegistroSesion): IPty {
  if (registro.ejecutable) return lanzarPtyDirecto(registro)
  return registro.host ? lanzarPtyNativo(registro) : lanzarPtyDocker(registro)
}
