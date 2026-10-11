// =============================================================================
// Las peticiones de la ventana al main (`ipcMain.handle`), para el registro de salud: cuáles
// estaban en curso durante un bloqueo y cuáles fueron lentas. Solo el canal y el tiempo, nunca
// lo que llevan. Puro: quien envuelve `ipcMain.handle` es `instrumentarIpc` (`ipc.ts`).
// Decisiones: docs/decisiones/app/registro-de-salud.md
// =============================================================================

import { IPC_LENTO_MS, type LlamadaSalud } from '../../shared/salud.ts'

/** Cuántas peticiones terminadas se guardan para mirar atrás (un anillo: lo viejo se descarta). */
export const TOPE_TERMINADAS = 300
/** Cuántas peticiones se anotan como mucho en un bloqueo (las más largas). */
export const TOPE_EN_BLOQUEO = 8

interface Terminada {
  canal: string
  inicio: number
  fin: number
}

export class LlamadasIpc {
  private siguiente = 1
  private readonly enCurso = new Map<number, { canal: string; inicio: number }>()
  private readonly terminadas: Terminada[] = []
  private lentas: Record<string, { n: number; maxMs: number }> = {}

  /** Empieza una petición; devuelve su id para `terminar`. */
  empezar(canal: string, ahora: number): number {
    const id = this.siguiente++
    this.enCurso.set(id, { canal, inicio: ahora })
    return id
  }

  terminar(id: number, ahora: number): void {
    const l = this.enCurso.get(id)
    if (!l) return
    this.enCurso.delete(id)
    this.terminadas.push({ canal: l.canal, inicio: l.inicio, fin: ahora })
    if (this.terminadas.length > TOPE_TERMINADAS) this.terminadas.shift()
    const ms = ahora - l.inicio
    if (ms >= IPC_LENTO_MS) {
      const a = (this.lentas[l.canal] ??= { n: 0, maxMs: 0 })
      a.n += 1
      a.maxMs = Math.max(a.maxMs, Math.round(ms))
    }
  }

  /** Las que se solapan con [desde, hasta]: terminadas en el intervalo o aún en curso; las más largas primero. */
  en(desde: number, hasta: number, ahora: number): LlamadaSalud[] {
    const out: LlamadaSalud[] = []
    for (const t of this.terminadas) {
      if (t.inicio <= hasta && t.fin >= desde) out.push({ canal: t.canal, ms: Math.round(t.fin - t.inicio) })
    }
    for (const l of this.enCurso.values()) {
      if (l.inicio <= hasta) out.push({ canal: l.canal, ms: Math.round(ahora - l.inicio), enCurso: true })
    }
    return out.sort((a, b) => b.ms - a.ms).slice(0, TOPE_EN_BLOQUEO)
  }

  /** Las lentas por canal desde la última llamada a esto (y se vacía). */
  tomarLentas(): Record<string, { n: number; maxMs: number }> {
    const r = this.lentas
    this.lentas = {}
    return r
  }
}
