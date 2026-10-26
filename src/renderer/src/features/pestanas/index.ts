// =============================================================================
// API pública de la feature de pestañas (perfiles y proyectos) para las demás features:
// el modelo de targets, el store, las tintas de la banda, las pestañas, el punto de perfil y
// los tipos de los hooks de la ventana. Lo que solo compone App.tsx está en `app.ts`
// (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export type { UseTabs } from './useTabs'
export { agentTargetKey, type OpenAgentTarget, type OpenProject } from './tabsModel'
export { tintaPerfil, tintaResaltado, hexARgb } from './colorPerfil'
export { ProfileTabs, ProfileDot } from './ProfileTabs'
export { SelectorPerfil } from './SelectorPerfil'
export { ProjectTabs } from './ProjectTabs'
export type { ProfileDotState, ProjectDotState } from './profileDotState'
export { useStorePestanas, leerTabs, despacharTabs } from './store'
export type { usePuntosPerfil } from './usePuntosPerfil'
