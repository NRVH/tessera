// =============================================================================
// API pública de la feature de agentes para las demás features: el store, el agente
// elegido, los tipos de los hooks de la ventana, el botón de agentes nativos y la
// vista de las actualizaciones nativas que también pinta Configuración. Lo que solo
// compone App.tsx está en `app.ts` (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export { useStoreAgentes } from './store'
export { resolveSelectedAgent } from './agenteElegido'
export type { AgentPaneStatus } from './agentPaneTipos'
export type { ColumnaAgenteEstado } from './useColumnaAgente'
export type { AgentesApp } from './useAgentesApp'
export type { ActividadAgentes } from './useActividadAgentes'
export type { SesionesNativas } from './useSesionesNativas'
export { BotonAgentesNativos } from './BotonAgentesNativos'
export type { UseActualizacionNativa } from './useActualizacionNativa'
export { decidirVistaBotonAgentes, hayNovedades } from './vistaBotonAgentes'
