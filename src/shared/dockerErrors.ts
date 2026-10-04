// =============================================================================
// Los textos con los que Tessera explica un fallo de Docker, en un solo sitio.
// No declara taxonomía propia: pone texto a cada rama de `AgentExitReason` con un
// `Record`, así que una causa nueva exige su texto al compilar.
// `normalizarErrorIpc` quita el «Error invoking remote method…» con que Electron envuelve
// lo que cruza un `invoke`; sin eso, comparar por prefijo no casaría nunca.
// La comparación va anclada (`startsWith`): con `includes`, un detalle que citara la frase
// de pasada pondría cara de «Docker apagado» a otra cosa.
// =============================================================================
import type { AgentExitReason } from './agent-terminal-ipc.ts'
import { plataformaActual, type Plataforma } from './plataforma.ts'

/** Prefijo EXACTO con el que el main marca "el daemon no responde". */
export const PREFIJO_DOCKER_NO_DISPONIBLE = 'Docker no disponible:'

/** Los pasos de Windows: Docker Desktop corre sobre WSL2, y lo primero es que WSL2 exista. */
const PASOS_WINDOWS: readonly string[] = [
  '  1. WSL2 activo:  wsl --status   /   wsl -l -v  (debe haber una distro en VERSION 2)',
  '  2. Docker Desktop abierto y con el motor en estado "Running".',
  '  3. Reintentar:   docker info'
]

/**
 * Los pasos de macOS. Sin WSL2 (no existe allí), y con el paso que en Mac SÍ falla:
 * Docker Desktop no toca el PATH del sistema, deja un enlace en `/usr/local/bin/docker`,
 * y una app lanzada desde el Finder no hereda el PATH del shell (ver
 * `main/util/pathDeLogin.ts`), así que "Docker funciona en mi Terminal" y "Tessera no
 * lo encuentra" pueden ser ciertos a la vez.
 */
const PASOS_MAC: readonly string[] = [
  '  1. Docker Desktop instalado y abierto, con el motor en "Running".',
  '  2. `docker` visible desde la app: Docker Desktop lo deja en `/usr/local/bin/docker`; en Terminal, `which docker`.',
  '  3. Reintentar:   docker info'
]

/** Linux/BSD: sin Docker Desktop garantizado ni WSL2; lo genérico que sigue siendo cierto. */
const PASOS_OTRA: readonly string[] = [
  '  1. El daemon de Docker en marcha (Docker Desktop abierto, o el servicio `docker` activo).',
  '  2. `docker` visible desde la app: en una terminal, `which docker`.',
  '  3. Reintentar:   docker info'
]

/**
 * Pasos a verificar cuando el daemon no responde. Viven aquí, y no incrustados en
 * `SandboxManager.checkDocker`, para que el detalle técnico que ve el usuario y el
 * texto que arma el main sean literalmente el mismo.
 *
 * POR PLATAFORMA, y no una lista única: la de Windows abría con «1. WSL2 activo:
 * wsl --status», que en un Mac no significa nada y hace dudar de todo lo que viene
 * detrás. Es una función con la plataforma como último parámetro (con la actual por
 * defecto) y no un `const`, para que el test fije las listas de las dos desde una.
 *
 * SÓLO DESDE EL MAIN, y no es un detalle de estilo. Este módulo lo importa también el
 * RENDERER (los dos paneles de terminal, por `clasificarErrorArranque`), y el valor por
 * defecto de aquí llama a `plataformaActual()`, que lee `process.platform`: con
 * `contextIsolation` + `sandbox` ahí no hay `process`. Importar el módulo es inofensivo
 * —`plataforma.ts` no toca `process` al cargarse, sólo dentro de sus funciones—, pero
 * LLAMAR a esto desde el renderer sin pasar la plataforma tumbaría el panel entero con
 * «process is not defined». Ya pasó por esta misma vía en `jarPath.ts` (ver el
 * comentario de su `normalizar`): el árbol de archivos se cayó completo en la app
 * empaquetada. Si algún día el renderer necesita estos pasos, que le llegue la
 * plataforma por `window.tessera.plataforma`.
 */
export function pasosDocker(plataforma: Plataforma = plataformaActual()): readonly string[] {
  if (plataforma === 'windows') return PASOS_WINDOWS
  if (plataforma === 'mac') return PASOS_MAC
  return PASOS_OTRA
}

/** Todas las causas, como VALOR, para que el test pueda recorrerlas. */
export const RAZONES_SALIDA: readonly AgentExitReason[] = [
  'ok',
  'container-down',
  'daemon-down',
  'unknown'
]

export interface TextoSalida {
  /** Titular corto, en lenguaje de persona. */
  titulo: string
  /** Qué hacer a continuación. */
  sugerencia: string
}

/**
 * Texto por causa. El tipo `Record<AgentExitReason, …>` es la red: añadir una quinta
 * causa a `AgentExitReason` rompe la compilación aquí hasta que se le escriba texto.
 */
export const TEXTOS_SALIDA: Record<AgentExitReason, TextoSalida> = {
  ok: {
    titulo: 'El agente terminó',
    sugerencia: 'La sesión salió con normalidad. Pulsa "Reabrir" para volver a lanzarlo en este panel.'
  },
  'container-down': {
    titulo: 'El contenedor del perfil se cayó',
    sugerencia:
      'Docker sigue vivo, así que Tessera puede recrearlo limpio y recuperar tus credenciales. Si no lo logra, pulsa "Reintentar".'
  },
  'daemon-down': {
    titulo: 'Docker no está disponible',
    sugerencia:
      'Tessera no puede arrancar Docker por ti. Abre Docker Desktop, espera a que el motor esté en "Running" y pulsa "Reintentar" aquí abajo.'
  },
  unknown: {
    titulo: 'No se pudo determinar la causa',
    sugerencia:
      'El diagnóstico de Docker falló, así que Tessera no sabe si fue una salida normal o una caída. Revisa Docker Desktop y pulsa "Reintentar".'
  }
}

/**
 * Quita el envoltorio que Electron le pone a lo que lanza el main al cruzar el IPC.
 * Sin esto, cualquier comparación contra el mensaje del main falla en silencio.
 */
export function normalizarErrorIpc(bruto: string): string {
  return bruto
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(Error:\s*)+/, '')
    .trim()
}

/** Deduce la causa a partir del mensaje de un arranque fallido. */
export function razonDeMensaje(bruto: string): AgentExitReason {
  return normalizarErrorIpc(bruto).startsWith(PREFIJO_DOCKER_NO_DISPONIBLE)
    ? 'daemon-down'
    : 'unknown'
}

/** Aviso listo para pintar: lo que consume AvisoCaja. */
export interface AvisoArranque {
  titulo: string
  sugerencia?: string
  detalle?: string
}

/**
 * Traduce el error de un arranque fallido a titular + qué hacer + detalle crudo.
 *
 * `tituloGenerico` es el del pane que llama ("No se pudo iniciar el agente" / "…la
 * terminal"): se usa cuando el fallo NO es de Docker, para no inventarle una causa
 * a algo que no entendemos. El detalle técnico nunca se descarta — sólo se pliega.
 */
export function clasificarErrorArranque(bruto: string, tituloGenerico: string): AvisoArranque {
  const limpio = normalizarErrorIpc(bruto)
  if (limpio.startsWith(PREFIJO_DOCKER_NO_DISPONIBLE)) {
    const detalle = limpio.slice(PREFIJO_DOCKER_NO_DISPONIBLE.length).trim()
    return {
      titulo: TEXTOS_SALIDA['daemon-down'].titulo,
      sugerencia: TEXTOS_SALIDA['daemon-down'].sugerencia,
      detalle: detalle || undefined
    }
  }
  return { titulo: tituloGenerico, detalle: limpio || undefined }
}
