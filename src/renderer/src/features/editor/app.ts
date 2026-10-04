// =============================================================================
// Lo que de la feature del editor solo compone App.tsx: el hook de pestañas de la
// ventana, la recarga en vivo y el área central. Las demás features usan `index.ts`;
// esto no va allí para no cerrar un ciclo entre barriles.
// Ver docs/decisiones/renderer/barriles-sin-ciclos.md.
// =============================================================================
export { useEditorApp } from './useEditorApp'
export { useRecargaEnVivo } from './useRecargaEnVivo'
export { AreaEditor } from './AreaEditor'
