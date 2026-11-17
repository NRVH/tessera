// =============================================================================
// Cuándo un traspaso de «Continuar en…» que espera a su pane se aplica, se espera o se descarta, y cómo se
// reconoce el error de una apertura cuyo traspaso ya no existe en el main. Puro: lo prueba
// `test-sesion-agente.mts`.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { MARCA_TRASPASO_CADUCADO } from '../../../../shared/traspaso-ipc.ts'
import type { ModoAgente } from './modoAgente.ts'

/** Lo que de un traspaso pendiente decide qué hacer con él. */
export interface DestinoPendiente {
  /** Hasta cuándo vale (epoch ms): el main lo descarta pasada su vida y la apertura fallaría. */
  caduca: number
  modo: ModoAgente
  /** En Docker, la cuenta; en nativo, null. */
  cuentaId: string | null
}

/** Qué hacer ahora con un traspaso pendiente. */
export type DecisionTraspaso =
  /** Pasó su vida: se descarta y se avisa; nunca se cierra una sesión viva para abrirlo. */
  | 'caducado'
  /** El pane ya estuvo en su modo y cuenta y luego cambió a otro: el usuario cambió de idea; se descarta. */
  | 'descartar'
  /** El pane aún no está en su modo y cuenta (el cambio del store no llegó al render). */
  | 'esperar'
  /** El pane corre en su modo y con su cuenta: se aplica. */
  | 'aplicar'

/**
 * Decide qué hacer con el pendiente de un pane. `yaCoincidio` dice si este mismo traspaso ya vio al pane en su
 * modo y cuenta: un cambio posterior a otro modo o cuenta lo deja sin sentido.
 */
export function decidirTraspaso(
  p: DestinoPendiente,
  o: { ahora: number; modoNativo: boolean; cuenta: string | null; yaCoincidio: boolean }
): DecisionTraspaso {
  if (p.caduca <= o.ahora) return 'caducado'
  const coincide = (p.modo === 'nativo') === o.modoNativo && (p.modo !== 'docker' || o.cuenta === p.cuentaId)
  if (coincide) return 'aplicar'
  return o.yaCoincidio ? 'descartar' : 'esperar'
}

/** ¿Es el error de una apertura cuyo traspaso caducó o ya se gastó? Llega por IPC, así que se busca su marca. */
export function esTraspasoCaducado(err: unknown): boolean {
  return (err instanceof Error ? err.message : String(err)).includes(MARCA_TRASPASO_CADUCADO)
}
