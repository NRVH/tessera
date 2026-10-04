// =============================================================================
// Lo que de la feature de terminales solo compone App.tsx: el hook de terminales de
// la ventana. Las demás features usan `index.ts`; esto va aparte por la misma regla
// que en las demás features. Ver docs/decisiones/renderer/barriles-sin-ciclos.md.
// =============================================================================
export { useTerminalesApp } from './useTerminalesApp'
