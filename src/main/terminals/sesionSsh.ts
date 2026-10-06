// =============================================================================
// Las sesiones SSH de la terminal de abajo: se abren en el pty del HOST con la línea que da el
// dominio SSH (`LanzadorSshTerminal`), nunca con el entorno de bases de datos, y guardan una cola
// corta de su salida sin ANSI para decir por qué terminaron, y qué hacer cuando su ssh termina. Lo
// usa `TerminalController`, que así no crece: abrir, reconectar y el mensaje de salida viven aquí.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================
import os from 'node:os'
import type { Profile } from '../profiles/types.ts'
import type { TerminalExitMessage } from '../../shared/terminal-ipc.ts'
import type { TerminalService, TerminalSession } from './TerminalService.ts'
import type { LanzadorSshTerminal } from './lanzadorSsh.ts'

/** Lo que se guarda en crudo: de sobra para que una secuencia cortada en el borde no estorbe. */
const MAX_CRUDO = 16384
/** Lo que se clasifica: los últimos 8 KiB de texto. */
export const MAX_COLA_SSH = 8192

// eslint-disable-next-line no-control-regex -- casar ESC y BEL es justo su trabajo
const SECUENCIAS = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][0-9A-Za-z]|\u001b[@-Z\\-_]/g
// eslint-disable-next-line no-control-regex -- casar caracteres de control es justo su trabajo
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** El texto sin secuencias de escape ni caracteres de control (salvo los saltos de línea y el tabulador). */
export function sinAnsi(texto: string): string {
  return texto.replace(SECUENCIAS, '').replace(CONTROL, '')
}

/** La cola de la salida de una sesión SSH, para clasificar su EXIT. */
export class ColaSalidaSsh {
  private crudo = ''

  anotar(datos: string): void {
    this.crudo = (this.crudo + datos).slice(-MAX_CRUDO)
  }

  /** Los últimos `MAX_COLA_SSH` caracteres, sin ANSI. */
  texto(): string {
    return sinAnsi(this.crudo).slice(-MAX_COLA_SSH)
  }

  vaciar(): void {
    this.crudo = ''
  }
}

/** Lo que el controlador guarda de una sesión SSH. */
export interface SesionSsh {
  conexionId: string
  cola: ColaSalidaSsh
  /** Lo que toca cuando termina el ssh vigente (revocar su ficha, mirar sus huellas). Una sola vez. */
  alTerminar: () => void
}

/** `alTerminar` de una preparación, que se ejecuta como mucho una vez (una salida y luego el cierre, por ejemplo). */
function unaVez(fn: (() => void) | undefined): () => void {
  let hecho = false
  return () => {
    if (hecho) return
    hecho = true
    fn?.()
  }
}

/** Abre la sesión SSH de una conexión del perfil (que lo sea lo comprueba `preparar`). */
export async function abrirSesionSsh(
  terminals: TerminalService,
  lanzador: LanzadorSshTerminal,
  profile: Profile,
  conexionId: string
): Promise<{ session: TerminalSession; ssh: SesionSsh }> {
  const { ejecutable, extraEnv, alTerminar } = lanzador.preparar(profile.id, conexionId)
  const terminar = unaVez(alTerminar)
  try {
    // Siempre en el host, aunque el proyecto abierto sea de Docker, y con cwd en HOME.
    const session = await terminals.createSession(profile, { project: os.homedir(), host: true, ejecutable, extraEnv })
    return { session, ssh: { conexionId, cola: new ColaSalidaSsh(), alTerminar: terminar } }
  } catch (e) {
    terminar()
    throw e
  }
}

/**
 * «Reconectar»: vuelve a preparar con los datos VIGENTES de la conexión, así que aplica una edición.
 * Lanza, sin tocar la sesión, si la conexión ya no existe. El ssh anterior termina aquí: su ficha cae.
 */
export async function recargarSesionSsh(
  terminals: TerminalService,
  lanzador: LanzadorSshTerminal,
  sessionId: string,
  profileId: string,
  ssh: SesionSsh
): Promise<TerminalSession> {
  const { ejecutable, extraEnv, alTerminar } = lanzador.preparar(profileId, ssh.conexionId)
  // Lo que dijo el proceso anterior no puede decidir por qué termina el nuevo.
  ssh.cola.vaciar()
  ssh.alTerminar()
  ssh.alTerminar = unaVez(alTerminar)
  try {
    return await terminals.reloadSession(sessionId, { ejecutable, extraEnv })
  } catch (e) {
    ssh.alTerminar()
    throw e
  }
}

/** El EXIT de una sesión SSH, con su motivo si salió con 255. */
export function salidaSsh(
  sessionId: string,
  exitCode: number | null,
  ssh: SesionSsh,
  lanzador: LanzadorSshTerminal
): TerminalExitMessage {
  const reason = lanzador.clasificar(exitCode, ssh.cola.texto())
  return reason === undefined ? { sessionId, exitCode } : { sessionId, exitCode, reason }
}
