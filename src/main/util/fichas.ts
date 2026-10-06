// =============================================================================
// Fichas: un token opaco que viaja por el IPC en lugar de algo que el renderer no debe ver (una
// ruta, una copia provisional), y que caduca. Genérico y puro: el reloj, la vida y el generador de
// tokens se inyectan, y al caducar `alCaducar` recibe el valor (para borrar lo provisional). La
// caducidad se mira al usarlas, sin temporizadores: quien necesite barrer llama a `podar`. Las usan las
// claves SSH importadas y los archivos de las bases de archivo (`db/archivosBd.ts`).
// Decisiones: docs/decisiones/ssh/claves-importadas.md, docs/decisiones/bd/conexiones-archivos-de-base-de-datos.md
// =============================================================================

import { randomUUID } from 'node:crypto'

/** Lo que vale una ficha si no se dice otra cosa: media hora, como las de los archivos de BD. */
export const VIDA_FICHA_POR_DEFECTO_MS = 30 * 60 * 1000

/** Lo que decide quien crea las fichas (o sustituye una prueba). */
export interface OpcionesFichas<T> {
  ahora?: () => number
  vidaMs?: number
  nuevoToken?: () => string
  /** Recibe el valor de cada ficha que caduca. Si lanza, la poda sigue con las demás. */
  alCaducar?: (valor: T) => void
}

interface Viva<T> {
  valor: T
  caduca: number
}

/** Las fichas vivas de un uso. Una instancia por uso: un token de uno no vale en otro. */
export class Fichas<T> {
  private readonly vivas = new Map<string, Viva<T>>()
  private readonly ahora: () => number
  private readonly vidaMs: number
  private readonly nuevoToken: () => string
  private readonly alCaducar: ((valor: T) => void) | null

  // Sin propiedades de parámetro: los test-*.mts corren con `node` a secas, que no las admite.
  constructor(opciones: OpcionesFichas<T> = {}) {
    this.ahora = opciones.ahora ?? Date.now
    this.vidaMs = opciones.vidaMs ?? VIDA_FICHA_POR_DEFECTO_MS
    this.nuevoToken = opciones.nuevoToken ?? randomUUID
    this.alCaducar = opciones.alCaducar ?? null
  }

  /** Guarda `valor` y devuelve el token que lo identifica. */
  emitir(valor: T): string {
    this.podar()
    const token = this.nuevoToken()
    this.vivas.set(token, { valor, caduca: this.ahora() + this.vidaMs })
    return token
  }

  /** El valor de una ficha viva; `undefined` si no se conoce, caducó o el token no es un texto. */
  ver(token: unknown): T | undefined {
    this.podar()
    return typeof token === 'string' ? this.vivas.get(token)?.valor : undefined
  }

  /** Retira una ficha SIN `alCaducar`: quien la retira se queda con lo que guardaba. */
  olvidar(token: string): void {
    this.vivas.delete(token)
  }

  /** Los valores de las fichas vivas: las caducadas se retiran antes, con su aviso. */
  valores(): T[] {
    this.podar()
    return [...this.vivas.values()].map((v) => v.valor)
  }

  /** Retira las caducadas y avisa de cada una. */
  podar(): void {
    const t = this.ahora()
    for (const [token, viva] of this.vivas) {
      if (viva.caduca > t) continue
      this.vivas.delete(token)
      try {
        this.alCaducar?.(viva.valor)
      } catch {
        // Una que no se pudo despachar no impide retirar las demás.
      }
    }
  }

  /** Cuántas hay vivas. */
  get cuantas(): number {
    this.podar()
    return this.vivas.size
  }
}
