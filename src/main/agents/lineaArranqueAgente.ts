// =============================================================================
// Las dos líneas de arranque del CLI del agente: la del contenedor (bajo `env -i`, con el
// preludio de git y las variables de bases) y la nativa del host. Puras: componen una
// cadena con todo lo que reciben por parámetro. El entrecomillado del briefing es por
// plataforma y sale de `shared/citarShell.ts`: POSIX en el contenedor y en macOS,
// PowerShell en Windows.
// Decisiones: docs/decisiones/agentes/sesion-linea-de-arranque.md
// =============================================================================

import type { Agente } from '../profiles/types.ts'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { citarPowerShell, citarSh } from '../../shared/citarShell.ts'
import { ARCHIVO_CAPA, PERFIL_CAPA_CODEX } from '../../shared/configAgente-ipc.ts'
import { ASIGNACIONES_TERMINAL_CONTENEDOR } from '../terminals/entornoPty.ts'
import { composeCleanGitCommand, dbAgentAssignments } from './gitInContainer.ts'

/**
 * Id de conversación aceptable (forma de UUID, lo que generan los dos CLIs): acaba dentro
 * de un `sh -c` y de rutas del disco. Si no calza se ignora y se arranca conversación nueva.
 */
export const ID_CONVERSACION = /^[0-9a-fA-F-]{8,64}$/

/**
 * Codex, sin su servidor compartido en segundo plano: con él, todas las sesiones de una cuenta
 * correrían en un proceso fuera de la terminal, con el entorno de la primera (bases, `tdb`, PATH),
 * y cerrar o hibernar la pestaña no pararía su turno. Una clave de `features` desconocida solo deja
 * un aviso en el registro de Codex, así que vale también con las versiones que no la tienen.
 */
export const SIN_SERVIDOR_CODEX = '-c features.daemon_auto_start=false'

/** Argumento de reanudación de cada CLI: CC usa un flag, Codex un subcomando. */
function argumentoReanudar(agente: Agente, resumeSessionId?: string): string | null {
  if (!resumeSessionId || !ID_CONVERSACION.test(resumeSessionId)) return null
  return agente === 'codex' ? `resume ${resumeSessionId}` : `--resume ${resumeSessionId}`
}

/**
 * Claude Code graba el prompt de sistema en la primera petición de la conversación y, al reanudarla, reenvía el
 * grabado aunque la línea traiga otro aviso: las reglas nuevas o la frase de un traspaso no llegarían hasta la
 * compactación. Al reanudar con aviso se le pide que no lo grabe, si su `--help` tiene la opción: una versión que
 * no la conoce no arrancaría con ella, y tampoco graba. En el contenedor se mira en la propia línea, que es bash
 * (una décima de segundo); en el equipo lo decide el main (`admiteSnapshot`), porque la shell del usuario puede
 * ser fish, que no parte una sustitución en argumentos.
 */
export const OPCION_SNAPSHOT = '--system-prompt-snapshot'

export function argumentoSnapshot(agente: Agente, binary: string, reanudar: string | null, aviso: string | null): string | null {
  if (agente !== 'claude-code' || !reanudar || !aviso) return null
  return `$(${ayudaConTope(binary)} | grep -q -e ${OPCION_SNAPSHOT} && echo ${OPCION_SNAPSHOT} off)`
}

/**
 * La ayuda del CLI, en el contenedor, con tope: la sustitución espera a que la salida se cierre, y un binario que
 * no saliera con `--help` dejaría la sesión sin arrancar. `timeout` es de coreutils, que trae la imagen.
 */
const ayudaConTope = (binary: string): string => `timeout 10 ${binary} --help 2>/dev/null`

/**
 * La capa compartida de Docker que Tessera dejó en la carpeta de la cuenta (`ARCHIVO_CAPA`), superpuesta a la
 * configuración de la cuenta sin escribir en ella. Claude Code la lee con `--settings`, que existe desde mucho
 * antes que estas capas. Codex, con `-p`, que solo superpone un archivo desde sus perfiles por archivo (las
 * versiones anteriores buscan una tabla `[profiles.tessera]` y no arrancarían sin ella): va si su `--help`
 * describe la forma de archivo; sin ella el agente arranca con la configuración de la cuenta.
 */
export function argumentoCapa(agente: Agente, binary: string, containerConfigPath: string): string {
  if (agente === 'claude-code') return `--settings ${citarSh(`${containerConfigPath}/${ARCHIVO_CAPA['claude-code']}`)}`
  return `$(${ayudaConTope(binary)} | grep -q -F '<name>.config.toml' && echo -p ${PERFIL_CAPA_CODEX})`
}

/**
 * Lo que Codex oye además del aviso: su sandbox (`workspace-write`) suele ir sin red, y `tdb`, `tssh`
 * y `tctx` necesitan el puente de Tessera (y los dos primeros, la red).
 */
const AVISO_SANDBOX_CODEX =
  'Si tu sandbox no tiene red, `tdb`, `tssh` y `tctx` fallarán dentro de él: pide permiso para ejecutarlos fuera del sandbox.'

/**
 * El aviso de arranque (bases, SSH y reglas del perfil) en el flag de cada CLI, o null: `--append-system-prompt`
 * en Claude Code y `-c developer_instructions=…` en Codex. Los saltos de línea se aplanan a
 * espacios; un briefing en blanco no produce flag. `citar` es la regla de la shell que la
 * recibe.
 */
export function argumentoBriefing(
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
 * El primer mensaje de la conversación como argumento posicional, el último de la línea (los dos CLIs lo
 * aceptan así, también tras `--resume`/`resume <id>`), o null. Va en una línea, como el aviso.
 */
function argumentoPrompt(prompt: string | null | undefined, citar: (valor: string) => string): string | null {
  // PowerShell 5.1 no escapa las comillas dobles de un argumento al pasarlo a un ejecutable: lo partiría.
  const plano = (prompt ?? '').replace(/\r?\n/g, ' ').replace(/"/g, "'").trim()
  // Un primer mensaje que empezara por `-` lo leería el CLI como una opción.
  if (plano.length === 0 || plano.startsWith('-')) return null
  return citar(plano)
}

/**
 * Comando de arranque del agente EN EL CONTENEDOR: entorno limpio (`env -i`) con el
 * preludio ssh/git, las asignaciones de git y de bases (re-inyectadas: `env -i` borra los
 * `-e` de `docker exec`), TERM, COLORTERM y la carpeta de configuración del agente; luego `exec`.
 * `binary` es inyectable para las pruebas.
 */
export function buildAgentLaunchCommand(
  binary: string,
  agente: Agente,
  containerConfigPath: string,
  resumeSessionId?: string,
  dbEnv?: Record<string, string>,
  briefing?: string | null,
  promptInicial?: string | null,
  /** Si Tessera dejó la capa compartida en la carpeta de la cuenta (`prepararCapaCompartida`). */
  conCapa = false
): string {
  const args: string[] = []
  const reanudar = argumentoReanudar(agente, resumeSessionId)
  if (reanudar) args.push(reanudar)

  if (agente === 'codex') args.push(SIN_SERVIDOR_CODEX)
  if (conCapa && (agente === 'claude-code' || agente === 'codex')) args.push(argumentoCapa(agente, binary, containerConfigPath))
  // POSIX siempre: esta línea acaba en el `bash -c` del contenedor sea cual sea el host.
  const aviso = argumentoBriefing(briefing, agente, citarSh)
  if (aviso) args.push(aviso)
  const snapshot = argumentoSnapshot(agente, binary, reanudar, aviso)
  if (snapshot) args.push(snapshot)
  const prompt = argumentoPrompt(promptInicial, citarSh)
  if (prompt) args.push(prompt)

  const agenteSolo = args.length > 0 ? `exec ${binary} ${args.join(' ')}` : `exec ${binary}`
  // Codex sin sesión en su cuenta: primero el login por navegador (el enlace sale en la terminal y la
  // vuelta la trae el puente del 1455 de Tessera), y el agente solo si salió bien. Por navegador y no por
  // código: una cuenta de empresa puede tener el código desactivado. Se mira al arrancar, así que vale
  // igual al relanzar.
  const invocation =
    agente === 'codex' ? `{ [ -f "$CODEX_HOME/auth.json" ] || ${binary} login; } && ${agenteSolo}` : agenteSolo
  return composeCleanGitCommand(invocation, {
    agente,
    containerConfigPath,
    extraAssignments: [...ASIGNACIONES_TERMINAL_CONTENEDOR, ...dbAgentAssignments(dbEnv)],
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
  dbEnv?: Record<string, string>
): string {
  return composeCleanGitCommand(invocacion, {
    home,
    pathDelante: [`${home}/.local/bin`, '/home/agente/.local/bin'],
    extraAssignments: [...ASIGNACIONES_TERMINAL_CONTENEDOR, ...dbAgentAssignments(dbEnv)],
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
  plataforma: Plataforma = plataformaActual(),
  promptInicial?: string | null,
  /** Si el Claude Code del equipo tiene `--system-prompt-snapshot` (lo sondea el main). */
  admiteSnapshot = false
): string {
  const args: string[] = []
  const reanudar = argumentoReanudar(agente, resumeSessionId)
  if (reanudar) args.push(reanudar)
  if (agente === 'codex') args.push(SIN_SERVIDOR_CODEX)
  const citar = plataforma === 'windows' ? citarPowerShell : citarSh
  const aviso = argumentoBriefing(briefing, agente, citar)
  if (aviso) args.push(aviso)
  if (agente === 'claude-code' && reanudar && aviso && admiteSnapshot) args.push(`${OPCION_SNAPSHOT} off`)
  const prompt = argumentoPrompt(promptInicial, citar)
  if (prompt) args.push(prompt)
  return args.length ? `${binary} ${args.join(' ')}` : binary
}
