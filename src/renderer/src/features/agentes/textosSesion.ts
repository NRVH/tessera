// =============================================================================
// Textos que la sesión del agente escribe en su terminal (banners de reinicio, recuperación del
// contenedor, fin de la sesión) y avisos de fondo del sandbox y del agente de la terminal. Puro y
// sin JSX; los colores ANSI los pone quien escribe.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txSesion = crearTextos(
  {
    bannerReiniciado: '── agente reiniciado ──',
    bannerReanudado: '── agente reanudado ──',
    contenedorCaido: (intento: number, max: number) =>
      `⚠ el contenedor Docker se cayó — reiniciando limpio (intento ${intento}/${max})…`,
    contenedorReiniciado: '✓ contenedor reiniciado — sesión reanudada (sin re-login)',
    intentoFallo: (intento: number, error: string) => `intento ${intento} falló: ${error}`,
    noRecuperado: (max: number) => `✕ no se pudo recuperar tras ${max} intentos.`,
    revisaDocker: 'Revisa Docker Desktop (que el motor esté "Running") y pulsa "Reintentar" para levantarlo a mano.',
    falloReinicio: (error: string) => `falló el reinicio: ${error}`,
    daemonCaido: (titulo: string) => `⚠ ${titulo} (el daemon no responde).`,
    desconocidaAviso: 'La sesión del agente terminó de forma inesperada',
    desconocidaDetalle:
      'No se pudo determinar la causa (el diagnóstico de Docker no respondió). Usa Reiniciar para relanzarla.',
    desconocidaTerminal: '⚠ El agente terminó y no se pudo determinar por qué (falló el diagnóstico).',
    usaReiniciar: 'Usa Reiniciar para volver a lanzarlo.',
    terminoConCodigo: (code: number | null | undefined) => `el agente terminó (exitCode=${code}). `,
    sandboxPreparando: 'Preparando la imagen del sandbox…',
    sandboxListo: 'Sandbox listo',
    sandboxPaquetes: 'Paquetes extra del sandbox',
    noSePudoPrepararAgenteTerminal: 'No se pudo preparar el agente de la terminal',
    basesDeDatos: 'Bases de datos',
    terminal: 'Terminal'
  },
  {
    bannerReiniciado: '── agent restarted ──',
    bannerReanudado: '── agent resumed ──',
    contenedorCaido: (intento: number, max: number) =>
      `⚠ the Docker container went down — restarting clean (attempt ${intento}/${max})…`,
    contenedorReiniciado: '✓ container restarted — session resumed (no re-login)',
    intentoFallo: (intento: number, error: string) => `attempt ${intento} failed: ${error}`,
    noRecuperado: (max: number) => `✕ could not recover after ${max} attempts.`,
    revisaDocker: 'Check Docker Desktop (the engine must be "Running") and click "Retry" to bring it up by hand.',
    falloReinicio: (error: string) => `the restart failed: ${error}`,
    daemonCaido: (titulo: string) => `⚠ ${titulo} (the daemon is not responding).`,
    desconocidaAviso: 'The agent session ended unexpectedly',
    desconocidaDetalle:
      'The cause could not be determined (the Docker diagnosis did not respond). Use Restart to launch it again.',
    desconocidaTerminal: '⚠ The agent ended and the reason could not be determined (the diagnosis failed).',
    usaReiniciar: 'Use Restart to launch it again.',
    terminoConCodigo: (code: number | null | undefined) => `the agent ended (exitCode=${code}). `,
    sandboxPreparando: 'Preparing the sandbox image…',
    sandboxListo: 'Sandbox ready',
    sandboxPaquetes: 'Extra sandbox packages',
    noSePudoPrepararAgenteTerminal: 'Could not prepare the terminal agent',
    basesDeDatos: 'Databases',
    terminal: 'Terminal'
  }
)
