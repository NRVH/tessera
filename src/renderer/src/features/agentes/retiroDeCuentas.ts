// =============================================================================
// Los panes con cuenta de la ventana, para cerrar sesión, eliminar o renombrar una cuenta desde
// cualquiera: el main cierra todas sus sesiones, y los demás panes que la tenían abierta tienen que
// enterarse para soltarla y reabrir (con login de cero o con otra cuenta), o para enseñar su nombre.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================

export type RetiroCuenta = 'logout' | 'eliminada'

export interface PaneConCuenta {
  /** ¿Tiene ahora una sesión abierta con esta cuenta? */
  usa: (accountId: string) => boolean
  /** Otro pane cerró la sesión de la cuenta o la eliminó: el main ya cerró las sesiones. */
  alRetirar: (accountId: string, motivo: RetiroCuenta) => void
  /** Otro pane la renombró: el que la tiene elegida relee su lista para enseñar el nombre nuevo. */
  alRenombrar: (accountId: string) => void
}

const panes = new Set<PaneConCuenta>()

/** Apunta un pane; devuelve cómo borrarlo al desmontarse. */
export function registrarPaneConCuenta(pane: PaneConCuenta): () => void {
  panes.add(pane)
  return () => {
    panes.delete(pane)
  }
}

/** Cuántos panes, sin contar `salvo`, tienen una sesión abierta con la cuenta. */
export function otrosQueUsan(accountId: string, salvo: PaneConCuenta): number {
  let n = 0
  for (const p of panes) if (p !== salvo && p.usa(accountId)) n++
  return n
}

/** Avisa a los demás panes de que la cuenta se retiró. */
export function avisarRetiro(accountId: string, motivo: RetiroCuenta, salvo: PaneConCuenta): void {
  for (const p of [...panes]) if (p !== salvo) p.alRetirar(accountId, motivo)
}

/** Avisa a los demás panes de que la cuenta cambió de nombre. */
export function avisarRenombre(accountId: string, salvo: PaneConCuenta): void {
  for (const p of [...panes]) if (p !== salvo) p.alRenombrar(accountId)
}
