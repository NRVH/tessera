// =============================================================================
// API pública de la feature de layout para las demás features: el store de la
// ventana, la regla del centro y los tipos de los hooks de vistas y tamaños. Los
// componentes que arman la ventana y sus hooks los compone solo App.tsx y están en
// `app.ts` (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export { useStoreLayout, fijadoresLayout, cambiarVistaSi } from './store'
export { derivarLayoutCentro, maximizadoCoherente, type SalidaLayoutCentro } from './layoutCentro'
export type { VistasPorPerfil } from './useVistasPorPerfil'
export type { Tamanos } from './useTamanos'
