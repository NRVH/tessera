// =============================================================================
// Las dos líneas de arranque del CLI del agente: la del contenedor (bajo `env -i`, con el
// preludio de git y las variables de bases) y la nativa del host. Puras: componen una
// cadena con todo lo que reciben por parámetro. El entrecomillado del briefing es por
// plataforma y sale de `shared/citarShell.ts`: POSIX en el contenedor y en macOS,
// PowerShell en Windows.
// Decisiones: docs/decisiones/agentes/sesion-linea-de-arranque.md
// =============================================================================

import type { Agente } from '../profiles/types.ts'
import type { SshSetup } from '../sandbox/sshSetup.ts'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { citarPowerShell, citarSh } from '../../shared/citarShell.ts'
import { composeCleanGitCommand, dbAgentAssignments } from './gitInContainer.ts'

/**
 * Id de conversación aceptable (forma de UUID, lo que generan los dos CLIs): acaba dentro
 * de un `sh -c`. Si no calza se ignora y se arranca conversación nueva.
 */
const ID_CONVERSACION = /^[0-9a-fA-F-]{8,64}$/

/**
 * Codex, sin su servidor compartido en segundo plano: con él, todas las sesiones de una cuenta
 * correrían en un proceso fuera de la terminal, con el entorno de la primera (bases, `tdb`, PATH),
 * y cerrar o hibernar la pestaña no pararía su turno. Una clave de `features` desconocida solo deja
 * un aviso en el registro de Codex, así que vale también con las versiones que no la tienen.
 */
const SIN_SERVIDOR_CODEX = '-c features.daemon_auto_start=false'

/** Argumento de reanudación de cada CLI: CC usa un flag, Codex un subcomando. */
function argumentoReanudar(agente: Agente, resumeSessionId?: string): string | null {
  if (!resumeSessionId || !ID_CONVERSACION.test(resumeSessionId)) return null
  return agente === 'codex' ? `resume ${resumeSessionId}` : `--resume ${resumeSessionId}`
}

/**
 * Lo que Codex oye además del aviso: su sandbox (`workspace-write`) suele ir sin red, y `tdb` y
 * `tssh` necesitan el puente de Tessera y la red.
 */
const AVISO_SANDBOX_CODEX =
  'Si tu sandbox no tiene red, `tdb` y `tssh` fallarán dentro de él: pide permiso para ejecutarlos fuera del sandbox.'

/**
 * El aviso de arranque (bases y SSH) en el flag de cada CLI, o null: `--append-system-prompt`
 * en Claude Code y `-c developer_instructions=…` en Codex. Los saltos de línea se aplanan a
 * espacios; un briefing en blanco no produce flag. `citar` es la regla de la shell que la
 * recibe.
 */
function argumentoBriefing(
  briefing: string | null | undefined,
  agente: Agente,
  citar: (valor: string) => string
): string | null {
  if (!briefing) return null
  const plano = briefing.replace(/\r?\n/g, ' ').trim()
  if (plano.length === 0) return null
  if (agente === 'claude-code') return `--append-system-prompt ${citar(plano)}`
  // Codex: `-c` parsea el valor como TOML y, si no lo es, lo toma literal. El prefijo fijo empieza por una
  // palabra, que no es un valor TOML, así que el aviso llega tal cual.
  return `-c ${citar(`developer_instructions=Avisos de Tessera: ${plano} ${AVISO_SANDBOX_CODEX}`)}`
}

/**
 * Comando de arranque del agente EN EL CONTENEDOR: entorno limpio (`env -i`) con el
 * preludio ssh/git, las asignaciones de git y de bases (re-inyectadas: `env -i` borra los
 * `-e` de `docker exec`), TERM y la carpeta de configuración del agente; luego `exec`.
 * `binary` es inyectable para las pruebas.
 */
export function buildAgentLaunchCommand(
  binary: string,
  agente: Agente,
  containerConfigPath: string,
  sshSetup: SshSetup | null = null,
  resumeSessionId?: string,
  dbEnv?: Record<string, string>,
  briefing?: string | null
): string {
  const args: string[] = []
  const reanudar = argumentoReanudar(agente, resumeSessionId)
  if (reanudar) args.push(reanudar)

  if (agente === 'codex') args.push(SIN_SERVIDOR_CODEX)
  // POSIX siempre: esta línea acaba en el `bash -c` del contenedor sea cual sea el host.
  const aviso = argumentoBriefing(briefing, agente, citarSh)
  if (aviso) args.push(aviso)

  const invocation = args.length > 0 ? `exec ${binary} ${args.join(' ')}` : `exec ${binary}`
  return composeCleanGitCommand(invocation, {
    agente,
    containerConfigPath,
    extraAssignments: ['TERM=xterm-256color', ...dbAgentAssignments(dbEnv)],
    sshSetup
  })
}

/**
 * Línea del contenedor de un agente MANUAL: `HOME` en su carpeta persistente del perfil, sus
 * `.local/bin` delante del PATH, git y bases como los de serie, y ni variable de cuenta ni aviso
 * por opción de arranque (cada CLI tiene la suya y una desconocida podría impedir que arranque).
 * Sin `exec`: el comando es el del usuario y puede llevar sintaxis de shell.
 */
export function buildManualAgentLaunchCommand(
  invocacion: string,
  home: string,
  sshSetup: SshSetup | null = null,
  dbEnv?: Record<string, string>
): string {
  return composeCleanGitCommand(invocacion, {
    home,
    pathDelante: [`${home}/.local/bin`, '/home/agente/.local/bin'],
    extraAssignments: ['TERM=xterm-256color', ...dbAgentAssignments(dbEnv)],
    sshSetup
  })
}

/**
 * Comando de arranque del agente en MODO NATIVO: la invocación pelada del CLI, que corre
 * en la shell nativa del host (`shellNativo.ts`) con el login y el PATH del usuario.
 * `plataforma` elige el entrecomillado del briefing: PowerShell en Windows, POSIX en el resto.
 */
export function buildHostAgentLaunchCommand(
  binary: string,
  agente: Agente,
  resumeSessionId?: string,
  briefing?: string | null,
  plataforma: Plataforma = plataformaActual()
): string {
  const args: string[] = []
  const reanudar = argumentoReanudar(agente, resumeSessionId)
  if (reanudar) args.push(reanudar)
  if (agente === 'codex') args.push(SIN_SERVIDOR_CODEX)
  const citar = plataforma === 'windows' ? citarPowerShell : citarSh
  const aviso = argumentoBriefing(briefing, agente, citar)
  if (aviso) args.push(aviso)
  return args.length ? `${binary} ${args.join(' ')}` : binary
}
