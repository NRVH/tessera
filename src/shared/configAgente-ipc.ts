// =============================================================================
// Contrato IPC del editor de la configuración de un agente: los archivos reales de su carpeta
// (la nativa o la de una cuenta de Docker), tal como los usa el CLI. El renderer nombra la cuenta y
// el tipo de archivo, nunca una ruta. Lo sirve `src/main/agents/configAgente/`.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================

export type AgenteConConfig = 'claude-code' | 'codex'
export type TipoArchivoConfig = 'configuracion' | 'instrucciones'

export const TIPOS_ARCHIVO_CONFIG: readonly TipoArchivoConfig[] = ['configuracion', 'instrucciones']

/** Los únicos archivos que se leen o escriben: nunca credenciales ni el estado interno del CLI. */
export const ARCHIVOS_CONFIG_AGENTE: Readonly<Record<AgenteConConfig, Readonly<Record<TipoArchivoConfig, string>>>> = {
  'claude-code': { configuracion: 'settings.json', instrucciones: 'CLAUDE.md' },
  codex: { configuracion: 'config.toml', instrucciones: 'AGENTS.md' }
}

/** La carpeta del agente nativo bajo el directorio del usuario, salvo que el CLI la cambie por su variable de entorno. */
export const CARPETA_NATIVA_AGENTE: Readonly<Record<AgenteConConfig, string>> = { 'claude-code': '.claude', codex: '.codex' }

/**
 * El archivo en que Tessera compone las capas compartidas, en la carpeta de una cuenta de Docker, y que el CLI
 * superpone al suyo: Claude Code con `--settings <ruta>` y Codex con `-p tessera`, que lee
 * `$CODEX_HOME/tessera.config.toml`. No se edita: se rehace al abrir cada sesión.
 */
export const ARCHIVO_CAPA: Readonly<Record<AgenteConConfig, string>> = {
  'claude-code': 'tessera-contexto.settings.json',
  codex: 'tessera.config.toml'
}
export const PERFIL_CAPA_CODEX = 'tessera'

/** Lo más grande que se abre o se guarda: estos archivos son de texto y un agente también puede escribirlos. */
export const MAX_BYTES_CONFIG_AGENTE = 1024 * 1024

export const CONFIG_AGENTE_CHANNELS = {
  /** invoke: los dos archivos de la cuenta y sus sesiones abiertas; null si la cuenta ya no existe. */
  LEER: 'configAgente:leer',
  /** invoke: la versión anterior a la última vez que Tessera guardó ese archivo; null si no la hay. */
  LEER_ANTERIOR: 'configAgente:leerAnterior',
  /** invoke: valida y guarda un archivo; devuelve un `ResultadoGuardarConfig`. */
  GUARDAR: 'configAgente:guardar',
  /** invoke: las propuestas de configuración pendientes que dejaron los agentes con `tctx config proponer`. */
  PROPUESTAS: 'configAgente:propuestas',
  /** invoke: acepta (la escribe en su nivel) o descarta una propuesta. ResolverPropuestaConfig -> ResultadoGuardarConfig | null. */
  RESOLVER_PROPUESTA: 'configAgente:resolverPropuesta',
  /** main -> renderer: ha llegado una propuesta. */
  PROPUESTA_LLEGADA: 'configAgente:propuestaLlegada'
} as const

/**
 * Una propuesta de un agente para la configuración compartida de Docker: el archivo entero nuevo de un nivel.
 * No cambia nada hasta que el usuario la acepta. Una nueva para el mismo nivel, agente y archivo sustituye a la anterior.
 */
export interface PropuestaConfig {
  id: string
  nivel: OrigenCompartido
  /** El perfil del agente que la hizo; en el nivel del perfil, también el perfil al que se aplica. */
  profileId: string
  agente: AgenteConConfig
  /** Las capas solo tienen configuración técnica: lo común a varios agentes es una regla. */
  tipo: 'configuracion'
  texto: string
  motivo: string
  /** Cuándo llegó (ms). */
  en: number
  /** El nombre de la carpeta del proyecto desde el que se propuso, si la sesión tenía uno. */
  proyecto?: string
}

export interface ResolverPropuestaConfig {
  id: string
  aceptar: boolean
}

/** La capa a la que se aplica una propuesta. */
export function capaDePropuesta(p: Pick<PropuestaConfig, 'nivel' | 'profileId'>): CapaCompartida {
  return p.nivel === 'global' ? { tipo: 'global' } : { tipo: 'perfil', profileId: p.profileId }
}

/** De qué capa compartida sale una clave fijada en las cuentas de Docker. */
export type OrigenCompartido = 'global' | 'perfil'

/** Una capa de la configuración compartida de Docker: la común a todos los perfiles o la de uno. */
export type CapaCompartida = { tipo: 'global' } | { tipo: 'perfil'; profileId: string }

/**
 * Una cuenta de Docker por su id, la carpeta nativa del agente con `accountId: null`, o una capa de la
 * configuración compartida con `capa` (entonces `accountId` no cuenta).
 */
export interface RefConfigAgente {
  agente: AgenteConConfig
  accountId: string | null
  capa?: CapaCompartida
}

/** Rehace una referencia de sus partes sueltas (las que un hook puede comparar), sin perder la capa. */
export function refConfig(agente: AgenteConConfig, accountId: string | null, capaTipo: CapaCompartida['tipo'] | null, capaPerfil: string | null): RefConfigAgente {
  if (capaTipo === 'global') return { agente, accountId, capa: { tipo: 'global' } }
  if (capaTipo === 'perfil' && capaPerfil !== null) return { agente, accountId, capa: { tipo: 'perfil', profileId: capaPerfil } }
  return { agente, accountId }
}

/** Una clave de primer nivel que la configuración compartida escribe en la cuenta al abrir cada sesión. */
export interface ClaveFijada {
  clave: string
  origen: OrigenCompartido
}

/** Una clave que el archivo admite, pero que Tessera sustituye al abrir una sesión. */
export type AvisoConfigAgente = 'developer-instructions'

/** Por qué un archivo no se abre: un enlace plantado desde el contenedor, un tamaño excesivo o un texto que no es UTF-8. */
export type BloqueoArchivoConfig = 'no-regular' | 'demasiado-grande' | 'no-utf8'

export interface ArchivoConfigLeido {
  tipo: TipoArchivoConfig
  nombre: string
  contenido: string
  /** Huella de lo leído; null si el archivo no existe. Guardar la compara para no pisar un cambio ajeno. */
  version: string | null
  hayAnterior: boolean
  avisos: AvisoConfigAgente[]
  bloqueo: BloqueoArchivoConfig | null
}

export interface ConfigAgenteLeida {
  /** Solo para enseñarla: nada vuelve al main como ruta. */
  carpeta: string
  archivos: Record<TipoArchivoConfig, ArchivoConfigLeido>
  sesionesAbiertas: number
  /** En una cuenta de Docker cuyo perfil usa la configuración compartida: las claves que esta fija. */
  fijadas: ClaveFijada[]
}

export interface LeerAnteriorConfigRequest {
  ref: RefConfigAgente
  tipo: TipoArchivoConfig
}

export interface GuardarConfigRequest {
  ref: RefConfigAgente
  tipo: TipoArchivoConfig
  contenido: string
  versionLeida: string | null
  /** Guarda aunque el archivo haya cambiado desde que se leyó: el usuario ya lo decidió al verlo. */
  sobrescribir?: boolean
}

export type ResultadoGuardarConfig =
  | { estado: 'guardado'; archivo: ArchivoConfigLeido }
  | { estado: 'sintaxis'; linea: number | null; columna: number | null; detalle: string }
  | { estado: 'raiz-json' }
  | { estado: 'cambio-externo' }
  | { estado: 'cuenta-no-disponible' }
  | { estado: BloqueoArchivoConfig }
