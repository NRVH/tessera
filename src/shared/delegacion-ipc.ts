// =============================================================================
// Contrato de las tareas delegadas: un agente nativo manda una tarea a una cuenta de Docker de su perfil con
// `tctx delegar` y la vigila con `tctx tarea`. Fija las operaciones del puente (`ctx.cuentas`, `ctx.delegar`,
// `ctx.tarea`), sus respuestas y rechazos, y los canales con los que el renderer pinta el indicador de la
// cabecera. Lo sirve `src/main/agents/delegacion/`.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================

/** Las operaciones del puente. */
export const OP_CUENTAS = 'ctx.cuentas'
export const OP_DELEGAR = 'ctx.delegar'
export const OP_TAREA = 'ctx.tarea'
export const OP_TAREAS = 'ctx.tareas'
export const OP_MODELOS = 'ctx.modelos'

/** Los agentes en los que se delega: los que tienen un modo no interactivo conocido. */
export type AgenteDelegable = 'claude-code' | 'codex'
export const AGENTES_DELEGABLES: readonly AgenteDelegable[] = ['claude-code', 'codex']

/** La orden como texto, en UTF-8: con el JSON de la petición cabe en el tope del puente (32 KiB). */
export const MAX_ORDEN_BYTES = 24 * 1024
/** Una orden leída de un archivo del proyecto (`--archivo`): la lee el main, sin pasar por el puente. */
export const MAX_ORDEN_ARCHIVO_BYTES = 512 * 1024
/** Uso de una ventana a partir del cual `auto` no elige la cuenta. */
export const UMBRAL_AGOTADA = 95
/** Líneas de actividad que se guardan de cada tarea (lo que enseña `tctx tarea`). */
export const MAX_LINEAS_ACTIVIDAD = 12

/** Un nombre de modelo o de esfuerzo que puede entrar en una línea de arranque: empieza por letra o número, así que nunca es una opción. */
export const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,119}$/
export const ESFUERZO_VALIDO = /^[a-z][a-z0-9_-]{0,23}$/

/** Un modelo que anuncia el CLI de una cuenta. */
export interface ModeloDelegable {
  /** Lo que se pasa en `--modelo`. */
  id: string
  /** El modelo completo al que apunta un alias, si el CLI lo dice; también se admite en `--modelo`. */
  resuelto?: string
  nombre: string
  /** Los niveles que admite; vacío si no admite ninguno. */
  esfuerzos: string[]
  /** Si es el que usa la cuenta cuando no se indica ninguno. */
  porDefecto: boolean
}

/** Estado de una cuenta para delegar. */
export type EstadoCuentaDelegable = 'lista' | 'sin-credencial' | 'agotada'

/** Una ventana de uso de la cuenta. */
export interface VentanaUsoDelegable {
  etiqueta: string
  /** Porcentaje consumido, 0-100. */
  porcentaje: number
  /** Epoch ms del reinicio, si se sabe. */
  reinicio?: number
}

/** Una cuenta de Docker del perfil, como la devuelve `ctx.cuentas`. */
export interface CuentaDelegable {
  agente: AgenteDelegable
  nombre: string
  estado: EstadoCuentaDelegable
  ventanas: VentanaUsoDelegable[]
  /** Tareas delegadas en marcha en esta cuenta. */
  enMarcha: number
}

/** `interrumpida`: seguía en marcha cuando Tessera o el equipo se apagaron; se puede continuar. */
export type EstadoTarea = 'en-marcha' | 'hecha' | 'fallida' | 'cancelada' | 'interrumpida'

/** Por qué terminó mal una tarea: cada uno tiene su texto y su salida en `tctx`. */
export type MotivoFallo =
  | 'sin-credencial'
  | 'sin-uso'
  | 'docker'
  | 'agente'
  | 'origen-cerrado'
  | 'cancelada-por-usuario'
  | 'actualizacion'

/** Una tarea vista desde fuera: lo que devuelve `ctx.tarea` y lo que pinta el renderer. */
export interface VistaTarea {
  id: string
  /** La clave de la sesión que la lanzó (`agent:<id>` o el id de la terminal): dónde se pinta el indicador. */
  origen: string
  profileId: string
  agente: AgenteDelegable
  cuenta: string
  soloLectura: boolean
  /** El modelo y el esfuerzo pedidos; sin ellos, los de la configuración de la cuenta. */
  modelo?: string
  esfuerzo?: string
  estado: EstadoTarea
  /** Un resumen de la orden (primera línea, recortada). */
  resumen: string
  /** Epoch ms. */
  inicio: number
  fin?: number
  /** Epoch ms de la última salida del agente delegado. */
  ultimaActividad: number
  /** Lo último que hizo, en líneas legibles (como mucho `MAX_LINEAS_ACTIVIDAD`). */
  actividad: string[]
  motivo?: MotivoFallo
  /** Lo que dijo el agente o Docker al fallar, tal cual; el texto de Tessera sale del `motivo`. */
  detalle?: string
  /** El id de la conversación del agente delegado, para continuarla. */
  conversacion?: string
}

/** El resultado: solo en `ctx.tarea` y solo al terminar bien. */
export interface VistaTareaConResultado extends VistaTarea {
  resultado?: string
}

/** La del indicador de la cabecera: con el id de la cuenta, para leer su uso. Los agentes no la reciben. */
export interface VistaTareaPanel extends VistaTarea {
  accountId: string
}

/** Canales del indicador de la cabecera. */
export const DELEGACION_CHANNELS = {
  /** evento main→renderer: la lista entera de tareas vivas o recién terminadas. VistaTareaPanel[] */
  CAMBIO: 'delegacion:cambio',
  /** invoke: la lista actual (al montar). () -> VistaTareaPanel[] */
  LISTAR: 'delegacion:listar',
  /** invoke: cancela una tarea en marcha. (id) -> void */
  CANCELAR: 'delegacion:cancelar',
  /** invoke: el usuario ya vio una tarea terminada; deja de pintarse. (id) -> void */
  DESCARTAR: 'delegacion:descartar'
} as const
