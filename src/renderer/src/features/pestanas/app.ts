// =============================================================================
// Lo que de la feature de pestañas solo compone App.tsx: el hook de pestañas, el modo
// del proyecto, las aperturas desde el sistema, los puntos y las tintas de perfil.
// Las demás features usan `index.ts`; esto no va allí para no cerrar un ciclo entre
// barriles. Ver docs/decisiones/renderer/barriles-sin-ciclos.md.
// =============================================================================
export { useTabs } from './useTabs'
export { useModoProyecto } from './useModoProyecto'
export { useAperturasApp } from './useAperturasApp'
export { usePuntosPerfil } from './usePuntosPerfil'
export { useTintasPerfil } from './useTintasPerfil'
