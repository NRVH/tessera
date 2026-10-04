// =============================================================================
// Contrato IPC de «actualizar los agentes de tu equipo» (main <-> preload <-> renderer),
// solo para sesiones nativas: el main sabe versiones, elige e instala la orden y sostiene
// el candado por agente; el renderer orquesta y relanza cada sesión desde su pane.
// invoke (renderer -> main): ESTADO, COMPROBAR, INSTALAR; send (main -> renderer): CAMBIO
// y PROGRESO. Lo sirve `src/main/agents/ipc.ts`.
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import type { AgentKind } from './agent-terminal-ipc'
import type { Plataforma } from './plataforma'

export const AGENTES_NATIVOS_CHANNELS = {
  /** invoke: foto actual (con la caché de sondas). void -> EstadoAgentesNativos. */
  ESTADO: 'agentesNativos:estado',
  /**
   * invoke: fuerza sondas SIN caché y consulta de últimas versiones.
   * void -> EstadoAgentesNativos. Es lo que llama el popover al abrirse y el paso de
   * re-sondeo tras instalar.
   */
  COMPROBAR: 'agentesNativos:comprobar',
  /**
   * invoke: instala la versión nueva de UN agente. InstalarRequest -> InstalarResultado.
   * Nunca rechaza la promesa: todo fallo va en el resultado.
   */
  INSTALAR: 'agentesNativos:instalar',
  /** send (main -> renderer): el estado cambió. EstadoAgentesNativos. */
  CAMBIO: 'agentesNativos:cambio',
  /** send (main -> renderer): una línea de la instalación en curso. ProgresoAgentesNativos. */
  PROGRESO: 'agentesNativos:progreso'
} as const

/**
 * Cómo está instalado un CLI en el equipo. Decide la orden de instalación y si hay
 * orden automática:
 *   - 'npm' | 'pnpm' | 'bun' | 'vite-plus': paquete global de ese gestor (Codex; y
 *     Claude si se instaló por npm). Lo detecta la RAÍZ REAL del paquete, la misma que
 *     el shim de Codex exporta como CODEX_MANAGED_PACKAGE_ROOT.
 *   - 'nativo': instalador propio del CLI (Claude Code: `installMethod: "native"`).
 *   - 'brew': Homebrew (cask o fórmula).
 *   - 'gestor': otro gestor del sistema (winget, apk, mise…) que Tessera no maneja.
 *   - 'desconocido': no se pudo determinar.
 */
export type MetodoInstalacion =
  | 'npm'
  | 'pnpm'
  | 'bun'
  | 'vite-plus'
  | 'nativo'
  | 'brew'
  | 'gestor'
  | 'desconocido'

/** Un proceso que tiene abierto algo bajo la carpeta del paquete (sólo Windows). */
export interface ProcesoBloqueador {
  pid: number
  /** Nombre del ejecutable (`codex.exe`, `node.exe`). */
  nombre: string
  /** Ruta completa del ejecutable, para poder decir QUÉ está abierto. */
  ruta: string
  /** ¿Parece el demonio compartido de Codex (`app-server`)? Se nombra distinto en la UI. */
  esDemonio: boolean
}

/** Lo que el main sabe de UN CLI instalado en el equipo. */
export interface EstadoCli {
  agente: AgentKind
  /** Versión instalada según `<cli> --version`; null = no instalado o sonda fallida. */
  instalada: string | null
  /** Última versión publicada para su canal y método; null = desconocida (sin red…). */
  ultima: string | null
  /** Canal de Claude (`latest` | `stable`); null en Codex o si no aplica. */
  canal: string | null
  metodo: MetodoInstalacion
  /** ¿Hay orden automática para este método en esta plataforma? */
  instalable: boolean
  /**
   * ¿Hay que PARAR sus sesiones antes de instalar? Sólo donde el ejecutable vivo
   * bloquea la carpeta que el gestor sustituye (Codex por npm/pnpm/bun en Windows).
   * El renderer lo usa para planificar la fase B; la decisión es del main.
   */
  requiereParar: boolean
  /** Orden para copiar y pegar cuando NO es instalable (o como ayuda si falló). */
  ordenManual: string | null
  /**
   * ¿Hay una versión nueva que instalar? `ultima` > `instalada` y, en Codex, con el
   * binario de ESTA plataforma ya publicado (npm publica `latest` minutos antes).
   */
  hayNueva: boolean
  /** Procesos ajenos a Tessera que bloquearían la instalación (Windows). */
  bloqueadores: ProcesoBloqueador[]
  /** Último error de sonda o de consulta, en español y para el usuario; null si no hubo. */
  error: string | null
  /** Epoch ms de la última comprobación completa; null si nunca. */
  comprobadoEn: number | null
}

/** Una sesión de agente NATIVA viva, tal como la ve el main. */
export interface SesionNativa {
  sessionId: string
  profileId: string
  projectHostPath: string
  agente: AgentKind
  /** Versión del binario con el que arrancó (sonda al lanzar); null = desconocida. */
  versionLanzada: string | null
  /** ¿Corre un binario más viejo que el instalado? (`sesionAtrasada` de versionesCli). */
  atrasada: boolean
  /** ¿Turno abierto ahora mismo? */
  trabajando: boolean
  /**
   * El pty está callado pero el TRANSCRIPT dice que el turno sigue abierto: casi
   * siempre, un diálogo de permiso esperando tu respuesta (el BEL o el silencio
   * cerraron el turno del rastreador, pero no hubo marca de fin en disco). Reiniciar
   * la cancelaría con el `^C` de la parada, así que BLOQUEA igual que `trabajando`.
   */
  esperandoRespuesta: boolean
  /**
   * Heurística: tecleaste o pegaste algo y no lo enviaste. Reiniciar lo perdería.
   * Es un AVISO redactado como posibilidad: vaciar con Esc o recuperar del historial
   * no se ve desde aquí.
   */
  puedeTenerTextoSinEnviar: boolean
}

export interface EstadoAgentesNativos {
  plataforma: Plataforma
  claude: EstadoCli
  codex: EstadoCli
  /** Sólo sesiones NATIVAS con el pty vivo (las de Docker y las ya salidas no cuentan). */
  sesiones: SesionNativa[]
  /** Agente cuya instalación está en curso (candado tomado), o null. */
  instalando: AgentKind | null
}

export interface InstalarRequest {
  agente: AgentKind
  /**
   * Sesiones a PARAR antes de instalar, en el MISMO paso y con el candado ya tomado
   * (Codex en Windows). Vacío = instalar con las sesiones vivas (Claude; Codex en Mac).
   * La parada es atómica: si una trabaja, no se para ninguna y no se instala nada.
   */
  detener: string[]
}

export type MotivoFalloInstalar =
  /** Alguna sesión de `detener` estaba trabajando (o ya no era válida). Nada se tocó. */
  | 'trabajando'
  /** Procesos ajenos siguen teniendo abierta la carpeta del paquete. */
  | 'bloqueado'
  /** La orden de instalación salió con error. */
  | 'fallo'
  /** La orden superó su tope de tiempo y se mató el árbol. */
  | 'tope'
  /** No hay orden automática para este método en esta plataforma. */
  | 'no-instalable'
  /** No hay versión nueva exacta que instalar (o su binario aún no está publicado). */
  | 'sin-version'
  /** Ya había otra instalación en curso. */
  | 'ocupado'

export interface InstalarResultado {
  ok: boolean
  agente: AgentKind
  /** Versión instalada antes; null si no se sabía. */
  antes: string | null
  /** Versión instalada después (sonda SIN caché); null = el CLI ya no responde. */
  despues: string | null
  motivo?: MotivoFalloInstalar
  /** Explicación para el usuario, en español. */
  detalle?: string
  /** Si `motivo === 'trabajando'`: qué sesiones lo impidieron y por qué. */
  rechazos?: Array<{ sessionId: string; causa: string }>
  /** Si `motivo === 'bloqueado'`: quién tiene la carpeta abierta. */
  bloqueadores?: ProcesoBloqueador[]
  /**
   * Sesiones que el main PARÓ de verdad. El renderer las relanza SIEMPRE, también si
   * la instalación falló: una sesión nunca se queda muerta por culpa de la actualización.
   */
  detenidas: string[]
}

export interface ProgresoAgentesNativos {
  agente: AgentKind
  linea: string
  fase?: 'inicio' | 'fin' | 'error'
}
