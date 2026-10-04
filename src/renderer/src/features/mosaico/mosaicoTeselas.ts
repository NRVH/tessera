// =============================================================================
// Qué sesiones de agente son teselas del mosaico y en qué orden se pintan: listas
// de claves `${profileId}|${projectHostPath}|${agente}` (las de agentTargetKey).
// La rejilla la decide `mosaicoLayout.ts` y el montaje, el componente.
// Puro (sin React, DOM ni plataforma): corre bajo `node`.
// Decisiones: docs/decisiones/mosaico/teselas-y-orden.md
// =============================================================================

import type { Agente } from '../../../../main/profiles/types'

/** Una sesión de agente que PUEDE ser tesela, con lo necesario para ordenarla. */
export interface CandidatoMosaico {
  /** `${profileId}|${projectHostPath}|${agente}` (agentTargetKey). */
  key: string
  profileId: string
  projectHostPath: string
  agente: Agente
  /** Índice del perfil en la banda de perfiles. */
  ordenPerfil: number
  /** Índice del proyecto entre las pestañas de ese perfil. */
  ordenProyecto: number
}

/**
 * Un PROYECTO elegible tal como se enseña al usuario: la misma lista alimenta el
 * selector «N de M» de la barra, las fichas cuando no caben todas y el menú de
 * destinos de cada casilla. Una fila por proyecto y no por (proyecto, agente),
 * porque una casilla es de un proyecto: el agente se elige dentro, con el chip.
 * Lleva nombres y color porque los tres sitios pintan lo mismo, y los
 * identificadores crudos porque quien pinta tiene que poder saber de qué proyecto
 * habla sin volver a partir la clave.
 *
 * Es un tipo de DATOS: este módulo sigue sin React, sin DOM y sin plataforma.
 */
export interface OpcionMosaico {
  /**
   * Target que se ENSEÑARÍA de ese proyecto: el que ya es casilla, o el que elige
   * quien construye la lista (el que trabaja, si no el que está vivo, si no Claude
   * Code). Es `${profileId}|${projectHostPath}|${agente}` (agentTargetKey).
   */
  key: string
  profileId: string
  projectHostPath: string
  /** `${profileId}|${projectHostPath}`: la unidad del selector. */
  proyectoKey: string
  agenteId: Agente
  /** Nombre del perfil y del proyecto, ya resueltos. */
  perfil: string
  proyecto: string
  /** Nombre del agente que se enseñaría ("Claude Code") y su abreviatura ("CC"). */
  agente: string
  agenteCorto: string
  /** Tinta del perfil, o null si no tiene color. */
  color: string | null
  /** ¿Este PROYECTO está ahora en el mosaico? */
  esCasilla: boolean
  /** ¿Alguno de sus agentes tiene sesión viva? Si no, arranca al ponerlo en una casilla. */
  enMarcha: boolean
  /**
   * HIBERNADO: además de no estar en marcha, su contenedor está abajo, así que elegirlo
   * lo levanta y eso tarda. Se dice aparte de `enMarcha` porque es el único clic del
   * mosaico con coste de backend y quien pinta la lista tiene que poder avisar.
   */
  dormido: boolean
  /** ¿Alguno de sus agentes trabaja / terminó sin que lo mirases? */
  trabajando: boolean
  sinVer: boolean
}

/** Tope de teselas: lo más que la rejilla sabe repartir. */
export const MAX_TESELAS = 6

/** Largo máximo de la lista de enfocadas recientes (tocarReciente). */
export const MAX_RECIENTES = 32

/**
 * Rango del agente dentro de un mismo proyecto: Claude Code antes que Codex, el
 * orden de AGENTES_DISPONIBLES. Es un `Record<Agente, …>` a propósito: el día que
 * haya un tercer agente, typecheck obliga a decidir aquí dónde va, en vez de que
 * caiga en un hueco indefinido del orden. (No se importa AGENTES_DISPONIBLES para
 * que este módulo sólo tenga imports de tipo.)
 */
const RANGO_AGENTE: Record<Agente, number> = {
  'claude-code': 0,
  codex: 1
}

/**
 * Rango de un agente; uno que RANGO_AGENTE no conoce (una clave persistida por
 * otra versión, que el tipo no ve) va detrás de los conocidos. Sin este respaldo
 * el rango sale `undefined`, la resta da NaN y pasa lo mismo que con indiceOrden.
 */
function rangoAgente(agente: Agente): number {
  return RANGO_AGENTE[agente] ?? Number.POSITIVE_INFINITY
}

/**
 * Índice de orden comparable: un NaN (un índice mal calculado aguas arriba) cuenta
 * como "al final". Hace falta porque NaN no es menor, ni mayor, ni igual a nada: el
 * comparador deja de ser transitivo y `sort` devuelve un orden que depende del de
 * ENTRADA, y no sólo para el candidato roto: medido con el comparador por resta,
 * ocho sanos (0..7) y un NaN barajados 2000 veces salían desordenados en 609 (p. ej.
 * 0,2,3,5,NaN,1,4,6,7). Es justo el salto de teselas que el orden canónico existe
 * para evitar.
 */
function indiceOrden(n: number): number {
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n
}

/** -1/0/1 por comparación y no por resta: `Infinity - Infinity` es NaN. */
function compararNumeros(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Comparador del orden canónico: ordenPerfil, ordenProyecto, agente (Claude Code
 * antes que Codex) y, como desempate estable, la clave comparada byte a byte (NO
 * localeCompare: el orden no puede depender del idioma del equipo). Un índice NaN
 * o un agente desconocido van al final de su nivel (ver indiceOrden).
 */
export function compararCandidatos(a: CandidatoMosaico, b: CandidatoMosaico): number {
  return (
    compararNumeros(indiceOrden(a.ordenPerfil), indiceOrden(b.ordenPerfil)) ||
    compararNumeros(indiceOrden(a.ordenProyecto), indiceOrden(b.ordenProyecto)) ||
    compararNumeros(rangoAgente(a.agente), rangoAgente(b.agente)) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  )
}

/**
 * Orden canónico: ordenPerfil, luego ordenProyecto, luego claude-code antes que
 * codex, luego key (estable). Devuelve un array NUEVO; la entrada no se toca.
 */
export function ordenarCandidatos(c: readonly CandidatoMosaico[]): CandidatoMosaico[] {
  return [...c].sort(compararCandidatos)
}

/**
 * Tope efectivo: `max` truncado a entero y acotado a [0, MAX_TESELAS]. Sin `max`
 * (o con NaN, que no es un número de verdad) vale MAX_TESELAS. Los infinitos se
 * acotan como cualquier otro número: +∞ → MAX_TESELAS y −∞ → 0. (Antes todo lo no
 * finito valía MAX_TESELAS, y −∞ daba 6 mientras −1 daba 0.)
 */
export function limiteTeselas(max?: number): number {
  if (max === undefined || Number.isNaN(max)) return MAX_TESELAS
  return Math.min(MAX_TESELAS, Math.max(0, Math.floor(max)))
}

// -----------------------------------------------------------------------------
// Utilidades internas sobre listas de claves
// -----------------------------------------------------------------------------

/** Quita claves repetidas conservando la PRIMERA aparición. */
function sinDuplicados(claves: readonly string[]): string[] {
  const vistas = new Set<string>()
  const out: string[] = []
  for (const k of claves) {
    if (vistas.has(k)) continue
    vistas.add(k)
    out.push(k)
  }
  return out
}

/** Candidatos sin claves repetidas (gana la PRIMERA aparición). */
function candidatosUnicos(c: readonly CandidatoMosaico[]): CandidatoMosaico[] {
  const vistas = new Set<string>()
  const out: CandidatoMosaico[] = []
  for (const x of c) {
    if (vistas.has(x.key)) continue
    vistas.add(x.key)
    out.push(x)
  }
  return out
}

/**
 * Posición canónica de cada clave conocida. Si una clave aparece varias veces
 * (p. ej. en `orden` y en `vivos`), manda la primera de la lista concatenada:
 * por eso quien llama pone delante la fuente con autoridad.
 */
function posicionesCanonicas(...fuentes: readonly (readonly CandidatoMosaico[])[]): Map<string, number> {
  const unicos = ordenarCandidatos(candidatosUnicos(fuentes.flat()))
  const pos = new Map<string, number>()
  unicos.forEach((c, i) => pos.set(c.key, i))
  return pos
}

/**
 * Ordena claves por su posición canónica. Las que `pos` no conoce van al FINAL,
 * conservando su orden relativo de entrada (un orden estable para lo que no se
 * sabe ordenar, en vez de uno inventado).
 */
function ordenarPorPosicion(claves: readonly string[], pos: ReadonlyMap<string, number>): string[] {
  return claves
    .map((clave, i) => ({ clave, i, p: pos.get(clave) }))
    .sort((a, b) => {
      if (a.p !== undefined && b.p !== undefined) return a.p - b.p || a.i - b.i
      if (a.p !== undefined) return -1
      if (b.p !== undefined) return 1
      return a.i - b.i
    })
    .map((x) => x.clave)
}

/**
 * Proyecto de cada clave conocida (`${profileId}|${projectHostPath}`), la unidad de
 * "una casilla por proyecto". Se deriva de los CANDIDATOS y no partiendo la clave:
 * aquí no se sabe si la ruta puede llevar el separador, y una clave que ninguna
 * fuente conoce vale como su propio proyecto (no colisiona con nadie).
 */
function proyectosPorClave(...fuentes: readonly (readonly CandidatoMosaico[])[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const c of fuentes.flat()) {
    if (!m.has(c.key)) m.set(c.key, `${c.profileId}|${c.projectHostPath}`)
  }
  return m
}

/** El proyecto de una clave; si no se conoce, ella misma. */
function proyectoDe(clave: string, proyectos: ReadonlyMap<string, string>): string {
  return proyectos.get(clave) ?? clave
}

/** true si las dos listas tienen las mismas claves en el mismo orden. */
function mismasClaves(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Ordena claves en orden canónico según `orden`; las desconocidas, al final y en
 * su orden relativo. Devuelve un array nuevo sin repetidas. Útil para pintar la
 * lista del selector en el mismo orden que el mosaico.
 */
export function ordenarClaves(claves: readonly string[], orden: readonly CandidatoMosaico[]): string[] {
  return ordenarPorPosicion(sinDuplicados(claves), posicionesCanonicas(orden))
}

// -----------------------------------------------------------------------------
// Selección al entrar
// -----------------------------------------------------------------------------

/** Señales de actividad que deciden QUÉ entra al abrir el mosaico. */
export interface SenalesMosaico {
  /** Clave del target activo en la vista normal. */
  activa: string | null
  /** Claves cuyo agente terminó un turno que no has mirado. */
  terminadasSinVer: ReadonlySet<string>
  /** Claves cuyo agente está trabajando ahora. */
  trabajando: ReadonlySet<string>
}

/**
 * Grupo de prioridad (menor = antes): activa, terminada sin ver, trabajando, resto.
 * Sólo se usa para desempatar cuando TRABAJAN más de las que caben, así que en la
 * práctica reparte entre los grupos 0, 1 y 2.
 */
function grupoPrioridad(key: string, s: SenalesMosaico): number {
  if (s.activa !== null && key === s.activa) return 0
  if (s.terminadasSinVer.has(key)) return 1
  if (s.trabajando.has(key)) return 2
  return 3
}

/**
 * Selección al ENTRAR en el mosaico: SÓLO las que están trabajando, y como mucho UNA
 * por proyecto (`vivos` son los candidatos vivos, en cualquier orden). Si no trabaja
 * ninguna, devuelve UNA —la `activa` si está viva, o la primera en orden canónico—:
 * el mosaico no abre vacío. Si quedan más proyectos que huecos, la prioridad decide
 * cuáles (activa, terminadas sin ver, resto). DEVUELVE las claves en orden CANÓNICO,
 * no el de prioridad.
 */
export function seleccionInicial(
  vivos: readonly CandidatoMosaico[],
  s: SenalesMosaico,
  max?: number
): string[] {
  const lim = limiteTeselas(max)
  const canonicos = ordenarCandidatos(candidatosUnicos(vivos))
  if (lim === 0 || canonicos.length === 0) return []
  const proyectos = proyectosPorClave(canonicos)
  const trabajando = canonicos.filter((c) => s.trabajando.has(c.key))
  // Nada trabaja: una sola casilla, la que estabas usando. Ver "NUNCA ABRE VACÍO".
  if (trabajando.length === 0) {
    const activa = s.activa !== null ? canonicos.find((c) => c.key === s.activa) : undefined
    return [(activa ?? canonicos[0]).key]
  }
  // UNA POR PROYECTO: si los dos agentes del mismo proyecto trabajan, entra el de más
  // prioridad (la que estabas usando, luego la que terminó sin que la miraras) y, en
  // empate, el primero en orden canónico (Claude Code). El otro sigue vivo detrás, y
  // el chip de la cabecera lo trae a la casilla.
  const mejorPorProyecto = new Map<string, { key: string; i: number; g: number }>()
  trabajando.forEach((c, i) => {
    const p = proyectoDe(c.key, proyectos)
    const cand = { key: c.key, i, g: grupoPrioridad(c.key, s) }
    const previo = mejorPorProyecto.get(p)
    if (previo === undefined || cand.g < previo.g) mejorPorProyecto.set(p, cand)
  })
  const elegibles = [...mejorPorProyecto.values()]
  const elegidas = new Set(
    (elegibles.length <= lim
      ? elegibles
      : [...elegibles].sort((a, b) => a.g - b.g || a.i - b.i).slice(0, lim)
    ).map((x) => x.key)
  )
  // Vuelta al orden canónico: la prioridad decide QUIÉN entra, no DÓNDE va.
  return canonicos.filter((c) => elegidas.has(c.key)).map((c) => c.key)
}

// -----------------------------------------------------------------------------
// Reconciliación con el mosaico abierto
// -----------------------------------------------------------------------------

/** Entradas de reconciliarTeselas. */
export interface EntradaReconciliar {
  /**
   * Candidatos vivos ahora. Deciden a quién se recorta si el tope baja (sale antes la
   * que ya no está viva) y, como SEGUNDA fuente de posiciones canónicas, dónde se
   * pinta una tesela que `orden` no conoce: por eso no basta con pasar `[]` cuando el
   * tope no cambia.
   */
  vivos: readonly CandidatoMosaico[]
  /** TODOS los candidatos conocidos (vivos o no): de aquí sale el orden canónico. */
  orden: readonly CandidatoMosaico[]
  /** Claves cuyo target sigue existiendo (pestaña abierta y proyecto sin hibernar). */
  existentes: ReadonlySet<string>
  max?: number
}

/**
 * Reconciliación mientras el mosaico está ABIERTO (corre en cada cambio
 * relevante). Pertenencia estable:
 *  - quita las claves que no están en `existentes` (target cerrado o hibernado);
 *  - CONSERVA las que siguen existiendo aunque ya no estén vivas (el agente
 *    salió: su tesela pinta el banner de reinicio y la rejilla no salta);
 *  - NO añade nada: lo que entra, lo mete el usuario (selector o cabecera);
 *  - resultado en orden canónico (según `orden` + `vivos`; las claves que ninguno
 *    conoce van al final en su orden relativo);
 *  - devuelve la MISMA referencia `prev` si no cambia nada.
 */
export function reconciliarTeselas(prev: readonly string[], a: EntradaReconciliar): readonly string[] {
  const lim = limiteTeselas(a.max)
  // `orden` delante: es la fuente con autoridad; `vivos` sólo cubre lo que falte.
  const pos = posicionesCanonicas(a.orden, a.vivos)
  const clavesVivas = new Set(a.vivos.map((c) => c.key))

  // 1) Se quedan las que siguen existiendo, vivas o no.
  let teselas = ordenarPorPosicion(
    sinDuplicados(prev).filter((k) => a.existentes.has(k)),
    pos
  )

  // 2) Si el tope bajó, se recorta: primero las que ya no están vivas, luego las
  //    últimas en orden canónico.
  if (teselas.length > lim) {
    const sobran = teselas.length - lim
    const victimas = new Set(
      teselas
        .map((k, i) => ({ k, i, muerta: clavesVivas.has(k) ? 0 : 1 }))
        .sort((x, y) => y.muerta - x.muerta || y.i - x.i)
        .slice(0, sobran)
        .map((x) => x.k)
    )
    teselas = teselas.filter((k) => !victimas.has(k))
  }

  return mismasClaves(teselas, prev) ? prev : teselas
}

// -----------------------------------------------------------------------------
// Alternar desde el selector
// -----------------------------------------------------------------------------

/** Entradas de alternarTesela. */
export interface EntradaAlternar {
  /** TODOS los candidatos conocidos: una clave que no esté aquí no se alterna. */
  orden: readonly CandidatoMosaico[]
  /** Claves enfocadas, la más reciente primero (tocarReciente). */
  recientes: readonly string[]
  max?: number
}

/**
 * Alternar desde el selector ("6 de 8" con casillas).
 *  - la clave ya es tesela -> se quita;
 *  - no lo es y hay hueco -> entra en su posición canónica;
 *  - no lo es y está lleno -> sustituye a la tesela enfocada hace MÁS tiempo (una
 *    ausente de `recientes` cuenta como más vieja que cualquier presente; entre
 *    varias así, la ÚLTIMA en orden canónico), y el resultado en orden canónico;
 *  - clave desconocida para `orden` -> `prev` (misma referencia).
 */
export function alternarTesela(prev: readonly string[], key: string, a: EntradaAlternar): readonly string[] {
  const pos = posicionesCanonicas(a.orden)
  if (!pos.has(key)) return prev
  const actuales = sinDuplicados(prev)

  if (actuales.includes(key)) {
    return ordenarPorPosicion(
      actuales.filter((k) => k !== key),
      pos
    )
  }

  const lim = limiteTeselas(a.max)
  if (lim === 0) return prev

  // EL OTRO AGENTE DEL MISMO PROYECTO YA TIENE CASILLA: se sustituye en su sitio, no
  // se abre una segunda del mismo árbol de trabajo (una casilla por proyecto: ver el ADR).
  // Hoy el selector lista proyectos, así que esto no llega desde ahí; queda como la
  // defensa de la invariante para cualquier otro llamador.
  const proyectos = proyectosPorClave(a.orden)
  const hermana = actuales.find(
    (k) => k !== key && proyectoDe(k, proyectos) === proyectoDe(key, proyectos)
  )

  // Antigüedad de cada tesela: su índice en `recientes` (0 = la más reciente);
  // la que no aparece, Infinity (más vieja que cualquiera que aparezca).
  const indiceReciente = new Map<string, number>()
  a.recientes.forEach((k, i) => {
    if (!indiceReciente.has(k)) indiceReciente.set(k, i)
  })
  let teselas = ordenarPorPosicion(actuales, pos)
  // El otro agente del mismo proyecto suelta su hueco ANTES del desalojo: la nueva
  // ocupa el suyo y no se mueve nadie más. El bucle sigue corriendo después, porque
  // sustituir no es excusa para pasarse del tope si éste bajó (y esa lista llega
  // como viene: esta función no re-valida el `prev` que le dan).
  if (hermana !== undefined) teselas = teselas.filter((k) => k !== hermana)
  // Normalmente sobra UNA; si el tope bajó por debajo de lo que había, se sacan
  // las necesarias para que quepa la nueva, siempre la menos reciente primero.
  while (teselas.length >= lim) {
    let victima = -1
    let peor = -1
    teselas.forEach((k, i) => {
      const edad = indiceReciente.get(k) ?? Number.POSITIVE_INFINITY
      // `>=`: ante empate (dos ausentes) gana la que va DESPUÉS en orden canónico.
      if (edad >= peor) {
        peor = edad
        victima = i
      }
    })
    teselas = teselas.filter((_, i) => i !== victima)
  }
  return ordenarPorPosicion([...teselas, key], pos)
}

// -----------------------------------------------------------------------------
// Cambiar el destino de una casilla
// -----------------------------------------------------------------------------

/** Entradas de reemplazarTesela. */
export interface EntradaReemplazar {
  /** TODOS los candidatos conocidos: un destino que no esté aquí no se acepta. */
  orden: readonly CandidatoMosaico[]
}

/**
 * Manda la casilla `actual` a otro target (`nueva`): el mismo hueco, otro proyecto
 * o el otro agente. Devuelve la lista en orden CANÓNICO.
 *  - `nueva` desconocida para `orden`, igual que `actual`, o `actual` que no es
 *    tesela -> `prev` (misma referencia);
 *  - `nueva` que YA es tesela -> `prev`: duplicarla sería multiplexar una sesión a
 *    dos tamaños. Quien llama la enfoca, que es lo que se quería.
 */
export function reemplazarTesela(
  prev: readonly string[],
  actual: string,
  nueva: string,
  a: EntradaReemplazar
): readonly string[] {
  if (actual === nueva) return prev
  const pos = posicionesCanonicas(a.orden)
  if (!pos.has(nueva)) return prev
  const actuales = sinDuplicados(prev)
  if (!actuales.includes(actual) || actuales.includes(nueva)) return prev
  // Ese proyecto ya está en OTRA casilla (con este agente o con el otro): no se
  // duplica. Quien llama la enfoca, que es lo que se quería ver.
  const proyectos = proyectosPorClave(a.orden)
  const destino = proyectoDe(nueva, proyectos)
  if (actuales.some((k) => k !== actual && proyectoDe(k, proyectos) === destino)) return prev
  return ordenarPorPosicion(
    actuales.map((k) => (k === actual ? nueva : k)),
    pos
  )
}

// -----------------------------------------------------------------------------
// Destinos pedidos que todavía no se pueden aplicar
// -----------------------------------------------------------------------------

/**
 * LO QUE UNA CASILLA PIDIÓ VER Y AÚN NO SE PUEDE APLICAR. Hay dos gestos que piden un
 * target que en ese instante NO existe o no vale:
 *
 *  · «abrir otro proyecto»: el target nace cuando el modelo de pestañas publica el
 *    proyecto, o sea un commit más tarde que el clic;
 *  · elegir un proyecto HIBERNADO: el target existe, pero mientras siga dormido la
 *    reconciliación lo sacaría del mosaico (no está en `existentes`), así que primero
 *    se despierta y luego se adopta.
 *
 * Los dos se resuelven igual: la petición se guarda y se reevalúa en cada cambio. Lo
 * que decide esta función es CUÁNDO deja de tener sentido esperar, que es la parte que
 * se puede equivocar en silencio: una petición que no caduca se queda armada y, si el
 * proyecto se cierra y se vuelve a abrir más tarde, secuestra la casilla que estuvieras
 * mirando entonces. Por eso el corte NO es "el target no existe" —justo eso es lo que
 * se está esperando— sino "su proyecto ya no está abierto": eso no vuelve solo.
 */
export interface PeticionPendiente {
  /** Casilla que lo pidió; null = viene del selector de la barra (añadir, no sustituir). */
  casilla: string | null
  /** Target pedido. */
  key: string
  /** Su proyecto (`${profileId}|${projectHostPath}`), que es lo que decide la caducidad. */
  proyecto: string
}

/** Lo que el integrador sabe del mundo al reevaluar una petición. */
export interface EstadoPeticion {
  /** ¿Sigue abierto el mosaico? */
  mosaico: boolean
  /** Casillas de ahora. */
  teselas: readonly string[]
  /** ¿El target ya existe como candidato (pestaña publicada)? */
  existe: boolean
  /** ¿Sigue hibernado? Un hibernado no puede ser tesela. */
  hibernado: boolean
  /** ¿Su proyecto sigue abierto? Si no, la petición ya no llegará nunca. */
  proyectoAbierto: boolean
}

/**
 * Qué hacer con una petición pendiente:
 *  - `descartar`: se cerró el mosaico, la casilla que lo pidió ya no está, o el
 *    proyecto se cerró (no volverá solo);
 *  - `esperar`: el target aún no existe, o sigue dormido;
 *  - `alternar` / `reemplazar`: ya se puede aplicar, por la vía que corresponde a
 *    quién lo pidió (la barra añade; una casilla sustituye).
 */
export function accionPeticion(
  p: PeticionPendiente,
  e: EstadoPeticion
): 'descartar' | 'esperar' | 'alternar' | 'reemplazar' {
  if (!e.mosaico) return 'descartar'
  if (p.casilla !== null && !e.teselas.includes(p.casilla)) return 'descartar'
  if (!e.proyectoAbierto) return 'descartar'
  if (!e.existe || e.hibernado) return 'esperar'
  return p.casilla === null ? 'alternar' : 'reemplazar'
}

// -----------------------------------------------------------------------------
// Recientes y "visto"
// -----------------------------------------------------------------------------

/**
 * Actualiza la lista de enfocadas recientes: lleva `key` al frente, quita
 * repetidas y recorta a MAX_RECIENTES. Misma referencia si `key` ya era la primera.
 */
export function tocarReciente(recientes: readonly string[], key: string): readonly string[] {
  if (recientes[0] === key) return recientes
  return sinDuplicados([key, ...recientes]).slice(0, MAX_RECIENTES)
}

/**
 * Qué clave cuenta como VISTA para los badges de actividad.
 *  - Vista normal: activeTargetKey si la columna del agente está visible
 *    (ccVisible); si no, null.
 *  - Mosaico: SÓLO la tesela enfocada, si es tesela; si no, null. Si contara
 *    toda tesela pintada se perdería la señal de "¿quién me necesita?".
 */
export function claveVista(a: {
  mosaico: boolean
  enfocada: string | null
  teselas: readonly string[]
  activeTargetKey: string | null
  ccVisible: boolean
}): string | null {
  if (a.mosaico) {
    return a.enfocada !== null && a.teselas.includes(a.enfocada) ? a.enfocada : null
  }
  return a.ccVisible ? a.activeTargetKey : null
}
