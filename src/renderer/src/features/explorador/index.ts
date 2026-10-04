// =============================================================================
// API pública de la feature del explorador de archivos: el panel lateral, el store
// de la ruta a revelar y el contrato de «Montar como base de datos».
// Es lo único que importan las demás features.
// =============================================================================
export { useStoreExplorador, revelarRuta, type EstadoExplorador } from './store'
export { Sidebar, type BasesDeArchivoSidebar } from './Sidebar'
