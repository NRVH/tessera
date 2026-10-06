// =============================================================================
// Lo que la terminal necesita del dominio SSH para abrir una sesión: la línea de ssh de una
// conexión guardada, qué hacer cuando ese ssh termina y el motivo de su salida. Solo tipos,
// declarados aquí para que `terminals/` no importe `ssh/`: lo implementa `ssh/ControladorSsh.ts`
// y se inyecta al construir el controlador.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================
import type { TerminalExitReason } from '../../shared/terminal-ipc.ts'
import type { EjecutableSesion } from './tiposSesion.ts'

/** Con qué se lanza la sesión SSH de una conexión. */
export interface PreparacionSsh {
  ejecutable: EjecutableSesion
  /** Variables extra del pty. Nunca el entorno de bases de datos; nunca un secreto (sí la ficha del programa de contraseñas). */
  extraEnv: Record<string, string>
  /**
   * Para cuando ESTE ssh termina (sale, se cierra la pestaña o se reconecta): revoca su ficha y avisa si
   * guardó una huella. Se llama una sola vez.
   */
  alTerminar?: () => void
}

/** El dominio SSH visto desde la terminal. */
export interface LanzadorSshTerminal {
  /**
   * La línea de ssh con los datos VIGENTES de la conexión. Lanza con un mensaje para el usuario si
   * la conexión no existe, si es de OTRO perfil, o si no se puede abrir (sin cliente SSH, datos que
   * no valen).
   */
  preparar(profileId: string, conexionId: string): PreparacionSsh
  /** Por qué salió la sesión (solo con 255), a partir de la cola de su salida ya sin ANSI. */
  clasificar(exitCode: number | null, cola: string): TerminalExitReason | undefined
}
