// =============================================================================
// Contrato IPC de las propuestas de reglas del perfil: un agente propone con `tctx proponer` y el usuario la
// revisa. El renderer pide la pendiente de un perfil, las de todos (al montar: el aviso se pierde sin
// ventana), descarta la rechazada y anota la aceptada para que el main la quite cuando sus reglas estén en
// disco; el main avisa al llegar una y al resolverse una. Lo sirve `src/main/reglas/ipc.ts`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================

/** Canales de las propuestas de reglas. */
export const REGLAS_CHANNELS = {
  /** invoke: la propuesta pendiente de un perfil. profileId -> PropuestaReglas | null. */
  OBTENER: 'reglas:propuesta:obtener',
  /** invoke: los perfiles con una propuesta pendiente. -> string[]. */
  PENDIENTES: 'reglas:propuesta:pendientes',
  /** invoke: descarta la pendiente de un perfil (aceptada o no). DescartarPropuestaRequest -> boolean. */
  DESCARTAR: 'reglas:propuesta:descartar',
  /** invoke: anota que la propuesta se resuelve cuando sus reglas estén guardadas en disco. ResolverAlGuardarRequest -> void. */
  RESOLVER_AL_GUARDAR: 'reglas:propuesta:resolver-al-guardar',
  /** main -> renderer: ha llegado una propuesta. AvisoPropuesta. */
  PROPUESTA: 'reglas:propuesta:llegada',
  /** main -> renderer: se resolvió una propuesta anotada porque sus reglas ya están en disco. AvisoPropuesta. */
  RESUELTA: 'reglas:propuesta:resuelta'
} as const

/** Una propuesta de un agente: la versión entera nueva de las reglas, nunca aprobada hasta que el usuario la acepte. */
export interface PropuestaReglas {
  profileId: string
  /** El texto propuesto, ya normalizado (`normalizarReglas`). */
  texto: string
  /** Por qué, según el agente; vacío si no lo dio. */
  motivo: string
  /** Cuándo llegó (ms): identifica la propuesta, que otra posterior sustituye. */
  en: number
  /** El nombre de la carpeta del proyecto desde el que se propuso, si la sesión tenía uno. */
  proyecto?: string
}

/** Descartar la propuesta de un perfil. Con `en`, solo si sigue siendo esa: una que llegó después no se pierde. */
export interface DescartarPropuestaRequest {
  profileId: string
  en?: number
}

/**
 * Aceptar (o aceptar editada) una propuesta: se quita cuando las reglas guardadas del perfil sean `texto`,
 * y solo si sigue siendo la propuesta `en`.
 */
export interface ResolverAlGuardarRequest {
  profileId: string
  en: number
  texto: string
}

/** El aviso de que ha llegado una propuesta, o de que se resolvió una. */
export interface AvisoPropuesta {
  profileId: string
}
