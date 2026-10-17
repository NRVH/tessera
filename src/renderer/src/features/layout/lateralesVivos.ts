// =============================================================================
// Qué vistas del panel lateral siguen montadas, ocultas, mientras se ve otra: las que guardan piezas
// vivas por perfil o por proyecto (el árbol de BD, el explorador), para que al volver a ellas, desde
// otra vista o desde otro perfil, estén tal cual. La de git no guarda nada así y se monta al verse.
// Puro, sin más import que los tipos: lo prueba `test-laterales-vivos.mts` con `node`.
// Decisiones: docs/decisiones/renderer/vivos-y-ocultos.md
// =============================================================================

/** Mismo tipo que `ActivityView` de ActivityBar (redeclarado para no importar un .tsx). */
export type VistaLateral = 'files' | 'git' | 'db'

/** Las vistas cuyo lateral se conserva montado aunque se mire otra. */
const CONSERVADAS: readonly VistaLateral[] = ['files', 'db']

/** Un conjunto por vista activa, con identidad estable: el render no rehace la lista sin motivo. */
const POR_ACTIVA = new Map<VistaLateral, ReadonlySet<string>>(
  (['files', 'git', 'db'] as const).map((activa) => [activa, new Set<string>([...CONSERVADAS, activa])])
)

/**
 * Los laterales que pueden seguir montados mientras se ve `activa`: los que se conservan y el que se
 * ve. Lo demás (el de git, cuando se mira otra vista) sale de los vivos.
 */
export function lateralesMontables(activa: VistaLateral): ReadonlySet<string> {
  return POR_ACTIVA.get(activa) ?? new Set([...CONSERVADAS, activa])
}
