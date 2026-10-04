// =============================================================================
// Riel de actividad conectado a los stores: la vista lateral del perfil, el orden
// de sus dos grupos (arrastrables) y los conmutadores de la franja inferior, que en
// la vista de bases de datos llevan a Archivos y abren el panel.
// =============================================================================
import { useShallow } from 'zustand/react/shallow'
import { ActivityBar } from './ActivityBar'
import { fijadoresLayout, useStoreLayout } from './store'
import type { VistasPorPerfil } from './useVistasPorPerfil'
import type { ZonaEnfocada } from '../../util/zonaEnfocada'

interface Props {
  vistas: VistasPorPerfil
  zonaEnfocada: ZonaEnfocada
  worktreeCount: number | null
}

/** Riel de iconos de la izquierda. */
export function RielActividad({ vistas, zonaEnfocada, worktreeCount }: Props): React.JSX.Element {
  const { activityBarOrder, bottomBarOrder } = useStoreLayout(
    useShallow((s) => ({ activityBarOrder: s.activityBarOrder, bottomBarOrder: s.bottomBarOrder }))
  )
  const { enConexiones } = vistas
  return (
    <ActivityBar
      active={vistas.activeView}
      onSelect={(view) => vistas.setActiveView(view)}
      order={activityBarOrder}
      onReorder={fijadoresLayout.activityBarOrder}
      bottomOrder={bottomBarOrder}
      onReorderBottom={fijadoresLayout.bottomBarOrder}
      zonaEnfocada={zonaEnfocada}
      // En BD la franja no se ve: ningún botón se pinta abierto y pulsarlos abre en Archivos.
      panelInferior={enConexiones ? null : vistas.panelInferior}
      onTogglePanelInferior={enConexiones ? vistas.abrirPanelInferior : vistas.alternarPanelInferior}
      gitBadge={worktreeCount && worktreeCount > 0 ? worktreeCount : null}
    />
  )
}
