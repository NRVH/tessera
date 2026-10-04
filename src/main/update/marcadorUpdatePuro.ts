// =============================================================================
// Marcador de actualización pendiente, la parte PURA (sin electron ni fs): la memoria del ciclo
// entre sesiones. Su forma, cómo se sanea uno roto, la comparación de la versión que corre con
// la destino (la única evidencia en los dos caminos: `--updated` solo llega con `--force-run`),
// qué se decide al arrancar (aplicada, fallida, lista) y al cerrar, y la cuenta de intentos.
// `instaladorPresente` entra por parámetro para no tocar disco. Lo prueba `test-marcador-update.mts`.
// Decisiones: docs/decisiones/actualizacion/marcador-y-prevuelos.md
// =============================================================================

import type { UpdateStatus } from '../../shared/update-ipc'

/** Versión del ESQUEMA del marcador (no la de la app). Bump al cambiar el shape. */
export const MARCADOR_VERSION = 1

/**
 * Cuántas veces se cede el control al instalador para una MISMA versión destino
 * antes de rendirse.
 *
 * Dos, y no tres. Un fallo de instalación de NSIS aquí no es estocástico: las dos
 * causas conocidas —un archivo bloqueado bajo la carpeta de instalación y una ruta
 * que al renombrarse pasa de MAX_PATH— son deterministas, y las dos tienen ya un
 * pre-vuelo dedicado que las convierte en error visible ANTES de ceder el control
 * (ver installDirLock.ts / installDirPaths.ts). El segundo intento sólo compra el
 * único caso genuinamente aleatorio: que apagaran el equipo a media instalación.
 * Un tercero serían dos ciclos completos de cierre más gastados en un update
 * muerto. Dos = "una mala suerte perdonada"; la tercera es un bug, no un reintento.
 */
export const MAX_INTENTOS_UPDATE = 2

/**
 * Motor con el que se aplica la actualización.
 *
 *   · `'nsis'`       — Windows: se cede el control al instalador de electron-updater.
 *   · `'relevo-mac'` — macOS: el guion `sh` desprendido de `update/relevoMac.ts`, que
 *                      desempaqueta el `.zip` y renombra el bundle.
 *   · `'swap'`       — reservado para el swap atómico que vendrá después.
 *
 * Hoy NADIE lo lee para decidir nada: el camino se elige por plataforma en el momento
 * de aplicar, no por lo que diga el marcador. Se escribe igualmente porque el marcador
 * es el registro de lo que se preparó, y un `motor: 'nsis'` en un Mac era literalmente
 * mentira persistida en disco.
 */
export type MotorUpdate = 'nsis' | 'swap' | 'relevo-mac'

/** El intento que se cedió al instalador y del que no volvimos. */
export interface IntentoUpdate {
  /** 1-based. Coincide con `marcador.intentos` en el momento de sellarlo. */
  n: number
  /** ISO 8601. */
  iniciadoEn: string
  /** Quién lo disparó: el botón del usuario o el cierre de la app. */
  origen: 'manual' | 'cierre'
  /** Si se pidió al instalador que relanzara la app al terminar. */
  relanzar: boolean
}

export interface MarcadorUpdate {
  /** Esquema (MARCADOR_VERSION), no la versión de la app. */
  version: number
  motor: MotorUpdate
  /** Versión que se va a instalar. */
  versionDestino: string
  /** Versión que corría cuando se preparó. */
  versionOrigen: string
  /** Ruta absoluta del instalador descargado y verificado. */
  rutaInstalador: string
  /** ISO 8601. */
  preparadoEn: string
  /** Intentos ya CONSUMIDOS con esta versión destino. */
  intentos: number
  /** Intento en curso (sellado antes de ceder el control), o null. */
  intento: IntentoUpdate | null
  /** Motivo por el que ya no se reintenta solo, o null. */
  bloqueado: string | null
}

// ---------------------------------------------------------------------------
// Versiones
// ---------------------------------------------------------------------------

/**
 * Parte una versión en sus tres números, o `null` si no es una versión.
 * Acepta la `v` inicial y corta en el primer `-` o `+` (prerelease/build, que se
 * ignoran a propósito: el canal publica solo `x.y.z`; ver el ADR del marcador).
 */
function partirVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null
  const limpia = v.trim().replace(/^v/i, '').split(/[-+]/)[0]
  if (limpia.length === 0) return null
  if (!/^\d+(\.\d+)*$/.test(limpia)) return null
  const partes = limpia.split('.').map((s) => Number.parseInt(s, 10))
  return [partes[0] ?? 0, partes[1] ?? 0, partes[2] ?? 0]
}

/** ¿Es una versión que sabemos comparar? */
export function esVersionParseable(v: unknown): boolean {
  return partirVersion(v) !== null
}

/**
 * Compara dos versiones. TOTAL y NUNCA LANZA: decide el camino de arranque, y una
 * excepción aquí es una app que no abre. Lo que no se puede parsear se trata como
 * `0.0.0`, que es el valor más bajo posible y por tanto el más inofensivo.
 */
export function compararVersiones(a: string, b: string): -1 | 0 | 1 {
  const x = partirVersion(a) ?? [0, 0, 0]
  const y = partirVersion(b) ?? [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    if (x[i] > y[i]) return 1
    if (x[i] < y[i]) return -1
  }
  return 0
}

// ---------------------------------------------------------------------------
// Construcción y transiciones del marcador
// ---------------------------------------------------------------------------

/**
 * El marcador recién preparado. `motor` es opcional y por defecto `'nsis'`: es el
 * camino de Windows, que es el que había cuando esto se escribió, y dejarlo como
 * defecto es lo que garantiza que ese camino no cambie de comportamiento al añadir
 * motores nuevos. Quien use otro lo dice (`atenderUpdateMac` pasa `'relevo-mac'`).
 */
export function nuevoMarcador(a: {
  versionDestino: string
  versionOrigen: string
  rutaInstalador: string
  ahora: Date
  motor?: MotorUpdate
}): MarcadorUpdate {
  return {
    version: MARCADOR_VERSION,
    motor: a.motor ?? 'nsis',
    versionDestino: a.versionDestino,
    versionOrigen: a.versionOrigen,
    rutaInstalador: a.rutaInstalador,
    preparadoEn: a.ahora.toISOString(),
    intentos: 0,
    intento: null,
    bloqueado: null
  }
}

/** Consume un intento y lo sella. El `n` sale del contador, no del llamador. */
export function marcadorConIntento(
  m: MarcadorUpdate,
  i: Omit<IntentoUpdate, 'n'>
): MarcadorUpdate {
  const n = m.intentos + 1
  return { ...m, intentos: n, intento: { n, ...i } }
}

/**
 * Cierra un intento fallido: se descubrió al arrancar que la versión vieja sigue
 * viva. El intento deja de estar "en curso" (ya sabemos cómo acabó) pero los
 * `intentos` consumidos se conservan: son la guarda anti-bucle.
 */
export function marcadorTrasFallo(m: MarcadorUpdate, agotado: boolean): MarcadorUpdate {
  return {
    ...m,
    intento: null,
    bloqueado: agotado ? (m.bloqueado ?? 'agotados los intentos') : m.bloqueado
  }
}

// ---------------------------------------------------------------------------
// Saneado defensivo
// ---------------------------------------------------------------------------

const MAX_INTENTOS_SANEADO = 99

function esTextoNoVacio(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function sanearIntento(crudo: unknown): IntentoUpdate | null {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return null
  const o = crudo as Record<string, unknown>
  if (!esTextoNoVacio(o.iniciadoEn)) return null
  if (o.origen !== 'manual' && o.origen !== 'cierre') return null
  const n = typeof o.n === 'number' && Number.isFinite(o.n) ? Math.max(1, Math.round(o.n)) : 1
  return { n, iniciadoEn: o.iniciadoEn, origen: o.origen, relanzar: o.relanzar === true }
}

/**
 * Convierte lo recién parseado del disco en un marcador utilizable, o `null` si no
 * hay nada aprovechable. Nunca lanza: un marcador roto tiene que degradarse a "no
 * hay marcador", jamás a un arranque que no ocurre.
 *
 * Un `version` que no sea el nuestro devuelve `null` a propósito: un build viejo no
 * puede adivinar los campos de un esquema futuro, y adivinarlos mal sería peor que
 * ignorarlo (el chequeo siguiente re-descarga y escribe uno bueno).
 */
export function sanearMarcador(crudo: unknown): MarcadorUpdate | null {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return null
  const o = crudo as Record<string, unknown>
  if (o.version !== MARCADOR_VERSION) return null
  if (!esTextoNoVacio(o.versionDestino)) return null
  if (!esTextoNoVacio(o.versionOrigen)) return null
  if (!esTextoNoVacio(o.rutaInstalador)) return null

  const intentos =
    typeof o.intentos === 'number' && Number.isFinite(o.intentos)
      ? Math.max(0, Math.min(MAX_INTENTOS_SANEADO, Math.round(o.intentos)))
      : 0

  return {
    version: MARCADOR_VERSION,
    // Lo desconocido cae en `'nsis'`, que es el valor con el que se escribían los
    // marcadores viejos (los de antes de que existiera `'relevo-mac'`) y por tanto el
    // único que no inventa nada sobre ellos.
    motor:
      o.motor === 'relevo-mac' ? 'relevo-mac' : o.motor === 'swap' ? 'swap' : 'nsis',
    versionDestino: o.versionDestino,
    versionOrigen: o.versionOrigen,
    rutaInstalador: o.rutaInstalador,
    preparadoEn: typeof o.preparadoEn === 'string' ? o.preparadoEn : '',
    intentos,
    intento: sanearIntento(o.intento),
    bloqueado: esTextoNoVacio(o.bloqueado) ? o.bloqueado : null
  }
}

/**
 * ¿El marcador describe algo que tiene sentido aplicar? Exige que las dos versiones
 * sean comparables y que el destino sea ESTRICTAMENTE mayor que el origen.
 *
 * Este guard es el que impide el falso "¡Actualizada!" del downgrade: un marcador
 * absurdo (destino 0.30.0, origen 0.31.0) corriendo 0.31.0 pasaría la comparación
 * `versionActual >= destino` y pintaríamos un desenlace de éxito sin que hubiera
 * pasado absolutamente nada. Por eso `decidirAlArrancar` lo evalúa ANTES.
 */
export function esMarcadorSensato(m: MarcadorUpdate): boolean {
  if (!esVersionParseable(m.versionDestino)) return false
  if (!esVersionParseable(m.versionOrigen)) return false
  if (m.rutaInstalador.trim().length === 0) return false
  return compararVersiones(m.versionDestino, m.versionOrigen) > 0
}

// ---------------------------------------------------------------------------
// La decisión del arranque
// ---------------------------------------------------------------------------

export interface EntradaArranque {
  marcador: MarcadorUpdate | null
  /** `app.getVersion()`. */
  versionActual: string
  /**
   * `esArranqueTrasActualizar()`. SÓLO informativo (para el registro): la decisión
   * NO depende de él, porque en el camino de aplicar-al-cerrar nunca es `true`
   * aunque la actualización sí se haya aplicado. Ver la cabecera.
   */
  vinoDeUnUpdate: boolean
  /** `existsSync(marcador.rutaInstalador)`, inyectado para mantener la pureza. */
  instaladorPresente: boolean
  maxIntentos: number
}

export type ResultadoArranque =
  | { clase: 'ninguno'; motivo: string }
  | { clase: 'exito'; desde: string; hasta: string }
  | { clase: 'fallo'; versionEsperada: string; intentos: number; agotado: boolean }
  | { clase: 'listo'; marcador: MarcadorUpdate }

/**
 * Qué pasó con la actualización que había preparada, mirado desde el arranque.
 *
 * EL ORDEN DE EVALUACIÓN ES EL DISEÑO. Tres cosas que no son obvias:
 *
 *  (1) El guard de sensatez va ANTES de comparar versiones, o un marcador de
 *      downgrade se leería como un éxito (ver `esMarcadorSensato`).
 *
 *  (2) La comparación de versiones no mira `vinoDeUnUpdate`. Es obligatorio: en
 *      aplicar-al-cerrar el instalador no relanza la app y esa bandera no llega
 *      nunca. La versión que corre es la única evidencia de los dos caminos.
 *
 *  (3) "El instalador ya no está" NO es un error si no habíamos intentado nada.
 *      Que Windows limpie el temporal, o que electron-updater vacíe su caché al
 *      preparar otra descarga, no rompe nada: se olvida el marcador y el próximo
 *      chequeo re-descarga. Sólo es fallo si YA habíamos prometido aplicarlo, y ese
 *      caso sale antes, por el `intento`.
 */
export function decidirAlArrancar(e: EntradaArranque): ResultadoArranque {
  const m = e.marcador
  if (m === null) return { clase: 'ninguno', motivo: 'sin marcador' }
  if (!esMarcadorSensato(m)) return { clase: 'ninguno', motivo: 'marcador incoherente' }

  // La versión que corre ya alcanzó (o pasó) al destino: se aplicó. `>` cubre el
  // caso de que el usuario instalara a mano algo aún más nuevo mientras había una
  // versión preparada; el marcador está obsoleto y retirarlo es el desenlace bueno.
  if (compararVersiones(e.versionActual, m.versionDestino) >= 0) {
    return { clase: 'exito', desde: m.versionOrigen, hasta: e.versionActual }
  }

  if (m.bloqueado !== null) {
    return {
      clase: 'fallo',
      versionEsperada: m.versionDestino,
      intentos: m.intentos,
      agotado: true
    }
  }

  // Cedimos el control y hemos vuelto a arrancar en la versión vieja: no llegó.
  if (m.intento !== null) {
    return {
      clase: 'fallo',
      versionEsperada: m.versionDestino,
      intentos: m.intentos,
      agotado: m.intentos >= e.maxIntentos
    }
  }

  if (!e.instaladorPresente) {
    return { clase: 'ninguno', motivo: 'el instalador ya no está en disco' }
  }

  return { clase: 'listo', marcador: m }
}

// ---------------------------------------------------------------------------
// La decisión del cierre
// ---------------------------------------------------------------------------

export type PlanDeCierre =
  | { tipo: 'ninguno'; motivo: string }
  | {
      tipo: 'instalar'
      /** Pedir al instalador que vuelva a abrir la app al terminar. */
      relanzar: boolean
      origen: 'manual' | 'cierre'
      marcador: MarcadorUpdate | null
    }

export interface EntradaPlanCierre {
  status: UpdateStatus
  empaquetada: boolean
  /** `WorkspaceSettings.aplicarUpdateAlCerrar`, leída en el momento del cierre. */
  preferenciaAlCerrar: boolean
  marcador: MarcadorUpdate | null
  maxIntentos: number
}

/**
 * Qué hay que hacer con la actualización cuando la app se está cerrando.
 *
 * Sustituye al viejo `isUpdateInstallPending(): boolean`, que no podía distinguir
 * las dos intenciones y por eso relanzaba SIEMPRE. Son distintas de verdad:
 *
 *   - el usuario pulsó "Actualizar ahora"  -> relanzar (te la abrimos de vuelta);
 *   - la app se está cerrando y hay una preparada -> NO relanzar (cerrar es cerrar;
 *     una app que se reabre sola cuando la cierras es un fallo, no una función).
 *
 * `status === 'installing'` es la señal inequívoca de la primera: sólo lo pone el
 * handler del canal INSTALL, o sea, un humano pulsando el botón.
 *
 * En el camino automático se EXIGE marcador legible. Sin él no hay dónde sellar el
 * intento, y sin intento sellado no hay contador anti-bucle: la app podría entrar
 * en un ciclo de instalar-fallar-instalar en cada cierre. El camino manual no lo
 * exige, porque el marcador es CONTABILIDAD, no autorización, y un bucle necesita
 * que algo lo dispare solo — aquí lo dispara una persona.
 */
export function decidirPlanDeCierre(e: EntradaPlanCierre): PlanDeCierre {
  // En dev la simulación llega a `ready` sin instalador real: no hay nada que aplicar.
  if (!e.empaquetada) return { tipo: 'ninguno', motivo: 'app sin empaquetar' }

  if (e.status === 'installing') {
    return { tipo: 'instalar', relanzar: true, origen: 'manual', marcador: e.marcador }
  }

  if (e.status !== 'ready') return { tipo: 'ninguno', motivo: `estado ${e.status}` }

  if (!e.preferenciaAlCerrar) {
    return { tipo: 'ninguno', motivo: 'el usuario no quiere aplicarla al cerrar' }
  }
  if (e.marcador === null) {
    return { tipo: 'ninguno', motivo: 'sin marcador: no se puede llevar la cuenta de intentos' }
  }
  if (e.marcador.bloqueado !== null) {
    return { tipo: 'ninguno', motivo: `bloqueado: ${e.marcador.bloqueado}` }
  }
  if (e.marcador.intentos >= e.maxIntentos) {
    return { tipo: 'ninguno', motivo: 'intentos agotados' }
  }

  return { tipo: 'instalar', relanzar: false, origen: 'cierre', marcador: e.marcador }
}


/**
 * A qué estado vuelve el auto-update cuando el usuario CANCELA el cierre en el diálogo
 * de salida (transacciones pendientes o cambios de la rejilla sin enviar, del
 * explorador de BD). Solo 'installing' cambia: lo puso «Reiniciar para actualizar», que
 * únicamente se puede pedir desde 'ready', así que vuelve ahí. Si se quedara en
 * 'installing', la UI seguiría en «Instalando…» toda la sesión y el siguiente cierre
 * normal instalaría y relanzaría sin que nadie lo pidiera (`decidirPlanDeCierre` lee
 * 'installing' como «lo pidió una persona»). Cualquier otro estado no lo tocó el
 * cierre cancelado: `null` = no se cambia nada.
 */
export function estadoTrasCierreCancelado(status: UpdateStatus): UpdateStatus | null {
  return status === 'installing' ? 'ready' : null
}
