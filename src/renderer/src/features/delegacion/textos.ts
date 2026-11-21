// =============================================================================
// Textos del indicador, la cancelación y los fallos de las tareas delegadas.
// Cada motivo del contrato tiene su explicación en español e inglés, sin acciones de reintento.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { crearTextos } from '../../../../shared/i18n.ts'

export const txDelegacion = crearTextos(
  {
    titulo: 'Tareas delegadas',
    cuentasEnUso: 'Cuentas en uso',
    cantidad: (n: number) => `${n} tareas`,
    cancelar: 'Cancelar la tarea delegada',
    confirmar: (cuenta: string) => `Se detendrá la tarea delegada en ${cuenta}.`,
    cancelarPregunta: (cuenta: string) => `¿Cancelar la tarea delegada en ${cuenta}?`,
    mantener: 'Mantener la tarea',
    cancelando: 'Cancelando…',
    descartar: 'Descartar',
    soloLectura: 'Solo lectura',
    puedeEditar: 'Puede editar',
    hecha: 'Tarea completada',
    fallida: 'La tarea no se completó',
    error: 'No se pudo completar la operación. Vuelva a intentarlo.',
    errorCancelar: 'No se pudo cancelar la tarea, que sigue en marcha. Vuelva a intentarlo con ✕.',
    agentes: { 'claude-code': 'Claude Code', codex: 'Codex' },
    motivos: {
      'sin-credencial': 'La cuenta no tiene la sesión iniciada. Iníciela en Configuración › Agentes, desplegando el agente.',
      'sin-uso': 'La cuenta agotó su uso disponible.',
      docker: 'Docker se detuvo o no está disponible, y la tarea no pudo seguir. El agente puede volver a intentarla; si Docker no se inicia, revíselo.',
      agente: 'El agente terminó con un error.',
      'origen-cerrado': 'Se cerró la sesión que delegó la tarea.',
      actualizacion: 'Se detuvo para actualizar los agentes en Docker. El agente puede volver a intentarla.',
      'cancelada-por-usuario': 'Usted canceló la tarea.'
    }
  },
  {
    titulo: 'Delegated tasks',
    cuentasEnUso: 'Accounts in use',
    cantidad: (n: number) => `${n} tasks`,
    cancelar: 'Cancel the delegated task',
    confirmar: (cuenta: string) => `The task delegated to ${cuenta} will be stopped.`,
    cancelarPregunta: (cuenta: string) => `Cancel the task delegated to ${cuenta}?`,
    mantener: 'Keep the task',
    cancelando: 'Canceling…',
    descartar: 'Dismiss',
    soloLectura: 'Read only',
    puedeEditar: 'Can edit',
    hecha: 'Task completed',
    fallida: 'The task did not complete',
    error: 'Could not complete the operation. Please try again.',
    errorCancelar: 'The task could not be canceled and is still running. Try again with ✕.',
    agentes: { 'claude-code': 'Claude Code', codex: 'Codex' },
    motivos: {
      'sin-credencial': 'The account is not signed in. Sign in from Settings › Agents by expanding the agent.',
      'sin-uso': 'The account has exhausted its available usage.',
      docker: 'Docker stopped or is unavailable, and the task could not continue. The agent can try again; if Docker does not start, check it.',
      agente: 'The agent exited with an error.',
      'origen-cerrado': 'The session that delegated the task was closed.',
      actualizacion: 'It was stopped to update the agents in Docker. The agent can try it again.',
      'cancelada-por-usuario': 'You canceled the task.'
    }
  }
)
