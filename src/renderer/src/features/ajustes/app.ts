// =============================================================================
// Lo que de la feature de ajustes solo compone App.tsx: la densidad de la interfaz,
// la persistencia de los ajustes y el aviso de la integración con el sistema. Las
// demás features usan `index.ts`; esto no va allí para no cerrar un ciclo entre
// barriles. Ver docs/decisiones/renderer/barriles-sin-ciclos.md.
// =============================================================================
export { useDensidad } from './useDensidad'
export { usePersistenciaAjustes } from './usePersistenciaAjustes'
export { useAvisoIntegracion } from './useAvisoIntegracion'
