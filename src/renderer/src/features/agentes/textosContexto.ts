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
      aria: 'Uso de la cuenta',
      sinDatos: 'uso —',
      titulo: 'Uso de la cuenta',
      ultimoDato: 'Último dato: ',
      noSePudoActualizar: (detalle: string | undefined) => `No se pudo actualizar ahora${detalle ? ` (${detalle})` : ''}; el dato es de `,
      ventanaReiniciada: 'Ventana reiniciada; se actualizará en tu próxima petición',
      seReinicia: (cuando: string) => `Se reinicia ${cuando}`,
      sinReinicio: 'Sin fecha de reinicio',
      sesion5h: 'Sesión (5 h)',
      semanal7d: 'Semanal (7 días)',
      semanalDe: (modelo: string) => `Semanal ${modelo}`,
      sesionDe: (modelo: string) => `Sesión ${modelo}`,
      consultando: 'Consultando…',
      sinCredenciales: 'Esta cuenta aún no ha iniciado sesión.',
      sinDatosCodex: 'Codex aún no ha reportado límites: escribe un primer mensaje y aparecerán.',
      sinDatosAgente: 'El agente aún no reporta límites de uso.',
      credencialCaducada: 'Credencial caducada; se renovará sola al usar el agente.',
      cuentaApi: 'Cuenta por API key: no tiene límites de suscripción que mostrar.',
      demasiadasConsultas: 'Demasiadas consultas seguidas; se reintenta en un momento.',
      errorLeer: (detalle: string | undefined) => `No se pudo leer el uso${detalle ? `: ${detalle}` : '.'}`,
      sinDatosUso: 'Sin datos de uso.'
    },
    contexto: {
      ariaChat: 'Contexto de la conversación',
      ariaAgente: 'Contexto del agente',
      etiqueta: (porcentaje: string | null) => `Contexto ${porcentaje === null ? 'sin datos' : porcentaje}`,
      compactando: 'Compactando la conversación',
      etiquetaCompactable: (contexto: string) => `${contexto}. Compactar la conversación`,
      titulo: 'Contexto del chat',
      tituloAgente: 'Contexto',
      ventanaOcupada: 'Ventana ocupada',
      de: ' de ',
      tokens: ' tokens',
      ventanaEstimada: 'Tamaño de ventana estimado por el modelo.',
      sinConfirmar: 'Sin confirmar en qué conversación estás: se mide la más reciente de este proyecto.',
      compactada: (cuando: string) => `Compactada ${cuando}; subirá en el próximo turno.`,
      ultimoTurno: (cuando: string) => `Último turno ${cuando}.`,
      comandoEnviado: (agente: string) => `Comando /compact enviado a ${agente}. Verás el resumen en la terminal.`,
      clicCompactar:
        'Haz clic para compactar: el agente resume la conversación en un extracto y libera la ventana. Se conserva el hilo, se pierde el detalle literal.',
      hazFaltaSesion: 'Para compactar hace falta una sesión activa; abre o reinicia el agente.',
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
      aria: 'Account usage',
      sinDatos: 'usage —',
      titulo: 'Account usage',
      ultimoDato: 'Last data point: ',
      noSePudoActualizar: (detalle: string | undefined) => `Could not update right now${detalle ? ` (${detalle})` : ''}; the data is from `,
      ventanaReiniciada: 'Window reset; it will update on your next request',
      seReinicia: (cuando: string) => `Resets ${cuando}`,
      sinReinicio: 'No reset date',
      sesion5h: 'Session (5 h)',
      semanal7d: 'Weekly (7 days)',
      semanalDe: (modelo: string) => `Weekly ${modelo}`,
      sesionDe: (modelo: string) => `Session ${modelo}`,
      consultando: 'Checking…',
      sinCredenciales: 'This account has not signed in yet.',
      sinDatosCodex: 'Codex has not reported limits yet: send a first message and they will show up.',
      sinDatosAgente: 'The agent does not report usage limits yet.',
      credencialCaducada: 'Credential expired; it will renew itself when you use the agent.',
      cuentaApi: 'API key account: it has no subscription limits to show.',
      demasiadasConsultas: 'Too many requests in a row; retrying in a moment.',
      errorLeer: (detalle: string | undefined) => `Could not read usage${detalle ? `: ${detalle}` : '.'}`,
      sinDatosUso: 'No usage data.'
    },
    contexto: {
      ariaChat: 'Conversation context',
      ariaAgente: 'Agent context',
      etiqueta: (porcentaje: string | null) => `Context ${porcentaje === null ? 'no data' : porcentaje}`,
      compactando: 'Compacting the conversation',
      etiquetaCompactable: (contexto: string) => `${contexto}. Compact the conversation`,
      titulo: 'Chat context',
      tituloAgente: 'Context',
      ventanaOcupada: 'Window used',
      de: ' of ',
      tokens: ' tokens',
      ventanaEstimada: 'Window size estimated from the model.',
      sinConfirmar: 'Cannot confirm which conversation you are in: the most recent one in this project is measured.',
      compactada: (cuando: string) => `Compacted ${cuando}; it will grow on the next turn.`,
      ultimoTurno: (cuando: string) => `Last turn ${cuando}.`,
      comandoEnviado: (agente: string) => `/compact command sent to ${agente}. You will see the summary in the terminal.`,
      clicCompactar:
        'Click to compact: the agent summarizes the conversation into an excerpt and frees up the window. The thread is kept, the literal detail is lost.',
      hazFaltaSesion: 'Compacting needs an active session; open or restart the agent.',
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
