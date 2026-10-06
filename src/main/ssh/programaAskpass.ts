// =============================================================================
// Dónde está el programa de contraseñas de Tessera y con qué entorno se lanza ssh para que lo use. Windows:
// `out/askpass/tessera-askpass.exe`, compilado al construir; macOS y demás: un lanzador `sh` que Tessera
// escribe en cada arranque en `userData/ssh/askpass/askpass` y que arranca Tessera como Node con
// `src/askpass/askpass.cjs`. Puro, con la plataforma como parámetro: las rutas llegan hechas.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import path from 'node:path'
import { citarSh } from '../../shared/citarShell.ts'
import type { Plataforma } from '../../shared/plataforma.ts'

/** La ficha del ssh lanzado: solo en su entorno, nunca en el del agente ni en el de una terminal. */
export const VAR_TOKEN_SSH = 'TESSERA_SSH_TOKEN'

/** El punto de escucha del puente (el mismo nombre que `ENV_PIPE` de `db-ipc`). */
export const VAR_PIPE_PUENTE = 'TESSERA_DB_PIPE'

/**
 * Lo que el ssh lanzado no hereda NUNCA: un shell de Git exporta su propio programa de contraseñas, y
 * un puente o una ficha heredados serían de otra instancia de Tessera. Los propios van en `extraEnv`.
 */
export const QUITAR_ENV_SSH: readonly string[] = ['SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE', VAR_PIPE_PUENTE, VAR_TOKEN_SSH]

/** Dónde viven la app (`app.getAppPath()`) y los datos del usuario. */
export interface RaicesAskpass {
  appDir: string
  userData: string
}

/** El programa que ssh lanza como `SSH_ASKPASS` en esa plataforma. */
export function rutaProgramaAskpass(plataforma: Plataforma, raices: RaicesAskpass): string {
  if (plataforma === 'windows') return path.win32.join(raices.appDir, 'out', 'askpass', 'tessera-askpass.exe')
  return path.posix.join(raices.userData, 'ssh', 'askpass', 'askpass')
}

/** El guion de Node del askpass (macOS y demás); viaja en el paquete como `src/tdb`. */
export function rutaGuionAskpass(plataforma: Plataforma, appDir: string): string {
  return (plataforma === 'windows' ? path.win32 : path.posix).join(appDir, 'src', 'askpass', 'askpass.cjs')
}

/**
 * El lanzador `sh` del askpass, con LF. El entorno manda sobre el ejecutable horneado (lo pone Tessera al
 * lanzar ssh); `export` aparte porque una asignación delante de `exec` no se exporta en todos los `sh`.
 */
export function lanzadorAskpassSh(exe: string, guion: string): string {
  return [
    '#!/bin/sh',
    '# Programa de contraseñas de Tessera para ssh (SSH_ASKPASS). Se reescribe en cada arranque: no lo edites.',
    `[ -n "$TESSERA_EXE" ] || TESSERA_EXE=${citarSh(exe)}`,
    'ELECTRON_RUN_AS_NODE=1',
    'export ELECTRON_RUN_AS_NODE',
    `exec "$TESSERA_EXE" ${citarSh(guion)} "$@"`,
    ''
  ].join('\n')
}

/** Lo que necesita el entorno del ssh que usará el programa de contraseñas. */
export interface DatosEntornoAskpass {
  programa: string
  pipe: string
  token: string
  plataforma: Plataforma
  /** El ejecutable de Tessera (`process.execPath`): el lanzador `sh` lo arranca como Node. */
  exe: string
}

/**
 * Las variables del ssh que usará el programa de contraseñas: con `force`, ssh nunca pregunta por la
 * terminal. En Windows va el NOMBRE del programa y su carpeta en el `PATH` (que se antepone, nunca se
 * sustituye): el ssh del sistema lee `SSH_ASKPASS` en la página de códigos ANSI y no lanza una ruta con
 * «ñ» o tildes, y buscando por el `PATH` sí (medido con el 9.5). Una carpeta con «;» no cabe en el PATH.
 */
export function entornoAskpass(d: DatosEntornoAskpass): Record<string, string> {
  const env: Record<string, string> = {
    SSH_ASKPASS: d.programa,
    SSH_ASKPASS_REQUIRE: 'force',
    [VAR_PIPE_PUENTE]: d.pipe,
    [VAR_TOKEN_SSH]: d.token
  }
  if (d.plataforma === 'windows' && !path.win32.dirname(d.programa).includes(';')) {
    env.SSH_ASKPASS = path.win32.basename(d.programa)
    env.PATH = path.win32.dirname(d.programa)
  }
  if (d.plataforma !== 'windows') env.TESSERA_EXE = d.exe
  return env
}
