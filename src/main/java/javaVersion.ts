// =============================================================================
// Lógica PURA sobre versiones de JVM y elección de motor: el major de la salida de `java -version`
// (que las JVM escriben en STDERR, y que hasta Java 8 es el segundo número de «1.8.0_202»), qué
// motor usar según el bytecode de cada clase y qué JVM arranca cada motor. Sin disco ni
// subprocesos: todo se prueba con `node` a secas. Lo usan `JavaRuntime` y `Decompiler`.
// Decisiones: docs/decisiones/java/deteccion-de-jvm-y-eleccion-de-motor.md
// =============================================================================

import type { MotorDescompilador, MotorPedido } from '../../shared/java-ipc.ts'

/** Class file en el que apareció `EnclosingMethod` (Java 5); por debajo, Vineflower emite código inválido. */
export const MAJOR_ENCLOSING_METHOD = 49

/** Major de JVM mínimo de cada motor. CFR está escrito en Java 6: corre casi donde sea. */
export const REQUIERE_MAJOR: Record<MotorDescompilador, number> = {
  cfr: 6,
  vineflower: 17
}

/** Versión horneada de cada motor (debe casar con los ficheros de `vendor/java/`). */
export const VERSION_MOTOR: Record<MotorDescompilador, string> = {
  cfr: '0.152',
  vineflower: '1.12.0'
}

/**
 * Extrae el major de plataforma de la salida de `java -version`.
 *
 * Acepta la salida COMPLETA (varias líneas) y busca la primera que traiga algo con
 * pinta de versión entrecomillada, que es el formato estable desde 1.2 hasta hoy y
 * el único común a Oracle, OpenJDK, Temurin, Zulu, GraalVM y OpenJ9.
 *
 * Devuelve 0 si no reconoce nada: 0 significa "no lo sé", y quien decide trata eso
 * como "no la uses", que es más seguro que adivinar.
 */
export function majorDeVersion(salida: string): number {
  const m = salida.match(/version\s+"([^"]+)"/i)
  if (!m) return 0
  const partes = m[1].split(/[._\-+]/)
  const primero = Number(partes[0])
  if (!Number.isFinite(primero) || primero <= 0) return 0
  if (primero !== 1) return primero
  const segundo = Number(partes[1])
  return Number.isFinite(segundo) && segundo > 0 ? segundo : 0
}

/** La primera línea con contenido de la salida, para enseñarla tal cual en la UI. */
export function primeraLineaVersion(salida: string): string {
  for (const linea of salida.split(/\r?\n/)) {
    const t = linea.trim()
    if (t.length > 0) return t
  }
  return ''
}

/**
 * ¿Qué motor usar para una clase de este bytecode?
 *
 * `pedido` manda salvo que sea 'auto'. Si el elegido no tiene JVM que lo arranque,
 * se cae al otro **avisando** (el llamador lo refleja en el mensaje): es preferible
 * enseñar el fuente de un motor subóptimo que una pantalla vacía.
 */
export function elegirMotor(
  pedido: MotorPedido,
  majorClase: number,
  hayJvmParaVineflower: boolean
): { motor: MotorDescompilador | null; degradado: boolean } {
  if (pedido === 'vineflower') {
    return hayJvmParaVineflower ? { motor: 'vineflower', degradado: false } : { motor: null, degradado: false }
  }
  if (pedido === 'cfr') return { motor: 'cfr', degradado: false }

  // auto: el bytecode manda.
  const preferido: MotorDescompilador =
    majorClase > 0 && majorClase < MAJOR_ENCLOSING_METHOD ? 'cfr' : 'vineflower'
  if (preferido === 'cfr') return { motor: 'cfr', degradado: false }
  return hayJvmParaVineflower
    ? { motor: 'vineflower', degradado: false }
    : { motor: 'cfr', degradado: true }
}

/**
 * De todas las JVM detectadas, la que se usará para un motor: la MAYOR que cumpla
 * su requisito. Se prefiere la mayor —y no la primera— porque una JVM moderna
 * descompila bytecode viejo sin problema, mientras que al revés no funciona.
 */
export function mejorJvmPara<T extends { major: number }>(
  jvms: readonly T[],
  motor: MotorDescompilador
): T | undefined {
  const minimo = REQUIERE_MAJOR[motor]
  let mejor: T | undefined
  for (const j of jvms) {
    if (j.major < minimo) continue
    if (mejor === undefined || j.major > mejor.major) mejor = j
  }
  return mejor
}

/** Ordena las JVM de mayor a menor versión (lo que espera ver el usuario en la lista). */
export function ordenarJvms<T extends { major: number; ruta: string }>(jvms: readonly T[]): T[] {
  return [...jvms].sort((a, b) => b.major - a.major || a.ruta.localeCompare(b.ruta, 'es'))
}

/** Quita duplicados por ruta (insensible a mayúsculas, que es como es Windows). */
export function dedupePorRuta<T extends { ruta: string }>(jvms: readonly T[]): T[] {
  const vistas = new Set<string>()
  const salida: T[] = []
  for (const j of jvms) {
    const clave = j.ruta.toLowerCase()
    if (vistas.has(clave)) continue
    vistas.add(clave)
    salida.push(j)
  }
  return salida
}
