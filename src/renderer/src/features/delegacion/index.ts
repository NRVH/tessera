// =============================================================================
// API pública del indicador de tareas delegadas: lo pintan la cabecera del pane de un agente y la de la franja
// de terminales, y la suscripción al main se monta una vez con los hooks de los agentes. Feature propia para que
// agentes y terminales dependan de ella sin depender una de otra.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
export { IndicadorDelegadas } from './IndicadorDelegadas'
export { useDelegacion } from './storeDelegacion'
export { origenesTerminales } from './modeloDelegacion'
