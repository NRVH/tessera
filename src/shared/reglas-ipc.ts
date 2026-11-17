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
  /** invoke: descarta la pendiente de un perfil (aceptada o no). PeticionDescartarPropuesta -> boolean. */
  DESCARTAR: 'reglas:propuesta:descartar',
  /** invoke: anota que la propuesta se resuelve cuando sus reglas estén guardadas en disco. PeticionResolverAlGuardar -> void. */
  RESOLVER_AL_GUARDAR: 'reglas:propuesta:resolver-al-guardar',
  /** main -> renderer: ha llegado una propuesta. AvisoPropuesta. */
  PROPUESTA: 'reglas:propuesta:llegada',
  /** main -> renderer: se resolvió una propuesta anotada porque sus reglas ya están en disco. AvisoPropuesta. */
  RESUELTA: 'reglas:propuesta:resuelta'
} as const

/**
 * El `profileId` con el que se guarda la propuesta de las reglas globales, que no son de ningún perfil. Un id
 * de perfil no puede ser este: lleva caracteres que `validarFormaDePerfil` no admite en un id.
 */
export const ID_REGLAS_GLOBALES = ':global'

/** Una propuesta de un agente: la versión entera nueva de las reglas, nunca aprobada hasta que el usuario la acepte. */
export interface PropuestaReglas {
  /** El perfil cuyas reglas cambia, o `ID_REGLAS_GLOBALES`. */
  profileId: string
  /** En una propuesta de las globales, el perfil desde el que se propuso. */
  desdePerfil?: string
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
export interface PeticionDescartarPropuesta {
  perfilId: string
  en?: number
}

/**
 * Aceptar (o aceptar editada) una propuesta: se quita cuando las reglas guardadas del perfil sean `texto`,
 * y solo si sigue siendo la propuesta `en`.
 */
export interface PeticionResolverAlGuardar {
  perfilId: string
  en: number
  texto: string
}

/** El aviso de que ha llegado una propuesta, o de que se resolvió una. */
export interface AvisoPropuesta {
  perfilId: string
}
