// =============================================================================
// Inicia Docker cuando una orden lo necesita y no responde: lanza el programa de la plataforma y espera a que el motor
// conteste. Una sola espera aunque lo pidan varios a la vez. Docker ocupa memoria: solo se arranca si algo va a usarlo.
// Las órdenes son fijas: nada de lo que llegue de un agente decide qué se ejecuta.
// Decisiones: docs/decisiones/sandbox/iniciar-docker-al-necesitarlo.md
// =============================================================================
import type { Plataforma } from '../../../shared/plataforma.ts'
import { txSandbox } from '../textos.ts'
import type { OrdenInicio } from '../adaptadores/lanzarDocker.ts'
import type { ResultadoComprobarDocker } from './tipos.ts'

export type { OrdenInicio }

/** Lo que se espera a que el motor conteste: en un equipo recién encendido, Docker Desktop tarda en levantar WSL. */
export const TOPE_ARRANQUE_MS = 180_000
const CADA_MS = 3000

/** Lo que se intenta, en orden: la orden oficial y, si esa versión de Docker no la tiene, el camino de cada plataforma. */
export function ordenesInicioDocker(plataforma: Plataforma, archivosPrograma?: string): OrdenInicio[] {
  const oficial: OrdenInicio = { programa: 'docker', args: ['desktop', 'start', '--detach'] }
  if (plataforma === 'windows') return [oficial, { programa: `${archivosPrograma ?? 'C:\\Program Files'}\\Docker\\Docker\\Docker Desktop.exe`, args: [] }]
  if (plataforma === 'mac') return [oficial, { programa: 'open', args: ['-a', 'Docker'] }]
  if (plataforma === 'linux') return [oficial, { programa: 'systemctl', args: ['--user', 'start', 'docker-desktop'] }]
  return []
}

export interface DependenciasArranqueDocker {
  comprobar: () => Promise<ResultadoComprobarDocker>
  /** Lanza una orden; `false` si no se pudo o terminó con error. */
  lanzar: (orden: OrdenInicio) => Promise<boolean>
  ordenes: () => OrdenInicio[]
  log: (linea: string) => void
  ahora?: () => number
  dormir?: (ms: number) => Promise<void>
}

export class ArranqueDocker {
  private enCurso: Promise<ResultadoComprobarDocker> | null = null
  private readonly deps: DependenciasArranqueDocker

  constructor(deps: DependenciasArranqueDocker) {
    this.deps = deps
  }

  /** Docker listo, o por qué no. `alEsperar` se llama solo si hay que iniciarlo, también si ya lo estaba iniciando otro. */
  async asegurar(alEsperar?: () => void): Promise<ResultadoComprobarDocker> {
    const r = await this.deps.comprobar()
    if (r.ok || !r.motorCaido) return r
    alEsperar?.()
    this.enCurso ??= this.iniciar(r).finally(() => {
      this.enCurso = null
    })
    return this.enCurso
  }

  private async iniciar(caido: ResultadoComprobarDocker): Promise<ResultadoComprobarDocker> {
    const { ahora = Date.now, dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = this.deps
    let lanzado = false
    for (const orden of this.deps.ordenes()) {
      lanzado = await this.deps.lanzar(orden).catch(() => false)
      this.deps.log(`[sandbox] iniciar Docker con ${orden.programa}: ${lanzado ? 'lanzado' : 'no disponible'}`)
      if (lanzado) break
    }
    if (!lanzado) return { ok: false, motorCaido: true, detalle: `${txSandbox().arranque.noSeLanzo}\n${caido.detalle}` }
    const limite = ahora() + TOPE_ARRANQUE_MS
    while (ahora() < limite) {
      await dormir(CADA_MS)
      const r = await this.deps.comprobar()
      if (r.ok || !r.motorCaido) {
        this.deps.log(`[sandbox] Docker ${r.ok ? 'ya responde' : 'responde con otro problema'}`)
        return r
      }
    }
    this.deps.log('[sandbox] Docker no respondió dentro del plazo')
    return { ok: false, motorCaido: true, detalle: `${txSandbox().arranque.noRespondio(TOPE_ARRANQUE_MS / 60_000)}\n${caido.detalle}` }
  }
}
