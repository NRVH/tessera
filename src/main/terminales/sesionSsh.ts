// =============================================================================
// Las sesiones SSH de la terminal de abajo: se abren en el pty del HOST con la línea que da el
// dominio SSH (`LanzadorSshTerminal`), nunca con el entorno de bases de datos, y guardan una cola
// corta de su salida sin ANSI para decir por qué terminaron, y qué hacer cuando su ssh termina. Lo
// usa `ControladorTerminal`, que así no crece: abrir, reconectar y el mensaje de salida viven aquí.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================
import os from 'node:os'
import type { Perfil } from '../perfiles/types.ts'
import type { MensajeSalidaTerminal } from '../../shared/terminal-ipc.ts'
import type { ServicioTerminal, SesionTerminal } from './ServicioTerminal.ts'
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

/**
 * Termina el ssh de la pestaña por su pid (el pty lanza ssh directamente): la pestaña lo ve salir como
 * siempre y se puede reconectar. El pid se lee al matar, no al vincular: es el del ssh vigente.
 */
function matarPorPid(terminales: ServicioTerminal, sesionId: string): () => void {
  return () => {
    const pid = terminales.pidDe(sesionId)
    if (pid === null) return
    try {
      process.kill(pid)
    } catch {
      // Ya había salido.
    }
  }
}

/** Abre la sesión SSH de una conexión del perfil (que lo sea lo comprueba `preparar`). */
export async function abrirSesionSsh(
  terminales: ServicioTerminal,
  lanzador: LanzadorSshTerminal,
  perfil: Perfil,
  conexionId: string
): Promise<{ sesion: SesionTerminal; ssh: SesionSsh }> {
  const { ejecutable, extraEnv, alTerminar, vincular } = lanzador.preparar(perfil.id, conexionId)
  const terminar = unaVez(alTerminar)
  try {
    // Siempre en el host, aunque el proyecto abierto sea de Docker, y con cwd en HOME.
    const sesion = await terminales.crearSesion(perfil, { proyecto: os.homedir(), host: true, ejecutable, extraEnv })
    vincular?.(matarPorPid(terminales, sesion.id))
    return { sesion, ssh: { conexionId, cola: new ColaSalidaSsh(), alTerminar: terminar } }
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
  terminales: ServicioTerminal,
  lanzador: LanzadorSshTerminal,
  sesionId: string,
  perfilId: string,
  ssh: SesionSsh
): Promise<SesionTerminal> {
  const { ejecutable, extraEnv, alTerminar, vincular } = lanzador.preparar(perfilId, ssh.conexionId)
  // Lo que dijo el proceso anterior no puede decidir por qué termina el nuevo.
  ssh.cola.vaciar()
  ssh.alTerminar()
  ssh.alTerminar = unaVez(alTerminar)
  try {
    const sesion = await terminales.recargarSesion(sesionId, { ejecutable, extraEnv })
    vincular?.(matarPorPid(terminales, sesionId))
    return sesion
  } catch (e) {
    ssh.alTerminar()
    throw e
  }
}

/** El EXIT de una sesión SSH, con su motivo si salió con 255. */
export function salidaSsh(
  sesionId: string,
  codigoSalida: number | null,
  ssh: SesionSsh,
  lanzador: LanzadorSshTerminal
): MensajeSalidaTerminal {
  const motivo = lanzador.clasificar(codigoSalida, ssh.cola.texto())
  return motivo === undefined ? { sessionId: sesionId, codigoSalida } : { sessionId: sesionId, codigoSalida, motivo }
}
