// =============================================================================
// Abrir Configuración en «Agentes»: donde se administran los agentes y las cuentas de Docker de todos, también los
// ocultos. Lo abren el selector de pestañas y el de cuenta de la cabecera.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { useStoreAjustes } from '../ajustes'

/** Abre Configuración en la categoría «Agentes». */
export function abrirGestionAgentes(): void {
  useStoreAjustes.setState({ settingsOpen: true, ajustesCategoria: 'agentes' })
}
