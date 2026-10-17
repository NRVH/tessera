// =============================================================================
// Cuándo enseña un panel que está cargando: nada los primeros 250 ms, el aviso discreto hasta
// los 5 s y, pasados, «está tardando más de lo habitual». Una vez visible se queda un mínimo
// para no hacer destello. Puro (los instantes entran por parámetro) para probarlo con `node` en
// `test-carga-diferida.mts`; el hook es `useCargaDiferida.ts`.
// Decisiones: docs/decisiones/renderer/carga-diferida.md
// =============================================================================

/** Lo que se ve de una carga: nada, el aviso de carga o el de que tarda. */
export type FaseCarga = 'nada' | 'cargando' | 'tardando'

/** Por debajo de esto una carga no se anuncia: el aviso sería un parpadeo. */
export const RETRASO_INDICADOR_MS = 250
/** Desde el inicio: a partir de aquí la espera ya no es la habitual. */
export const UMBRAL_TARDANDO_MS = 5000
/** Lo que el aviso, una vez visible, sigue a la vista aunque la carga acabe antes. */
export const MINIMO_VISIBLE_MS = 300

/** El inicio de la espera y su fin (null mientras sigue). */
export interface MarcasCarga {
  inicio: number
  fin: number | null
}

/** La fase en un instante y cuándo cambia (null = ya no cambia sola). */
export interface EvaluacionCarga {
  fase: FaseCarga
  proximoCambio: number | null
}

/** La fase de una carga en `ahora` y el instante del próximo cambio, para un solo temporizador. */
export function evaluarCarga(m: MarcasCarga, ahora: number): EvaluacionCarga {
  const visibleDesde = m.inicio + RETRASO_INDICADOR_MS
  if (m.fin === null || ahora < m.fin) {
    const transcurrido = ahora - m.inicio
    if (transcurrido < RETRASO_INDICADOR_MS) return { fase: 'nada', proximoCambio: visibleDesde }
    if (transcurrido < UMBRAL_TARDANDO_MS) return { fase: 'cargando', proximoCambio: m.inicio + UMBRAL_TARDANDO_MS }
    return { fase: 'tardando', proximoCambio: null }
  }
  // Acabó: si no llegó a verse, nada; si se vio, sigue hasta cumplir su mínimo.
  if (m.fin <= visibleDesde) return { fase: 'nada', proximoCambio: null }
  const hasta = Math.max(m.fin, visibleDesde + MINIMO_VISIBLE_MS)
  if (ahora >= hasta) return { fase: 'nada', proximoCambio: null }
  const fase: FaseCarga = m.fin - m.inicio >= UMBRAL_TARDANDO_MS ? 'tardando' : 'cargando'
  return { fase, proximoCambio: hasta }
}

/**
 * Las marcas tras saber si se carga en `ahora`. Una carga que vuelve mientras el aviso aún se ve
 * continúa la anterior: empezar de cero lo escondería 250 ms para volver a enseñarlo.
 */
export function anotarCarga(previas: MarcasCarga | null, cargando: boolean, ahora: number): MarcasCarga | null {
  if (cargando) {
    if (previas === null) return { inicio: ahora, fin: null }
    if (previas.fin === null) return previas
    if (evaluarCarga(previas, ahora).fase !== 'nada') return { inicio: previas.inicio, fin: null }
    return { inicio: ahora, fin: null }
  }
  if (previas !== null && previas.fin === null) return { inicio: previas.inicio, fin: ahora }
  return previas
}

/** Las marcas al montar: sin carga, ninguna; cargando, la espera empieza `ahora`. */
export function marcasAlMontar(cargando: boolean, ahora: number): MarcasCarga | null {
  return cargando ? { inicio: ahora, fin: null } : null
}

/** Si el aviso ocupa el sitio del contenido: mientras carga o mientras cumple su mínimo visible. */
export function cargaOcupa(cargando: boolean, fase: FaseCarga): boolean {
  return cargando || fase !== 'nada'
}
