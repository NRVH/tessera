// =============================================================================
// Muestrea cada pocos segundos la memoria disponible del equipo y guarda si hay poca: la ronda de
// hibernación es síncrona y lee el último valor sin medir. Windows y Linux, `os.freemem()` (la
// disponible, con la caché que se puede soltar); macOS, `kern.memorystatus_level` (ver
// `presionMemoria.ts`). Lo compone `agents/componer.ts`.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================
import { execFile } from 'node:child_process'
import os from 'node:os'
import type { Plataforma } from '../../shared/plataforma'
import { disponibleDesdeNivel, hayPocaMemoria } from './presionMemoria'

/** Cada cuánto se mide: la ronda más corta de la hibernación es de un minuto. */
const CADA_MS = 15_000
const TOPE_SYSCTL_MS = 2_000

export interface OpcionesVigilanteMemoria {
  plataforma: Plataforma
  log: (msg: string) => void
  /** Solo pruebas: fija la respuesta sin medir. */
  forzada?: boolean
}

export class VigilanteMemoria {
  private poca = false
  private temporizador: ReturnType<typeof setInterval> | null = null

  constructor(private readonly o: OpcionesVigilanteMemoria) {}

  /** Mide ya y después cada `CADA_MS`; no retiene el proceso al salir. */
  iniciar(): void {
    if (this.o.forzada !== undefined) {
      this.poca = this.o.forzada
      return
    }
    this.medir()
    this.temporizador = setInterval(() => this.medir(), CADA_MS)
    this.temporizador.unref()
  }

  parar(): void {
    if (this.temporizador !== null) clearInterval(this.temporizador)
    this.temporizador = null
  }

  /** El último veredicto. */
  pocaMemoria(): boolean {
    return this.poca
  }

  private medir(): void {
    const total = os.totalmem()
    if (this.o.plataforma !== 'mac') {
      this.fijar(os.freemem(), total)
      return
    }
    execFile('sysctl', ['-n', 'kern.memorystatus_level'], { timeout: TOPE_SYSCTL_MS }, (err, salida) => {
      const disponible = err ? null : disponibleDesdeNivel(String(salida), total)
      if (disponible !== null) this.fijar(disponible, total)
    })
  }

  private fijar(disponible: number, total: number): void {
    const ahora = hayPocaMemoria(disponible, total, this.poca)
    if (ahora !== this.poca) {
      const mb = (b: number): number => Math.round(b / 1048576)
      this.o.log(`memoria: ${ahora ? 'poca' : 'suficiente'} (${mb(disponible)} de ${mb(total)} MB disponibles)`)
    }
    this.poca = ahora
  }
}
