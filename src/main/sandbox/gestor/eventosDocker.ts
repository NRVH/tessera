// =============================================================================
// Los eventos de Docker que vigila el supervisor: qué se pide a `docker events` (solo los
// contenedores de esta instancia), cómo se lee una línea y por qué murió un contenedor. Puro y
// sin Docker: lo prueba `test-supervisor.mts`.
// Decisiones: docs/decisiones/sandbox/supervisor-de-contenedores.md
// =============================================================================
import { ETIQUETA_INSTANCIA } from '../contenedoresPropios.ts'

/** Lo que interesa de un contenedor: que murió, que se quedó sin memoria o que lo borraron. */
export type AccionContenedor = 'die' | 'oom' | 'destroy'

const ACCIONES: readonly AccionContenedor[] = ['die', 'oom', 'destroy']

/** Un evento de contenedor ya leído. `exitCode` solo lo trae `die`. */
export interface EventoContenedor {
  accion: AccionContenedor
  id: string
  nombre: string
  exitCode: number | null
}

/** Por qué murió el contenedor de un perfil sin que Tessera lo parara. */
export type CausaMuerte = 'sin-memoria' | 'murio'

/**
 * Argumentos de `docker events`: solo contenedores, solo esas acciones y solo los de esta
 * instancia (su etiqueta). Sin sello (las pruebas que no pasan por el main) se filtra por el
 * prefijo del nombre.
 */
export function argsEventos(sello: string): string[] {
  const deInstancia = sello === '' ? ['--filter', 'name=tessera-'] : ['--filter', `label=${ETIQUETA_INSTANCIA}=${sello}`]
  return [
    'events',
    '--format',
    '{{json .}}',
    '--filter',
    'type=container',
    ...ACCIONES.flatMap((a) => ['--filter', `event=${a}`]),
    ...deInstancia
  ]
}

function esAccion(valor: unknown): valor is AccionContenedor {
  return typeof valor === 'string' && (ACCIONES as readonly string[]).includes(valor)
}

/** La forma de un evento de `docker events`; todo puede faltar (versiones distintas de Docker). */
interface EventoCrudo {
  Action?: unknown
  status?: unknown
  id?: unknown
  Actor?: { ID?: unknown; Attributes?: Record<string, unknown> }
}

function parsear(linea: string): EventoCrudo | null {
  try {
    const crudo: unknown = JSON.parse(linea)
    return typeof crudo === 'object' && crudo !== null ? (crudo as EventoCrudo) : null
  } catch {
    return null
  }
}

function codigoDe(valor: unknown): number | null {
  const codigo = Number.parseInt(String(valor ?? ''), 10)
  return Number.isNaN(codigo) ? null : codigo
}

/** Una línea de `docker events --format '{{json .}}'`, o null si no es un evento que interese. */
export function leerEvento(linea: string): EventoContenedor | null {
  const e = parsear(linea)
  if (!e) return null
  const accion = e.Action ?? e.status
  const id = e.Actor?.ID ?? e.id
  const atributos = e.Actor?.Attributes ?? {}
  const nombre = atributos.name
  if (!esAccion(accion) || typeof id !== 'string' || id === '' || typeof nombre !== 'string') return null
  return { accion, id, nombre, exitCode: codigoDe(atributos.exitCode) }
}

/**
 * Por qué murió: sin memoria si Docker avisó de un OOM de ese contenedor antes de su `die`. El
 * 137 a secas no basta: también es un `docker kill` o el cierre de Docker Desktop.
 */
export function causaDeMuerte(oomVisto: boolean): CausaMuerte {
  return oomVisto ? 'sin-memoria' : 'murio'
}

/**
 * Esperas antes de cada intento de volver a escuchar con Docker caído: crecen y se quedan en la
 * última. Un daemon que arranca tarda; uno parado no merece una sonda por segundo.
 */
export const ESPERAS_RECONEXION_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000]

/** La espera del intento `n` (0 = el primero). */
export function esperaReconexion(n: number): number {
  return ESPERAS_RECONEXION_MS[Math.min(Math.max(n, 0), ESPERAS_RECONEXION_MS.length - 1)]
}
