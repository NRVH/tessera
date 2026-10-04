// =============================================================================
// Ancla de conversación: qué chat mide el anillo de contexto. Se ancla al chat con el que
// Tessera abrió la sesión (`--resume <id>` o ninguno) y a los envíos del usuario, en vez de
// adivinarlo por el último evento del transcript. Módulo puro, sin E/S ni Electron.
// Lo usan `ContextReader` (elige el chat) y las terminales del agente (alimentan el registro).
// Decisiones: docs/decisiones/agentes/contexto-ancla-de-conversacion.md
// =============================================================================

/** De dónde salió el id anclado. Solo informativo: no cambia ninguna decisión. */
export type FuenteAncla = 'resume' | 'aprendida' | 'historial'

/**
 * Qué sabemos de la conversación viva de un (base, agente, proyecto):
 *   - 'anclada'   → sabemos su id (se abrió con `--resume`, o se aprendió por evidencia).
 *   - 'esperando' → la sesión arrancó SIN reanudar: la viva será la primera que reciba
 *                   un evento fechado a partir de `desde`. Hasta entonces no hay chat
 *                   que medir, y decirlo ('no-data') es mejor que medir el anterior.
 *   - 'dudosa'    → enviaste un comando de CAMBIO DE CONVERSACIÓN dentro del TUI
 *                   (`/resume`, `/clear`…): sabemos que te has movido, pero no adónde.
 *                   Mientras no llegue evidencia manda la heurística de siempre —que
 *                   en ese momento acierta, porque el chat al que saltaste es el que
 *                   tiene los eventos más recientes—. Sin este estado, anclarse al
 *                   chat viejo enseñaría 0 % mientras lees uno lleno: cambiar un
 *                   número equivocado por otro no es arreglar nada.
 */
export type EstadoAncla =
  | { tipo: 'anclada'; sessionId: string; desde: number; fuente: FuenteAncla }
  | { tipo: 'esperando'; desde: number }
  | { tipo: 'dudosa'; desde: number }

export interface Ancla {
  estado: EstadoAncla
  /** Epoch ms del último ENVÍO del usuario (Enter). 0 = ninguno desde el arranque. */
  marcaEnvio: number
  /**
   * Sesiones vivas que comparten esta clave. Hace falta porque la clave NO lleva el
   * perfil —no puede: el lector solo conoce (agente, carpeta, proyecto)— y en modo
   * Windows TODOS los perfiles comparten la misma carpeta (`~/.claude`). Dos perfiles
   * con un proyecto que se llame igual caen en la misma clave, y sin contar referencias
   * el cierre de uno soltaba el ancla que el otro seguía usando: su anillo se volvía
   * heurístico en silencio. Lo mismo con dos rutas distintas de igual basename.
   */
  refs: number
}

/** Lo mínimo que `elegirVivo` necesita de cada transcript candidato. */
export interface CandidatoMedido {
  /**
   * Id que DECLARA el transcript por dentro. Puede faltar, y puede no coincidir con el
   * nombre del fichero (Claude Code arrastra el `sessionId` de la línea que se copió),
   * por eso no es la única forma de reconocer al anclado.
   */
  sessionId?: string
  /**
   * Nombre del fichero. Es la otra forma de reconocerlo: Claude Code nombra el
   * transcript `<sessionId>.jsonl` y Codex `rollout-<fecha>-<uuid>.jsonl`, y ese uuid
   * SOBREVIVE a los `codex resume` porque se sigue anexando al mismo fichero.
   */
  nombre?: string
  /** Epoch ms del último evento FECHADO del transcript; 0 si no tiene ninguno. */
  lastEventAt: number
  /** mtime del fichero: red de seguridad cuando no hay ni un evento fechado. */
  mtimeMs: number
}

/**
 * Resultado: qué candidato medir y por qué.
 *   - `indice >= 0` → mide ése.
 *   - `indice < 0`  → no hay nada que medir (el llamador decide entre 'no-data' y
 *     'no-session' según haya visto o no transcripts del proyecto).
 *   - `aprender`    → el id que el registro debe fijar como ancla (se descubrió por
 *     evidencia: ese transcript recibió un evento tras tu envío).
 */
export interface Eleccion {
  indice: number
  anclaje: 'sesion' | 'heuristica' | 'esperando'
  aprender?: string
}

/**
 * Tolerancia por defecto al comparar la hora de un evento del transcript con la de tu
 * envío. Existe porque son DOS RELOJES: el evento lo fecha el proceso del agente
 * —dentro del contenedor— y el envío lo fecha el main, en Windows. Un desfase de un
 * par de segundos, o un `timestamp` puesto al EMPEZAR a escribir el evento, no puede
 * invalidar la evidencia. 5 s es holgado frente al desfase real (< 1 s con el reloj de
 * Docker Desktop) y estrecho frente al ritmo humano de escribir dos prompts seguidos.
 */
export const TOLERANCIA_EVENTO_MS = 5_000

/**
 * ¿Este candidato ES la conversación anclada? Vale su id declarado o su nombre de
 * fichero: los dos identifican la misma conversación y ninguno está siempre.
 */
function esElAnclado(c: CandidatoMedido, id: string): boolean {
  if (!id) return false
  if (c.sessionId === id) return true
  return typeof c.nombre === 'string' && c.nombre.includes(id)
}

/** Índice del candidato con mayor "vivacidad" (último evento, o mtime si no lo hay). */
function masVivo(cands: readonly CandidatoMedido[], filtro?: (c: CandidatoMedido, i: number) => boolean): number {
  let mejor = -1
  let mejorVal = -1
  for (let i = 0; i < cands.length; i++) {
    if (filtro && !filtro(cands[i], i)) continue
    const val = cands[i].lastEventAt || cands[i].mtimeMs
    if (val > mejorVal) {
      mejorVal = val
      mejor = i
    }
  }
  return mejor
}

/**
 * Elige qué transcript es la conversación viva. Ver el bloque de arriba para el
 * porqué; el orden de las reglas ES la especificación:
 *
 *   1. SIN ANCLA (no hay sesión abierta, o es de otro perfil) → como siempre: el del
 *      último evento. El anillo tiene que seguir funcionando con el contenedor parado.
 *   2. ANCLADA:
 *      a. Hay envío reciente y OTRO candidato recibió un evento después de él mientras
 *         el anclado no → te cambiaste de chat dentro del TUI: gana ese otro y se
 *         aprende su id.
 *      b. El anclado está entre los candidatos → GANA ÉL, aunque otro tenga un evento
 *         más reciente. Aquí es donde se arregla el bug.
 *      c. El anclado ya no existe (borrado, o el CLI abrió otro) → heurística: un
 *         ancla que no se puede comprobar miente más que callarse.
 *   3. ESPERANDO → el primero que recibió un evento desde que arrancó la sesión. Si
 *      ninguno, no hay nada que medir: NO se retrocede al chat anterior (misma
 *      doctrina que la nota 2 de ContextReader).
 *   4. DUDOSA → igual que 3, pero si nadie ha recibido nada todavía se cae a la
 *      HEURÍSTICA en vez de a 'no-data': aquí no acabas de estrenar conversación,
 *      sino que has saltado a una que ya existe y que sí tiene algo que enseñar.
 */
export function elegirVivo(
  cands: readonly CandidatoMedido[],
  ancla: Ancla | null,
  tolerancia: number = TOLERANCIA_EVENTO_MS
): Eleccion {
  if (cands.length === 0) return { indice: -1, anclaje: ancla ? 'esperando' : 'heuristica' }

  if (!ancla) return { indice: masVivo(cands), anclaje: 'heuristica' }

  if (ancla.estado.tipo === 'esperando' || ancla.estado.tipo === 'dudosa') {
    // Con un envío posterior al arranque manda ÉSE: es evidencia más reciente que la
    // del arranque y es la que resuelve el `/clear` o el `/resume` que acabas de teclear.
    const desde = Math.max(ancla.estado.desde, ancla.marcaEnvio)
    const umbral = desde - tolerancia
    const idx = masVivo(cands, (c) => c.lastEventAt >= umbral)
    if (idx >= 0) return { indice: idx, anclaje: 'sesion', aprender: cands[idx].sessionId }
    return ancla.estado.tipo === 'dudosa'
      ? { indice: masVivo(cands), anclaje: 'heuristica' }
      : { indice: -1, anclaje: 'esperando' }
  }

  const idAnclado = ancla.estado.sessionId
  const idxAnclado = cands.findIndex((c) => esElAnclado(c, idAnclado))

  // (a) Evidencia de que te cambiaste de chat: alguien recibió un evento tras tu envío
  // y el anclado no. Vale también si el anclado ni siquiera está entre los candidatos.
  if (ancla.marcaEnvio > 0) {
    const umbral = ancla.marcaEnvio - tolerancia
    const ancladoRecibio = idxAnclado >= 0 && cands[idxAnclado].lastEventAt >= umbral
    if (!ancladoRecibio) {
      const idx = masVivo(cands, (c, i) => i !== idxAnclado && c.lastEventAt >= umbral)
      if (idx >= 0) return { indice: idx, anclaje: 'sesion', aprender: cands[idx].sessionId }
    }
  }

  // (b) El ancla manda sobre la hora del último evento.
  if (idxAnclado >= 0) return { indice: idxAnclado, anclaje: 'sesion' }

  // (c) Ancla incomprobable: se vuelve a la heurística de siempre.
  return { indice: masVivo(cands), anclaje: 'heuristica' }
}

/**
 * Clave de un ancla. Es DELIBERADAMENTE la misma tripleta con la que ContextReader
 * cachea sus respuestas —(agente, carpeta de credenciales, proyecto)— y no el id del
 * pty: el anillo se pinta también con la sesión cerrada, así que el ancla no puede
 * morir con ella. El separador es el byte nulo, que no puede aparecer en una ruta.
 */
export function claveAncla(agente: string, base: string, proyecto: string): string {
  return `${agente}\u0000${base}\u0000${proyecto}`
}

/** Registro mutable de anclas por clave, con aviso de cambio. */
export interface RegistroAnclas {
  /** Una sesión más pasa a usar esta clave. Crea el ancla si no existía. */
  retain(clave: string): void
  /** La sesión arrancó reanudando `sessionId`: ése es el chat vivo, sin dudas. */
  pin(clave: string, sessionId: string, fuente?: FuenteAncla): void
  /** La sesión arrancó SIN reanudar: el chat vivo es el que reciba el primer evento. */
  arm(clave: string): void
  /** Enviaste `/resume`, `/clear`… dentro del TUI: te moviste, pero no sabemos adónde. */
  dudar(clave: string): void
  /** El usuario acaba de enviar un prompt (Enter): fija la marca para la regla (a). */
  touch(clave: string): void
  /** Se descubrió por evidencia cuál es el chat vivo. No-op si ya era ése. */
  aprender(clave: string, sessionId: string): void
  /**
   * Una sesión suelta esta clave. El ancla solo muere con la ÚLTIMA (ver `Ancla.refs`);
   * mientras quede alguna viva se conserva, y entonces vuelve la heurística.
   */
  release(clave: string): void
  get(clave: string): Ancla | null
  /** Avisa cuando alguna ancla CAMBIA (para caducar la caché de respuestas). */
  onCambio(fn: () => void): () => void
}

/**
 * Crea un registro. `now` se inyecta para poder probarlo con un reloj falso, igual
 * que hace el rastreador de actividad con su scheduler.
 */
export function crearRegistroAnclas(now: () => number = () => Date.now()): RegistroAnclas {
  const oyentes = new Set<() => void>()
  const ctx: ContextoRegistro = {
    anclas: new Map<string, Ancla>(),
    now,
    avisar: () => {
      for (const fn of oyentes) fn()
    }
  }
  return {
    ...operacionesDeApertura(ctx),
    ...operacionesDeEvidencia(ctx),
    onCambio(fn) {
      oyentes.add(fn)
      return () => oyentes.delete(fn)
    }
  }
}

/** Lo que comparten las operaciones del registro: el mapa de anclas, el reloj y el aviso. */
interface ContextoRegistro {
  anclas: Map<string, Ancla>
  now: () => number
  avisar: () => void
}

/** Operaciones que fijan el ancla al abrir una sesión o al saltar de chat dentro del TUI. */
function operacionesDeApertura({
  anclas,
  now,
  avisar
}: ContextoRegistro): Pick<RegistroAnclas, 'retain' | 'pin' | 'arm' | 'dudar'> {
  return {
    retain(clave) {
      const prev = anclas.get(clave)
      if (prev) {
        prev.refs++
        return // el estado lo fija el `pin`/`arm` que viene detrás
      }
      anclas.set(clave, { estado: { tipo: 'esperando', desde: now() }, marcaEnvio: 0, refs: 1 })
      avisar()
    },
    pin(clave, sessionId, fuente = 'resume') {
      const prev = anclas.get(clave)
      if (prev?.estado.tipo === 'anclada' && prev.estado.sessionId === sessionId) return
      anclas.set(clave, {
        estado: { tipo: 'anclada', sessionId, desde: now(), fuente },
        // La marca de envío no se hereda: es de la sesión anterior y dispararía la regla (a)
        // con evidencia vieja nada más abrir.
        marcaEnvio: 0,
        refs: prev?.refs ?? 1
      })
      avisar()
    },
    arm(clave) {
      const prev = anclas.get(clave)
      anclas.set(clave, {
        estado: { tipo: 'esperando', desde: now() },
        marcaEnvio: 0,
        refs: prev?.refs ?? 1
      })
      avisar()
    },
    dudar(clave) {
      const prev = anclas.get(clave)
      if (!prev) return // sin sesión ya manda la heurística: no hay nada que dudar
      if (prev.estado.tipo === 'dudosa') return
      anclas.set(clave, {
        estado: { tipo: 'dudosa', desde: now() },
        marcaEnvio: prev.marcaEnvio,
        refs: prev.refs
      })
      avisar()
    }
  }
}

/** Operaciones que reaccionan a la evidencia: envíos, aprendizaje, cierre y consulta. */
function operacionesDeEvidencia({
  anclas,
  now,
  avisar
}: ContextoRegistro): Pick<RegistroAnclas, 'touch' | 'aprender' | 'release' | 'get'> {
  return {
    touch(clave) {
      const prev = anclas.get(clave)
      if (!prev) return // sin sesión no hay nada que anclar
      anclas.set(clave, { estado: prev.estado, marcaEnvio: now(), refs: prev.refs })
      // No avisa: la marca de envío por sí sola no cambia qué se mide, y avisar tiraría la
      // caché en cada tecleo.
    },
    aprender(clave, sessionId) {
      const prev = anclas.get(clave)
      if (!prev) return
      if (prev.estado.tipo === 'anclada' && prev.estado.sessionId === sessionId) return
      anclas.set(clave, {
        estado: { tipo: 'anclada', sessionId, desde: now(), fuente: 'aprendida' },
        marcaEnvio: prev.marcaEnvio,
        refs: prev.refs
      })
      avisar()
    },
    release(clave) {
      const prev = anclas.get(clave)
      if (!prev) return
      prev.refs--
      if (prev.refs > 0) return // otra sesión viva sigue usando esta clave
      anclas.delete(clave)
      avisar()
    },
    get(clave) {
      return anclas.get(clave) ?? null
    }
  }
}
