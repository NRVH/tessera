// =============================================================================
// API pública de la feature de git para las demás features: el store compartido
// (ticks, historial, repos visibles), el ámbito de la caché de blobs, los paneles que
// compone el layout y lo que usan el editor y los demás paneles: el modelo de los
// diffs (blobs, editabilidad, lados, etiquetas), el árbol de archivos, los estilos,
// las marcas de estado y los iconos. Lo que solo compone App.tsx está en `app.ts`
// (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export { useStoreGit, avanzarWorktree, anotarReposVisibles, abrirHistorial, cerrarHistorial } from './store'
export { claveHistorial } from './modelo/historialPorProyecto'
export { etiquetaRevisiones } from './modelo/resolverDestinoDiffWorktree'
export type { EstadoGitApp } from './useEstadoGit'
export type { AccionesGit, AccionesGitDe } from './useAccionesGit'
export { PanelGit } from './PanelGit'
export { PanelLogGit } from './PanelLogGit'
export { traerBlob } from './modelo/cacheBlobs'
export { esDiffEditable, type ContenidoEnMemoria } from './modelo/editabilidadDiff'
export { esDiffDeUnLado } from './modelo/ladosDelDiff'
export { claseEstado, type DecoracionesWorktree } from './modelo/insigniaEstado'
export { aplanarArbolArchivos, construirArbolArchivos, type FilaArbol } from './modelo/arbolArchivos'
export { asegurarEstilosGit } from './estilosGit'
export { FilaArbolArchivo } from './FilaArbolArchivo'
export { Casilla } from './Casilla'
export { IconoCambios, IconoRama } from './iconos'
export { PermisosHooksGit } from './PermisosHooksGit'
