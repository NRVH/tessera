// =============================================================================
// Contrato IPC de la terminal del agente (main <-> preload <-> renderer): canales hermanos
// de `terminal-ipc.ts`, que no se toca, con las mismas formas de escritura, resize, datos
// y salida, y un OPEN propio que lleva el agente, el modo y la cuenta.
// invoke (renderer -> main): OPEN, RELOAD, CLOSE, SAVE_IMAGE, STAGE_FILE, ACTIVITY_SNAPSHOT,
// DETENER_VARIAS, HIBERNAR_INACTIVOS; send (renderer -> main): WRITE, RESIZE, FLOW; send
// (main -> renderer): DATA, EXIT, ACTIVITY. Lo sirve `src/main/agents/ipc.ts`.
// =============================================================================

/** Tipos de agente admitidos (espejo de Agente en main/profiles/types, inline para no acoplar shared). */
export type AgentKind = 'claude-code' | 'codex'

/**
 * DÓNDE corre el agente:
 *   - 'container' (por defecto): dentro del contenedor Docker aislado del perfil,
 *     con la cuenta del perfil.
 *   - 'host': en la shell nativa del equipo, con tu cuenta PERSONAL (el login nativo
 *     de tu claude/codex), sin contenedor. Para proyectos que necesitan herramientas
 *     del sistema.
 */
export type AgentRunMode = 'container' | 'host'

export const AGENT_TERMINAL_CHANNELS = {
  /** invoke: abre una sesión de agente. AgentOpenRequest -> AgentOpenResult. */
  OPEN: 'agentTerminal:open',
  /** send: stdin del usuario hacia el agente. AgentWriteMessage. */
  WRITE: 'agentTerminal:write',
  /** send: reflow del pty (cols/rows). AgentResizeMessage. */
  RESIZE: 'agentTerminal:resize',
  /** send (renderer -> main): CONTRAPRESIÓN, pausa/reanuda el pty. AgentFlowMessage. */
  FLOW: 'agentTerminal:flow',
  /**
   * invoke: RELOAD ROBUSTO. Mata el proceso del agente y lo relevanta en el MISMO
   * contenedor/cwd con el MISMO configDir montado, conservando el sessionId. El
   * preludio ssh/git vuelve a correr. AgentReloadRequest -> AgentOpenResult.
   */
  RELOAD: 'agentTerminal:reload',
  /** invoke: cierra la sesión y DESMONTA el configDir del agente. AgentCloseRequest -> void. */
  CLOSE: 'agentTerminal:close',
  /**
   * invoke: vuelca la IMAGEN del portapapeles del sistema DENTRO del contenedor de
   * la sesión y devuelve su ruta EN EL CONTENEDOR (o null si no hay imagen). El CLI
   * (claude/codex) corre en el contenedor y NO puede leer rutas de Windows, así que
   * el PNG debe existir en el FS del contenedor para pegarlo como adjunto.
   * AgentSaveImageRequest -> string | null.
   */
  SAVE_IMAGE: 'agentTerminal:saveImage',
  /**
   * invoke: copia un ARCHIVO del host (arrastrado/pegado desde Windows) DENTRO del
   * contenedor de la sesión y devuelve su ruta EN EL CONTENEDOR (o null si falla).
   * Igual que SAVE_IMAGE pero para un archivo con ruta de disco (no el portapapeles):
   * el CLI no puede leer `C:\…`. AgentStageFileRequest -> string | null.
   */
  STAGE_FILE: 'agentTerminal:stageFile',
  /** send (main -> renderer): salida del agente. AgentDataMessage. */
  DATA: 'agentTerminal:data',
  /** send (main -> renderer): el agente terminó. AgentExitMessage. */
  EXIT: 'agentTerminal:exit',
  /**
   * send (main -> renderer): el agente PASÓ de trabajar a inactivo (o viceversa).
   * Señal de actividad (el "modelo de turnos"; su panel, el inspector de progreso, se
   * retiró y hoy la consumen el mosaico y los dots de perfil): el main deriva del pty si el
   * CLI está pensando/ejecutando (bytes fluyendo) o quieto en el prompt (silencio).
   * AgentActivityMessage. Solo se emite en CAMBIOS de estado, no por cada chunk.
   */
  ACTIVITY: 'agentTerminal:activity',
  /**
   * invoke: ESTADO ACTUAL de actividad de TODAS las sesiones vivas. void -> AgentActivityMessage[].
   *
   * El canal ACTIVITY solo emite CAMBIOS, así que un cambio que se pierda deja la UI
   * mintiendo hasta el siguiente —y perderse puede: el main descarta el envío si la
   * ventana está destruida (recarga, crash del renderer)—. El síntoma es el peor de
   * todos: un agente que terminó hace rato con el indicador aún encendido. Con esto el
   * renderer puede pedir la foto completa al montar y al recuperar el foco.
   */
  ACTIVITY_SNAPSHOT: 'agentTerminal:activitySnapshot',
  /**
   * invoke: PARA varias sesiones NATIVAS de una vez, conservando cada sesión para que
   * un RELOAD posterior la relance en el mismo panel/id. AgentDetenerVariasRequest ->
   * AgentDetenerVariasResult.
   *
   * Es la parada del reinicio masivo de «actualizar los agentes de tu equipo», y es
   * ATÓMICA a propósito: la comprobación («ninguna trabaja, todas son nativas y están
   * vivas») y la parada ocurren en el main en el mismo tick, así que un prompt que
   * llegue entre la foto del renderer y la parada no se corta a mitad de turno. Si una
   * sola no cumple, no se para NINGUNA. No emite EXIT: es una parada pedida.
   */
  DETENER_VARIAS: 'agentTerminal:detenerVarias',
  /**
   * invoke: hiberna los agentes de los proyectos que llevan inactivos más que el ajuste.
   * AgentHibernarInactivosRequest -> AgentHibernarInactivosResult.
   *
   * El renderer dice qué hay en pantalla; el main mide, decide y suelta las sesiones en el
   * mismo tick, y responde sin esperar a que mueran los procesos. Va en el canal del AGENTE
   * a propósito: desde aquí no se alcanza ninguna terminal de shell. No emite EXIT.
   */
  HIBERNAR_INACTIVOS: 'agentTerminal:hibernarInactivos'
} as const

/** Petición para abrir una terminal de agente para un (perfil, agente, proyecto). */
export interface AgentOpenRequest {
  /** Id de perfil (debe existir en config/profiles.json). */
  profileId: string
  /** Agente a lanzar; debe estar declarado en `agentes[]` del perfil. */
  agente: AgentKind
  /** Ruta host (Windows) del proyecto a montar/anclar como cwd. */
  projectHostPath: string
  /**
   * Cuenta (login) con la que arrancar. Si se omite, el main usa la cuenta
   * "default" (migrada) de ese (perfil, agente). Determina QUÉ credencial se monta.
   */
  accountId?: string
  /**
   * Si se da, en vez de arrancar una conversación NUEVA se REANUDA la sesión con ese
   * id: `claude --resume <id>` / `codex resume <id>`. Debe pertenecer al mismo
   * (agente, cuenta, PROYECTO) que se abre (así CC/Codex la encuentran en su store).
   */
  resumeSessionId?: string
  /**
   * Dónde correr el agente. Ausente => 'container' (retrocompatible). En 'host' se
   * ignora `accountId` (se usa el login personal nativo) y no se toca Docker.
   */
  mode?: AgentRunMode
  /**
   * Ids de las conexiones a base de datos MONTADAS en este proyecto. Solo se
   * inyectan sus credenciales en el entorno del pty y solo esas ve `tdb`. Ausente o
   * vacío => el agente no tiene ninguna base a mano.
   *
   * Solo aplica en modo 'host': en contenedor no hay `tdb` (las bases van por la VPN
   * del usuario y no se expone al contenedor).
   *
   * Se fija al ARRANCAR la sesión: cambiar el montaje con el agente vivo exige
   * reiniciarlo, porque los secretos viven en el entorno del proceso.
   */
  dbConnectionIds?: string[]
}

/** Respuesta al abrir: identidad de la sesión + rutas neutras dentro del contenedor. */
export interface AgentOpenResult {
  /** Id estable de la sesión; se conserva a través de reload. */
  sessionId: string
  profileId: string
  agente: AgentKind
  /** Cuenta (login) con la que se abrió la sesión. */
  accountId: string
  /** Ruta host tal como se pidió. */
  projectHostPath: string
  /** cwd neutro dentro del contenedor: /workspace/<x>. */
  workspacePath: string
  /** Ruta neutra donde vive el configDir del agente durante la sesión: /agent-config/<tipo>/<cuenta>. */
  configContainerPath: string
}

export interface AgentWriteMessage {
  sessionId: string
  data: string
}

export interface AgentResizeMessage {
  sessionId: string
  cols: number
  rows: number
}

/** Contrapresión: pausar (true) o reanudar (false) la lectura del pty del agente. */
export interface AgentFlowMessage {
  sessionId: string
  paused: boolean
}

export interface AgentReloadRequest {
  sessionId: string
  /**
   * Bases MONTADAS ahora mismo en el proyecto (modo Windows). Reiniciar es la vía por
   * la que se APLICA un cambio de montaje: los secretos viven en el entorno del pty y
   * el aviso al agente en su línea de arranque, y ambos solo pueden fijarse al
   * spawnear. Omitirlo conserva lo que ya tenía la sesión.
   */
  dbConnectionIds?: string[]
  /**
   * Conversación a REANUDAR al relanzar el proceso. Reiniciar debe conservar el chat:
   * relanza el CLI, no la conversación. Omitirlo arrancaría uno nuevo y tiraría el
   * contexto acumulado, que es justo lo que no debe pasar al montar una base a mitad
   * de un análisis.
   */
  resumeSessionId?: string
}

export interface AgentCloseRequest {
  sessionId: string
}

/** Petición de parada atómica de varias sesiones nativas (ver DETENER_VARIAS). */
export interface AgentDetenerVariasRequest {
  sessionIds: string[]
}

/**
 * Por qué una sesión impidió la parada del lote:
 *   - 'trabajando' → tiene un turno abierto.
 *   - 'esperando-respuesta' → el turno sigue abierto en el transcript con el pty callado
 *                    (un diálogo de permiso): el `^C` de la parada lo cancelaría.
 *   - 'no-nativa'  → es de Docker (este flujo sólo toca las nativas).
 *   - 'no-existe'  → el main no la conoce (se cerró entretanto).
 *   - 'muerta'     → su proceso ya salió (el usuario la cerró): no se resucita sin pedirlo.
 *   - 'ocupada'    → está a mitad de otro reinicio o ya parada.
 */
export type CausaRechazoDetener =
  | 'trabajando'
  | 'esperando-respuesta'
  | 'no-nativa'
  | 'no-existe'
  | 'muerta'
  | 'ocupada'

export type AgentDetenerVariasResult =
  | { ok: true; detenidas: string[] }
  | { ok: false; rechazos: Array<{ sessionId: string; causa: CausaRechazoDetener }> }

/** Lo que solo el renderer sabe de un proyecto abierto (ver HIBERNAR_INACTIVOS). */
export interface ProyectoHibernable {
  profileId: string
  /** Identidad opaca del proyecto: el main solo la compara, nunca la usa como ruta. */
  projectHostPath: string
  /** Es el proyecto activo o una casilla del mosaico. */
  enPantalla: boolean
  /** Ya está hibernado (su perfil o solo su agente). */
  hibernado: boolean
  /** Tiene un resultado que el usuario aún no ha visto. */
  sinRevisar: boolean
  /** Milisegundos desde que dejó de estar en pantalla. */
  fueraDePantallaMs: number
}

/** Petición de una ronda de hibernación por inactividad. */
export interface AgentHibernarInactivosRequest {
  /** El ajuste `agenteInactividadMin` tal cual; el main lo sanea (0 = Nunca). */
  minutos: number
  proyectos: ProyectoHibernable[]
}

/** Un proyecto cuyo agente se acaba de hibernar, con el chat que debe reanudar cada sesión. */
export interface AgenteHibernado {
  profileId: string
  projectHostPath: string
  sesiones: Array<{ sessionId: string; agente: AgentKind; resumeSessionId?: string }>
}

/** Resultado de una ronda: lo hibernado y cuándo conviene volver a mirar. */
export interface AgentHibernarInactivosResult {
  hibernados: AgenteHibernado[]
  /** Lo que le falta al proyecto más cercano al umbral, o null si no hay ninguno en espera. */
  revisarEnMs: number | null
  /** El umbral aplicado, o null con «Nunca». */
  umbralMs: number | null
}

/** Petición para volcar la imagen del portapapeles en el contenedor de una sesión. */
export interface AgentSaveImageRequest {
  sessionId: string
}

/** Petición para copiar un archivo del host (ruta Windows) en el contenedor de una sesión. */
export interface AgentStageFileRequest {
  sessionId: string
  /** Ruta ABSOLUTA del archivo en el host (Windows). */
  hostPath: string
}

/** Evento main -> renderer con salida del agente. */
export interface AgentDataMessage {
  sessionId: string
  data: string
}

/**
 * Causa de una salida de sesión, clasificada por el main tras el exit:
 *   - 'ok'             → salida normal (Docker y contenedor vivos): el usuario cerró
 *                        el CLI o el proceso salió. La UI ofrece "Reiniciar".
 *   - 'container-down' → el contenedor del perfil murió (Docker vive). La UI se
 *                        AUTO-RECUPERA (recrea limpio + recarga credenciales), acotado.
 *   - 'daemon-down'    → el daemon de Docker no responde. Tessera NO puede arrancarlo:
 *                        la UI avisa y ofrece reintento MANUAL.
 *   - 'unknown'        → el DIAGNÓSTICO en sí falló (la sonda docker info/inspect lanzó):
 *                        no se pudo determinar la causa. La UI NO auto-recupera (podría
 *                        haber sido una salida normal), pero AVISA de forma visible en
 *                        vez de fingir 'ok' silencioso. Reintento manual.
 * Las tres primeras son espejo de ContainerDeathCause en main/sandbox; 'unknown' lo
 * añade el AgentTerminalController cuando el diagnóstico lanza.
 */
export type AgentExitReason = 'ok' | 'container-down' | 'daemon-down' | 'unknown'

/**
 * Estado de ACTIVIDAD de un agente, derivado por el main del TURNO en curso (ver
 * main/agents/agentActivity: un turno lo arma tu Enter y lo sostiene el caudal de
 * salida del pty):
 *   - 'working' → turno abierto: el CLI está pensando/ejecutando para ti.
 *   - 'done'    → el turno terminó y fue REAL (duró lo bastante como para que te
 *     interese): es la señal accionable "terminó y aún no lo revisas".
 *   - 'idle'    → cierre SILENCIOSO: turno trivial, sesión cerrada/hibernada, o
 *     simplemente no hay nada en marcha. Apaga el indicador SIN avisar de nada.
 * Es una HEURÍSTICA (no parsea la TUI): falla hacia el silencio, nunca inventa un
 * 'done' cuando no hubo un turno tuyo de por medio.
 */
export type AgentActivityState = 'working' | 'done' | 'idle'

/**
 * Evento main -> renderer con el cambio de actividad de una sesión. Lleva la
 * identidad completa (perfil, proyecto, agente) para que el renderer mapee a la
 * key del target sin depender del sessionId (que el pane conoce, pero el panel de
 * progreso —que ve TODOS los perfiles— no).
 */
export interface AgentActivityMessage {
  sessionId: string
  profileId: string
  projectHostPath: string
  agente: AgentKind
  state: AgentActivityState
}

/** Evento main -> renderer cuando el agente termina. */
export interface AgentExitMessage {
  sessionId: string
  /** exitCode del proceso del agente; null si aún no se pudo determinar. */
  exitCode: number | null
  /**
   * Causa clasificada de la salida (Docker/contenedor/normal). Opcional por
   * compatibilidad; si falta, la UI la trata como 'ok' (salida normal).
   */
  reason?: AgentExitReason
}
