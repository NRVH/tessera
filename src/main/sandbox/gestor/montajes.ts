// =============================================================================
// Montajes en caliente del sandbox: el helper privilegiado efímero (`nsenter -t 1 -m` en
// `alpine`), las raíces `rshared` de cada perfil, los proyectos bajo `/workspace` y el buzón
// del puente de BD. Toda ruta que va al `sh -c` pasa por `citarSh`.
// Decisiones: docs/decisiones/sandbox/montajes-en-caliente.md
// =============================================================================
import path from 'node:path'
import type { Profile } from '../../profiles/types.ts'
import { citarSh } from '../../../shared/citarShell.ts'
import { SSH_RO_BASE } from '../sshSetup.ts'
import { runDocker, type CommandResult } from '../adaptadores/docker.ts'
import {
  DB_BRIDGE_CONTAINER,
  PRIVILEGED_HELPER_IMAGE,
  WORKSPACE_ROOT,
  agentcfgRootFor,
  containerNameFor,
  errText,
  managedRootFor,
  normalizeHostPath,
  sanitizeWorkspaceName,
  toDaemonPath
} from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { ProjectMount } from './tipos.ts'

/** El helper privilegiado, las raíces del perfil y los proyectos montados. */
export class MontajesSandbox {
  private readonly n: NucleoSandbox

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
        `No se pudo preparar ${descripcion} (${root}): ` +
          (res.stderr.trim() || res.stdout.trim() || `nsenter salió con ${res.status}`)
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
      const base = sanitizeWorkspaceName(path.basename(normalized))
      let name = base
      for (let n = 2; mounts.has(name); n++) {
        name = `${base}-${n}`
      }

      const root = managedRootFor(profile)
      const daemonPath = toDaemonPath(normalized)
      const target = `${root}/${name}`
      const res = await this.runPrivileged(`mkdir -p ${citarSh(target)} && mount --bind ${citarSh(daemonPath)} ${citarSh(target)}`)
      if (res.status !== 0) {
        throw new Error(
          `No se pudo montar el proyecto "${normalized}" en el perfil "${profile.id}": ` +
            (res.stderr.trim() || res.stdout.trim() || `nsenter salió con ${res.status}`)
        )
      }

      const mount: ProjectMount = {
        profileId: profile.id,
        projectHostPath: normalized,
        workspacePath: `${WORKSPACE_ROOT}/${name}`
      }
      mounts.set(name, mount)
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
          `No se pudo desmontar el proyecto "${foundName}" del perfil "${profile.id}": ` +
            (res.stderr.trim() || res.stdout.trim() || `nsenter salió con ${res.status}`)
        )
      }
      mounts.delete(foundName)
    })
  }

  /** Proyectos montados en el perfil. */
  async listProjects(profile: Profile): Promise<ProjectMount[]> {
    return [...this.mountsFor(profile.id).values()]
  }

  /** Argumentos `--mount` READ-ONLY de las carpetas ssh globales (o `[]` si no hay). */
  globalSshMountArgs(): string[] {
    if (!this.n.sshSetup) return []
    const args: string[] = []
    for (const m of this.n.sshSetup.mounts) {
      args.push(
        '--mount',
        `type=bind,source=${toDaemonPath(m.hostDir)},target=${SSH_RO_BASE}/${m.basename},readonly`
      )
    }
    return args
  }

  /**
   * Monta el buzón del puente de BD y enlaza `tdb` en el PATH del contenedor. Best-effort:
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
      const enlace = await runDocker([
        'exec',
        '-u',
        'root',
        containerNameFor(profile),
        'ln',
        '-sf',
        `${DB_BRIDGE_CONTAINER}/tdb`,
        '/usr/local/bin/tdb'
      ])
      if (enlace.status !== 0) {
        console.log(`[sandbox] no se pudo enlazar tdb en "${profile.id}": ${enlace.stderr.trim()}`)
      }
    } catch (err) {
      console.log(`[sandbox] puente de BD no disponible en "${profile.id}": ${errText(err)}`)
    }
  }
}
