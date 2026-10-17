// =============================================================================
// API pública de la feature de git para las demás features: el store compartido
// (ticks, historial, repos visibles), el ámbito de la caché de blobs, los paneles que
// compone el layout y lo que usan el editor y los demás paneles: el modelo de los
// diffs (blobs, editabilidad, lados, etiquetas), el árbol de archivos, los estilos,
// las marcas de estado y los iconos. Lo que solo compone App.tsx está en `app.ts`
// (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export { useStoreGit, bumpWorktree, anotarReposVisibles, abrirHistorial, cerrarHistorial } from './store'
export { claveHistorial } from './modelo/historialPorProyecto'
export { etiquetaRevisiones } from './modelo/resolveWorkingDiffTarget'
export type { EstadoGitApp } from './useEstadoGit'
export type { AccionesGit, AccionesGitDe } from './useAccionesGit'
export { GitPanel } from './GitPanel'
export { GitLogPanel } from './GitLogPanel'
export { fetchBlob } from './modelo/blobCache'
export { isDiffEditable, type ContenidoEnMemoria } from './modelo/diffEditability'
export { esDiffDeUnLado } from './modelo/ladosDelDiff'
export { statusClass, type WorktreeDecorations } from './modelo/statusBadge'
export { aplanarArbolArchivos, construirArbolArchivos, type FilaArbol } from './modelo/arbolArchivos'
export { asegurarEstilosGit } from './estilosGit'
export { FilaArbolArchivo } from './FilaArbolArchivo'
export { Casilla } from './Casilla'
export { IconoCambios, IconoRama } from './iconos'
