// =============================================================================
// Contrato IPC de «Actualizar agentes» del modo Docker: los CLI vienen horneados en la imagen
// y el self-update dentro del contenedor no persiste, así que se rehornea la imagen sin caché
// y se recrean los contenedores (los paneles se recuperan solos).
//   invoke RUN -> ResultadoActualizacionAgentes; send PROGRESS (líneas del build).
// Decisiones: docs/decisiones/sandbox/imagen-y-extras.md
// =============================================================================

/** Canales de «Actualizar agentes». */
export const AGENTS_UPDATE_CHANNELS = {
  /** invoke: reconstruye la imagen y recrea contenedores. -> ResultadoActualizacionAgentes. */
  RUN: 'agentsUpdate:run',
  /** invoke: versiones de la imagen, última publicada y lo que está en uso. -> EstadoAgentesDocker. */
  ESTADO: 'agentsUpdate:estado',
  /** send (main -> renderer): línea de progreso del build/recreación. ProgresoActualizacionAgentes. */
  PROGRESS: 'agentsUpdate:progress'
} as const

/** Un CLI de la imagen: lo instalado y lo publicado; null si no se conoce. */
export interface VersionAgenteDocker {
  instalada: string | null
  ultima: string | null
  hayNueva: boolean
}

/** Una sesión viva en un contenedor: actualizar la reinicia. */
export interface SesionDockerEnUso {
  sesionId: string
  perfilId: string
  rutaHostProyecto: string
  nombreAgente: string
  trabajando: boolean
  esperandoRespuesta: boolean
}

/** Una tarea delegada en marcha: actualizar la detiene. */
export interface TareaDockerEnUso {
  id: string
  cuenta: string
  resumen: string
}

/** Los agentes en Docker: todas las cuentas de todos los perfiles usan la misma imagen. */
export interface EstadoAgentesDocker {
  cuentas: number
  perfiles: number
  dockerActivo: boolean
  claude: VersionAgenteDocker
  codex: VersionAgenteDocker
  /** Cuándo se leyeron las versiones de la imagen; null si nunca. */
  leidoEn: number | null
  sesiones: SesionDockerEnUso[]
  tareas: TareaDockerEnUso[]
  /** Algún perfil tiene instalaciones propias, que reconstruyen su capa al abrir un agente. */
  conCapas: boolean
  /** Los paquetes pedidos no entraron en la imagen por un build fallido: reconstruirla es lo único que lo reintenta. */
  extrasVetados: boolean
}

/** Resultado de «Actualizar agentes»: las versiones horneadas o el error. */
export interface ResultadoActualizacionAgentes {
  ok: boolean
  /** Versión de Codex horneada tras el build (p.ej. "codex-cli 0.143.0"). */
  codex: string
  /** Versión de Claude Code horneada tras el build. */
  claude: string
  /** Mensaje de error si falló. */
  error?: string
}

/** Una línea de progreso del build o de la recreación. */
export interface ProgresoActualizacionAgentes {
  line: string
  /**
   * Principio, final o fallo de un rebuild AUTOMÁTICO (el de `asegurarImagen`, no el botón),
   * para que el renderer avise aunque el modal esté cerrado; ausente en el resto de líneas.
   */
  fase?: 'inicio' | 'fin' | 'error'
}
