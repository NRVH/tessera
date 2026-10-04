// =============================================================================
// workspaceSnapshot: puente puro entre el estado en memoria de las pestañas
// (TabsState, tabsModel) y el documento persistido (WorkspaceState). Sin React ni IPC.
// serializeWorkspace proyecta el esqueleto (perfil activo, proyectos con path, nombre y
// estado, activo por perfil) y descarta lo derivado (repoState) y lo efímero (sesiones);
// persistedToProfileTabs y restoredSessionFromState hacen el camino inverso, y un
// proyecto hibernado amanece hibernado. Lo usa usePersistenciaTabs.
// =============================================================================

import type { ProfileTabs, RestoredSession, TabsState } from './tabsModel'
import type {
  PersistedProfileTabs,
  WorkspaceState
} from '../../../../shared/workspace-state-ipc'

/**
 * Proyecta el TabsState vivo al documento persistible. Omite los perfiles SIN
 * proyectos abiertos (entrada innecesaria: al restaurar caen al estado por
 * defecto vacío) y todo lo derivado/efímero. `activeProfileId` se conserva
 * aunque su perfil esté vacío.
 */
export function serializeWorkspace(state: TabsState): WorkspaceState {
  const byProfile: Record<string, PersistedProfileTabs> = {}
  for (const [profileId, tabs] of Object.entries(state.byProfile)) {
    if (tabs.openProjects.length === 0) continue // perfil vacío: no se persiste
    byProfile[profileId] = {
      // La marca solo se escribe cuando existe: un proyecto sin ella sale byte a byte igual.
      openProjects: tabs.openProjects.map((p) => ({
        projectHostPath: p.projectHostPath,
        name: p.name,
        // 'agente-hibernado' es de la sesión: en disco es un hibernado más.
        estado: p.estado === 'active' ? ('active' as const) : ('hibernated' as const),
        ...(p.agenteDiferido === true ? { agenteDiferido: true as const } : {})
      })),
      activePath: tabs.activePath
    }
  }
  // `version: 1` literal (no un import de valor a propósito): así este módulo solo
  // tiene imports de TIPO y corre bajo `node` en los tests, igual que tabsModel. El
  // tipo WorkspaceState fija `version: 1`, de modo que el compilador lo verifica.
  return { version: 1, activeProfileId: state.activeProfileId, byProfile }
}

/**
 * Reconstruye el ProfileTabs en memoria de UN perfil a partir de su estado
 * persistido. `repoState` arranca VACÍO: los repos son nivel 3 derivado del
 * escaneo, que se vuelve a disparar al activar el proyecto (no se persisten).
 */
export function persistedToProfileTabs(persisted: PersistedProfileTabs): ProfileTabs {
  return {
    openProjects: persisted.openProjects.map((p) => ({
      projectHostPath: p.projectHostPath,
      name: p.name,
      // Un proyecto hibernado se restaura hibernado, no forzado a 'active'.
      estado: p.estado,
      ...(p.agenteDiferido === true ? { agenteDiferido: true as const } : {})
    })),
    activePath: persisted.activePath,
    repoState: {}
  }
}

/**
 * Convierte el estado persistido COMPLETO (o null) a la sesión restaurada que
 * consume el reducer (`init.restored`). PURO: no filtra por perfiles actuales —
 * eso lo hace initialTabsState al iterar los perfiles reales (un id obsoleto aquí
 * es inofensivo). `null` (sin archivo / corrupto) -> sesión vacía = arranque
 * limpio. Las rutas inexistentes ya vienen podadas del `load` del main.
 */
export function restoredSessionFromState(state: WorkspaceState | null): RestoredSession {
  if (state === null) return { activeProfileId: null, byProfile: {} }
  const byProfile: Record<string, ProfileTabs> = {}
  for (const [profileId, tabs] of Object.entries(state.byProfile)) {
    byProfile[profileId] = persistedToProfileTabs(tabs)
  }
  return { activeProfileId: state.activeProfileId, byProfile }
}
