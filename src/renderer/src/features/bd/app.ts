// =============================================================================
// Lo que de la feature de bases de datos solo compone App.tsx: los hooks de la
// ventana (espacios de datos, montajes, vista de BD) y el centro de BD. Las demás
// features usan `index.ts`; esto no va allí para no cerrar un ciclo entre barriles.
// Ver docs/decisiones/renderer/barriles-sin-ciclos.md.
// =============================================================================
export { useEspaciosDatos } from './useEspaciosDatos'
export { useMontajesBd } from './useMontajesBd'
export { useBdApp } from './useBdApp'
export { CentroBd } from './CentroBd'
