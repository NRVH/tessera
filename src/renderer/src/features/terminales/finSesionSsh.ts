// =============================================================================
// Qué se dice cuando una sesión SSH termina, en lógica pura: «No se pudo conectar» si salió con 255
// (el código de los fallos del propio ssh) o con un motivo del main en menos de 20 s, con el motivo
// si lo hay; «Se cortó la conexión» si fue un fallo después; y «La sesión terminó» (con el código si
// no fue 0 ni la salida sin código de Windows) para el resto. Y el banner con el que el xterm lo
// cuenta y manda a «Reconectar». Se fija bajo `node` (`test-pestanas-ssh.mts`).
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import type { Plataforma } from '../../../../shared/plataforma.ts'
import type { TerminalExitReason } from '../../../../shared/terminal-ipc.ts'

/** El código con el que sale ssh cuando falla él y no lo de dentro. */
export const CODIGO_FALLO_SSH = 255

/** El -1 de Windows visto como entero sin signo de 32 bits. */
export const CODIGO_FALLO_SSH_WINDOWS = 4294967295

/** Antes de esto, un 255 es «no se pudo conectar»; después, «se cortó» (hubo una sesión). */
export const UMBRAL_FALLO_AL_CONECTAR_MS = 20_000

/** El motivo que acompaña a «No se pudo conectar». Sin `reason` el main no supo más: no se dice nada. */
const MOTIVOS: Record<TerminalExitReason, string> = {
  'ssh-autenticacion': 'el servidor no aceptó las credenciales',
  'ssh-inalcanzable': 'el servidor no responde: ¿falta la VPN?',
  'ssh-huella-cambiada': 'la huella del servidor cambió',
  'ssh-algoritmos': 'el servidor solo ofrece algoritmos antiguos'
}

/**
 * ¿Salió ssh por un fallo suyo? Si el main clasificó un motivo por lo que ssh escribió (también un
 * corte en Windows, que llega como -1), manda él. Si no, solo el 255.
 */
function esFalloDeSsh(exitCode: number | null, reason: TerminalExitReason | undefined): boolean {
  return reason !== undefined || exitCode === CODIGO_FALLO_SSH
}

/**
 * ¿Es la salida sin código de Windows? Allí -1 / 4294967295 sin motivo del main puede ser un corte
 * del que ssh no dejó texto, pero también un `exit` normal cuyo código perdió ConPTY: no se afirma
 * nada. En mac y otras ese -1 es un código más. La plataforma entra por parámetro: el renderer no
 * tiene `process`.
 */
function esSinCodigo(exitCode: number | null, plataforma: Plataforma): boolean {
  return plataforma === 'windows' && (exitCode === -1 || exitCode === CODIGO_FALLO_SSH_WINDOWS)
}

/**
 * Lo que pasó con la sesión:`duracionMs` es lo que vivió desde que se abrió (o se reconectó) y
 * `reason` lo trae el main solo con 255 (en Windows también -1) y si ssh dejó escrito por qué.
 */
export function motivoFinSsh(
  exitCode: number | null,
  duracionMs: number,
  reason?: TerminalExitReason,
  plataforma: Plataforma = 'otra'
): string {
  if (esFalloDeSsh(exitCode, reason)) {
    if (duracionMs >= UMBRAL_FALLO_AL_CONECTAR_MS) return 'Se cortó la conexión'
    return reason === undefined ? 'No se pudo conectar' : `No se pudo conectar: ${MOTIVOS[reason]}`
  }
  if (exitCode === 0 || exitCode === null || esSinCodigo(exitCode, plataforma)) return 'La sesión terminó'
  return `La sesión terminó (código ${exitCode})`
}

/** El aviso que el xterm escribe al terminar la sesión: lo que pasó y qué pulsar para volver a conectar. */
export function bannerFinSsh(motivo: string): string {
  const puntoFinal = /[.?!]$/.test(motivo) ? '' : '.'
  return `${motivo}${puntoFinal} Usa «Reconectar» para volver a conectar.`
}
