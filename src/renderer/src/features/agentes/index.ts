// =============================================================================
// API pública de la feature de agentes para las demás features: el store, el agente
// elegido, los tipos de los hooks de la ventana, el botón de agentes nativos, la
// vista de las actualizaciones nativas, la lista de agentes que pinta Configuración y el contexto de los
// agentes (su entrada, su diálogo y el global). Lo que solo
// compone App.tsx está en `app.ts` (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export { useStoreAgentes, fijarSelectorAgentes } from './store'
export { GestionAgentes } from './GestionAgentes'
export { EntradaContexto } from './contexto/EntradaContexto'
export { abrirContexto } from './contexto/storeContextoAbierto'
export { useStoreContextoGlobal, guardarContextoGlobal } from './contexto/storeContextoGlobal'
export { txSelector as textosSelectorAgentes } from './textosSelectorAgentes.ts'
export { useStoreAgenteTerminal } from './storeAgenteTerminal'
export { resolverAgenteSeleccionado } from './agenteElegido'
export { useAgentesDe, useNombresAgente } from './useAgentesDelProyecto'
export type { EstadoPaneAgente } from './tiposPaneAgente'
export type { ColumnaAgenteEstado } from './useColumnaAgente'
export type { AgentesApp } from './useAgentesApp'
export type { ActividadAgentes } from './useActividadAgentes'
export type { SesionesNativas } from './useSesionesNativas'
export { BotonAgentesNativos } from './BotonAgentesNativos'
export { UsoCuentaTarea } from './UsoCuentaTarea'
export type { UseActualizacionNativa } from './useActualizacionNativa'
export { decidirVistaBotonAgentes, hayNovedades } from './vistaBotonAgentes'
