// =============================================================================
// API pública de la feature de ajustes para las demás features: el store de los
// ajustes globales, el guardado y el modal de Configuración conectado a los stores.
// Lo que solo compone App.tsx (densidad, persistencia, aviso de la integración) está
// en `app.ts` (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export { useStoreAjustes, fijarAjuste } from './store'
export type { Densidad } from './useDensidad'
export { guardarAjustes } from './usePersistenciaAjustes'
export { ModalAjustes } from './ModalAjustes'
