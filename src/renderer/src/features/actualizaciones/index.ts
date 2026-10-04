// =============================================================================
// API pública de la feature de actualizaciones de la app: el botón de la barra de
// título, el `UpdateState` del main y los textos del último chequeo, que también usan
// la categoría Actualizaciones de Configuración y el botón de agentes nativos.
// Es lo único que importan las demás features.
// =============================================================================
export { BotonActualizacion } from './BotonActualizacion'
export { TICK_ULTIMO_CHEQUEO_MS, textoUltimoChequeo } from './textoUpdate'
export { useEstadoUpdate } from './useBotonActualizacion'
