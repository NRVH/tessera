// =============================================================================
// Registro de salud: reglas puras compartidas por el main (que graba), el preload y el
// renderer (que saben si la versión es alpha y resumen lo que le fue lento a la ventana) y el
// analizador de `scripts/pruebas/salud.mjs`. Solo existe en las versiones alpha. No importa nada.
// Decisiones: docs/decisiones/app/registro-de-salud.md
// =============================================================================

/** Argumento de línea de órdenes con el que el main avisa al preload de que la versión es alpha. */
export const ARGUMENTO_ALPHA = '--tessera-alpha'

/** Intervalo entre muestras. */
export const INTERVALO_MUESTRA_MS = 5 * 60 * 1000

/** Tamaño a partir del cual el archivo rota (5 MB). */
export const TOPE_ARCHIVO_BYTES = 5 * 1024 * 1024

/** Nombre del archivo vigente y del anterior (el que sustituye la rotación). */
export const ARCHIVO_SALUD = 'salud.jsonl'
export const ARCHIVO_SALUD_ANTERIOR = 'salud.1.jsonl'

/** ¿Es una versión alpha? Su prerelease empieza por `alpha` (`0.76.2-alpha.3`). */
export function esVersionAlpha(version: string): boolean {
  const m = /^\d+\.\d+\.\d+-([0-9A-Za-z.-]+)(?:\+.*)?$/.exec(version.trim())
  return m !== null && (m[1] === 'alpha' || m[1].startsWith('alpha.'))
}

/**
 * ¿Está activa una opción de «Experimental»? Solo en alpha y con su ajuste encendido.
 * `forzadoEnPruebas` sustituye a la alpha (el paquete del arnés de interfaz no lo es), nunca al ajuste.
 */
export function opcionExperimentalActiva(version: string, ajuste: boolean, forzadoEnPruebas = false): boolean {
  return (esVersionAlpha(version) || forzadoEnPruebas) && ajuste
}

/** ¿Se graba? Solo en alpha y con el ajuste encendido. */
export function registroSaludActivo(version: string, ajuste: boolean): boolean {
  return opcionExperimentalActiva(version, ajuste)
}

/** ¿Hay que rotar el archivo antes de seguir escribiendo? */
export function debeRotar(tamanoBytes: number, tope: number = TOPE_ARCHIVO_BYTES): boolean {
  return tamanoBytes >= tope
}

/** Memoria y CPU de los procesos de un mismo tipo (main, ventana, GPU, utilidad…). */
export interface ProcesoSalud {
  /** Cuántos procesos de ese tipo. */
  n: number
  /** Working set sumado, en MB. */
  mb: number
  /** CPU sumada, en %. */
  cpu: number
}

export interface MuestraSalud {
  t: string
  tipo: 'muestra'
  procesos: Record<string, ProcesoSalud>
  main: { heapMb: number; externalMb: number; rssMb: number }
  /** `null` si la ventana no respondió a tiempo. */
  ventana: { heapMb: number; nodos: number } | null
  abierto: { terminales: number; agentes: number }
  /** Memoria libre del equipo. Ausente en las líneas de versiones anteriores. */
  sistema?: SistemaSalud | null
  /** Peticiones de la ventana que pasaron de `IPC_LENTO_MS` desde la muestra anterior, por canal. */
  ipcLentas?: Record<string, { n: number; maxMs: number }>
}

export interface ArranqueSalud {
  t: string
  tipo: 'arranque'
  version: string
  plataforma: string
}

export interface SuspensionSalud {
  t: string
  tipo: 'suspend' | 'resume'
}

/** Un proceso que se cae: solo causa y código, nunca rutas ni contenido. */
export interface CaidaSalud {
  t: string
  tipo: 'gone'
  /** `renderer` o el tipo del proceso hijo (`GPU`, `Utility`…). */
  proceso: string
  reason: string
  exitCode?: number
}

// --- Bloqueos -------------------------------------------------------------------------------

/** Cada cuánto mira el vigía del bucle del main si ha llegado tarde. */
export const INTERVALO_VIGIA_MS = 250
/** Un retraso del bucle del main por encima de esto es un bloqueo y se anota. */
export const UMBRAL_BLOQUEO_MS = 1000
/** Una petición de la ventana que tarda más que esto cuenta como lenta en la muestra. */
export const IPC_LENTO_MS = 1000
/** Cada cuánto resume la ventana lo que le ha ido lento (y solo si hubo algo). */
export const PERIODO_RENDERER_MS = 60 * 1000
/** Un fotograma de la ventana por encima de esto es un atasco que se ve. */
export const UMBRAL_FOTOGRAMA_MS = 200
/** Una tecla o un clic que tarda más que esto en pintarse se nota al escribir. */
export const UMBRAL_ENTRADA_MS = 150

/** Dónde y cómo estaba la ventana: el monitor con su escala y su frecuencia, sin nombres. */
export interface EstadoVentanaSalud {
  enfocada: boolean
  visible: boolean
  minimizada: boolean
  maximizada: boolean
  pantalla: { escala: number; hz: number; ancho: number; alto: number } | null
}

/** Memoria del equipo (MB). */
export interface SistemaSalud {
  libreMb: number
  totalMb: number
}

/** Lo que rodea a un suceso: la ventana, el equipo y los procesos en ese instante. */
export interface ContextoSalud {
  ventana: EstadoVentanaSalud | null
  sistema: SistemaSalud | null
  procesos: Record<string, ProcesoSalud>
}

/** Una petición de la ventana: su canal (un tipo, nunca contenido) y lo que tardó o lleva. */
export interface LlamadaSalud {
  canal: string
  ms: number
  /** Seguía sin responder al anotarla. */
  enCurso?: true
}

/** El bucle del main se quedó parado: cuánto, y las peticiones que se solapan con el parón. */
export interface BloqueoSalud extends ContextoSalud {
  t: string
  tipo: 'bloqueo-main'
  ms: number
  ipc: LlamadaSalud[]
}

/** La ventana dejó de responder (`sin-respuesta`) o volvió (`responde`, con lo que duró). */
export interface RespuestaSalud extends ContextoSalud {
  t: string
  tipo: 'sin-respuesta' | 'responde'
  ms?: number
}

/** Un cambio de monitor, de sus métricas o de cuántos hay. */
export interface PantallaSalud {
  t: string
  tipo: 'pantalla'
  motivo: 'cambio-monitor' | 'metricas' | 'monitor-añadido' | 'monitor-quitado'
  ventana: EstadoVentanaSalud | null
  monitores: number
}

/** La ventana se minimizó, se restauró, se ocultó o se mostró; o la ventana dice si se la ve. */
export interface VentanaSalud {
  t: string
  tipo: 'ventana'
  evento: 'minimizada' | 'restaurada' | 'oculta' | 'mostrada' | 'tapada' | 'a-la-vista'
}

/** La tarjeta gráfica al arrancar: lo que Chromium tiene acelerado y los adaptadores (por id). */
export interface GpuSalud {
  t: string
  tipo: 'gpu'
  aceleracion: Record<string, string>
  adaptadores: Array<{ vendor: number; device: number; activo: boolean; driver?: string }>
}

/** Lo que le fue lento a la ventana en un periodo: tareas, fotogramas y entradas (teclas, clics). */
export interface ResumenRenderer {
  periodoS: number
  tareasLargas: { n: number; maxMs: number; totalMs: number }
  fotogramasLargos: { n: number; maxMs: number }
  entradasLentas: { n: number; maxMs: number }
}

export interface RendererSalud extends ResumenRenderer {
  t: string
  tipo: 'renderer-lento'
}

/** Un número finito, no negativo y redondeado, con tope; cualquier otra cosa, 0. */
function numeroSano(v: unknown, tope: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), tope) : 0
}

const TOPE_CUENTA = 1_000_000
const TOPE_MS = 24 * 60 * 60 * 1000

/**
 * El resumen que manda la ventana, saneado: solo números con tope. `null` si no es un resumen o no
 * dice nada (todo a cero): la ventana es un proceso de menos confianza y no escribe lo que quiera.
 */
export function sanearResumenRenderer(x: unknown): ResumenRenderer | null {
  if (typeof x !== 'object' || x === null) return null
  const r = x as Record<string, Record<string, unknown> | undefined>
  const tl = r.tareasLargas ?? {}
  const fl = r.fotogramasLargos ?? {}
  const el = r.entradasLentas ?? {}
  const s: ResumenRenderer = {
    periodoS: numeroSano((x as { periodoS?: unknown }).periodoS, 24 * 3600),
    tareasLargas: { n: numeroSano(tl.n, TOPE_CUENTA), maxMs: numeroSano(tl.maxMs, TOPE_MS), totalMs: numeroSano(tl.totalMs, TOPE_MS) },
    fotogramasLargos: { n: numeroSano(fl.n, TOPE_CUENTA), maxMs: numeroSano(fl.maxMs, TOPE_MS) },
    entradasLentas: { n: numeroSano(el.n, TOPE_CUENTA), maxMs: numeroSano(el.maxMs, TOPE_MS) }
  }
  return s.tareasLargas.n + s.fotogramasLargos.n + s.entradasLentas.n > 0 ? s : null
}

/** Los eventos de la ventana que puede anotar el renderer (si la tapan o vuelve a verse). */
export function esEventoVisibilidad(x: unknown): x is 'tapada' | 'a-la-vista' {
  return x === 'tapada' || x === 'a-la-vista'
}

/** Lo que se sabe de un proceso de Electron en una muestra (`app.getAppMetrics()` reducido). */
export interface MetricaProceso {
  tipo: string
  /** Working set en KB. */
  workingSetKb: number
  cpuPct: number
}

/** Los oyentes de sucesos que el registro cuelga mientras está encendido. */
export interface OyentesSalud {
  suspend: () => void
  resume: () => void
  rendererCaido: (reason: string, exitCode?: number) => void
  hijoCaido: (tipo: string, reason: string, exitCode?: number) => void
  sinRespuesta: () => void
  responde: () => void
  pantalla: (motivo: PantallaSalud['motivo']) => void
  ventana: (evento: VentanaSalud['evento']) => void
  /** El bucle del main llegó `ms` tarde, entre `desde` y `hasta` (ms de `ahoraMs`). */
  bloqueo: (ms: number, desde: number, hasta: number) => void
}

/** Todo lo que el registro necesita del mundo: así se prueba sin Electron ni disco. */
export interface DepsRegistroSalud {
  version: string
  plataforma: string
  /** Carpeta de los registros (`<userData>/logs`). */
  carpeta: string
  /** Hora actual; se inyecta para fijar las marcas en los tests. */
  ahora: () => Date
  /** Disco: todo best-effort, el registro lo envuelve en try/catch. */
  disco: {
    crearCarpeta: (ruta: string) => void
    anexar: (ruta: string, texto: string) => void
    tamano: (ruta: string) => number
    /** Mueve `desde` a `hasta` sustituyendo lo que hubiera. */
    mover: (desde: string, hasta: string) => void
    unir: (carpeta: string, nombre: string) => string
  }
  /** Un temporizador de un solo disparo, no retiene el proceso; devuelve cómo cancelarlo. */
  armar: (fn: () => void, ms: number) => () => void
  metricas: () => MetricaProceso[]
  memoriaMain: () => { heapMb: number; externalMb: number; rssMb: number }
  /** Memoria y nodos de la ventana; `null` si no hay ventana o no respondió a tiempo. */
  ventana: () => Promise<{ heapMb: number; nodos: number } | null>
  sesiones: () => { terminales: number; agentes: number }
  suscribir: (oyentes: OyentesSalud) => () => void
  /** Reloj monótono en ms (el de las peticiones y el vigía). */
  ahoraMs: () => number
  estadoVentana: () => EstadoVentanaSalud | null
  sistema: () => SistemaSalud | null
  /** Cuántos monitores hay conectados. */
  monitores: () => number
  /** La tarjeta gráfica (una vez por arranque); null si no se pudo leer. */
  gpu: () => Promise<Omit<GpuSalud, 't' | 'tipo'> | null>
  /** Las peticiones que se solapan con [desde, hasta] (las más largas) y las lentas desde la última vez. */
  ipcEn: (desde: number, hasta: number) => LlamadaSalud[]
  ipcLentas: () => Record<string, { n: number; maxMs: number }>
}

export type LineaSalud =
  | MuestraSalud
  | ArranqueSalud
  | SuspensionSalud
  | CaidaSalud
  | BloqueoSalud
  | RespuestaSalud
  | PantallaSalud
  | VentanaSalud
  | GpuSalud
  | RendererSalud
