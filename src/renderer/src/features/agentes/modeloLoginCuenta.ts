// =============================================================================
// En qué punto va el inicio de sesión de una cuenta de Docker: su fase, sus tres pasos, cuándo se ofrece ayuda y qué
// muestra de la terminal. Sin React ni IPC.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import type { IdAgente } from '../../../../shared/agentesManuales.ts'

export type FaseLogin = 'sin-proyecto' | 'preparando' | 'esperando' | 'confirmado' | 'error'
export type EstadoPaso = 'pendiente' | 'activo' | 'hecho' | 'error'

/** Lo que tarda en ofrecerse la ayuda de la autorización, en segundos. */
export const SEGUNDOS_AYUDA = 60

export function faseLogin(e: { conProyecto: boolean; confirmado: boolean; error: boolean; abierta: boolean }): FaseLogin {
  if (!e.conProyecto) return 'sin-proyecto'
  if (e.confirmado) return 'confirmado'
  if (e.error) return 'error'
  return e.abierta ? 'esperando' : 'preparando'
}

/** El entorno, la autorización y la confirmación. */
export function pasosLogin(fase: FaseLogin, abierta: boolean): [EstadoPaso, EstadoPaso, EstadoPaso] {
  if (fase === 'confirmado') return ['hecho', 'hecho', 'hecho']
  if (fase === 'esperando') return ['hecho', 'activo', 'pendiente']
  if (fase === 'error') return abierta ? ['hecho', 'error', 'pendiente'] : ['error', 'pendiente', 'pendiente']
  return fase === 'preparando' ? ['activo', 'pendiente', 'pendiente'] : ['pendiente', 'pendiente', 'pendiente']
}

/** Solo Codex se autoriza en el navegador: en los demás, el inicio de sesión se completa dentro de la terminal. */
export function loginGuiado(agente: IdAgente, manual: boolean): boolean {
  return agente === 'codex' && !manual
}

/** Con la terminal ya a la vista, la ayuda que remite a ella sobra. */
export function ayudaVisible(fase: FaseLogin, segundos: number, terminalVisible: boolean): boolean {
  return fase === 'esperando' && segundos >= SEGUNDOS_AYUDA && !terminalVisible
}

/** La terminal se abre sola con un error que dejó salida que consultar, salvo que el usuario haya decidido otra cosa. */
export function terminalVisible(e: { guiado: boolean; fase: FaseLogin; abierta: boolean; pedida: boolean | null }): boolean {
  if (e.fase === 'sin-proyecto') return false
  return !e.guiado || (e.pedida ?? (e.fase === 'error' && e.abierta))
}

export function relojEspera(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
}
