// =============================================================================
// Textos de «Continuar esta conversación», el botón de la cabecera: seguirla en otra cuenta del mismo agente
// o pasar el trabajo a otro agente. Puro y sin JSX.
// Decisiones: docs/decisiones/app/idioma.md, docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txTraspaso = crearTextos(
  {
    titulo: 'Continuar esta conversación',
    continuarEnCuenta: 'Continuar en otra cuenta',
    continuarEnCuentaOCon: (agente: string) => `Continuar en otra cuenta o con ${agente}`,
    continuarCon: (agente: string) => `Continuar con ${agente}`,
    sinConversacion: 'Abra una conversación para poder continuarla',
    cuentaCitada: (nombre: string) => `"${nombre}"`,
    grupoAria: (agente: string, lleva: string) => `${agente}: ${lleva}`,
    llevaCompleta: 'Conversación completa',
    llevaCompletaDetalle: 'Continúa en otra cuenta con todo el historial. La conversación original no cambia.',
    llevaResumen: 'Solo un resumen',
    llevaResumenDetalle: 'Inicia una conversación nueva con un resumen. La actual sigue abierta.',
    detalleDocker: 'Docker',
    noSePudo: 'No se pudo continuar en otro agente o cuenta',
    trabajandoTitulo: (agente: string) => `¿Interrumpir el turno en marcha de ${agente}?`,
    trabajandoMensaje: (agente: string) =>
      `${agente} tiene un turno en marcha en este proyecto. Si continúa, se interrumpe y se abre una conversación nueva con el resumen; la anterior queda en su historial.`,
    seguirTrabajandoMensaje: (agente: string, donde: string) =>
      `${agente} tiene un turno en marcha. Si continúa, se interrumpe aquí y la conversación sigue en ${donde} desde el último punto guardado; la conversación de aquí no cambia.`,
    caducado: 'No se pudo abrir a tiempo la conversación en el destino. Vuelva a intentarlo desde ⇄ en la cabecera del agente.',
    seguir: 'Interrumpir y continuar',
    cancelar: 'Cancelar',
    cargando: 'Cargando cuentas…',
    divergenciaTitulo: (lugar: string) => `La conversación ya existe en ${lugar}, con otro contenido`,
    divergenciaTexto: (lugar: string) => `Las dos copias continuaron por separado. Elija con cuál seguir trabajando en ${lugar}.`,
    desdeDonde: 'Desde donde la continúa',
    yaEsta: (lugar: string) => `La que ya está en ${lugar}`,
    masReciente: 'Más reciente',
    mensajes: (n: number) => (n === 1 ? '1 mensaje' : `${n.toLocaleString('es-MX')} mensajes`),
    sinFecha: 'sin fecha conocida',
    tarjetaDocker: (nombre: string) => `Docker · la cuenta "${nombre}"`,
    tarjetaEquipo: 'Su equipo',
    datosCopia: (fecha: string, mensajes: string | null) => mensajes === null ? fecha : `${fecha} · ${mensajes}`,
    notaApartar: (origen: string, lugar: string) =>
      `Si continúa con la de ${origen}, la que estaba en ${lugar} no se borra: se guarda aparte, fuera del historial, y se puede recuperar desde la carpeta de conversaciones.`,
    continuarConLaDe: (lado: string) => `Continuar con la de ${lado}`,
    preparando: 'Preparando…',
    hecho: 'Hecho',
    docker: 'Docker',
    cuentaLugar: (nombre: string) => `la cuenta "${nombre}"`
  },
  {
    titulo: 'Continue this conversation',
    continuarEnCuenta: 'Continue in another account',
    continuarEnCuentaOCon: (agente: string) => `Continue in another account or with ${agente}`,
    continuarCon: (agente: string) => `Continue with ${agente}`,
    sinConversacion: 'Open a conversation to continue it',
    cuentaCitada: (nombre: string) => `"${nombre}"`,
    grupoAria: (agente: string, lleva: string) => `${agente}: ${lleva}`,
    llevaCompleta: 'Full conversation',
    llevaCompletaDetalle: 'Continues in another account with the whole history. The original does not change.',
    llevaResumen: 'Summary only',
    llevaResumenDetalle: 'Starts a new conversation with a summary. This one stays open.',
    detalleDocker: 'Docker',
    noSePudo: 'Could not continue in another agent or account',
    trabajandoTitulo: (agente: string) => `Interrupt ${agente}’s running turn?`,
    trabajandoMensaje: (agente: string) =>
      `${agente} has a turn running in this project. If you continue, it is interrupted and a new conversation opens with the summary; the one it had stays in its history.`,
    seguirTrabajandoMensaje: (agente: string, donde: string) =>
      `${agente} has a turn running. If you continue, it is interrupted here and the conversation continues in ${donde} from the last point it saved; the one here does not change.`,
    caducado: 'The conversation could not be opened at the destination in time. Try again from ⇄ in the agent header.',
    seguir: 'Interrupt and continue',
    cancelar: 'Cancel',
    cargando: 'Loading accounts…',
    divergenciaTitulo: (lugar: string) => `The conversation already exists in ${lugar}, with different content`,
    divergenciaTexto: (lugar: string) => `The two copies continued separately. Choose which one to keep working with in ${lugar}.`,
    desdeDonde: 'Where you are continuing from',
    yaEsta: (lugar: string) => `The one already in ${lugar}`,
    masReciente: 'Most recent',
    mensajes: (n: number) => (n === 1 ? '1 message' : `${n.toLocaleString('en-US')} messages`),
    sinFecha: 'date unknown',
    tarjetaDocker: (nombre: string) => `Docker · the "${nombre}" account`,
    tarjetaEquipo: 'Your computer',
    datosCopia: (fecha: string, mensajes: string | null) => mensajes === null ? fecha : `${fecha} · ${mensajes}`,
    notaApartar: (origen: string, lugar: string) =>
      `If you continue with the one from ${origen}, the one in ${lugar} is not deleted: it is set aside, outside the history, and can be recovered from the conversations folder.`,
    continuarConLaDe: (lado: string) => `Continue with the one from ${lado}`,
    preparando: 'Preparing…',
    hecho: 'Done',
    docker: 'Docker',
    cuentaLugar: (nombre: string) => `the "${nombre}" account`
  }
)
