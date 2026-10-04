// =============================================================================
// API pública de la feature de terminales para las demás features: el store de las
// terminales de shell por proyecto, sus acciones, el tipo del hook de la ventana y el
// panel de la franja inferior, y el ciclo de vida del xterm que comparte el pane del
// agente (montaje, WebGL, apariencia, ajuste, buscador, pegado, control de flujo y
// botón de reinicio). El hook lo compone solo App.tsx y está en `app.ts`
// (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export { useStoreTerminales, accionesTerminales } from './store'
export type { TerminalesApp } from './useTerminalesApp'
export { TerminalsPanel } from './TerminalsPanel'
export { TerminalImageChips, type PastedImagePreview } from './TerminalImageChips'
export { handleTerminalPaste, injectPaths, stageOrPassthrough } from './clipboardPaste'
export type { FlowWriter } from './flowControl'
export { debeAbrirMenuContextual, laAppUsaElRaton } from './comportamientoTerminal'
export { botonReinicio } from './reloadButton'
export { montarXterm, alternarWebgl, type OpcionesMontaje } from './montajeXterm'
export { useAparienciaXterm } from './useAparienciaXterm'
export { ajustarXterm, ajustarConRebote } from './ajusteTamano'
export { buscarEnXterm, cerrarBuscadorXterm, copiarSeleccion } from './buscadorXterm'
