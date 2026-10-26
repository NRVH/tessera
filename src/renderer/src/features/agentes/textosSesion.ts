// =============================================================================
// Textos que la sesión del agente escribe en su terminal (banners de reinicio, recuperación del
// contenedor, fin de la sesión) y avisos de fondo del sandbox y del agente de la terminal. Puro y
// sin JSX; los colores ANSI los pone quien escribe.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'
import type { PrimeroEnPararse } from '../../../../shared/semaforoContenedores.ts'

function reglaEs(primero: PrimeroEnPararse, varios: boolean): string {
  if (primero === 'ultimos') return varios ? 'los últimos que abriste' : 'el último que abriste'
  if (primero === 'primeros') return varios ? 'los primeros que abriste' : 'el primero que abriste'
  return varios ? 'los que llevaban más sin uso' : 'el que llevaba más sin uso'
}

function reglaEn(primero: PrimeroEnPararse, varios: boolean): string {
  if (primero === 'ultimos') return varios ? 'the most recent ones you opened' : 'the most recent one you opened'
  if (primero === 'primeros') return varios ? 'the first ones you opened' : 'the first one you opened'
  return varios ? 'the ones idle the longest' : 'the one idle the longest'
}

export const txSesion = crearTextos(
  {
    bannerReiniciado: '── agente reiniciado ──',
    bannerReanudado: '── agente reanudado ──',
    contenedorCaido: (intento: number, max: number) =>
      `⚠ el contenedor Docker se cayó — reiniciando limpio (intento ${intento}/${max})…`,
    contenedorReiniciado: '✓ contenedor reiniciado — sesión reanudada (sin re-login)',
    intentoFallo: (intento: number, error: string) => `intento ${intento} falló: ${error}`,
    noRecuperado: (max: number) => `✕ no se pudo recuperar tras ${max} intentos.`,
    revisaDocker:
      'Si Docker se cayó, se reintenta solo cuando vuelva a responder; si Docker está en marcha, revisa el error y pulsa "Reintentar".',
    falloReinicio: (error: string) => `falló el reinicio: ${error}`,
    daemonCaido: (titulo: string) => `⚠ ${titulo} (el daemon no responde).`,
    desconocidaAviso: 'La sesión del agente terminó de forma inesperada',
    desconocidaDetalle:
      'No se pudo determinar la causa (el diagnóstico de Docker no respondió). Usa Reabrir para relanzarla.',
    desconocidaTerminal: '⚠ El agente terminó y no se pudo determinar por qué (falló el diagnóstico).',
    usaReabrir: 'Usa Reabrir para volver a lanzarlo.',
    pocaMemoriaTitulo: 'Queda poca memoria en el equipo',
    pocaMemoriaDetalle:
      'Tessera hibernará antes los agentes que no estés usando. Al volver a un proyecto, su agente retoma la conversación.',
    pocaMemoriaAccion: 'Hibernar inactivos ahora',
    limiteTitulo: (limite: number) => `Límite de ${limite} ${limite === 1 ? 'contenedor' : 'contenedores'}`,
    limiteSinAgentes: 'Paré un contenedor que ya no tenía agentes para abrir el nuevo.',
    limiteDetalle: (lista: string, primero: PrimeroEnPararse, varios: boolean) =>
      `Hiberné ${lista} (${reglaEs(primero, varios)}) para abrir el nuevo. ${varios ? 'Sus conversaciones siguen' : 'Su conversación sigue'} al volver.`,
    limiteYMas: (n: number) => `y ${n} más`,
    saturacionTitulo: (pct: number) => `Docker al ${pct} % de su memoria`,
    saturacionAviso: (lista: string | null, segundos: number) =>
      lista === null
        ? `Si sigue así, en ${segundos} s pararé un contenedor que ya no tiene agentes.`
        : `Si sigue así, en ${segundos} s hibernaré ${lista}. Su conversación se retoma al volver, pero lo que esté haciendo se interrumpe.`,
    saturacionOtro: 'Parar otro',
    saturacionSinOtro: 'No hay otro que se pueda parar: se parará el anunciado.',
    saturacionCanceladoTitulo: 'Docker se recuperó',
    saturacionCancelado: (pct: number) => `Bajó al ${pct} % de su memoria: no se para nada.`,
    saturacionSinCandidatos:
      'No hay ningún agente que se pueda parar con tus ajustes: los que estás mirando y los manuales no se paran. Cierra lo que no uses.',
    saturacionParada: (lista: string, primero: PrimeroEnPararse, varios: boolean) =>
      `Hiberné ${lista} (${reglaEs(primero, varios)}). ${varios ? 'Sus conversaciones siguen' : 'Su conversación sigue'} al volver.`,
    saturacionSinAgentes: 'Paré un contenedor que ya no tenía agentes.',
    saturacionRojo: 'Tu límite de contenedores está en rojo: Docker no da para tantos a la vez.',
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
    revisaDocker:
      'If Docker went down, it retries on its own when it responds again; if Docker is running, check the error and click "Retry".',
    falloReinicio: (error: string) => `the restart failed: ${error}`,
    daemonCaido: (titulo: string) => `⚠ ${titulo} (the daemon is not responding).`,
    desconocidaAviso: 'The agent session ended unexpectedly',
    desconocidaDetalle:
      'The cause could not be determined (the Docker diagnosis did not respond). Use Reopen to launch it again.',
    desconocidaTerminal: '⚠ The agent ended and the reason could not be determined (the diagnosis failed).',
    usaReabrir: 'Use Reopen to launch it again.',
    pocaMemoriaTitulo: 'The computer is low on memory',
    pocaMemoriaDetalle:
      'Tessera will hibernate the agents you are not using sooner. When you return to a project, its agent picks up the conversation.',
    pocaMemoriaAccion: 'Hibernate idle agents now',
    limiteTitulo: (limite: number) => `Limit of ${limite} ${limite === 1 ? 'container' : 'containers'}`,
    limiteSinAgentes: 'I stopped a container that no longer had agents to open the new one.',
    limiteDetalle: (lista: string, primero: PrimeroEnPararse, varios: boolean) =>
      `I hibernated ${lista} (${reglaEn(primero, varios)}) to open the new one. ${varios ? 'Their conversations resume' : 'Its conversation resumes'} when you return.`,
    limiteYMas: (n: number) => `and ${n} more`,
    saturacionTitulo: (pct: number) => `Docker at ${pct} % of its memory`,
    saturacionAviso: (lista: string | null, segundos: number) =>
      lista === null
        ? `If it stays like this, in ${segundos} s I will stop a container that no longer has agents.`
        : `If it stays like this, in ${segundos} s I will hibernate ${lista}. Its conversation resumes when you return, but whatever it is doing is interrupted.`,
    saturacionOtro: 'Stop another one',
    saturacionSinOtro: 'There is no other one that can be stopped: the announced one will be stopped.',
    saturacionCanceladoTitulo: 'Docker recovered',
    saturacionCancelado: (pct: number) => `It dropped to ${pct} % of its memory: nothing is stopped.`,
    saturacionSinCandidatos:
      'No agent can be stopped with your settings: the ones you are looking at and manual ones are never stopped. Close what you are not using.',
    saturacionParada: (lista: string, primero: PrimeroEnPararse, varios: boolean) =>
      `I hibernated ${lista} (${reglaEn(primero, varios)}). ${varios ? 'Their conversations resume' : 'Its conversation resumes'} when you return.`,
    saturacionSinAgentes: 'I stopped a container that no longer had agents.',
    saturacionRojo: 'Your container limit is in the red: Docker cannot handle that many at once.',
    terminoConCodigo: (code: number | null | undefined) => `the agent ended (exitCode=${code}). `,
    sandboxPreparando: 'Preparing the sandbox image…',
    sandboxListo: 'Sandbox ready',
    sandboxPaquetes: 'Extra sandbox packages',
    noSePudoPrepararAgenteTerminal: 'Could not prepare the terminal agent',
    basesDeDatos: 'Databases',
    terminal: 'Terminal'
  }
)
