// =============================================================================
// Caducidad de las ventanas de uso (5 h y semanal): una ventana cuyo `resets_at` ya pasó se pone a
// 0 % y se marca `reiniciada`, por ventana y no por snapshot.
// El `resets_at` vencido se retira en vez de extrapolarse: la ventana nueva cuenta desde la próxima
// petición.
// Puro y sin E/S. Decisiones: docs/decisiones/agentes/uso-de-cuenta.md
// =============================================================================

import type { FotoUso, VentanaUso } from '../../shared/usage-ipc'

/** ¿Esta ventana ya se reinició? Sin fecha de reinicio no se puede saber: no caduca. */
export function ventanaCaducada(w: VentanaUso, ahora: number): boolean {
  return typeof w.restablecimientoEn === 'number' && w.restablecimientoEn <= ahora
}

/** ¿Alguna ventana del snapshot ya se reinició? Decide si vale la pena releer la fuente. */
export function algunaCaducada(foto: FotoUso | undefined, ahora: number): boolean {
  return !!foto?.windows.some((w) => ventanaCaducada(w, ahora))
}

/**
 * Devuelve el snapshot con las ventanas ya reiniciadas a 0 % y marcadas. IDENTIDAD
 * ESTABLE si no había ninguna: el llamador puede pasarlo por aquí siempre sin
 * fabricar objetos nuevos en cada sondeo.
 */
export function caducarFoto(foto: FotoUso, ahora: number): FotoUso {
  if (!algunaCaducada(foto, ahora)) return foto
  return {
    ...foto,
    windows: foto.windows.map((w) => {
      if (!ventanaCaducada(w, ahora)) return w
      // `restablecimientoEn` fuera a propósito (ver cabecera): la ventana nueva no tiene fecha
      // conocida hasta que el agente vuelva a pedir algo.
      const { restablecimientoEn: _vencido, ...resto } = w
      return { ...resto, porcentaje: 0, reiniciada: true }
    })
  }
}

// NOTA: `proximoRestablecimiento` NO está aquí, está en `shared/usage-ipc.ts`. Lo usa el RENDERER
// (para reconsultar justo después del reinicio) y este módulo es del MAIN: importarlo
// desde el renderer funcionaba solo por casualidad —hoy este archivo únicamente importa
// un tipo—, y se rompería el día que alguien le añada `node:fs` o `electron`, que es
// justo lo que su carpeta invita a hacer. Como opera sobre el contrato compartido, su
// sitio es el contrato.
