// =============================================================================
// API pública de Tessera Academy para las demás features: el botón ⓘ con sus destinos, abrir el
// lector desde cualquier sitio, el lector (lo monta la capa de modales de la raíz), y lo que
// Configuración monta como su categoría (el panel, su icono y los grupos de su buscador). No
// depende de ninguna otra feature.
// Decisiones: docs/decisiones/configuracion/tessera-academy.md
// =============================================================================
export { BotonAyuda } from './BotonAyuda'
export { AYUDA, type DestinoAyuda } from './ayudas'
export { abrirAcademy } from './store'
export { LectorAcademy } from './LectorAcademy'
export { PanelAcademy } from './PanelAcademy'
export { IconoBirrete } from './iconosAcademy'
export { gruposBuscables as gruposAcademy } from './indice'
