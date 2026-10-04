// =============================================================================
// Caducidad de las ventanas de uso (5 h y semanal): una ventana cuyo `resets_at` ya pasó se pone a
// 0 % y se marca `reiniciada`, por ventana y no por snapshot.
// El `resets_at` vencido se retira en vez de extrapolarse: la ventana nueva cuenta desde la próxima
// petición.
// Puro y sin E/S. Decisiones: docs/decisiones/agentes/uso-de-cuenta.md
// =============================================================================

import type { UsageSnapshot, UsageWindow } from '../../shared/usage-ipc'

/** ¿Esta ventana ya se reinició? Sin fecha de reinicio no se puede saber: no caduca. */
export function ventanaCaducada(w: UsageWindow, ahora: number): boolean {
  return typeof w.resetsAt === 'number' && w.resetsAt <= ahora
}

/** ¿Alguna ventana del snapshot ya se reinició? Decide si vale la pena releer la fuente. */
export function algunaCaducada(snap: UsageSnapshot | undefined, ahora: number): boolean {
  return !!snap?.windows.some((w) => ventanaCaducada(w, ahora))
}

/**
 * Devuelve el snapshot con las ventanas ya reiniciadas a 0 % y marcadas. IDENTIDAD
 * ESTABLE si no había ninguna: el llamador puede pasarlo por aquí siempre sin
 * fabricar objetos nuevos en cada sondeo.
 */
export function caducarSnapshot(snap: UsageSnapshot, ahora: number): UsageSnapshot {
  if (!algunaCaducada(snap, ahora)) return snap
  return {
    ...snap,
    windows: snap.windows.map((w) => {
      if (!ventanaCaducada(w, ahora)) return w
      // `resetsAt` fuera a propósito (ver cabecera): la ventana nueva no tiene fecha
      // conocida hasta que el agente vuelva a pedir algo.
      const { resetsAt: _vencido, ...resto } = w
      return { ...resto, percent: 0, reiniciada: true }
    })
  }
}

// NOTA: `proximoReset` NO está aquí, está en `shared/usage-ipc.ts`. Lo usa el RENDERER
// (para reconsultar justo después del reinicio) y este módulo es del MAIN: importarlo
// desde el renderer funcionaba solo por casualidad —hoy este archivo únicamente importa
// un tipo—, y se rompería el día que alguien le añada `node:fs` o `electron`, que es
// justo lo que su carpeta invita a hacer. Como opera sobre el contrato compartido, su
// sitio es el contrato.
