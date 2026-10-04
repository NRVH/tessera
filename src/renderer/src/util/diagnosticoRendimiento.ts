// =============================================================================
// diagnosticoRendimiento: publica `window.__tesseraRendimiento`, el diagnóstico que se
// enciende en caliente desde las herramientas de desarrollo (F12) o desde una prueba:
// recuentos de contadorRenders, tramos medidos con `performance` y tareas largas.
// Apagado por defecto y sin coste; no usa `process` ni ningún canal IPC.
// Decisiones: docs/decisiones/calidad/presupuesto-del-cambio-de-perfil.md
// =============================================================================

import {
  activarContador,
  anotarDuracion,
  contadorActivo,
  fotoContador,
  MAX_MUESTRAS,
  reiniciarContador,
  type FotoContador
} from './contadorRenders'

/** Una tarea que bloqueó el hilo principal 50 ms o más mientras se medía. */
export interface TareaLarga {
  /** Milisegundos desde el origen de `performance`. */
  inicio: number
  duracion: number
}

/** Lo medido desde el último reinicio. */
export interface FotoRendimiento extends FotoContador {
  tareasLargas: TareaLarga[]
}

/** La API que queda en `window.__tesseraRendimiento`. */
export interface DiagnosticoRendimiento {
  activar: () => void
  desactivar: () => void
  activo: () => boolean
  /** Borra lo medido sin apagar. */
  reiniciar: () => void
  foto: () => FotoRendimiento
  /** Vuelca lo medido a la consola en tablas. */
  informe: () => void
}

declare global {
  interface Window {
    __tesseraRendimiento?: DiagnosticoRendimiento
  }
}

const tareasLargas: TareaLarga[] = []
/** Tramos abiertos: nombre → instante en que empezó. */
const tramos = new Map<string, number>()
let observador: PerformanceObserver | null = null

/** Empieza a medir el tramo `nombre`; uno abierto con el mismo nombre se reinicia. */
export function iniciarTramo(nombre: string): void {
  if (!contadorActivo()) return
  tramos.set(nombre, performance.now())
}

/**
 * Un tramo que nadie cerró a tiempo no es una medida: quien lo abre no siempre llega a
 * su cierre (un clic en el perfil ya activo), y lo cerraría mucho después otra acción.
 */
const TRAMO_MAXIMO_MS = 10_000

/** Cierra el tramo `nombre` y apunta su duración; sin tramo abierto no hace nada. */
export function cerrarTramo(nombre: string): void {
  if (!contadorActivo()) return
  const t0 = tramos.get(nombre)
  if (t0 === undefined) return
  tramos.delete(nombre)
  const ms = performance.now() - t0
  if (ms <= TRAMO_MAXIMO_MS) anotarDuracion(nombre, ms)
}

/** Ejecuta `f` y, si se está midiendo, apunta lo que tardó bajo `nombre`. */
export function medirDuracion<T>(nombre: string, f: () => T): T {
  if (!contadorActivo()) return f()
  const t0 = performance.now()
  try {
    return f()
  } finally {
    anotarDuracion(nombre, performance.now() - t0)
  }
}

/** Los fotogramas largos dicen más que las tareas largas; se usa lo que haya. */
function tipoDeTareaLarga(): string | null {
  const tipos = PerformanceObserver.supportedEntryTypes
  if (tipos.includes('long-animation-frame')) return 'long-animation-frame'
  return tipos.includes('longtask') ? 'longtask' : null
}

function observar(): void {
  const tipo = tipoDeTareaLarga()
  if (observador !== null || tipo === null) return
  observador = new PerformanceObserver((lista) => {
    for (const e of lista.getEntries()) {
      // Con tope: encendido y olvidado, no puede crecer durante días.
      if (tareasLargas.length < MAX_MUESTRAS) tareasLargas.push({ inicio: e.startTime, duracion: e.duration })
    }
  })
  observador.observe({ type: tipo })
}

function dejarDeObservar(): void {
  observador?.disconnect()
  observador = null
}

function informe(): void {
  const foto = fotoContador()
  console.table(
    Object.entries(foto.renders).map(([componente, r]) => ({
      componente,
      renders: r.total,
      instancias: Object.keys(r.porClave).length
    }))
  )
  console.table(foto.eventos)
  console.table(foto.duraciones)
  console.table(tareasLargas)
}

/** Publica el diagnóstico en la ventana. Se llama una vez, antes de montar React. */
export function instalarDiagnosticoRendimiento(): void {
  window.__tesseraRendimiento = {
    activar: () => {
      activarContador(true)
      observar()
    },
    desactivar: () => {
      activarContador(false)
      dejarDeObservar()
      tramos.clear()
    },
    activo: contadorActivo,
    reiniciar: () => {
      reiniciarContador()
      tareasLargas.length = 0
      tramos.clear()
    },
    foto: () => ({ ...fotoContador(), tareasLargas: [...tareasLargas] }),
    informe
  }
}
