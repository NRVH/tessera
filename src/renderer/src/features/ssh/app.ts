// =============================================================================
// Lo que de la feature de conexiones SSH solo compone App.tsx: el hook que carga las conexiones del
// main y las mantiene al día. Las demás features usan `index.ts`; esto va aparte por la misma regla
// que en las demás features. Ver docs/decisiones/renderer/barriles-sin-ciclos.md.
// =============================================================================
export { useConexionesSsh } from './useConexionesSsh'
