// =============================================================================
// Textos de los descriptores de motor que ve la persona: lo que se dice cuando falta el destino de
// una conexión. Los descriptores se crean al cargar el módulo, así que los exponen con `get` para
// que el texto se lea al validar y no antes de fijar el idioma. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos } from '../i18n.ts'

export const txMotores = crearTextos(
  {
    necesitaBase: (motor: string) => `${motor} necesita el nombre de la base.`,
    necesitaServicioOSid: (motor: string) => `${motor} necesita un Service Name o un SID.`,
    servicioOSid: 'Indica Service Name O SID, no ambos.'
  },
  {
    necesitaBase: (motor: string) => `${motor} needs the database name.`,
    necesitaServicioOSid: (motor: string) => `${motor} needs a Service Name or a SID.`,
    servicioOSid: 'Give a Service Name OR a SID, not both.'
  }
)
