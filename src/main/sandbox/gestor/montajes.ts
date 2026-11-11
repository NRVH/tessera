// =============================================================================
// Montajes en caliente del sandbox: el helper privilegiado efímero (`nsenter -t 1 -m` en
// `alpine`), las raíces `rshared` de cada perfil, los proyectos bajo `/workspace` y el buzón
// del puente de BD. Toda ruta que va al `sh -c` pasa por `citarSh`.
// Decisiones: docs/decisiones/sandbox/montajes-en-caliente.md
// =============================================================================
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Profile } from '../../profiles/types.ts'
import { PERFIL_CUENTAS_GLOBALES } from '../../../shared/agent-accounts-ipc.ts'
import { citarSh } from '../../../shared/citarShell.ts'
import { runDocker, type CommandResult } from '../adaptadores/docker.ts'
import {
  DB_BRIDGE_CONTAINER,
  PRIVILEGED_HELPER_IMAGE,
  WORKSPACE_ROOT,
  agentcfgRootFor,
  containerNameFor,
  errText,
  idBase,
  managedRootFor,
  normalizeHostPath,
  sanitizeWorkspaceName,
  toDaemonPath
} from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { ProjectMount } from './tipos.ts'
import { txSandbox } from '../textos.ts'

/**
 * El nombre bajo `/workspace` que no usa otro proyecto: el de la carpeta, o `<carpeta>-2`, `-3`… Los nombres
 * reservados (ruta del host en minúsculas -> nombre) cuentan como ocupados para los demás proyectos, y el
 * proyecto que tiene reserva recibe la suya. Con `estable`, la ruta decide el nombre: en un contenedor que comparten
 * varios perfiles, el orden en que llegan no puede cambiar la ruta de la que cuelgan las conversaciones de un proyecto.
 */
export function nombreLibre(
  mounts: ReadonlyMap<string, ProjectMount>,
  hostPathNormalizada: string,
  reservas: ReadonlyMap<string, string> = new Map(),
  estable = false
): string {
  const clave = hostPathNormalizada.toLowerCase()
  if (estable) return `${sanitizeWorkspaceName(path.basename(hostPathNormalizada))}-${createHash('sha256').update(clave).digest('hex').slice(0, 8)}`
  const propio = reservas.get(clave)
  if (propio !== undefined && !mounts.has(propio)) return propio
  const ocupado = (nombre: string): boolean => mounts.has(nombre) || [...reservas].some(([k, v]) => k !== clave && v === nombre)
  const base = sanitizeWorkspaceName(path.basename(hostPathNormalizada))
  let name = base
  for (let n = 2; ocupado(name); n++) name = `${base}-${n}`
  return name
}

/** El helper privilegiado, las raíces del perfil y los proyectos montados. */
export class MontajesSandbox {
  private readonly n: NucleoSandbox
  /** Por contenedor: nombre prometido a un proyecto aún sin montar (ruta del host en minúsculas -> nombre). */
  private readonly reservas = new Map<string, Map<string, string>>()

  constructor(n: NucleoSandbox) {
    this.n = n
  }

  /**
   * Única puerta al privilegio: un contenedor EFÍMERO `--privileged --pid=host` que entra
   * al namespace de montaje del daemon y ejecuta `mountOps` con `sh -c` (por argv, sin
   * shell del host de por medio). Muere al terminar (`--rm`).
   */
  runPrivileged(mountOps: string): Promise<CommandResult> {
    return runDocker([
      'run',
      '--rm',
      '--privileged',
      '--pid=host',
      PRIVILEGED_HELPER_IMAGE,
      'nsenter',
      '-t',
      '1',
      '-m',
      '--',
      'sh',
      '-c',
      mountOps
    ])
  }

  /** Prepara `root` como punto `rshared` en el namespace del daemon. Idempotente. */
  private async ensureRsharedRoot(root: string, descripcion: string): Promise<void> {
    const r = citarSh(root)
    const ops =
      `mkdir -p ${r} && ` +
      `( mountpoint -q ${r} || mount --bind ${r} ${r} ) && ` +
      `mount --make-rshared ${r}`
    const res = await this.runPrivileged(ops)
    if (res.status !== 0) {
      throw new Error(
        txSandbox().montajes.noSePrepararon(
          descripcion,
          root,
          res.stderr.trim() || res.stdout.trim() || txSandbox().montajes.nsenterSalio(res.status)
        )
      )
    }
  }

  /** Raíz `rshared` de los proyectos del perfil. */
  ensureManagedRoot(profile: Profile): Promise<void> {
    return this.ensureRsharedRoot(managedRootFor(profile), `la raíz gestionada del perfil "${profile.id}"`)
  }

  /** Raíz `rshared` de las credenciales del perfil, en un árbol separado. */
  ensureAgentcfgRoot(profile: Profile): Promise<void> {
    return this.ensureRsharedRoot(agentcfgRootFor(profile), `la raíz de credenciales del perfil "${profile.id}"`)
  }

  /** Mapa de proyectos montados del perfil (se crea vacío si no existe). */
  mountsFor(profileId: string): Map<string, ProjectMount> {
    let m = this.n.projectMounts.get(profileId)
    if (!m) {
      m = new Map<string, ProjectMount>()
      this.n.projectMounts.set(profileId, m)
    }
    return m
  }

  /** El montaje de ese proyecto en el perfil, comparando sin distinguir mayúsculas. */
  findMount(profileId: string, hostPath: string): ProjectMount | null {
    const normalized = normalizeHostPath(hostPath).toLowerCase()
    for (const pm of this.mountsFor(profileId).values()) {
      if (pm.projectHostPath.toLowerCase() === normalized) return pm
    }
    return null
  }

  /**
   * Dónde está montado el proyecto en ese contenedor o, si aún no lo está, dónde lo montará `addProject`:
   * el nombre queda reservado para ese proyecto hasta que se monte, así que otro con la misma carpeta no se
   * lo quita. Sin Docker: lo dice el registro de montajes.
   */
  reservarRuta(profileId: string, projectHostPath: string): string {
    const normalized = normalizeHostPath(projectHostPath)
    const ya = this.findMount(profileId, normalized)
    if (ya) return ya.workspacePath
    let delContenedor = this.reservas.get(profileId)
    if (!delContenedor) {
      delContenedor = new Map<string, string>()
      this.reservas.set(profileId, delContenedor)
    }
    const nombre = nombreLibre(this.mountsFor(profileId), normalized, delContenedor, idBase(profileId) === PERFIL_CUENTAS_GLOBALES)
    delContenedor.set(normalized.toLowerCase(), nombre)
    return `${WORKSPACE_ROOT}/${nombre}`
  }

  /**
   * Monta el proyecto EN CALIENTE en `/workspace/<nombre>` sin recrear el contenedor.
   * Idempotente; si dos proyectos distintos comparten basename, los siguientes reciben
   * `<base>-2`, `<base>-3`… Bajo el `profileLock`: el check-then-act es atómico.
   */
  async addProject(profile: Profile, projectHostPath: string): Promise<ProjectMount> {
    return this.n.profileLock.runExclusive(profile.id, async () => {
      const handle = this.n.handles.get(profile.id)
      if (!handle) {
        throw new Error(
          `No hay contenedor activo para el perfil "${profile.id}". Llama a ensureContainer() primero.`
        )
      }

      const normalized = normalizeHostPath(projectHostPath)

      const already = this.findMount(profile.id, normalized)
      if (already) return already

      const mounts = this.mountsFor(profile.id)
      const reservas = this.reservas.get(profile.id)
      const name = nombreLibre(mounts, normalized, reservas, idBase(profile.id) === PERFIL_CUENTAS_GLOBALES)

      const root = managedRootFor(profile)
      const daemonPath = toDaemonPath(normalized)
      const target = `${root}/${name}`
      const res = await this.runPrivileged(`mkdir -p ${citarSh(target)} && mount --bind ${citarSh(daemonPath)} ${citarSh(target)}`)
      if (res.status !== 0) {
        throw new Error(
          txSandbox().montajes.noSeMontoProyecto(
            normalized,
            profile.id,
            res.stderr.trim() || res.stdout.trim() || txSandbox().montajes.nsenterSalio(res.status)
          )
        )
      }

      const mount: ProjectMount = {
        profileId: profile.id,
        projectHostPath: normalized,
        workspacePath: `${WORKSPACE_ROOT}/${name}`
      }
      mounts.set(name, mount)
      reservas?.delete(normalized.toLowerCase())
      return mount
    })
  }

  /** Desmonta ese proyecto en caliente (umount + rmdir). Idempotente. */
  async removeProject(profile: Profile, projectHostPath: string): Promise<void> {
    return this.n.profileLock.runExclusive(profile.id, async () => {
      const mounts = this.mountsFor(profile.id)
      const normalized = normalizeHostPath(projectHostPath).toLowerCase()

      let foundName: string | null = null
      for (const [name, pm] of mounts) {
        if (pm.projectHostPath.toLowerCase() === normalized) {
          foundName = name
          break
        }
      }
      if (!foundName) return

      const target = `${managedRootFor(profile)}/${foundName}`
      const res = await this.runPrivileged(`umount ${citarSh(target)} && rmdir ${citarSh(target)}`)
      if (res.status !== 0) {
        throw new Error(
          txSandbox().montajes.noSeDesmontoProyecto(
            foundName,
            profile.id,
            res.stderr.trim() || res.stdout.trim() || txSandbox().montajes.nsenterSalio(res.status)
          )
        )
      }
      mounts.delete(foundName)
    })
  }

  /** Proyectos montados en el perfil. */
  async listProjects(profile: Profile): Promise<ProjectMount[]> {
    return [...this.mountsFor(profile.id).values()]
  }


  /**
   * Monta el buzón del puente de BD y enlaza `tdb`, `tssh` y `tctx` en el PATH del contenedor. Best-effort:
   * si falla, el perfil se queda sin bases pero el contenedor y el agente siguen.
   */
  async mountDbBridge(profile: Profile): Promise<void> {
    if (!this.n.prepararBuzonDb) return
    try {
      const hostDir = this.n.prepararBuzonDb(profile.id)
      const target = `${agentcfgRootFor(profile)}/dbbridge`
      const daemonPath = toDaemonPath(normalizeHostPath(hostDir))
      // Idempotente: nunca se apila un segundo bind sobre el mismo destino.
      const res = await this.runPrivileged(
        `mkdir -p ${citarSh(target)} && ` +
          `( mountpoint -q ${citarSh(target)} || ` +
          `mount --bind ${citarSh(daemonPath)} ${citarSh(target)} )`
      )
      if (res.status !== 0) {
        console.log(
          `[sandbox] puente de BD no montado en "${profile.id}": ` +
            (res.stderr.trim() || res.stdout.trim() || `nsenter salió con ${res.status}`)
        )
        return
      }
      // `tdb`, `tssh` y `tctx` (los programas que registran SSH y las reglas en el mismo buzón), en un solo `exec`.
      const enlace = await runDocker([
        'exec',
        '-u',
        'root',
        containerNameFor(profile),
        'sh',
        '-c',
        ['tdb', 'tssh', 'tctx'].map((p) => `ln -sf ${citarSh(`${DB_BRIDGE_CONTAINER}/${p}`)} /usr/local/bin/${p}`).join(' && ')
      ])
      if (enlace.status !== 0) {
        console.log(`[sandbox] no se pudo enlazar tdb, tssh y tctx en "${profile.id}": ${enlace.stderr.trim()}`)
      }
    } catch (err) {
      console.log(`[sandbox] puente de BD no disponible en "${profile.id}": ${errText(err)}`)
    }
  }
}
