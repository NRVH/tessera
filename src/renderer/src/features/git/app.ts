// =============================================================================
// Lo que de la feature de git solo compone App.tsx: el estado del árbol de trabajo y
// las acciones de la ventana. Las demás features usan `index.ts`; esto no va allí
// para no cerrar un ciclo entre barriles.
// Ver docs/decisiones/renderer/barriles-sin-ciclos.md.
// =============================================================================
export { useEstadoGit } from './useEstadoGit'
export { useAccionesGit } from './useAccionesGit'
