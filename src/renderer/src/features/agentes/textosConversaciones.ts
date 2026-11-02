// =============================================================================
// Textos del historial de conversaciones del agente: el modal, sus filas, el renombrado y el
// borrado. El lugar donde vive el agente («en este proyecto», «en el agente de datos») lo
// aporta `textosMontajeBases.ts`. Puro y sin JSX.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txConversaciones = crearTextos(
  {
    eliminarTitulo: 'Eliminar conversación',
    eliminarMensaje: (titulo: string) =>
      `¿Eliminar "${titulo}"?\nLa conversación se borra de este equipo y no se puede recuperar.`,
    eliminar: 'Eliminar',
    titulo: (agente: string) => `Conversaciones de ${agente}`,
    cerrar: 'Cerrar (Esc)',
    cerrarAria: 'Cerrar',
    buscar: 'Buscar conversación…',
    pie: 'Elige una conversación para seguirla en este agente; la que tienes abierta queda guardada aquí.',
    cargando: 'Cargando…',
    errorLeer: 'No se pudo leer el historial:',
    elegirCuenta: 'Elige una cuenta primero.',
    sinConversaciones: (agente: string, enVacio: string) =>
      `Aún no hay conversaciones de ${agente} ${enVacio} con esta cuenta. Las de otras cuentas se ven al cambiar a ellas.`,
    sinResultados: 'Ningún resultado para la búsqueda.',
    reanudar: (titulo: string) => `Reanudar: ${titulo}`,
    reanudarRenombrada: (custom: string, automatico: string) => `Reanudar: ${custom}\nTítulo automático: ${automatico}`,
    renombrada: 'Renombrada',
    renombrar: 'Renombrar conversación',
    nombre: 'Nombre',
    guardar: 'Guardar',
    pistaConNombre: (automatico: string) => `Déjalo vacío para volver al título automático:\n"${automatico}"`,
    pistaSinNombre: (automatico: string) => `Título automático actual:\n"${automatico}"`,
    hoy: (hora: string) => `hoy ${hora}`,
    ayer: (hora: string) => `ayer ${hora}`
  },
  {
    eliminarTitulo: 'Delete conversation',
    eliminarMensaje: (titulo: string) =>
      `Delete “${titulo}”?\nThe conversation is deleted from this computer and cannot be recovered.`,
    eliminar: 'Delete',
    titulo: (agente: string) => `${agente} conversations`,
    cerrar: 'Close (Esc)',
    cerrarAria: 'Close',
    buscar: 'Search conversations…',
    pie: 'Choose a conversation to continue it in this agent; the one you have open stays saved here.',
    cargando: 'Loading…',
    errorLeer: 'Could not read the history:',
    elegirCuenta: 'Choose an account first.',
    sinConversaciones: (agente: string, enVacio: string) =>
      `There are no ${agente} conversations ${enVacio} with this account yet. Conversations from other accounts appear when you switch to them.`,
    sinResultados: 'No matching conversations.',
    reanudar: (titulo: string) => `Resume: ${titulo}`,
    reanudarRenombrada: (custom: string, automatico: string) => `Resume: ${custom}\nAutomatic title: ${automatico}`,
    renombrada: 'Renamed',
    renombrar: 'Rename conversation',
    nombre: 'Name',
    guardar: 'Save',
    pistaConNombre: (automatico: string) => `Leave it empty to use the automatic title:\n“${automatico}”`,
    pistaSinNombre: (automatico: string) => `Current automatic title:\n“${automatico}”`,
    hoy: (hora: string) => `today ${hora}`,
    ayer: (hora: string) => `yesterday ${hora}`
  }
)
