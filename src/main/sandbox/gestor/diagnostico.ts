// =============================================================================
// Diagnóstico del sandbox: si el daemon responde, qué puede el contenedor VIVO de un perfil
// (sudo y extras horneados, leídos del contenedor y no de lo configurado), por qué murió una
// sesión y el `inspect` que distingue «no existe» de «no se sabe».
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import type { Profile } from '../../profiles/types.ts'
import { EXTRAS_VACIOS, extrasDesdeSello } from '../../../shared/sandboxExtras.ts'
import { detalleDockerRootless, esDockerRootless, pasosDocker } from '../../../shared/dockerErrors.ts'
import { usoDeStats } from '../../../shared/saturacionDocker.ts'
import { txSandbox } from '../textos.ts'
import { runDocker } from '../adaptadores/docker.ts'
import { containerNameFor } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type {
  CapacidadesSandbox,
  ContainerDeathCause,
  DockerCheckResult,
  DockerInspectState
} from './tipos.ts'

/** Sondas de Docker y del contenedor de un perfil. */
export class DiagnosticoSandbox {
  private readonly n: NucleoSandbox
  /** Diagnóstico en vuelo por perfil. */
  private readonly diagnosticos = new Map<string, Promise<ContainerDeathCause>>()

  constructor(n: NucleoSandbox) {
    this.n = n
  }

  /**
   * Qué puede hacer REALMENTE el contenedor vivo del perfil. Sale del contenedor (la
   * etiqueta que hereda de su imagen), no de los ajustes. Sin `profileLock` y con timeouts
   * cortos; solo se cachea una respuesta concluyente.
   */
  async capacidades(profile: Profile): Promise<CapacidadesSandbox> {
    const handle = this.n.handles.get(profile.id)
    if (!handle) return { puedeInstalar: false, extras: EXTRAS_VACIOS }
    const cached = this.n.capsCache.get(profile.id)
    if (cached && cached.containerId === handle.containerId) return cached.caps

    const [sudo, sello] = await Promise.all([
      runDocker(
        ['exec', handle.containerName, 'sh', '-lc', 'command -v sudo >/dev/null 2>&1 && sudo -n true'],
        { timeoutMs: 10_000 }
      ),
      runDocker(
        ['inspect', handle.containerName, '--format', '{{index .Config.Labels "tessera.sandbox.extras"}}'],
        { timeoutMs: 10_000 }
      )
    ])

    const caps: CapacidadesSandbox = {
      puedeInstalar: sudo.status === 0,
      extras: sello.status === 0 ? extrasDesdeSello(sello.stdout.trim()) : EXTRAS_VACIOS
    }
    // `status === null` es un timeout o un fallo de transporte: «no se sabe» no es «no».
    if (sudo.status !== null && sello.status !== null) {
      this.n.capsCache.set(profile.id, { containerId: handle.containerId, caps })
    }
    return caps
  }

  /** La memoria y los núcleos que tiene Docker; null en lo que no se pueda leer. */
  async recursos(): Promise<{ memoriaBytes: number | null; cpus: number | null }> {
    const r = await runDocker(['info', '--format', '{{.MemTotal}} {{.NCPU}}'], { timeoutMs: 15_000 })
    if (r.error || r.status !== 0) return { memoriaBytes: null, cpus: null }
    const [mem, cpus] = r.stdout.trim().split(/\s+/).map((x) => Number.parseInt(x, 10))
    return { memoriaBytes: Number.isFinite(mem) && mem > 0 ? mem : null, cpus: Number.isFinite(cpus) && cpus > 0 ? cpus : null }
  }

  /**
   * La memoria que usan ahora todos los contenedores de Docker, de Tessera o no: lo que satura es
   * la suma. null si Docker no responde o la salida no se entiende.
   */
  async usoMemoria(): Promise<number | null> {
    const r = await runDocker(['stats', '--no-stream', '--format', '{{.MemUsage}}'], { timeoutMs: 20_000 })
    if (r.error || r.status !== 0) return null
    return usoDeStats(r.stdout)
  }

  /** ¿Responde el daemon? Sonda caliente: timeout corto para que un daemon colgado falle rápido. */
  async checkDocker(): Promise<DockerCheckResult> {
    const info = await runDocker(
      ['info', '--format', '{{.ServerVersion}} {{.OSType}}/{{.Architecture}}|{{json .SecurityOptions}}'],
      { timeoutMs: 30_000 }
    )
    if (info.error || info.status !== 0) {
      // Los pasos salen de `pasosDocker` para que el detalle y el texto del main sean el MISMO.
      const detalle = [
        txSandbox().diagnostico.daemon,
        (info.error && info.error.message) || info.stderr.trim() || info.stdout.trim(),
        '',
        txSandbox().diagnostico.queVerificar,
        ...pasosDocker()
      ].join('\n')
      return { ok: false, detalle }
    }
    const [version, opciones = ''] = info.stdout.trim().split('|')
    // Sin root, el gestor no puede montar los proyectos en caliente en el contenedor vivo.
    if (esDockerRootless(opciones)) return { ok: false, detalle: detalleDockerRootless() }
    return { ok: true, detalle: version }
  }

  /**
   * Clasifica POR QUÉ murió una sesión (ver `ContainerDeathCause`). Las sesiones de un perfil
   * mueren juntas con su contenedor: comparten UN diagnóstico en vuelo en vez de N sondas.
   */
  async diagnoseProfile(profile: Profile, exitCode: number | null = null): Promise<ContainerDeathCause> {
    let enVuelo = this.diagnosticos.get(profile.id)
    if (!enVuelo) {
      enVuelo = this.diagnosticar(profile).finally(() => this.diagnosticos.delete(profile.id))
      this.diagnosticos.set(profile.id, enVuelo)
    }
    const causa = await enVuelo
    if (causa === 'daemon-down') this.n.alVerDockerCaido?.()
    // El contenedor sigue, pero el kernel acaba de matar un proceso suyo por memoria. Es ESTA sesión
    // si murió por SIGKILL (137) o sin código; una que salió por sí misma no lo es.
    const muertaPorKill = exitCode === 137 || exitCode === null
    return causa === 'ok' && muertaPorKill && this.n.oomReciente(profile.id, Date.now()) ? 'sin-memoria' : causa
  }

  private async diagnosticar(profile: Profile): Promise<ContainerDeathCause> {
    // Lo que ya vio el supervisor no necesita sonda: la causa exacta y sin esperar a un daemon colgado.
    const muerte = this.n.muerteReciente(profile.id, Date.now())
    if (muerte === 'sin-memoria') return 'sin-memoria'
    if (this.n.dockerCaido) return 'daemon-down'
    const docker = await this.checkDocker()
    if (!docker.ok) return 'daemon-down'
    if (muerte === 'murio') return 'container-down'
    // Un `inspect` que no puede saberlo es un problema del daemon: 'container-down' haría
    // que la UI ofreciera recrear algo que podría seguir vivo.
    let st: DockerInspectState | null
    try {
      st = await this.inspectContainer(containerNameFor(profile))
    } catch {
      return 'daemon-down'
    }
    if (st && !st.State.Running && st.State.OOMKilled === true) return 'sin-memoria'
    if (!st || !st.State.Running) return 'container-down'
    return 'ok'
  }

  /**
   * Estado de un contenedor, o `null` si CONSTA que no existe. Lanza si no se puede saber
   * (timeout, transporte, salida ilegible): `null` hace que el llamador recree y desmonte.
   */
  async inspectContainer(name: string): Promise<DockerInspectState | null> {
    const r = await runDocker(['inspect', name], { timeoutMs: 30_000 })
    if (r.status === 0) {
      try {
        const parsed = JSON.parse(r.stdout) as DockerInspectState[]
        return parsed[0] ?? null
      } catch {
        throw new Error(txSandbox().diagnostico.salidaIlegible(name))
      }
    }
    // ÚNICO caso en que se puede afirmar que no existe (Docker no localiza este texto).
    if (/no such object|no such container/i.test(r.stderr)) return null
    const motivo = r.error?.message || r.stderr.trim() || txSandbox().diagnostico.dockerSalio(r.status)
    throw new Error(txSandbox().diagnostico.noSeConsulto(name, motivo))
  }
}
