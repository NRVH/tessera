// =============================================================================
// Diagnóstico del sandbox: si el daemon responde, qué puede el contenedor VIVO de un perfil
// (sudo y extras horneados, leídos del contenedor y no de lo configurado), por qué murió una
// sesión y el `inspect` que distingue «no existe» de «no se sabe».
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import type { Perfil } from '../../perfiles/types.ts'
import { EXTRAS_VACIOS, extrasDesdeSello } from '../../../shared/sandboxExtras.ts'
import { detalleDockerRootless, esDockerRootless, pasosDocker } from '../../../shared/erroresDocker.ts'
import { usoDeStats } from '../../../shared/saturacionDocker.ts'
import { txSandbox } from '../textos.ts'
import { ejecutarDocker } from '../adaptadores/docker.ts'
import { nombreContenedorPara } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type {
  CapacidadesSandbox,
  CausaMuerteContenedor,
  ResultadoComprobarDocker,
  EstadoInspeccionDocker
} from './tipos.ts'

/** Sondas de Docker y del contenedor de un perfil. */
export class DiagnosticoSandbox {
  private readonly n: NucleoSandbox
  /** Diagnóstico en vuelo por perfil. */
  private readonly diagnosticos = new Map<string, Promise<CausaMuerteContenedor>>()

  constructor(n: NucleoSandbox) {
    this.n = n
  }

  /**
   * Qué puede hacer REALMENTE el contenedor vivo del perfil. Sale del contenedor (la
   * etiqueta que hereda de su imagen), no de los ajustes. Sin `candadoPerfil` y con timeouts
   * cortos; solo se cachea una respuesta concluyente.
   */
  async capacidades(perfil: Perfil): Promise<CapacidadesSandbox> {
    const descriptor = this.n.descriptores.get(perfil.id)
    if (!descriptor) return { puedeInstalar: false, extras: EXTRAS_VACIOS }
    const guardadoEnCache = this.n.cacheCapacidades.get(perfil.id)
    if (guardadoEnCache && guardadoEnCache.contenedorId === descriptor.contenedorId) return guardadoEnCache.capacidades

    const [sudo, sello] = await Promise.all([
      ejecutarDocker(
        ['exec', descriptor.nombreContenedor, 'sh', '-lc', 'command -v sudo >/dev/null 2>&1 && sudo -n true'],
        { topeMs: 10_000 }
      ),
      ejecutarDocker(
        ['inspect', descriptor.nombreContenedor, '--format', '{{index .Config.Labels "tessera.sandbox.extras"}}'],
        { topeMs: 10_000 }
      )
    ])

    const capacidades: CapacidadesSandbox = {
      puedeInstalar: sudo.status === 0,
      extras: sello.status === 0 ? extrasDesdeSello(sello.stdout.trim()) : EXTRAS_VACIOS
    }
    // `status === null` es un timeout o un fallo de transporte: «no se sabe» no es «no».
    if (sudo.status !== null && sello.status !== null) {
      this.n.cacheCapacidades.set(perfil.id, { contenedorId: descriptor.contenedorId, capacidades })
    }
    return capacidades
  }

  /** La memoria y los núcleos que tiene Docker; null en lo que no se pueda leer. */
  async recursos(): Promise<{ memoriaBytes: number | null; cpus: number | null }> {
    const r = await ejecutarDocker(['info', '--format', '{{.MemTotal}} {{.NCPU}}'], { topeMs: 15_000 })
    if (r.error || r.status !== 0) return { memoriaBytes: null, cpus: null }
    const [memoria, cpus] = r.stdout.trim().split(/\s+/).map((x) => Number.parseInt(x, 10))
    return { memoriaBytes: Number.isFinite(memoria) && memoria > 0 ? memoria : null, cpus: Number.isFinite(cpus) && cpus > 0 ? cpus : null }
  }

  /**
   * La memoria que usan ahora todos los contenedores de Docker, de Tessera o no: lo que satura es
   * la suma. null si Docker no responde o la salida no se entiende.
   */
  async usoMemoria(): Promise<number | null> {
    const r = await ejecutarDocker(['stats', '--no-stream', '--format', '{{.MemUsage}}'], { topeMs: 20_000 })
    if (r.error || r.status !== 0) return null
    return usoDeStats(r.stdout)
  }

  /** ¿Responde el daemon? Sonda caliente: timeout corto para que un daemon colgado falle rápido. */
  async comprobarDocker(): Promise<ResultadoComprobarDocker> {
    const info = await ejecutarDocker(
      ['info', '--format', '{{.ServerVersion}} {{.OSType}}/{{.Architecture}}|{{json .SecurityOptions}}'],
      { topeMs: 30_000 }
    )
    if (info.error || info.status !== 0) {
      // Los pasos salen de `pasosDocker` para que el detalle y el texto del main sean el MISMO.
      const detalle = [
        txSandbox().diagnostico.motor,
        (info.error && info.error.message) || info.stderr.trim() || info.stdout.trim(),
        '',
        txSandbox().diagnostico.queVerificar,
        ...pasosDocker()
      ].join('\n')
      return { ok: false, detalle, motorCaido: true }
    }
    const [version, opciones = ''] = info.stdout.trim().split('|')
    // Sin root, el gestor no puede montar los proyectos en caliente en el contenedor vivo.
    if (esDockerRootless(opciones)) return { ok: false, detalle: detalleDockerRootless() }
    return { ok: true, detalle: version }
  }

  /**
   * Clasifica POR QUÉ murió una sesión (ver `CausaMuerteContenedor`). Las sesiones de un perfil
   * mueren juntas con su contenedor: comparten UN diagnóstico en vuelo en vez de N sondas.
   */
  async diagnosticarPerfil(perfil: Perfil, codigoSalida: number | null = null): Promise<CausaMuerteContenedor> {
    let enVuelo = this.diagnosticos.get(perfil.id)
    if (!enVuelo) {
      enVuelo = this.diagnosticar(perfil).finally(() => this.diagnosticos.delete(perfil.id))
      this.diagnosticos.set(perfil.id, enVuelo)
    }
    const causa = await enVuelo
    if (causa === 'daemon-down') this.n.alVerDockerCaido?.()
    // El contenedor sigue, pero el kernel acaba de matar un proceso suyo por memoria. Es ESTA sesión
    // si murió por SIGKILL (137) o sin código; una que salió por sí misma no lo es.
    const muertaPorSigkill = codigoSalida === 137 || codigoSalida === null
    return causa === 'ok' && muertaPorSigkill && this.n.oomReciente(perfil.id, Date.now()) ? 'sin-memoria' : causa
  }

  private async diagnosticar(perfil: Perfil): Promise<CausaMuerteContenedor> {
    // Lo que ya vio el supervisor no necesita sonda: la causa exacta y sin esperar a un daemon colgado.
    const muerte = this.n.muerteReciente(perfil.id, Date.now())
    if (muerte === 'sin-memoria') return 'sin-memoria'
    if (this.n.dockerCaido) return 'daemon-down'
    const docker = await this.comprobarDocker()
    if (!docker.ok) return 'daemon-down'
    if (muerte === 'murio') return 'container-down'
    // Un `inspect` que no puede saberlo es un problema del daemon: 'container-down' haría
    // que la UI ofreciera recrear algo que podría seguir vivo.
    let st: EstadoInspeccionDocker | null
    try {
      st = await this.inspeccionarContenedor(nombreContenedorPara(perfil))
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
  async inspeccionarContenedor(nombre: string): Promise<EstadoInspeccionDocker | null> {
    const r = await ejecutarDocker(['inspect', nombre], { topeMs: 30_000 })
    if (r.status === 0) {
      try {
        const analizado = JSON.parse(r.stdout) as EstadoInspeccionDocker[]
        return analizado[0] ?? null
      } catch {
        throw new Error(txSandbox().diagnostico.salidaIlegible(nombre))
      }
    }
    // ÚNICO caso en que se puede afirmar que no existe (Docker no localiza este texto).
    if (/no such object|no such container/i.test(r.stderr)) return null
    const motivo = r.error?.message || r.stderr.trim() || txSandbox().diagnostico.dockerSalio(r.status)
    throw new Error(txSandbox().diagnostico.noSeConsulto(nombre, motivo))
  }
}
