// =============================================================================
// Textos del pie del agente que dicen cuánto queda: el uso de la cuenta (barras y desplegable)
// y el contexto de la conversación (anillo, desplegable y acción de compactar), incluido el de
// un agente manual. Puro y sin JSX.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txContexto = crearTextos(
  {
    uso: {
      aria: 'Límites de su plan',
      sinDatos: 'uso —',
      titulo: 'Límites de su plan',
      ultimoDato: 'Último dato: ',
      noSePudoActualizar: (detalle: string | undefined) => `No se pudo actualizar ahora${detalle ? ` (${detalle})` : ''}; el dato es de `,
      ventanaReiniciada: 'Se renovó; se actualizará con su próximo mensaje',
      seReinicia: (cuando: string) => `Se reinicia ${cuando}`,
      sinReinicio: 'Sin fecha de reinicio',
      sesion5h: 'Cada 5 horas',
      semanal7d: 'Semanal',
      semanalDe: (modelo: string) => `Semanal ${modelo}`,
      sesionDe: (modelo: string) => `Cada 5 horas ${modelo}`,
      consultando: 'Consultando…',
      sinCredenciales: 'Esta cuenta aún no ha iniciado sesión.',
      sinDatosCodex: 'Codex aún no ha informado de límites: aparecerán al enviar un primer mensaje.',
      sinDatosAgente: 'El agente aún no informa de límites de uso.',
      credencialCaducada: 'Credencial caducada; se renovará automáticamente al usar el agente.',
      cuentaApi: 'Cuenta por API key: no tiene límites de suscripción que mostrar.',
      demasiadasConsultas: 'Demasiadas consultas seguidas; se reintentará en unos instantes.',
      errorLeer: (detalle: string | undefined) => `No se pudo leer el uso${detalle ? `: ${detalle}` : '.'}`,
      sinDatosUso: 'Sin datos de uso.'
    },
    contexto: {
      ariaChat: 'Memoria de la conversación',
      ariaAgente: 'Memoria del agente',
      etiqueta: (porcentaje: string | null) => `Memoria ${porcentaje === null ? 'sin datos' : porcentaje}`,
      compactando: 'Resumiendo la conversación',
      etiquetaCompactable: (contexto: string) => `${contexto}. Resumir la conversación`,
      titulo: 'Memoria de la conversación',
      explicacion: 'Cuánto puede recordar el agente simultáneamente. Al llenarse, resume la conversación y pierde el detalle.',
      tituloAgente: 'Memoria del agente',
      ventanaOcupada: 'Ocupado',
      de: ' de ',
      tokens: ' tokens',
      ventanaEstimada: 'Tamaño de ventana estimado por el modelo.',
      sinConfirmar: 'No se ha podido confirmar la conversación activa: se mide la más reciente de este proyecto.',
      compactada: (cuando: string) => `Resumida ${cuando}; subirá en el próximo turno.`,
      ultimoTurno: (cuando: string) => `Último turno ${cuando}.`,
      comandoEnviado: (agente: string) => `Comando /compact enviado a ${agente}. El resumen aparecerá en la terminal.`,
      clicCompactar:
        'Haga clic para resumir la conversación y liberar espacio: el agente conserva el tema tratado, pero no el texto exacto.',
      hazFaltaSesion: 'Para resumir se necesita una sesión activa; abra o reinicie el agente.',
      consultando: 'Consultando…',
      sinConversacion: 'Este proyecto aún no tiene ninguna conversación con este agente.',
      vaciaCodex: 'Conversación vacía (nueva o recién limpiada): aún no ha hecho ninguna petición.',
      vaciaClaude: 'Conversación vacía (nueva o recién limpiada con /clear): aún no hay ningún turno que medir.',
      errorLeer: (detalle: string | undefined) => `No se pudo leer el contexto${detalle ? `: ${detalle}` : '.'}`,
      sinDatos: 'Sin datos de contexto.',
      leyendo: 'Leyendo…'
    }
  },
  {
    uso: {
      aria: 'Your plan limits',
      sinDatos: 'usage —',
      titulo: 'Your plan limits',
      ultimoDato: 'Last updated: ',
      noSePudoActualizar: (detalle: string | undefined) => `Could not update right now${detalle ? ` (${detalle})` : ''}; the data is from `,
      ventanaReiniciada: 'The limit was reset; it updates with your next message',
      seReinicia: (cuando: string) => `Resets ${cuando}`,
      sinReinicio: 'No reset date',
      sesion5h: 'Every 5 hours',
      semanal7d: 'Weekly',
      semanalDe: (modelo: string) => `Weekly ${modelo}`,
      sesionDe: (modelo: string) => `Every 5 hours ${modelo}`,
      consultando: 'Checking…',
      sinCredenciales: 'This account has not signed in yet.',
      sinDatosCodex: 'Codex has not reported limits yet: send a message to see them.',
      sinDatosAgente: 'The agent does not report usage limits yet.',
      credencialCaducada: 'Credential expired; it renews automatically when you use the agent.',
      cuentaApi: 'API key account: there are no subscription limits to show.',
      demasiadasConsultas: 'Too many requests in a row; retrying in a moment.',
      errorLeer: (detalle: string | undefined) => `Could not read usage${detalle ? `: ${detalle}` : '.'}`,
      sinDatosUso: 'No usage data.'
    },
    contexto: {
      ariaChat: 'Conversation memory',
      ariaAgente: 'Agent memory',
      etiqueta: (porcentaje: string | null) => `Memory ${porcentaje === null ? 'no data' : porcentaje}`,
      compactando: 'Summarizing the conversation',
      etiquetaCompactable: (contexto: string) => `${contexto}. Summarize the conversation`,
      titulo: 'Conversation memory',
      explicacion: 'How much the agent can remember at once. When it fills up, it summarizes the conversation and loses the details.',
      tituloAgente: 'Agent memory',
      ventanaOcupada: 'Used',
      de: ' of ',
      tokens: ' tokens',
      ventanaEstimada: 'Window size estimated from the model.',
      sinConfirmar: 'Tessera cannot confirm which conversation you are in: it shows the most recent one in this project.',
      compactada: (cuando: string) => `Summarized ${cuando}; usage updates on the next turn.`,
      ultimoTurno: (cuando: string) => `Last turn ${cuando}.`,
      comandoEnviado: (agente: string) => `/compact command sent to ${agente}. You will see the summary in the terminal.`,
      clicCompactar:
        'Click to summarize the conversation and make room: the agent keeps what it was about, but not the exact text.',
      hazFaltaSesion: 'Summarizing requires an active session; open or restart the agent.',
      consultando: 'Checking…',
      sinConversacion: 'This project has no conversation with this agent yet.',
      vaciaCodex: 'Empty conversation (new or just cleared): it has not made any request yet.',
      vaciaClaude: 'Empty conversation (new or just cleared with /clear): there is no turn to measure yet.',
      errorLeer: (detalle: string | undefined) => `Could not read the context${detalle ? `: ${detalle}` : '.'}`,
      sinDatos: 'No context data.',
      leyendo: 'Reading…'
    }
  }
)
