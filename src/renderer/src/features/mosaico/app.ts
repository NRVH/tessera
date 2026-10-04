// =============================================================================
// Lo que de la feature del mosaico solo compone App.tsx: el hook del mosaico de la
// ventana. Las demás features usan `index.ts`; esto no va allí para no cerrar un
// ciclo entre barriles. Ver docs/decisiones/renderer/barriles-sin-ciclos.md.
// =============================================================================
export { useMosaico } from './useMosaico'
