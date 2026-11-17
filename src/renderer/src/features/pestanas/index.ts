// =============================================================================
// API pública de la feature de pestañas (perfiles y proyectos) para las demás features:
// el modelo de targets, el store, las tintas de la banda, las pestañas, el punto de perfil y
// los tipos de los hooks de la ventana. Lo que solo compone App.tsx está en `app.ts`
// (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export type { UsePestanas } from './usePestanas'
export { claveDestinoAgente, type DestinoAgenteAbierto, type ProyectoAbiertoDePerfil } from './modeloPestanas'
export { seleccionarProyectoActivoGlobal } from './modeloPestanas'
export { tintaPerfil, tintaResaltado, hexARgb } from './colorPerfil'
export { PestanasPerfil, PuntoColorPerfil } from './PestanasPerfil'
export { SelectorPerfil } from './SelectorPerfil'
export { PestanasProyecto } from './PestanasProyecto'
export type { EstadoPuntoPerfil, EstadoPuntoProyecto } from './estadosPunto'
export { useStorePestanas, leerPestanas, despacharPestanas } from './store'
export { DiffReglas } from './DiffReglas'
export { useStorePropuestasReglas, revisarPropuesta } from './storePropuestasReglas'
export type { usePuntosPerfil } from './usePuntosPerfil'
