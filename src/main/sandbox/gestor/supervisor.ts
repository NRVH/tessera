// =============================================================================
// Supervisor de los contenedores: escucha `docker events` de esta instancia desde que Tessera
// crea su primer contenedor. Uno que muere sin que Tessera lo parara deja de darse por vivo al
// momento (el siguiente `ensureContainer` lo recrea con pizarra limpia) y queda apuntado por qué.
// Si Docker se cae lo dice y sondea con esperas crecientes hasta que vuelve. No recrea nada: la
// recuperación es de las sesiones, que ya saben cómo.
// Decisiones: docs/decisiones/sandbox/supervisor-de-contenedores.md
// =============================================================================
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { EstadoDocker } from '../../../shared/sandbox-estado-ipc.ts'
import { argsEventos, causaDeMuerte, esperaReconexion, leerEvento, type EventoContenedor } from './eventosDocker.ts'
import { selloInstancia } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { DockerCheckResult } from './tipos.ts'

/** Un `docker events` que vive al menos esto se da por sano: su caída siguiente reintenta desde la primera espera. */
const VIDA_SANA_MS = 30_000

/** Un `die` es por memoria si Docker avisó del OOM de ese contenedor hace menos de esto. */
const VENTANA_OOM_MS = 10_000

/** Lo que el supervisor necesita de fuera; `lanzar` y `ahora` se sustituyen en las pruebas. */
export interface DepsSupervisor {
  checkDocker: () => Promise<DockerCheckResult>
  lanzar?: (args: string[]) => ChildProcess
  ahora?: () => number
  /** Espera antes de la sonda `n` con Docker sin escuchar (`esperaReconexion`). */
  espera?: (n: number) => number
  log?: (linea: string) => void
}

/** Vigila los contenedores de esta instancia y la disponibilidad de Docker. */
export class SupervisorContenedores {
  private readonly n: NucleoSandbox
  private readonly deps: DepsSupervisor
  private proceso: ChildProcess | null = null
  private activo = false
  private intentos = 0
  private inicioProceso = 0
  private temporizador: ReturnType<typeof setTimeout> | null = null
  /** Id de contenedor -> cuándo avisó Docker de su último OOM. */
  private readonly oomVistos = new Map<string, number>()

  constructor(n: NucleoSandbox, deps: DepsSupervisor) {
    this.n = n
    this.deps = deps
  }

  /** Empieza a escuchar; idempotente. Se llama con Docker respondiendo (recién creado un contenedor). */
  iniciar(): void {
    if (this.activo) return
    this.activo = true
    this.escuchar()
  }

  /** Deja de escuchar y de sondear (cierre de la app). */
  detener(): void {
    this.activo = false
    if (this.temporizador) clearTimeout(this.temporizador)
    this.temporizador = null
    const p = this.proceso
    this.proceso = null
    p?.kill()
  }

  /**
   * Un diagnóstico vio a Docker sin responder (quizá antes de que se cortara el `docker events`, o
   * con él colgado): se da por caído y se sondea hasta que vuelva, así «disponible» siempre llega.
   */
  dockerCaidoSegunDiagnostico(): void {
    this.activo = true
    this.marcarDocker('caido')
    if (this.temporizador === null) this.programarSonda()
  }

  /** Procesa una línea de `docker events` (público para las pruebas). */
  alLinea(linea: string): void {
    const ev = leerEvento(linea)
    if (ev) this.alEvento(ev)
  }

  private ahora(): number {
    return (this.deps.ahora ?? Date.now)()
  }

  private escuchar(): void {
    const p = (this.deps.lanzar ?? ((args: string[]) => spawn('docker', args, { stdio: ['ignore', 'pipe', 'ignore'] })))(
      argsEventos(selloInstancia())
    )
    this.proceso = p
    this.inicioProceso = this.ahora()
    if (p.stdout) createInterface({ input: p.stdout }).on('line', (l) => this.alLinea(l))
    p.once('error', () => this.alTerminar(p))
    p.once('exit', () => this.alTerminar(p))
  }

  /** El `docker events` terminó: con Docker caído o por otra cosa; lo decide la sonda. */
  private alTerminar(p: ChildProcess): void {
    if (this.proceso !== p) return
    this.proceso = null
    if (!this.activo) return
    if (this.ahora() - this.inicioProceso >= VIDA_SANA_MS) this.intentos = 0
    this.programarSonda()
  }

  private programarSonda(): void {
    const espera = (this.deps.espera ?? esperaReconexion)(this.intentos++)
    this.temporizador = setTimeout(() => void this.sondear(), espera)
    this.temporizador.unref?.()
  }

  private async sondear(): Promise<void> {
    this.temporizador = null
    if (!this.activo) return
    const r = await this.deps.checkDocker()
    if (!this.activo) return
    if (!r.ok) {
      this.marcarDocker('caido')
      this.programarSonda()
      return
    }
    this.marcarDocker('disponible')
    this.intentos = 0
    // Con un `docker events` que nunca se cortó (el caído lo vio un diagnóstico) no se lanza otro.
    if (this.proceso === null) this.escuchar()
  }

  private marcarDocker(estado: EstadoDocker): void {
    const caido = estado === 'caido'
    if (this.n.dockerCaido === caido) return
    this.n.dockerCaido = caido
    this.deps.log?.(`[sandbox] Docker ${caido ? 'no responde' : 'vuelve a responder'}`)
    this.n.onEstadoDocker?.(estado)
  }

  /** El perfil cuyo contenedor VIVO conocido es este Id, o null (uno viejo, ajeno o ya olvidado). */
  private perfilDe(id: string): string | null {
    for (const [profileId, h] of this.n.handles) if (h.containerId === id) return profileId
    return null
  }

  private alEvento(ev: EventoContenedor): void {
    if (ev.accion === 'oom') {
      this.oomVistos.set(ev.id, this.ahora())
      const deQuien = this.perfilDe(ev.id)
      if (deQuien !== null) this.n.oomRecientes.set(deQuien, this.ahora())
      return
    }
    // Solo cuenta un OOM de justo antes: uno viejo mató un proceso y el contenedor siguió.
    const oomEn = this.oomVistos.get(ev.id)
    this.oomVistos.delete(ev.id)
    const oom = oomEn !== undefined && this.ahora() - oomEn < VENTANA_OOM_MS
    const profileId = this.perfilDe(ev.id)
    if (profileId === null || this.n.paradasEsperadas.has(ev.nombre)) return
    const causa = causaDeMuerte(oom)
    // Deja de darse por vivo: así nadie hace un `exec` sobre él y `ensureContainer` lo recrea.
    this.n.handles.delete(profileId)
    this.n.capsCache.delete(profileId)
    this.n.muertes.set(profileId, { causa, en: this.ahora() })
    this.deps.log?.(`[sandbox] el contenedor de "${profileId}" murió (${ev.accion}, ${causa}, código ${ev.exitCode ?? '?'})`)
  }
}
