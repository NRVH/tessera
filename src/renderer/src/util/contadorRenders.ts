// =============================================================================
// contadorRenders: núcleo PURO del diagnóstico de rendimiento. Cuenta renders por
// componente y clave, eventos y duraciones, solo mientras está encendido: apagado
// (lo normal) cada llamada vuelve en la primera línea sin asignar nada.
// Sin DOM; la capa que lo publica en la ventana es diagnosticoRendimiento.ts.
// Decisiones: docs/decisiones/calidad/presupuesto-del-cambio-de-perfil.md
// =============================================================================

/** Renders de un componente: el total y cuántos por clave (un pane, una pestaña). */
export interface RendersDeComponente {
  total: number
  porClave: Record<string, number>
}

/** Resumen de las duraciones anotadas con un mismo nombre, en milisegundos. */
export interface ResumenDuracion {
  n: number
  mediana: number
  max: number
}

/** Lo contado desde el último reinicio. */
export interface FotoContador {
  renders: Record<string, RendersDeComponente>
  eventos: Record<string, number>
  duraciones: Record<string, ResumenDuracion>
}

let activo = false
const renders = new Map<string, Map<string, number>>()
const eventos = new Map<string, number>()
const duraciones = new Map<string, number[]>()

/** Clave de los renders de un componente que no distingue instancias. */
const SIN_CLAVE = ''

/** Enciende o apaga el recuento; no borra lo contado. */
export function activarContador(encendido: boolean): void {
  activo = encendido
}

/** ¿Está contando? */
export function contadorActivo(): boolean {
  return activo
}

/** Borra todo lo contado, sin cambiar si está encendido. */
export function reiniciarContador(): void {
  renders.clear()
  eventos.clear()
  duraciones.clear()
}

/** Apunta un render de `componente`; `clave` distingue instancias. */
export function contarRender(componente: string, clave: string = SIN_CLAVE): void {
  if (!activo) return
  let porClave = renders.get(componente)
  if (!porClave) {
    porClave = new Map()
    renders.set(componente, porClave)
  }
  porClave.set(clave, (porClave.get(clave) ?? 0) + 1)
}

/** Apunta una ocurrencia del evento `nombre`. */
export function contarEvento(nombre: string): void {
  if (!activo) return
  eventos.set(nombre, (eventos.get(nombre) ?? 0) + 1)
}

/**
 * Tope de muestras guardadas por nombre: el diagnóstico encendido y olvidado no puede
 * crecer sin fin. Pasado el tope se dejan de guardar hasta el siguiente reinicio.
 */
export const MAX_MUESTRAS = 5_000

/** Apunta una duración (ms) bajo `nombre`. */
export function anotarDuracion(nombre: string, ms: number): void {
  if (!activo) return
  const lista = duraciones.get(nombre)
  if (!lista) duraciones.set(nombre, [ms])
  else if (lista.length < MAX_MUESTRAS) lista.push(ms)
}

function resumir(valores: readonly number[]): ResumenDuracion {
  const orden = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  const mediana = orden.length % 2 === 1 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2
  return { n: orden.length, mediana, max: orden[orden.length - 1] }
}

/** Copia de lo contado hasta ahora (objetos planos, serializables). */
export function fotoContador(): FotoContador {
  const foto: FotoContador = { renders: {}, eventos: {}, duraciones: {} }
  for (const [componente, porClave] of renders) {
    let total = 0
    const claves: Record<string, number> = {}
    for (const [clave, n] of porClave) {
      total += n
      if (clave !== SIN_CLAVE) claves[clave] = n
    }
    foto.renders[componente] = { total, porClave: claves }
  }
  for (const [nombre, n] of eventos) foto.eventos[nombre] = n
  for (const [nombre, lista] of duraciones) foto.duraciones[nombre] = resumir(lista)
  return foto
}
