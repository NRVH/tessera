// =============================================================================
// API pública de la feature «Buscar en archivos»: el store de lo que se recuerda
// entre aperturas, la acción de abrir el modal y el modal conectado a la ventana.
// Es lo único que importan las demás features.
// =============================================================================
export { useStoreBusqueda, abrirBusqueda, type EstadoBusqueda } from './store'
export { ModalBusqueda } from './ModalBusqueda'
