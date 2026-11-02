// =============================================================================
// Textos de «Continuar esta conversación en…» (seguirla en otra cuenta o modo desde el selector de
// cuenta) y de «Continuar con…» (pasar el trabajo a otro agente desde la cabecera). Puro y sin JSX.
// Decisiones: docs/decisiones/app/idioma.md, docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txTraspaso = crearTextos(
  {
    seguirAqui: 'La conversación se copia a esta cuenta y sigue ahí con todo su historial. La original no cambia.',
    seguirAquiItem: (donde: string) => `Continuar esta conversación en ${donde}`,
    sinConversacion: 'Abre una conversación para poder continuarla en otra cuenta',
    pasarA: (agente: string) => `Continuar con ${agente}…`,
    pasarATitulo: (agente: string) =>
      `Abre ${agente} en este proyecto y le pasa un resumen de esta conversación para que siga donde lo dejaste. Esta conversación no se cierra.`,
    pasarAAria: (agente: string) => `Continuar con ${agente}`,
    elegirDestino: (agente: string) => `¿Con qué cuenta de ${agente}?`,
    noSePudo: 'No se pudo continuar en otro agente o cuenta',
    trabajandoTitulo: (agente: string) => `${agente} está trabajando`,
    trabajandoMensaje: (agente: string) =>
      `${agente} tiene un turno en marcha en este proyecto. Si sigues, se corta y abre una conversación nueva con el resumen; la que tenía queda en su historial.`,
    seguirTrabajandoMensaje: (agente: string, donde: string) =>
      `${agente} tiene un turno en marcha. Si sigues, se corta aquí y la conversación continúa en ${donde} desde lo último que alcanzó a guardar; la de aquí no cambia.`,
    caducado: 'No se pudo abrir a tiempo la conversación en el destino. Vuelve a intentarlo desde «Continuar con…» o desde el ⋯ de la cuenta.',
    seguir: 'Seguir',
    cancelar: 'Cancelar',
    cargando: 'Cargando cuentas…'
  },
  {
    seguirAqui: 'The conversation is copied to this account and continues there with its whole history. The original does not change.',
    seguirAquiItem: (donde: string) => `Continue this conversation in ${donde}`,
    sinConversacion: 'Open a conversation to continue it in another account',
    pasarA: (agente: string) => `Continue with ${agente}…`,
    pasarATitulo: (agente: string) =>
      `Opens ${agente} in this project and gives it a summary of this conversation so it can continue where you left off. This conversation stays open.`,
    pasarAAria: (agente: string) => `Continue with ${agente}`,
    elegirDestino: (agente: string) => `Which ${agente} account?`,
    noSePudo: 'Could not continue in another agent or account',
    trabajandoTitulo: (agente: string) => `${agente} is working`,
    trabajandoMensaje: (agente: string) =>
      `${agente} has a turn running in this project. If you continue, it is interrupted and a new conversation opens with the summary; the one it had stays in its history.`,
    seguirTrabajandoMensaje: (agente: string, donde: string) =>
      `${agente} has a turn running. If you continue, it is interrupted here and the conversation continues in ${donde} from the last point it saved; the one here does not change.`,
    caducado: 'The conversation could not be opened at the destination in time. Try again from “Continue with…” or from the account’s ⋯ menu.',
    seguir: 'Continue',
    cancelar: 'Cancel',
    cargando: 'Loading accounts…'
  }
)
