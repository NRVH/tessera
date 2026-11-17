// =============================================================================
// API pública de la feature de terminales para las demás features: el store de las
// terminales de shell por proyecto, sus acciones, el tipo del hook de la ventana y el
// panel de la franja inferior, y el ciclo de vida del xterm que comparte el pane del
// agente (montaje, WebGL, apariencia, ajuste, buscador, pegado, control de flujo y
// botón de reinicio). El hook lo compone solo App.tsx y está en `app.ts`
// (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export { useStoreTerminales, accionesTerminales, fijarTerminalesPendientes, ordenTiraAGuardar, terminalesPendientes, type TerminalesGuardadas } from './store'
export { pestanasAGuardar } from './modeloPestanasSsh'
export type { TerminalesProyecto } from './modeloTerminalesShell'
export type { TerminalesApp } from './useTerminalesApp'
export { PanelTerminalesPuro } from './PanelTerminalesPuro'
export { ChipsImagenTerminal, type PreviaImagenPegada } from './ChipsImagenTerminal'
export { alPegarTerminal, insertarRutas, prepararRutasOPasarlas } from './pegadoPortapapeles'
export type { EscritorFlujo } from './controlFlujo'
export { debeAbrirMenuContextual, laAppUsaElRaton } from './comportamientoTerminal'
export { botonReinicio, textosReinicio } from './botonReinicio'
export { montarXterm, alternarWebgl, type OpcionesMontaje } from './montajeXterm'
export type { RefsXterm } from './sesionXterm'
export { useAparienciaXterm } from './useAparienciaXterm'
export { ajustarXterm, ajustarConRebote } from './ajusteTamano'
export { buscarEnXterm, cerrarBuscadorXterm, copiarSeleccion } from './buscadorXterm'
