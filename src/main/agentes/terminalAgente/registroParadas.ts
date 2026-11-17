// =============================================================================
// La constancia de las paradas que hace Tessera (por el límite o por la saturación de Docker): cada
// una con la regla que aplicó, en un archivo de líneas JSON que sobrevive al reinicio. Se guardan
// las últimas `MAX_CONSTANCIAS`; una línea rota se salta. Sin ruta, solo en memoria (pruebas).
// Decisiones: docs/decisiones/sandbox/saturacion-de-docker.md
// =============================================================================

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ConstanciaParada } from '../../../shared/agent-terminal-ipc'

/** Cuántas se guardan: de sobra para ver qué pasó en los últimos días. */
export const MAX_CONSTANCIAS = 200

function esConstancia(x: unknown): x is ConstanciaParada {
  if (typeof x !== 'object' || x === null) return false
  const c = x as Partial<ConstanciaParada>
  return typeof c.en === 'number' && (c.motivo === 'limite' || c.motivo === 'saturacion') && Array.isArray(c.proyectos)
}

export class RegistroParadas {
  private readonly ruta: string | null
  private readonly log: (msg: string) => void
  /** La más antigua primero, como en el archivo; null hasta la primera lectura. */
  private lista: ConstanciaParada[] | null = null

  constructor(ruta: string | null, log: (msg: string) => void = () => {}) {
    this.ruta = ruta
    this.log = log
  }

  private cargar(): ConstanciaParada[] {
    if (this.lista !== null) return this.lista
    let leidas: ConstanciaParada[] = []
    if (this.ruta !== null) {
      try {
        leidas = readFileSync(this.ruta, 'utf8')
          .split('\n')
          .flatMap((l) => {
            try {
              const x: unknown = JSON.parse(l)
              return esConstancia(x) ? [x] : []
            } catch {
              return []
            }
          })
      } catch {
        // Sin archivo aún: no hay paradas.
      }
    }
    this.lista = leidas.slice(-MAX_CONSTANCIAS)
    return this.lista
  }

  /** Apunta una parada. Un fallo al escribir no impide la parada: se queda en memoria y se dice en el log. */
  anotar(c: ConstanciaParada): void {
    const lista = this.cargar()
    lista.push(c)
    const sobran = lista.length > MAX_CONSTANCIAS
    if (sobran) lista.splice(0, lista.length - MAX_CONSTANCIAS)
    if (this.ruta === null) return
    try {
      mkdirSync(dirname(this.ruta), { recursive: true })
      // Al pasarse del tope se reescribe entero; si no, solo se añade la línea.
      if (sobran) writeFileSync(this.ruta, lista.map((x) => JSON.stringify(x)).join('\n') + '\n')
      else appendFileSync(this.ruta, JSON.stringify(c) + '\n')
    } catch (err) {
      this.log(`registro de paradas: no se pudo escribir: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Las paradas, la más reciente primero. */
  leer(): ConstanciaParada[] {
    return [...this.cargar()].reverse()
  }
}
