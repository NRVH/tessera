// =============================================================================
// Tipos de «actualizar los agentes de tu equipo» en el renderer: la API que publica
// cada pane, el plan, los eventos y las dependencias del orquestador. Sólo tipos:
// los importan el orquestador puro, el pane del agente y el botón de la barra.
// Decisiones: docs/decisiones/agentes/actualizacion-nativa.md
// =============================================================================

import type { AgentKind } from '../../../../shared/agent-terminal-ipc'
import type { AgentDetenerVariasResult } from '../../../../shared/agent-terminal-ipc'
import type {
  EstadoAgentesNativos,
  InstalarRequest,
  InstalarResultado,
  ProcesoBloqueador,
  SesionNativa
} from '../../../../shared/agentes-nativos-ipc'
import type { Plataforma } from '../../../../shared/plataforma'

/** Qué pasó al pedirle a un pane que relance su sesión. */
export type ResultadoRelanzar =
  /** La sesión volvió a arrancar. */
  | 'ok'
  /** El relanzamiento falló (el pane ya lo cuenta en su terminal y ofrece Reabrir). */
  | 'fallo'
  /** No había nada que relanzar: hibernado, sin sesión, cambió de modo o de id. */
  | 'saltada'

/**
 * Lo que cada `AgentTerminalPane` publica hacia arriba. Sus funciones leen REFS en el
 * momento de llamarlas, nunca valores capturados al publicarse (una API publicada
 * con el `sessionId` de hace un minuto relanzaría la sesión equivocada).
 */
export interface ApiAgentePane {
  /** Clave del target (`perfil|proyecto|agente`). Para ordenar y depurar, NO identifica sesión. */
  readonly clave: string
  readonly agente: AgentKind
  readonly profileId: string
  readonly projectHostPath: string
  /** Sesión viva del pane AHORA (o null). */
  sessionId(): string | null
  /** ¿Corre AHORA en modo nativo? */
  hostMode(): boolean
  /**
   * Bloquea el pane para el reinicio: entrada del teclado, historial, «Nueva
   * conversación», cambio de modo y compactar; el pie dice «Actualizando…». No toca
   * el proceso: la parada la hace el main (atómica, por lotes).
   */
  preparar(): void
  /**
   * Relanza la sesión por el camino del «Reiniciar» del pane (misma conversación,
   * montajes vigentes), SIN robar el foco. Escribe `banner` (en color de error si
   * `error`) en vez del banner genérico de reinicio. Siempre deja el pane liberado.
   */
  relanzar(opts: { banner: string; error?: boolean }): Promise<ResultadoRelanzar>
  /** Deshace `preparar()` sin relanzar (el orquestador lo llama en su `finally`). */
  liberar(): void
  /**
   * Fija la conversación que el pane reanudará la PRÓXIMA vez que abra su sesión. Lo usa la
   * hibernación por inactividad con el chat que el main tenía anclado, para que al volver
   * no se reanude «la última de la carpeta».
   */
  reanudarCon(conversacionId: string): void
}

/** Fases que el botón enseña mientras corre. */
export type FaseActualizacion = 'comprobando' | 'instalando' | 'deteniendo' | 'relanzando' | 'terminado'

/** Qué se hará con un CLI al ejecutar. */
export interface InstalacionPlaneada {
  agente: AgentKind
  /**
   * 'A' = se instala con sus sesiones VIVAS (Claude en las dos plataformas, Codex en
   * Mac); 'B' = hay que PARAR sus sesiones antes (Codex en Windows: su ejecutable vivo
   * bloquea la carpeta que npm sustituye).
   */
  fase: 'A' | 'B'
  de: string | null
  a: string
}

/** Un aviso que NO bloquea pero que el usuario debe ver antes de confirmar. */
export interface AvisoSesion {
  sessionId: string
  tipo: 'texto-sin-enviar' | 'sin-revisar'
}

/** Lo que la vista previa promete. Lo calcula `planificar`, puro. */
export interface PlanActualizacion {
  instalar: InstalacionPlaneada[]
  /** Sesiones que se reiniciarán (por una instalación o por ir atrasadas). */
  reiniciar: SesionNativa[]
  /**
   * Sesiones afectadas que TRABAJAN o ESPERAN TU RESPUESTA (un diálogo de permiso que
   * el `^C` de la parada cancelaría): mientras haya alguna, no se puede ejecutar.
   */
  bloqueantes: SesionNativa[]
  avisos: AvisoSesion[]
  /** CLIs con versión nueva que Tessera no puede instalar sola (orden a mano). */
  manuales: Array<{ agente: AgentKind; orden: string | null; motivo: string }>
  /** Procesos ajenos que impiden instalar (Windows); la instalación de ese CLI se omite. */
  bloqueadores: Array<{ agente: AgentKind; procesos: ProcesoBloqueador[] }>
  /** ¿Se puede pulsar la acción? */
  puedeEjecutar: boolean
  /** Por qué no, en español, para escribirlo junto a la lista; null si se puede. */
  motivoNoEjecutar: string | null
  /** Nada que instalar ni sesiones atrasadas (se ofrece «Reiniciar igualmente»). */
  todoAlDia: boolean
  /** ¿Es el plan de «Reiniciar igualmente» (todas las nativas vivas, sin instalar)? */
  forzado: boolean
}

/** Resultado final de una sesión tras la ejecución. */
export interface ResultadoSesion {
  sessionId: string
  agente: AgentKind
  profileId: string
  projectHostPath: string
  resultado: 'relanzada' | 'fallo' | 'saltada'
  /** Por qué se saltó o falló, en español. */
  motivo?: string
}

/** Lo que queda al terminar: lo guarda `useActualizacionNativa` (resultado PEGAJOSO). */
export interface ResumenActualizacion {
  /** Sin ningún fallo de instalación ni de sesión. */
  ok: boolean
  /** Si la compuerta paró todo antes de tocar nada, el motivo; null si se ejecutó. */
  abortado: string | null
  instalaciones: InstalarResultado[]
  sesiones: ResultadoSesion[]
}

/** Eventos de progreso que el orquestador emite mientras corre. */
export type EventoActualizacion =
  | { tipo: 'fase'; fase: FaseActualizacion; agente?: AgentKind }
  | { tipo: 'instalacion'; resultado: InstalarResultado }
  | { tipo: 'sesion'; sesion: ResultadoSesion }
  | { tipo: 'aviso'; texto: string }

/** Dependencias INYECTADAS del orquestador: así su test corre con falsos bajo `node`. */
export interface DepsActualizacion {
  plataforma: Plataforma
  /** Foto FRESCA (sondas sin caché + últimas versiones). */
  comprobar(): Promise<EstadoAgentesNativos>
  instalar(req: InstalarRequest): Promise<InstalarResultado>
  /** Parada atómica de un lote en el main. */
  detener(ids: string[]): Promise<AgentDetenerVariasResult>
  /** Las APIs de los panes montados, leídas en el momento de llamar. */
  panes(): readonly ApiAgentePane[]
  onEvento(ev: EventoActualizacion): void
}
