// =============================================================================
// Las decisiones de las ventanas de agente que no necesitan Electron: qué crea un arranque en frío,
// qué hace una segunda instancia, qué cierra la X de cada ventana, las tareas de la Jump List y el
// menú del Dock, y qué ventanas se restauran tras «Reiniciar para actualizar». Puro, con su prueba
// (`test-ventanas-agente.mts`); lo usan `ventanaAgente.ts`, `instanciaUnica.ts` e `index.ts`.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import { ARGUMENTO_VENTANA_AGENTE } from '../../shared/ventana-agente-ipc.ts'
import { esAgenteManual } from '../../shared/agentesManuales.ts'
import type { IdAgente } from '../../shared/agentesManuales.ts'

/** Qué crea un arranque en frío: la principal salvo que se pida solo una ventana de agente. */
export function ventanasDelArranque(e: { pideAgente: boolean; conRutas: boolean }): { principal: boolean; agente: boolean } {
  // Con rutas que abrir manda la principal: son proyectos, y sin ella se quedarían en la cola.
  return { principal: !e.pideAgente || e.conRutas, agente: e.pideAgente }
}

/** Lo que hace una segunda instancia (otro clic en el icono, la Jump List, «Abrir con Tessera»). */
export type DecisionSegundaInstancia =
  /** Abrir ya una ventana de agente. */
  | 'ventana-agente'
  /** El arranque sigue en curso: se abre al terminarlo. */
  | 'ventana-agente-al-arrancar'
  /** Arrancando: se atiende al mostrar la principal o, si no la hay, al terminar. */
  | 'pendiente'
  | 'traer-principal'
  /** No hay principal (se cerró con ventanas de agente abiertas): se vuelve a crear. */
  | 'crear-principal'

export function decidirSegundaInstancia(e: { pideAgente: boolean; arranqueTerminado: boolean; hayPrincipal: boolean }): DecisionSegundaInstancia {
  if (e.pideAgente) return e.arranqueTerminado ? 'ventana-agente' : 'ventana-agente-al-arrancar'
  if (!e.arranqueTerminado) return 'pendiente'
  return e.hayPrincipal ? 'traer-principal' : 'crear-principal'
}

/** La X de la principal: con ventanas de agente vivas cierra solo lo suyo; sin ellas, la app. */
export function alCerrarPrincipal(ventanasAgente: number): 'solo-principal' | 'app' {
  return ventanasAgente > 0 ? 'solo-principal' : 'app'
}

/** Tras cerrar una ventana de agente: si no queda ninguna ventana, se cierra la app. */
export function trasCerrarVentanaAgente(e: { quedanAgente: number; hayPrincipal: boolean }): 'nada' | 'cerrar-app' {
  return e.quedanAgente === 0 && !e.hayPrincipal ? 'cerrar-app' : 'nada'
}

/** Una tarea de la Jump List, sin el programa ni el icono (los pone quien la instala). */
export interface TareaJumpList {
  argumentos: string
  titulo: string
  descripcion: string
}

/**
 * Las tareas de la Jump List: siempre «Nueva ventana de agente» y, mientras no haya ventana
 * principal, «Abrir Tessera» (con la app cerrada el icono ya la abre, y sobra).
 */
export function tareasJumpList(
  e: { appViva: boolean; hayPrincipal: boolean },
  t: { nueva: string; nuevaDescripcion: string; abrir: string; abrirDescripcion: string }
): TareaJumpList[] {
  const tareas: TareaJumpList[] = [{ argumentos: ARGUMENTO_VENTANA_AGENTE, titulo: t.nueva, descripcion: t.nuevaDescripcion }]
  if (e.appViva && !e.hayPrincipal) tareas.push({ argumentos: '', titulo: t.abrir, descripcion: t.abrirDescripcion })
  return tareas
}

/** Una entrada del menú del Dock; `accion` dice qué hace al pulsarla. */
export interface EntradaDock {
  label: string
  accion: 'nueva-ventana-agente' | 'abrir-principal'
}

/** El menú del Dock (macOS): «Nueva ventana de agente» y, sin principal, «Abrir Tessera». */
export function entradasDock(hayPrincipal: boolean, t: { nueva: string; abrir: string }): EntradaDock[] {
  const entradas: EntradaDock[] = [{ label: t.nueva, accion: 'nueva-ventana-agente' }]
  if (!hayPrincipal) entradas.push({ label: t.abrir, accion: 'abrir-principal' })
  return entradas
}

/** Una ventana de agente que se reabre tras actualizar: su agente y su conversación. */
export interface VentanaARestaurar {
  agente: IdAgente
  conversacion?: string
}

/** Lo que se guarda en disco antes de instalar una actualización que relanza la app. */
export interface ArchivoRestauracion {
  escritoEn: number
  ventanas: VentanaARestaurar[]
}

/** Más viejo que esto, el archivo no es de la actualización de ahora: un arranque normal no restaura. */
export const VIGENCIA_RESTAURACION_MS = 30 * 60_000
/** Tope de ventanas que se reabren solas: un archivo raro no puede abrir cien. */
export const MAX_VENTANAS_RESTAURADAS = 8

const ID_CONVERSACION = /^[A-Za-z0-9._:-]{1,200}$/

function esAgenteValido(x: unknown): x is IdAgente {
  return x === 'claude-code' || x === 'codex' || (typeof x === 'string' && esAgenteManual(x) && x.length <= 80)
}

/** Las ventanas de un archivo de restauración leído del disco, ya saneadas; [] si no vale o es viejo. */
export function ventanasARestaurar(crudo: unknown, ahora: number): VentanaARestaurar[] {
  if (!crudo || typeof crudo !== 'object') return []
  const a = crudo as Partial<ArchivoRestauracion>
  if (typeof a.escritoEn !== 'number' || !Array.isArray(a.ventanas)) return []
  const edad = ahora - a.escritoEn
  if (edad < 0 || edad > VIGENCIA_RESTAURACION_MS) return []
  const fuera: VentanaARestaurar[] = []
  for (const v of a.ventanas as unknown[]) {
    if (fuera.length >= MAX_VENTANAS_RESTAURADAS) break
    if (!v || typeof v !== 'object') continue
    const { agente, conversacion } = v as Record<string, unknown>
    if (!esAgenteValido(agente)) continue
    fuera.push(typeof conversacion === 'string' && ID_CONVERSACION.test(conversacion) ? { agente, conversacion } : { agente })
  }
  return fuera
}
