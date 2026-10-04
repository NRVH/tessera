// =============================================================================
// Tipos de los perfiles de Tessera: el `Profile` que persiste `profiles.json` (id, nombre, color,
// agentes con su carpeta de credenciales, `.ssh` y sandbox), el `Agente` disponible, la lista
// `AGENTES_DISPONIBLES` y la convención `agentConfigDir` que aísla las credenciales por (perfil,
// agente). Lo importan el main, el renderer (solo tipos y la lista) y las pruebas.
// =============================================================================

export type Agente = 'claude-code' | 'codex'

/**
 * Agentes disponibles en CADA perfil: capacidad FIJA del producto (Claude Code Y
 * Codex), NO configuración por perfil. El selector de la columna del agente los
 * ofrece en todos los perfiles por igual; cada uno corre AISLADO en su propia
 * carpeta de credenciales del perfil (ver agentConfigDir). El orden es el de
 * presentación en el selector (el primero es el agente por defecto).
 */
export const AGENTES_DISPONIBLES: readonly Agente[] = ['claude-code', 'codex']

/**
 * Subcarpeta de credenciales por agente, dentro de `./.tessera/perfiles/<id>/`.
 * Convención ÚNICA: de aquí sale el configDir cuando el perfil no lo declara,
 * garantizando aislamiento por (perfil, agente) sin depender de profiles.json.
 */
export const AGENT_CONFIG_SUBDIR: Record<Agente, string> = {
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
export function agentConfigDir(profile: Profile, agente: Agente): string {
  const declared = profile.agentes.find((a) => a.tipo === agente)
  if (declared) return declared.configDir
  return `./.tessera/perfiles/${profile.id}/${AGENT_CONFIG_SUBDIR[agente]}`
}

export interface Profile {
  id: string
  nombre: string
  /** Color hex usado para el borde/badge del perfil en la UI. */
  color: string
  /** Agentes disponibles para este perfil, cada uno con su carpeta de credenciales aislada. */
  agentes: AgenteConfig[]
  /**
   * Carpeta `.ssh` del host (ruta Windows ABSOLUTA, p.ej. `C:\Users\x\.ssh`) que
   * se montará READ-ONLY como `/home/agente/.ssh` dentro del contenedor del
   * perfil, para que git/ssh del agente encuentren las llaves en `~/.ssh`.
   *
   * OPCIONAL: un perfil sin `sshDir` no monta nada — `~/.ssh` no existe en su
   * contenedor y un push por SSH fallará con error claro (comportamiento seguro).
   * Varios perfiles PUEDEN apuntar a la misma carpeta host (son binds
   * independientes en contenedores distintos); el contenedor de un perfil monta
   * SOLO su propia `.ssh`, nunca la de otro.
   */
  sshDir?: string
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
     * sonda de `SandboxManager`; esto es sólo lo que el usuario PIDIÓ.
     *
     * Y tampoco se aplica al vuelo: un contenedor vivo no cambia de red, así que el modo
     * entra al RE-CREARLO (hibernar el perfil y volver a entrar).
     */
    redHost?: boolean
  }
}

/** Perfiles vivos del main: `SAVE_PROFILES` reasigna la lista y las clausuras la leen al usarse. */
export interface PerfilesVivos {
  lista: Profile[]
}
