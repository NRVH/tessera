// =============================================================================
// Textos del indicador, la cancelación y los fallos de las tareas delegadas.
// Cada motivo del contrato tiene su explicación en español e inglés, sin acciones de reintento.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { crearTextos } from '../../../../shared/i18n.ts'

export const txDelegacion = crearTextos(
  {
    titulo: 'Tareas delegadas',
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
    agentes: { 'claude-code': 'Claude Code', codex: 'Codex' },
    motivos: {
      'sin-credencial': 'La cuenta no tiene la sesión iniciada. Iníciela en Configuración › Agentes, desplegando el agente.',
      'sin-uso': 'La cuenta agotó su uso disponible.',
      docker: 'Docker no pudo ejecutar la tarea.',
      agente: 'El agente terminó con un error.',
      'origen-cerrado': 'Se cerró la sesión que delegó la tarea.',
      'cancelada-por-usuario': 'Usted canceló la tarea.'
    }
  },
  {
    titulo: 'Delegated tasks',
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
    agentes: { 'claude-code': 'Claude Code', codex: 'Codex' },
    motivos: {
      'sin-credencial': 'The account is not signed in. Sign in from Settings › Agents by expanding the agent.',
      'sin-uso': 'The account has exhausted its available usage.',
      docker: 'Docker could not run the task.',
      agente: 'The agent exited with an error.',
      'origen-cerrado': 'The session that delegated the task was closed.',
      'cancelada-por-usuario': 'You canceled the task.'
    }
  }
)
