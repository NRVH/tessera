// =============================================================================
// Presupuesto GLOBAL de celdas: registro de módulo de todas las rejillas con filas en
// memoria (pestañas de datos y resultados de consola) y quién suelta filas al pasarse de
// `TOPE_CELDAS_MEMORIA`. De módulo y no un contexto de React: la pregunta es SÍNCRONA
// («¿cabe otra página?», «suelta ya») y los dueños viven en árboles distintos. Neutral.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-memoria.md
// =============================================================================

import { TOPE_CELDAS_MEMORIA, presupuesto, rejillasALiberar, type Presupuesto, type RejillaEnMemoria } from './celdasRejilla.ts'

/** Una rejilla con filas en memoria, vista por el registro. */
export interface DuenoRejilla {
  /** Único en el renderer: registrar otro con el mismo id sustituye al anterior. */
  readonly id: string
  /** Celdas cargadas ahora (filas × columnas). */
  celdas(): number
  /** Las que conserva al liberar (su primera página). */
  celdasPrimeraPagina(): number
  /** El usuario la está mirando: nunca se libera. */
  visible(): boolean
  /**
   * Última vez que se vio. El MISMO reloj para todos los dueños (`performance.now()`
   * en la app): se comparan pestañas de tabla con resultados de consola.
   */
  ultimoUso(): number
  /**
   * Suelta lo que va tras la primera página y deja «Volver a ejecutar». SÍNCRONO: al
   * volver, `celdas()` ya tiene que decir lo nuevo (si no, se da por no liberada).
   */
  liberar(): void
}

export interface RegistroCeldas {
  readonly tope: number
  /** Da de alta un dueño; devuelve su baja (idempotente). */
  registrar(d: DuenoRejilla): () => void
  /**
   * Un dueño cambió sus celdas o su visibilidad: si el total pasa del tope, las
   * ocultas menos usadas sueltan filas hasta volver por debajo. Devuelve las
   * liberadas, en orden (para los tests y el registro de actividad).
   */
  avisar(): string[]
  /**
   * ¿Cabe una página más de `extra` celdas sin pasar del tope? Antes de decir que no,
   * suelta las ocultas menos usadas que hagan falta, pero SOLO si soltándolas cabría:
   * tirar el trabajo de otras pestañas para acabar igual sin sitio no ayuda a nadie.
   */
  cabe(extra: number): boolean
  /**
   * Cuántas celdas MÁS cabrían soltando todas las ocultas (lo que `cabe` podría llegar
   * a aceptar). No suelta nada: es para calcular el tamaño de una página ANTES de
   * pedirla, sin pasarse («Traer todas», ver `traerTodas.ts`).
   */
  alcanzable(): number
  /** Celdas de todas las rejillas registradas. */
  total(): number
  estado(): Presupuesto
}

/** Un número que venga de un dueño, saneado: negativo o absurdo cuenta como 0. */
function numero(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Celdas de todas las rejillas registradas. */
function totalDe(duenos: ReadonlyMap<string, DuenoRejilla>): number {
  let n = 0
  for (const d of duenos.values()) n += numero(d.celdas())
  return n
}

/** Lo que el plan de liberación ve de un dueño; una ya liberada en esta pasada deja de ser candidata. */
function foto(d: DuenoRejilla, liberadas: ReadonlySet<string>): RejillaEnMemoria {
  const celdas = numero(d.celdas())
  return {
    id: d.id,
    celdas,
    celdasPrimeraPagina: liberadas.has(d.id) ? celdas : Math.min(celdas, numero(d.celdasPrimeraPagina())),
    visible: d.visible(),
    usadaEn: numero(d.ultimoUso())
  }
}

/** Lo mínimo a lo que se puede bajar: las visibles enteras, las ocultas con su primera página. */
function minimoAlcanzable(duenos: ReadonlyMap<string, DuenoRejilla>): number {
  let n = 0
  for (const d of duenos.values()) {
    const celdas = numero(d.celdas())
    n += d.visible() ? celdas : Math.min(celdas, numero(d.celdasPrimeraPagina()))
  }
  return n
}

export function crearRegistroCeldas(tope: number = TOPE_CELDAS_MEMORIA): RegistroCeldas {
  const duenos = new Map<string, DuenoRejilla>()
  let equilibrando = false
  const total = (): number => totalDe(duenos)

  /** Libera de una en una hasta que el total quede en `limite` o no quede candidata. */
  function equilibrar(limite: number): string[] {
    if (equilibrando) return []
    equilibrando = true
    const liberadas = new Set<string>()
    const orden: string[] = []
    try {
      for (;;) {
        const fotos = Array.from(duenos.values(), (d) => foto(d, liberadas))
        const id = rejillasALiberar(fotos, limite)[0]
        if (id === undefined) break
        liberadas.add(id)
        orden.push(id)
        const d = duenos.get(id)
        if (!d) continue
        try {
          d.liberar()
        } catch {
          // Un dueño que falla al soltar no impide que suelten los demás; ya no es
          // candidato en esta pasada, así que el bucle sigue con el siguiente.
        }
      }
    } finally {
      equilibrando = false
    }
    return orden
  }

  return {
    tope,
    registrar(d: DuenoRejilla): () => void {
      duenos.set(d.id, d)
      return () => {
        // Solo si sigue siendo ÉL: un remontaje con el mismo id ya lo sustituyó.
        if (duenos.get(d.id) === d) duenos.delete(d.id)
      }
    },
    avisar(): string[] {
      return equilibrar(tope)
    },
    cabe(extra: number): boolean {
      const e = numero(extra)
      if (total() + e <= tope) return true
      if (minimoAlcanzable(duenos) + e > tope) return false
      equilibrar(tope - e)
      return total() + e <= tope
    },
    alcanzable(): number {
      return Math.max(0, tope - minimoAlcanzable(duenos))
    },
    total,
    estado(): Presupuesto {
      return presupuesto(total(), tope)
    }
  }
}

/** El registro de la app: uno por renderer (una ventana = una memoria). */
export const registroCeldas: RegistroCeldas = crearRegistroCeldas()
