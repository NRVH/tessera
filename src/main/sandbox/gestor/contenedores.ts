// =============================================================================
// Ciclo de vida del contenedor de cada perfil: crearlo o reusarlo (coalescido y bajo el
// `profileLock`), ejecutar dentro, escribirle archivos, pararlo y llevar la cuenta
// INFORMATIVA de sesiones. Depende del resto de operaciones de `gestor/`.
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import type { Profile } from '../../profiles/types.ts'
import { esContenedorDeTessera, mensajeContenedorAjeno } from '../contenedoresPropios.ts'
import { escribirPorStdinDocker, runDocker, type CommandResult } from '../adaptadores/docker.ts'
import {
  AGENT_CONFIG_ROOT,
  KEEPALIVE_CMD,
  NEUTRAL_USER,
  SANDBOX_IMAGE,
  WORKSPACE_ROOT,
  agentcfgRootFor,
  containerNameFor,
  managedRootFor,
  sshMountArgs
} from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { DiagnosticoSandbox } from './diagnostico.ts'
import type { ImagenSandbox } from './imagen.ts'
import type { MontajesSandbox } from './montajes.ts'
import { isPortConflictError, type RedSandbox } from './red.ts'
import type { BarridoSandbox } from './barrido.ts'
import type { ContainerHandle, ExecOptions, ExecResult } from './tipos.ts'

/** Puerto del callback de login OAuth de Codex (publicado solo en `bridge`). */
const CODEX_CALLBACK_PORT = 1455

/** Crear, reusar, usar y parar el contenedor de un perfil. */
export class ContenedoresSandbox {
  private readonly n: NucleoSandbox
  private readonly diag: DiagnosticoSandbox
  private readonly imagen: ImagenSandbox
  private readonly montajes: MontajesSandbox
  private readonly red: RedSandbox
  private readonly barrido: BarridoSandbox

  constructor(
    n: NucleoSandbox,
    ops: {
      diag: DiagnosticoSandbox
      imagen: ImagenSandbox
      montajes: MontajesSandbox
      red: RedSandbox
      barrido: BarridoSandbox
    }
  ) {
    this.n = n
    this.diag = ops.diag
    this.imagen = ops.imagen
    this.montajes = ops.montajes
    this.red = ops.red
    this.barrido = ops.barrido
  }

  /**
   * Crea (o reutiliza/reinicia) el contenedor del perfil con SU raíz como `/workspace`
   * (`rshared`); los proyectos entran después en caliente. Coalesce las llamadas en vuelo
   * del mismo perfil y serializa contra paradas y montajes con el `profileLock`.
   */
  async ensureContainer(profile: Profile): Promise<ContainerHandle> {
    const inFlight = this.n.ensureInFlight.get(profile.id)
    if (inFlight) return inFlight
    const run = this.n.profileLock
      .runExclusive(profile.id, () => this.createOrReuseContainer(profile))
      .finally(() => {
        this.n.ensureInFlight.delete(profile.id)
      })
    this.n.ensureInFlight.set(profile.id, run)
    return run
  }

  /** Cuerpo de `ensureContainer`, ya bajo el candado del perfil. */
  private async createOrReuseContainer(profile: Profile): Promise<ContainerHandle> {
    // Nunca sobre binds residuales de un cierre sucio: se espera el barrido de arranque.
    if (this.n.startupSweep) await this.n.startupSweep

    const containerName = containerNameFor(profile)
    const existing = await this.diag.inspectContainer(containerName)
    const known = this.n.handles.get(profile.id)

    // Camino rápido: el MISMO contenedor vivo (mismo Id); sus montajes siguen valiendo.
    if (existing && existing.State.Running && known && known.containerId === existing.Id) {
      return known
    }

    // PIZARRA LIMPIA: el contenedor no es el vivo que conocíamos, así que sus binds se
    // perdieron aunque los mapas los den por montados. Solo se borra si es nuestro.
    if (existing) {
      if (!esContenedorDeTessera(existing, SANDBOX_IMAGE)) throw new Error(mensajeContenedorAjeno(containerName))
      await runDocker(['rm', '-f', containerName]) // mata el contenedor parado/zombie
    }
    await this.barrido.resetProfileMounts(profile) // desmonta binds residuales + limpia mapas
    this.n.handles.delete(profile.id)

    // Las raíces rshared van ANTES del `docker run` para que los montajes en caliente se propaguen.
    await this.montajes.ensureManagedRoot(profile)
    await this.montajes.ensureAgentcfgRoot(profile)
    await this.imagen.ensureImage()

    const redHost = profile.sandbox?.redHost === true
    const run = await this.crearContenedor(profile, containerName, redHost)

    // `docker run -d` imprime el Id: distingue en el próximo `ensureContainer` si sigue siendo ESTE.
    const containerId = run.stdout.trim()
    const handle: ContainerHandle = {
      profileId: profile.id,
      containerName,
      containerId,
      workspacePath: WORKSPACE_ROOT,
      redHostAplicado: redHost
    }
    this.n.handles.set(profile.id, handle)
    // En modo anfitrión el puente no puede ayudar: lo que decide ahí es la sonda.
    if (!redHost) this.red.startCodexCallbackForwarder(containerName)
    if (redHost) void this.red.avisarSiLaRedNoLlega(profile)
    // El puente de BD se monta aquí, el embudo de apertura, recarga y despertar.
    await this.montajes.mountDbBridge(profile)
    return handle
  }

  /**
   * `docker run` del contenedor. Si el 1455 ya lo tiene otro contenedor, se avisa, se
   * limpia el contenedor a medias y se reintenta SIN publicarlo; otro fallo se propaga.
   */
  private async crearContenedor(profile: Profile, containerName: string, redHost: boolean): Promise<CommandResult> {
    let run = await runDocker(this.argsDockerRun(profile, containerName, redHost, true))
    if (!redHost && run.status !== 0 && isPortConflictError(run.stderr)) {
      console.log(
        `[sandbox] puerto ${CODEX_CALLBACK_PORT} ocupado por otro contenedor; ` +
          `creo "${containerName}" SIN publicarlo (login de navegador de Codex no disponible en este perfil hasta liberar el puerto).`
      )
      this.n.avisoRed?.({
        profileId: profile.id,
        motivo: 'choque-1455',
        titulo: 'El login de Codex no está disponible en este perfil',
        detalle:
          `Otro perfil ya tiene tomado el puerto ${CODEX_CALLBACK_PORT}, que es el que Codex usa para terminar el ` +
          'login por navegador. Todo lo demás funciona. Para poder iniciar sesión aquí, hiberna el otro perfil y vuelve a entrar a éste.'
      })
      await runDocker(['rm', '-f', containerName]) // limpia el contenedor "Created" que dejó el fallo de bind
      run = await runDocker(this.argsDockerRun(profile, containerName, redHost, false))
    }
    if (run.status !== 0) {
      throw new Error(`No se pudo crear el contenedor "${containerName}": ${run.stderr.trim()}`)
    }
    return run
  }

  /** Argumentos del `docker run` del contenedor del perfil (red, 1455, montajes). */
  private argsDockerRun(profile: Profile, containerName: string, redHost: boolean, includePort: boolean): string[] {
    return [
      'run',
      '-d',
      '--name',
      containerName,
      // `--network host` no admite `--hostname` ni `-p`; en bridge, hostname neutro.
      ...(redHost ? ['--network', 'host'] : ['--hostname', `${profile.id}-sandbox`]),
      '--user',
      NEUTRAL_USER,
      // PID 1 que cosecha huérfanos (un navegador colgado no deja zombis).
      '--init',
      // Los 64 MiB de /dev/shm por defecto tumban un navegador que graba vídeo.
      ...(this.n.extras.depsNavegador ? ['--shm-size', '1g'] : []),
      // El 1455 solo en el loopback del host y solo en bridge (con host, Docker descarta `-p`).
      ...(!redHost && includePort
        ? ['-p', `127.0.0.1:${CODEX_CALLBACK_PORT}:${CODEX_CALLBACK_PORT}`]
        : []),
      '--mount',
      `type=bind,source=${managedRootFor(profile)},target=${WORKSPACE_ROOT},bind-propagation=rshared`,
      '--mount',
      `type=bind,source=${agentcfgRootFor(profile)},target=${AGENT_CONFIG_ROOT},bind-propagation=rshared`,
      // `.ssh` del perfil (READ-ONLY, solo la suya) y las carpetas ssh globales.
      ...sshMountArgs(profile),
      ...this.montajes.globalSshMountArgs(),
      '-w',
      WORKSPACE_ROOT,
      SANDBOX_IMAGE,
      ...KEEPALIVE_CMD
    ]
  }

  /** Registra una sesión viva del perfil; `sessionKey` va con su origen (`term:`/`agent:`). */
  retainSession(profileId: string, sessionKey: string): void {
    let set = this.n.liveSessions.get(profileId)
    if (!set) {
      set = new Set<string>()
      this.n.liveSessions.set(profileId, set)
    }
    set.add(sessionKey)
  }

  /** Da de baja una sesión; `true` si era la última. NUNCA detiene el contenedor. */
  releaseSession(profile: Profile, sessionKey: string): boolean {
    const set = this.n.liveSessions.get(profile.id)
    if (!set || !set.has(sessionKey)) return false
    set.delete(sessionKey)
    const wasLast = set.size === 0
    if (wasLast) this.n.liveSessions.delete(profile.id)
    return wasLast
  }

  /** Nº de sesiones vivas registradas para un perfil (0 si ninguna). */
  liveSessionCount(profileId: string): number {
    return this.n.liveSessions.get(profileId)?.size ?? 0
  }

  /** Ejecuta en el contenedor; cwd: `opts.cwd`, o el del proyecto, o `/workspace`. */
  async exec(profile: Profile, command: string, opts?: ExecOptions): Promise<ExecResult> {
    const handle = this.n.handles.get(profile.id)
    if (!handle) {
      throw new Error(
        `No hay contenedor activo para el perfil "${profile.id}". Llama a ensureContainer() primero.`
      )
    }

    let cwd = opts?.cwd
    if (!cwd && opts?.project) {
      const pm = this.montajes.findMount(profile.id, opts.project)
      if (!pm) {
        throw new Error(
          `El proyecto "${opts.project}" no está montado en el perfil "${profile.id}". ` +
            'Llama a addProject() primero.'
        )
      }
      cwd = pm.workspacePath
    }
    cwd ??= WORKSPACE_ROOT

    const args = ['exec', '-w', cwd, handle.containerName, 'bash', '-lc', command]
    const r = await runDocker(args)
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.status ?? -1
    }
  }

  /**
   * Vuelca los bytes de un archivo en `/tmp` del contenedor, por stdin y como el usuario
   * neutro, y devuelve su ruta EN EL CONTENEDOR (el CLI no puede leer rutas del host).
   */
  async writeFileToContainer(
    profile: Profile,
    bytes: Buffer,
    filename: string,
    timestamp: number
  ): Promise<string> {
    const handle = this.n.handles.get(profile.id)
    if (!handle) {
      throw new Error(
        `No hay contenedor activo para el perfil "${profile.id}". Llama a ensureContainer() primero.`
      )
    }
    // Nombre saneado: sin separadores ni caracteres que rompan el `sh -c` o escapen de /tmp.
    const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(-120) || 'archivo'
    const containerPath = `/tmp/tessera-${timestamp}-${safe}`
    // Poda best-effort de clips de más de 12 h en un contenedor de vida larga.
    void runDocker([
      'exec',
      '-d',
      handle.containerName,
      'sh',
      '-c',
      "find /tmp -maxdepth 1 -name 'tessera-*' -mmin +720 -delete 2>/dev/null || true"
    ])
    await escribirPorStdinDocker(
      ['exec', '-i', '-u', NEUTRAL_USER, handle.containerName, 'sh', '-c', `cat > "${containerPath}"`],
      bytes
    )
    return containerPath
  }

  /**
   * Detiene y elimina el contenedor del perfil y limpia SUS raíces; nunca la raíz común ni
   * las de otros perfiles. Un contenedor con ese nombre que no es nuestro no se toca.
   */
  async stopContainer(profile: Profile): Promise<void> {
    return this.n.profileLock.runExclusive(profile.id, async () => {
      const containerName = containerNameFor(profile)

      const actual = await this.diag.inspectContainer(containerName)
      if (actual && !esContenedorDeTessera(actual, SANDBOX_IMAGE)) {
        throw new Error(mensajeContenedorAjeno(containerName))
      }

      const stop = await runDocker(['stop', containerName])
      if (stop.status !== 0 && !/no such container/i.test(stop.stderr)) {
        // Sin olvidar el buzón: si el `stop` falló, el contenedor puede seguir vivo.
        throw new Error(`No se pudo detener el contenedor "${containerName}": ${stop.stderr.trim()}`)
      }

      // Parado: se olvida el buzón AQUÍ, antes de lo que puede lanzar, o el puente lo
      // sondearía para siempre. Idempotente; `mountDbBridge` lo da de alta al despertar.
      this.n.olvidarBuzonDb?.(profile.id)

      const rm = await runDocker(['rm', containerName])
      if (rm.status !== 0 && !/no such container/i.test(rm.stderr)) {
        throw new Error(`No se pudo eliminar el contenedor "${containerName}": ${rm.stderr.trim()}`)
      }

      await this.barrido.cleanProfileRoots(profile)

      this.n.handles.delete(profile.id)
      this.n.projectMounts.delete(profile.id)
      this.n.agentConfigMounts.delete(profile.id)
      this.n.liveSessions.delete(profile.id)
    })
  }
}
