// =============================================================================
// Cadencia de comprobación del feed, la parte PURA (sin electron ni timers): cuándo toca el
// próximo chequeo según el foco, la suspensión, un reintento en cola y si ya hay algo
// descargado (en ese orden de precedencia, para que los tres relojes no se pisen), y si
// recuperar el foco merece comprobar ya. `chequeo.ts` la cablea sobre un solo `setTimeout`.
// Los periodos entran por parámetro; la prueba `test-marcador-update.mts`.
// Decisiones: docs/decisiones/actualizacion/cadencia-y-reintentos.md
// =============================================================================

export const CADENCIA = {
  /** Deja que el arranque respire antes de la primera comprobación. */
  PRIMER_CHEQUEO_MS: 8_000,
  /** Con la ventana enfocada: estás delante, publicar y ver el aviso va seguido. */
  ENFOCADA_MS: 5 * 60_000,
  /** En segundo plano: la app puede pasarse el día abierta y sin mirar. */
  FONDO_MS: 30 * 60_000,
  /** Al recuperar el foco, sólo se comprueba si el último chequeo es más viejo que esto. */
  UMBRAL_REFOCO_MS: 2 * 60_000
} as const

/**
 * Periodos efectivos. Se inyectan para poder acortarlos en desarrollo (ver
 * `TESSERA_CADENCIA_*` en AutoUpdate) sin meter `process.env` en un módulo puro, y
 * para que los tests no dependan de las constantes de producción.
 */
export interface Periodos {
  primerChequeoMs: number
  enfocadaMs: number
  fondoMs: number
  umbralRefocoMs: number
}

export const PERIODOS_POR_DEFECTO: Periodos = {
  primerChequeoMs: CADENCIA.PRIMER_CHEQUEO_MS,
  enfocadaMs: CADENCIA.ENFOCADA_MS,
  fondoMs: CADENCIA.FONDO_MS,
  umbralRefocoMs: CADENCIA.UMBRAL_REFOCO_MS
}

/** El mayor plazo que admite `setTimeout`: por encima, Node lo cambia por 1 ms y dispara YA. */
const MAX_TEMPORIZADOR_MS = 2_147_483_647

/**
 * Periodos desde los knobs de DIAGNÓSTICO del entorno, con el suelo de 5 s (que no se
 * conviertan en un martillo) y el techo de `setTimeout`. `TESSERA_CADENCIA_*` acorta el patrón
 * para verlo en dos minutos; `TESSERA_PRIMER_CHEQUEO_MS` lo usan las pruebas de interfaz para
 * ALARGAR el primero más allá de lo que dura una prueba: a los 8 s de fábrica, el botón de la
 * barra de título cambiaba de icono a mitad de un spec (en el paquete de `pack:dir` no hay
 * `app-update.yml`, así que el chequeo falla) y la captura dependía de cuánto tardara la máquina.
 * Pura: el entorno entra por parámetro.
 */
export function periodosDeEntorno(env: Record<string, string | undefined>): Periodos {
  const num = (v: string | undefined, def: number): number => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 5_000 ? Math.min(n, MAX_TEMPORIZADOR_MS) : def
  }
  return {
    primerChequeoMs: num(env.TESSERA_PRIMER_CHEQUEO_MS, PERIODOS_POR_DEFECTO.primerChequeoMs),
    enfocadaMs: num(env.TESSERA_CADENCIA_ENFOCADA_MS, PERIODOS_POR_DEFECTO.enfocadaMs),
    fondoMs: num(env.TESSERA_CADENCIA_FONDO_MS, PERIODOS_POR_DEFECTO.fondoMs),
    umbralRefocoMs: PERIODOS_POR_DEFECTO.umbralRefocoMs
  }
}

export interface EntradaCadencia {
  ahoraMs: number
  /** Epoch del último chequeo CONCLUIDO, o null si aún no hubo ninguno. */
  ultimoChequeoMs: number | null
  enfocada: boolean
  suspendido: boolean
  /** Hay un reintento de red ya programado (el backoff manda). */
  reintentoPendiente: boolean
  /**
   * El ciclo ya está ocupado: `downloading`, `ready` o `installing`. Preguntar al
   * feed en cualquiera de los tres no aporta nada, y en `downloading` además puede
   * reiniciar la descarga en curso (con 4 h de periodo eso no pasaba nunca; con 5
   * minutos pasaría en cualquier descarga lenta).
   */
  estadoTerminal: boolean
  periodos?: Periodos
}

export type DecisionCadencia =
  | { accion: 'ninguna'; motivo: string }
  | { accion: 'chequear'; motivo: string }
  | { accion: 'programar'; enMs: number; motivo: string }

/** Los tres bloqueos que comparten `decidirProximoChequeo` y el re-foco. */
function bloqueo(e: {
  suspendido: boolean
  reintentoPendiente: boolean
  estadoTerminal: boolean
}): string | null {
  if (e.estadoTerminal) return 'ya hay una actualización descargada'
  if (e.suspendido) return 'el sistema está suspendido'
  if (e.reintentoPendiente) return 'hay un reintento de red en cola'
  return null
}

export function decidirProximoChequeo(e: EntradaCadencia): DecisionCadencia {
  const p = e.periodos ?? PERIODOS_POR_DEFECTO
  const motivo = bloqueo(e)
  if (motivo !== null) return { accion: 'ninguna', motivo }

  if (e.ultimoChequeoMs === null) {
    return { accion: 'programar', enMs: p.primerChequeoMs, motivo: 'primer chequeo' }
  }

  const periodo = e.enfocada ? p.enfocadaMs : p.fondoMs
  const transcurrido = e.ahoraMs - e.ultimoChequeoMs
  const donde = e.enfocada ? 'enfocada' : 'en segundo plano'

  // Un reloj que salta hacia atrás daría `transcurrido` negativo. Se trata como
  // "acaba de pasar": esperar el periodo entero es preferible a chequear en bucle.
  if (transcurrido >= periodo) {
    return { accion: 'chequear', motivo: `vencido el periodo ${donde}` }
  }
  return {
    accion: 'programar',
    enMs: Math.max(0, periodo - Math.max(0, transcurrido)),
    motivo: `resto del periodo ${donde}`
  }
}

/**
 * ¿Comprobar ahora mismo porque el usuario acaba de volver a la app?
 *
 * Sin `enfocada` en la entrada a propósito: se llama justo cuando el foco se acaba
 * de recuperar, así que el valor es siempre `true` y pedirlo sólo invitaría a
 * pasarlo mal.
 */
export function debeChequearAlRecuperarFoco(e: Omit<EntradaCadencia, 'enfocada'>): boolean {
  const p = e.periodos ?? PERIODOS_POR_DEFECTO
  if (bloqueo(e) !== null) return false
  // SIN chequeo previo se dice que NO, y es deliberado: el primer foco de la app
  // llega a los pocos milisegundos de crear la ventana, antes que el retraso de
  // cortesía del arranque. Devolver `true` aquí lo saltaba SIEMPRE —dejando
  // `PRIMER_CHEQUEO_MS` como código muerto— y metía una petición de red en el peor
  // momento posible: en mitad del arranque, compitiendo con el barrido de Docker y
  // el primer pintado. El chequeo ya está programado; que lo haga su temporizador.
  if (e.ultimoChequeoMs === null) return false
  return e.ahoraMs - e.ultimoChequeoMs > p.umbralRefocoMs
}
