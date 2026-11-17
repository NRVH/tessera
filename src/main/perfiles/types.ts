// =============================================================================
// Tipos de los perfiles de Tessera: el `Profile` que persiste `profiles.json` (id, nombre, color,
// agentes con su carpeta de credenciales, `.ssh` y sandbox), el `Agente` disponible, la lista
// `AGENTES_DISPONIBLES` y la convención `dirConfigAgente` que aísla las credenciales por (perfil,
// agente). Lo importan el main, el renderer (solo tipos y la lista) y las pruebas.
// =============================================================================

export type Agente = 'claude-code' | 'codex'

/**
 * Agentes disponibles en CADA perfil: capacidad FIJA del producto (Claude Code Y
 * Codex), NO configuración por perfil. El selector de la columna del agente los
 * ofrece en todos los perfiles por igual; cada uno corre AISLADO en su propia
 * carpeta de credenciales del perfil (ver dirConfigAgente). El orden es el de
 * presentación en el selector (el primero es el agente por defecto).
 */
export const AGENTES_DISPONIBLES: readonly Agente[] = ['claude-code', 'codex']

/**
 * Subcarpeta de credenciales por agente, dentro de `./.tessera/perfiles/<id>/`.
 * Convención ÚNICA: de aquí sale el configDir cuando el perfil no lo declara,
 * garantizando aislamiento por (perfil, agente) sin depender de profiles.json.
 */
export const SUBCARPETA_CONFIG_AGENTE: Record<Agente, string> = {
  'claude-code': 'claude',
  codex: 'codex'
}

export interface AgenteConfig {
  tipo: Agente
  /**
   * Carpeta de credenciales de este agente. Se mapea a CLAUDE_CONFIG_DIR
   * (claude-code) / CODEX_HOME (codex) dentro del contenedor.
   */
  configDir: string
}

/**
 * configDir (host, relativo a la raíz de datos) de un agente en un perfil. Usa el
 * declarado en `profiles.json` si existe (compatibilidad), si no lo deriva por
 * convención: `./.tessera/perfiles/<id>/<subdir>`. Así Codex y Claude Code
 * funcionan en TODOS los perfiles aunque el JSON no los liste, cada uno en su
 * carpeta aislada dentro del perfil.
 */
export function dirConfigAgente(perfil: Perfil, agente: Agente): string {
  const declared = perfil.agentes.find((a) => a.tipo === agente)
  if (declared) return declared.configDir
  return `./.tessera/perfiles/${perfil.id}/${SUBCARPETA_CONFIG_AGENTE[agente]}`
}

export interface Perfil {
  id: string
  nombre: string
  /** Color hex usado para el borde/badge del perfil en la UI. */
  color: string
  /** Agentes disponibles para este perfil, cada uno con su carpeta de credenciales aislada. */
  agentes: AgenteConfig[]
  /** Carpeta SSH propia del perfil en el host: amplía su catálogo y nunca se monta. */
  sshDir?: string
  /** Rutas host autorizadas para firmar: ausente conserva perfiles existentes; vacío deniega todas. */
  clavesSshPermitidas?: string[]
  /**
   * Reglas para los agentes de este perfil (Markdown, como mucho `MAX_REGLAS_PERFIL` caracteres): las escribe
   * o aprueba el usuario y llegan en el aviso de arranque de todo agente de serie del perfil, detrás de las
   * globales. Ausente = sin reglas. Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
   */
  reglas?: string
  /**
   * Carpetas del equipo con documentos de referencia para los agentes del perfil, que los leen por su nombre con
   * `tctx docs`. Ausente = ninguna. Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
   */
  documentos?: string[]
  /**
   * `false` si el perfil no usa el contexto global: ni sus reglas, ni sus documentos, ni la configuración global
   * de Docker. Ausente = lo usa. Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
   */
  contextoGlobal?: false
  sandbox: {
    habilitado: boolean
    /**
     * Si true, el contenedor del perfil se lanza con `--network host`: sus puertos
     * (back/front, callback OAuth de Codex) quedan directamente en el `localhost` DEL
     * ANFITRIÓN —el equipo del usuario, sea Windows o un Mac—, en el MISMO puerto
     * configurado. Default/ausente = red `bridge` aislada con hostname neutro. Relaja
     * SOLO la red; el aislamiento de credenciales y filesystem (el corazón del producto)
     * no se toca.
     *
     * OJO: que este flag esté en `true` NO significa que el modo esté funcionando. Sólo
     * funciona si Docker Desktop tiene activada la red del anfitrión (Settings ›
     * Resources › Network), que viene apagada de fábrica — y con ella apagada
     * `docker run --network host` no falla: arranca, devuelve 0 y los puertos se quedan
     * dentro de la VM. Quien comprueba de verdad es `main/sandbox/redAnfitrion.ts` y la
     * sonda de `GestorSandbox`; esto es sólo lo que el usuario PIDIÓ.
     *
     * Y tampoco se aplica al vuelo: un contenedor vivo no cambia de red, así que el modo
     * entra al RE-CREARLO (hibernar el perfil y volver a entrar).
     */
    redHost?: boolean
  }
}

/** Perfiles vivos del main: `SAVE_PROFILES` reasigna la lista y las clausuras la leen al usarse. */
export interface PerfilesVivos {
  lista: Perfil[]
}
