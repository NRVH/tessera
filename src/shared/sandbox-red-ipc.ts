// =============================================================================
// Contrato IPC de la red del contenedor (modo `--network host` por perfil): el PREVUELO, que
// responde cuando el usuario decide, y el AVISO, que empuja el main cuando la sonda de
// después de recrear el contenedor ve que el modo no funciona. El flag viaja con el perfil.
// Los textos llegan REDACTADOS desde el main (`main/sandbox/redAnfitrion.ts`).
// Decisiones: docs/decisiones/sandbox/red-del-anfitrion.md
// =============================================================================

/** Estado de una fila del prevuelo: 'desconocido' es «no se pudo saber», nunca «no». */
export type EstadoFila = 'ok' | 'falla' | 'desconocido'

/** Una comprobación del prevuelo, YA REDACTADA por el main. El renderer sólo la pinta. */
export interface FilaPrevuelo {
  id: 'motor' | 'version' | 'ajuste' | 'aislamiento' | 'trafico'
  estado: EstadoFila
  titulo: string
  /** Qué hacer. Ausente cuando la fila está en 'ok'. */
  remedio?: string
}

/** Canales de la red del contenedor. */
export const SANDBOX_RED_CHANNELS = {
  /** invoke: corre el prevuelo del modo anfitrión. PrevueloRequest -> ResultadoRedPrevuelo. */
  PREVUELO: 'sandbox:red:prevuelo',
  /** main -> renderer: algo de la red del contenedor merece un aviso. AvisoRed. */
  AVISO: 'sandbox:red:aviso'
} as const

/** Petición del prevuelo de un perfil. */
export interface PrevueloRequest {
  profileId: string
  /**
   * ¿Levantar el contenedor efímero para medir si el tráfico llega? El diálogo, al abrirse,
   * solo quiere `pendiente` (ya en memoria); mide al elegir el modo anfitrión.
   */
  medirTrafico: boolean
}

/** Lo que el diálogo necesita para pintarse entero. */
export interface ResultadoRedPrevuelo {
  /** Las comprobaciones, en orden, ya redactadas. */
  filas: FilaPrevuelo[]
  /** ¿Alguna en 'falla'? Decide el tono, no un porcentaje. */
  hayFallas: boolean
  /**
   * Nota informativa sobre la SALIDA por VPN (WSL en modo espejo). Va aparte de las
   * filas a propósito: es otra cosa —vale para todos los perfiles, con toggle o sin
   * él— y nunca es una comprobación en rojo, porque no sabemos qué host de la VPN le
   * importa al usuario. `null` fuera de Windows, o si no se pudo medir.
   */
  notaEgress: string | null
  /**
   * ¿Hay OTRO perfil vivo ahora mismo en modo anfitrión? En ese modo todos los
   * contenedores comparten el espacio de puertos del equipo, así que dos Codex chocan
   * en el 1455 y el segundo login se queda sin vía. Nombre del perfil, o `null`.
   */
  otroPerfilEnAnfitrion: string | null
  /**
   * ¿El contenedor VIVO corre con una red distinta de la que el perfil ya tiene pedida?
   * Un contenedor vivo no cambia de red, así que el modo se aplica al recrearlo: sin este
   * dato, alguien que ya eligió el modo se queda creyendo que está activo.
   */
  pendiente: boolean
}

/** Motivo del aviso. El texto lo compone el main; esto es para poder distinguirlos. */
export type MotivoAvisoRed = 'sonda-fallida' | 'choque-1455'

/** Aviso de red que el main empuja al renderer, ya redactado. */
export interface AvisoRed {
  profileId: string
  motivo: MotivoAvisoRed
  titulo: string
  detalle: string
}
