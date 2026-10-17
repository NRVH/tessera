// =============================================================================
// API pública de la feature de agentes para las demás features: el store, el agente
// elegido, los tipos de los hooks de la ventana, el botón de agentes nativos, la
// vista de las actualizaciones nativas y la lista de agentes que pinta Configuración. Lo que solo
// compone App.tsx está en `app.ts` (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export { useStoreAgentes, fijarSelectorAgentes } from './store'
export { GestionAgentes } from './GestionAgentes'
export { txSelector as textosSelectorAgentes } from './textosSelectorAgentes.ts'
export { useStoreAgenteTerminal } from './storeAgenteTerminal'
export { resolveSelectedAgent } from './agenteElegido'
export { useAgentesDe, useNombresAgente } from './useAgentesDelProyecto'
export type { AgentPaneStatus } from './agentPaneTipos'
export type { ColumnaAgenteEstado } from './useColumnaAgente'
export type { AgentesApp } from './useAgentesApp'
export type { ActividadAgentes } from './useActividadAgentes'
export type { SesionesNativas } from './useSesionesNativas'
export { BotonAgentesNativos } from './BotonAgentesNativos'
export type { UseActualizacionNativa } from './useActualizacionNativa'
export { decidirVistaBotonAgentes, hayNovedades } from './vistaBotonAgentes'
