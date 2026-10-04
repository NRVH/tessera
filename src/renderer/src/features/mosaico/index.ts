// =============================================================================
// API pública de la feature del mosaico de agentes para las demás features: el store
// y sus acciones, las reglas puras (qué entra y cómo se distribuye), el tipo del hook
// de la ventana y la marca de «está en el mosaico». La barra del mosaico la pinta la
// barra de título. El hook lo compone solo App.tsx y está en `app.ts`
// (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export {
  useStoreMosaico,
  salirMosaico,
  enfocarCasilla,
  ampliarCasilla,
  verCasilla,
  setMosaicoPreset,
  setDisposicionMosaico
} from './store'
export { claveVista, ordenarCandidatos, type CandidatoMosaico, type OpcionMosaico } from './mosaicoTeselas'
export type { MosaicoApp } from './useMosaico'
export { BarraMosaico } from './BarraMosaico'
export { PuntoMosaico } from './PuntoMosaico'
export {
  calcularMosaico,
  type CeldaMosaico,
  type DisposicionMosaico,
  type PresetMosaico
} from './mosaicoLayout'
