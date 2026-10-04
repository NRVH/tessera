// =============================================================================
// Diagnóstico del sandbox: si el daemon responde, qué puede el contenedor VIVO de un perfil
// (sudo y extras horneados, leídos del contenedor y no de lo configurado), por qué murió una
// sesión y el `inspect` que distingue «no existe» de «no se sabe».
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import type { Profile } from '../../profiles/types.ts'
import { EXTRAS_VACIOS, extrasDesdeSello } from '../../../shared/sandboxExtras.ts'
import { pasosDocker } from '../../../shared/dockerErrors.ts'
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

  /** ¿Responde el daemon? Sonda caliente: timeout corto para que un daemon colgado falle rápido. */
  async checkDocker(): Promise<DockerCheckResult> {
    const info = await runDocker(['info', '--format', '{{.ServerVersion}} {{.OSType}}/{{.Architecture}}'], {
      timeoutMs: 30_000
    })
    if (info.error || info.status !== 0) {
      // Los pasos salen de `pasosDocker` para que el detalle y el texto del main sean el MISMO.
      const detalle = [
        'El daemon de Docker no responde.',
        (info.error && info.error.message) || info.stderr.trim() || info.stdout.trim(),
        '',
        'Que verificar:',
        ...pasosDocker()
      ].join('\n')
      return { ok: false, detalle }
    }
    return { ok: true, detalle: info.stdout.trim() }
  }

  /** Clasifica POR QUÉ murió una sesión (ver `ContainerDeathCause`). */
  async diagnoseProfile(profile: Profile): Promise<ContainerDeathCause> {
    const docker = await this.checkDocker()
    if (!docker.ok) return 'daemon-down'
    // Un `inspect` que no puede saberlo es un problema del daemon: 'container-down' haría
    // que la UI ofreciera recrear algo que podría seguir vivo.
    let st: DockerInspectState | null
    try {
      st = await this.inspectContainer(containerNameFor(profile))
    } catch {
      return 'daemon-down'
    }
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
        throw new Error(
          `docker inspect ${name} devolvió una salida que no se pudo interpretar; ` +
            'no se toca nada del perfil hasta poder consultarlo.'
        )
      }
    }
    // ÚNICO caso en que se puede afirmar que no existe (Docker no localiza este texto).
    if (/no such object|no such container/i.test(r.stderr)) return null
    const motivo = r.error?.message || r.stderr.trim() || `docker salió con ${r.status}`
    throw new Error(
      `No se pudo consultar el estado del contenedor "${name}" (${motivo}). ` +
        'No se recrea ni se desmonta nada: podría estar vivo.'
    )
  }
}
