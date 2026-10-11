// =============================================================================
// Registro de salud (`userData/logs/salud.jsonl`): en las versiones alpha y con el ajuste
// encendido, una muestra cada 5 minutos (memoria y CPU por proceso, ventana, sesiones, peticiones
// lentas) y una línea por suspensión, proceso caído, bloqueo del main, ventana sin respuesta, cambio
// de monitor y lo que la ventana resume como lento, con el contexto de ese instante. Nunca registra
// contenido. Lo de Electron entra por `DepsRegistroSalud`; las reglas puras viven en `shared/salud.ts`.
// Decisiones: docs/decisiones/app/registro-de-salud.md
// =============================================================================

import {
  ARCHIVO_SALUD,
  ARCHIVO_SALUD_ANTERIOR,
  debeRotar,
  INTERVALO_MUESTRA_MS,
  esEventoVisibilidad,
  registroSaludActivo,
  sanearResumenRenderer,
  type ContextoSalud,
  type DepsRegistroSalud,
  type LineaSalud,
  type MetricaProceso,
  type MuestraSalud,
  type OyentesSalud,
  type ProcesoSalud
} from '../../shared/salud.ts'

/** Tiempo máximo que se espera a la ventana antes de anotar la muestra sin ella. */
export const TOPE_VENTANA_MS = 3000

/** Agrupa las métricas por tipo: `Browser`→main, `Tab`→ventana, `GPU`→gpu, el resto por su nombre. */
export function resumirProcesos(metricas: readonly MetricaProceso[]): Record<string, ProcesoSalud> {
  const nombre = (tipo: string): string =>
    tipo === 'Browser' ? 'main' : tipo === 'Tab' ? 'ventana' : tipo === 'GPU' ? 'gpu' : tipo.toLowerCase()
  const out: Record<string, ProcesoSalud> = {}
  for (const m of metricas) {
    const k = nombre(m.tipo)
    const p = (out[k] ??= { n: 0, mb: 0, cpu: 0 })
    p.n += 1
    p.mb += m.workingSetKb / 1024
    p.cpu += m.cpuPct
  }
  for (const p of Object.values(out)) {
    p.mb = Math.round(p.mb * 10) / 10
    p.cpu = Math.round(p.cpu * 10) / 10
  }
  return out
}

export class RegistroSalud {
  private readonly deps: DepsRegistroSalud
  private readonly ruta: string
  private readonly rutaAnterior: string
  private encendido = false
  private cancelarTemporizador: (() => void) | null = null
  private quitarOyentes: (() => void) | null = null
  private muestreando = false
  /** La línea de `arranque` sale una vez por proceso, no cada vez que se enciende el ajuste. */
  private arrancado = false
  /** Cuándo dejó de responder la ventana (reloj de `ahoraMs`), para la duración en `responde`. */
  private inicioSinRespuesta: number | null = null

  constructor(deps: DepsRegistroSalud) {
    this.deps = deps
    this.ruta = deps.disco.unir(deps.carpeta, ARCHIVO_SALUD)
    this.rutaAnterior = deps.disco.unir(deps.carpeta, ARCHIVO_SALUD_ANTERIOR)
  }

  /** ¿Está grabando ahora mismo? */
  get activo(): boolean {
    return this.encendido
  }

  /**
   * Aplica el ajuste: enciende o apaga según versión y ajuste. Idempotente. Apagado no queda
   * temporizador ni oyente vivo.
   */
  fijarAjuste(ajuste: boolean): void {
    const debe = registroSaludActivo(this.deps.version, ajuste)
    if (debe === this.encendido) return
    if (debe) this.encender()
    else this.detener()
  }

  /** Quita el temporizador y los oyentes (apagado y cierre de la app). Nunca lanza. */
  detener(): void {
    this.encendido = false
    try {
      this.cancelarTemporizador?.()
    } catch {
      /* cancelar un temporizador no puede romper el cierre */
    }
    this.cancelarTemporizador = null
    try {
      this.quitarOyentes?.()
    } catch {
      /* idem */
    }
    this.quitarOyentes = null
  }

  private encender(): void {
    this.encendido = true
    try {
      this.deps.disco.crearCarpeta(this.deps.carpeta)
    } catch {
      /* sin carpeta, cada escritura falla y se ignora */
    }
    if (!this.arrancado) {
      this.arrancado = true
      this.escribir({
        t: this.marca(),
        tipo: 'arranque',
        version: this.deps.version,
        plataforma: this.deps.plataforma
      })
      void this.lineaGpu()
    }
    try {
      this.quitarOyentes = this.deps.suscribir(this.oyentes())
    } catch {
      this.quitarOyentes = null
    }
    this.programar()
  }

  private oyentes(): OyentesSalud {
    return {
      suspend: () => this.escribir({ t: this.marca(), tipo: 'suspend' }),
      resume: () => {
        this.escribir({ t: this.marca(), tipo: 'resume' })
        void this.muestra()
      },
      rendererCaido: (reason, exitCode) =>
        this.escribir({ t: this.marca(), tipo: 'gone', proceso: 'renderer', reason, ...(exitCode === undefined ? {} : { exitCode }) }),
      hijoCaido: (tipo, reason, exitCode) =>
        this.escribir({ t: this.marca(), tipo: 'gone', proceso: tipo, reason, ...(exitCode === undefined ? {} : { exitCode }) }),
      sinRespuesta: () => {
        this.inicioSinRespuesta = this.seguro<number | null>(() => this.deps.ahoraMs(), null)
        this.escribir({ t: this.marca(), tipo: 'sin-respuesta', ...this.contexto() })
      },
      responde: () => {
        const inicio = this.inicioSinRespuesta
        this.inicioSinRespuesta = null
        const ms = inicio === null ? undefined : Math.round(this.seguro(() => this.deps.ahoraMs(), inicio) - inicio)
        this.escribir({ t: this.marca(), tipo: 'responde', ...(ms === undefined ? {} : { ms }), ...this.contexto() })
      },
      pantalla: (motivo) =>
        this.escribir({ t: this.marca(), tipo: 'pantalla', motivo, ventana: this.seguro(() => this.deps.estadoVentana(), null), monitores: this.seguro(() => this.deps.monitores(), 0) }),
      ventana: (evento) => this.escribir({ t: this.marca(), tipo: 'ventana', evento }),
      bloqueo: (ms, desde, hasta) => {
        const ipc = this.seguro(() => this.deps.ipcEn(desde, hasta), [])
        this.escribir({ t: this.marca(), tipo: 'bloqueo-main', ms: Math.round(ms), ipc, ...this.contexto() })
      }
    }
  }

  /** La ventana, el equipo y los procesos en este instante. Nunca lanza. */
  private contexto(): ContextoSalud {
    return {
      ventana: this.seguro(() => this.deps.estadoVentana(), null),
      sistema: this.seguro(() => this.deps.sistema(), null),
      procesos: this.seguro(() => resumirProcesos(this.deps.metricas()), {})
    }
  }

  /** El resumen de lo que le fue lento a la ventana (llega por IPC; se sanea aquí). */
  anotarRenderer(x: unknown): void {
    const r = sanearResumenRenderer(x)
    if (r) this.escribir({ t: this.marca(), tipo: 'renderer-lento', ...r })
  }

  /** La ventana dice que la han tapado o que vuelve a verse. */
  anotarVisibilidad(x: unknown): void {
    if (esEventoVisibilidad(x)) this.escribir({ t: this.marca(), tipo: 'ventana', evento: x })
  }

  /** La tarjeta gráfica, una vez por arranque. Nunca rechaza. */
  private async lineaGpu(): Promise<void> {
    try {
      const g = await this.deps.gpu()
      if (g) this.escribir({ t: this.marca(), tipo: 'gpu', ...g })
    } catch {
      /* sin datos de la GPU no hay línea */
    }
  }

  /** Arma el siguiente disparo. Re-armable: se programa al acabar cada muestra, nunca un intervalo fijo. */
  private programar(): void {
    // Con un disparo ya armado no se arma otro: una muestra que acaba tras apagar y volver a encender
    // empezaría un segundo bucle.
    if (!this.encendido || this.cancelarTemporizador !== null) return
    try {
      this.cancelarTemporizador = this.deps.armar(() => {
        this.cancelarTemporizador = null
        void this.muestra().finally(() => this.programar())
      }, INTERVALO_MUESTRA_MS)
    } catch {
      this.cancelarTemporizador = null
    }
  }

  /** Toma y escribe una muestra. Nunca lanza ni rechaza. */
  async muestra(): Promise<void> {
    if (!this.encendido || this.muestreando) return
    this.muestreando = true
    try {
      const t = this.marca()
      const procesos = this.seguro(() => resumirProcesos(this.deps.metricas()), {})
      const main = this.seguro(() => this.deps.memoriaMain(), { heapMb: 0, externalMb: 0, rssMb: 0 })
      const abierto = this.seguro(() => this.deps.sesiones(), { terminales: 0, agentes: 0 })
      const sistema = this.seguro(() => this.deps.sistema(), null)
      const ipcLentas = this.seguro(() => this.deps.ipcLentas(), {})
      const ventana = await this.ventanaConTope()
      const linea: MuestraSalud = { t, tipo: 'muestra', procesos, main, ventana, abierto, sistema, ...(Object.keys(ipcLentas).length > 0 ? { ipcLentas } : {}) }
      this.escribir(linea)
    } catch {
      /* una muestra fallida se pierde; la siguiente sale sola */
    } finally {
      this.muestreando = false
    }
  }

  private seguro<T>(fn: () => T, porDefecto: T): T {
    try {
      return fn()
    } catch {
      return porDefecto
    }
  }

  private async ventanaConTope(): Promise<MuestraSalud['ventana']> {
    let cancelar: (() => void) | null = null
    try {
      const tope = new Promise<null>((resolver) => {
        cancelar = this.deps.armar(() => resolver(null), TOPE_VENTANA_MS)
      })
      return await Promise.race([this.deps.ventana().catch(() => null), tope])
    } catch {
      return null
    } finally {
      try {
        ;(cancelar as (() => void) | null)?.()
      } catch {
        /* nada */
      }
    }
  }

  private marca(): string {
    return this.deps.ahora().toISOString()
  }

  /** Anexa una línea; rota antes si el archivo ya llegó al tope. Un fallo de disco se ignora. */
  private escribir(linea: LineaSalud): void {
    if (!this.encendido) return
    try {
      const { disco } = this.deps
      let tamano = 0
      try {
        tamano = disco.tamano(this.ruta)
      } catch {
        /* aún no existe */
      }
      if (debeRotar(tamano)) disco.mover(this.ruta, this.rutaAnterior)
      disco.anexar(this.ruta, JSON.stringify(linea) + '\n')
    } catch {
      /* el registro no puede romper lo que intenta medir */
    }
  }
}
