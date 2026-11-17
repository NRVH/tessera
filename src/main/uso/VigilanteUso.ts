// =============================================================================
// Vigilante del transcript de una cuenta: detecta que el agente acaba de responder para avisar de
// que su uso cambió.
// `fs.watch` recursivo con refcount por cuenta y rebote de 2,5 s, para quedarse con el último
// snapshot de límites del turno. Al soltarlo el último panel no se cierra en el acto.
// Claude se estrecha a `projects` y Codex vigila su base entera: un vigilante más estrecho que su
// lector deja el dato viejo.
// Lo usa `ServicioUso`. Decisiones: docs/decisiones/agentes/uso-de-cuenta.md
// =============================================================================

import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'

/** Silencio tras la última escritura que se considera "turno terminado". */
const SILENCIO_MS = 2500

/**
 * Cuánto sobrevive el vigilante a su último panel. Cambiar de pane entre dos de la misma
 * cuenta suelta y vuelve a pedir en el mismo commit; sin esta gracia cada cambio cerraba y
 * reabría un `fs.watch` recursivo.
 */
const GRACIA_CIERRE_MS = 30_000

/** Crea el vigilante de una carpeta; las pruebas lo sustituyen para no tocar el disco. */
export type Vigilar = (
  objetivo: string,
  opciones: { recursive: boolean; persistent: boolean },
  alCambiar: (evento: string, archivo: string | Buffer | null) => void
) => FSWatcher

export interface OpcionesVigilanteUso {
  graciaCierreMs?: number
  vigilar?: Vigilar
}

interface EntradaVigilanciaUso {
  /** Nº de paneles que miran esta cuenta. */
  refs: number
  /** null si no se pudo montar o si murió con un error: el siguiente `watch` lo reintenta. */
  vigilante: FSWatcher | null
  temporizador: ReturnType<typeof setTimeout> | null
  /** Cierre programado al quedarse sin paneles, o null. */
  cierre: ReturnType<typeof setTimeout> | null
  base: string
  sub: string | undefined
}

export class VigilanteUso {
  private readonly entradas = new Map<string, EntradaVigilanciaUso>()
  // Campos explícitos, no propiedades de parámetro: el `node --strip-types` con el que
  // corren los tests .mts de este repo no soporta `constructor(private x)`.
  private readonly onCambio: (clave: string) => void
  private readonly graciaCierreMs: number
  private readonly vigilar: Vigilar

  constructor(onCambio: (clave: string) => void, opciones: OpcionesVigilanteUso = {}) {
    this.onCambio = onCambio
    this.graciaCierreMs = opciones.graciaCierreMs ?? GRACIA_CIERRE_MS
    this.vigilar = opciones.vigilar ?? (watch as Vigilar)
  }

  /**
   * Vigila la carpeta `base` de la cuenta `key`. Idempotente y con refcount: varios paneles de la
   * misma cuenta comparten un solo `fs.watch`. `sub` acota el vigilante a una subcarpeta (Claude:
   * `projects`, para no despertar al main con cada escritura de `file-history/`); el filtro por
   * extensión se queda porque dentro también hay ficheros que no son transcripts. No se estrecha
   * cuando el lector mira varias carpetas (Codex).
   */
  iniciarVigilancia(clave: string, base: string, sub?: string): void {
    const existente = this.entradas.get(clave)
    if (existente) {
      existente.refs++
      if (existente.cierre) clearTimeout(existente.cierre)
      existente.cierre = null
      if (existente.vigilante === null) this.montar(clave, existente)
      return
    }
    const entrada: EntradaVigilanciaUso = { refs: 1, vigilante: null, temporizador: null, cierre: null, base, sub }
    this.entradas.set(clave, entrada)
    this.montar(clave, entrada)
  }

  private montar(clave: string, entrada: EntradaVigilanciaUso): void {
    const { base, sub } = entrada
    // Si la subcarpeta aún no existe (cuenta sin estrenar), `watch` lanza y se cae a la
    // base: peor filtro, pero nunca menos cobertura que antes.
    const objetivos = sub ? [path.join(base, sub), base] : [base]
    for (const objetivo of objetivos) {
      try {
        const vigilante = this.vigilar(objetivo, { recursive: true, persistent: false }, (_evento, nombreArchivo) => {
          // Solo transcripts: la carpeta también tiene caches, credenciales e historial,
          // y ninguno de esos cambios significa que el uso se haya movido.
          if (!nombreArchivo || !nombreArchivo.toString().endsWith('.jsonl')) return
          if (entrada.temporizador) clearTimeout(entrada.temporizador)
          entrada.temporizador = setTimeout(() => {
            entrada.temporizador = null
            this.onCambio(clave)
          }, SILENCIO_MS)
        })
        // Sin oyente, un 'error' (la carpeta vigilada se borra o se mueve) es una excepción
        // no capturada. El vigilante muerto se suelta SIN perder `refs`: los paneles siguen
        // contando y el siguiente `watch` lo vuelve a montar.
        vigilante.on('error', () => {
          vigilante.close()
          if (entrada.vigilante === vigilante) entrada.vigilante = null
        })
        entrada.vigilante = vigilante
        return // vigilante montado: no hace falta probar la base
      } catch (e) {
        // Carpeta inexistente (cuenta sin estrenar) o límite de watchers del SO: el
        // sondeo periódico sigue funcionando, solo se pierde la actualización inmediata.
        // Solo se avisa cuando ya no queda alternativa que probar.
        if (objetivo === objetivos[objetivos.length - 1]) {
          console.error(`[usage] no se pudo vigilar ${objetivo}:`, e)
        }
      }
    }
  }

  /** Suelta una referencia; con la última, el vigilante se cierra pasada la gracia. */
  dejarDeVigilar(clave: string): void {
    const entrada = this.entradas.get(clave)
    if (!entrada || entrada.refs === 0) return
    entrada.refs--
    if (entrada.refs > 0) return
    entrada.cierre = setTimeout(() => this.cerrar(clave), this.graciaCierreMs)
    // Un cierre pendiente no puede retener vivo el proceso.
    entrada.cierre.unref?.()
  }

  /**
   * Cierra YA el vigilante de `key`, tenga los paneles que tenga y sin gracia. Para antes de
   * borrar la carpeta de una cuenta: en Windows un vigilante abierto impide borrarla.
   */
  cerrar(clave: string): void {
    const entrada = this.entradas.get(clave)
    if (!entrada) return
    this.soltar(entrada)
    this.entradas.delete(clave)
  }

  private soltar(entrada: EntradaVigilanciaUso): void {
    if (entrada.temporizador) clearTimeout(entrada.temporizador)
    if (entrada.cierre) clearTimeout(entrada.cierre)
    entrada.vigilante?.close()
  }

  liberarTodos(): void {
    for (const entrada of this.entradas.values()) this.soltar(entrada)
    this.entradas.clear()
  }
}
