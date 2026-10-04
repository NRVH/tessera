// =============================================================================
// API pública de la feature de pestañas (perfiles y proyectos) para las demás features:
// el modelo de targets, el store del modo de los proyectos, las tintas de la banda, el
// modal de modo y las pestañas, el punto de perfil, el icono de modo y los tipos de los
// hooks de la ventana. Lo que solo compone App.tsx está en `app.ts`
// (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export type { UseTabs, DecideProjectMode } from './useTabs'
export { agentTargetKey, backendAnclado, type OpenAgentTarget, type OpenProject } from './tabsModel'
export { tintaPerfil, tintaResaltado, hexARgb } from './colorPerfil'
export { ProfileTabs, ProfileDot } from './ProfileTabs'
export { ProjectTabs } from './ProjectTabs'
export { ModeIcon } from './modeIcon'
export type { ProfileDotState, ProjectDotState } from './profileDotState'
export { useStorePestanas, asegurarModoNativo } from './store'
export type { ModoProyecto } from './useModoProyecto'
export type { usePuntosPerfil } from './usePuntosPerfil'
export { ProjectModeModal } from './ProjectModeModal'
