// =============================================================================
// Lo que de la feature de layout solo compone App.tsx: los hooks de vistas, tamaños,
// atajos, pantalla completa y estilo del shell, y los componentes que arman la ventana. Las demás
// features usan `index.ts` (el store y la regla del centro); esto no va allí para no
// cerrar un ciclo entre barriles. Ver docs/decisiones/renderer/barriles-sin-ciclos.md.
// =============================================================================
export { useVistasPorPerfil } from './useVistasPorPerfil'
export { useTamanos } from './useTamanos'
export { useAtajosGlobales } from './useAtajosGlobales'
export { useEstiloShell } from './estiloShell'
export { clasesPantallaCompleta, usePantallaCompletaFranja } from './usePantallaCompletaFranja'
export { useAtajoPantallaCompleta } from './useAtajoPantallaCompleta'
export { BarraTitulo } from './BarraTitulo'
export { RielActividad } from './RielActividad'
export { PanelLateral } from './PanelLateral'
export { FranjaInferior } from './FranjaInferior'
export { BarraEstadoApp } from './BarraEstadoApp'
export { CapaModales } from './CapaModales'
export { ShutdownOverlay } from './ShutdownOverlay'
