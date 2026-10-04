// =============================================================================
// Esquemas VISIBLES de una conexión (el «N de M» del explorador): normalizar, resolver, contar y la
// casilla tri-estado «Todos». Lógica pura que comparten el main y el renderer para contar igual.
// Neutral y ES2020 (sin `.at()`, `replaceAll`, `findLast` ni `Object.hasOwn`).
// Decisiones: docs/decisiones/bd/contratos-esquemas-visibles.md
// =============================================================================

import { ESQUEMAS_VISIBLES_INICIAL, type DbEsquemasVisibles } from './db-ipc.ts'

/** Tope de nombres guardados en una lista de esquemas visibles. */
export const ESQUEMAS_VISIBLES_MAX = 2000
/** Longitud máxima de un nombre guardado. Holgada: Oracle admite 128, PG 63. */
const NOMBRE_MAX = 1024
const NUL = '\u0000'

export type EstadoCasillaTodos = 'vacia' | 'parcial' | 'llena'

/**
 * Sanea lo que llega del disco. Devuelve `undefined` si la forma no es válida (el
 * llamador lo trata como "sin configurar" = `ESQUEMAS_VISIBLES_INICIAL`).
 */
export function normalizarEsquemasVisibles(raw: unknown): DbEsquemasVisibles | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const o = raw as { modo?: unknown; porDefecto?: unknown; esquemas?: unknown }
  if (o.modo === 'todos') return { modo: 'todos' }
  if (o.modo !== 'lista') return undefined
  if (typeof o.porDefecto !== 'boolean') return undefined
  if (!Array.isArray(o.esquemas)) return undefined
  const vistos = new Set<string>()
  const esquemas: string[] = []
  for (const e of o.esquemas) {
    if (esquemas.length >= ESQUEMAS_VISIBLES_MAX) break
    if (typeof e !== 'string') continue
    const nombre = e.trim()
    if (nombre === '' || nombre.length > NOMBRE_MAX || nombre.indexOf(NUL) !== -1) continue
    if (vistos.has(nombre)) continue
    vistos.add(nombre)
    esquemas.push(nombre)
  }
  return { modo: 'lista', porDefecto: o.porDefecto, esquemas }
}

/** La configuración que rige: la guardada o, si falta, la inicial (solo el por defecto). */
export function configEfectiva(conf: DbEsquemasVisibles | undefined): DbEsquemasVisibles {
  return conf ?? ESQUEMAS_VISIBLES_INICIAL
}

/** ¿Está marcada la casilla «Por defecto (X)»? En «Todos» lo está todo. */
export function porDefectoMarcado(conf: DbEsquemasVisibles | undefined): boolean {
  const c = configEfectiva(conf)
  return c.modo === 'todos' || c.porDefecto
}

/** ¿Se ve este esquema? (sin comprobar que exista: eso lo hace `resolverVisibles`). */
export function estaVisible(
  conf: DbEsquemasVisibles | undefined,
  esquema: string,
  porDefecto: string | null
): boolean {
  const c = configEfectiva(conf)
  if (c.modo === 'todos') return true
  if (c.porDefecto && porDefecto !== null && esquema === porDefecto) return true
  return c.esquemas.indexOf(esquema) !== -1
}

/**
 * Los esquemas que se ven, en el orden de `todos` y SOLO los que existen.
 *
 * `sistema` (opcional) excluye esos esquemas en el modo «Todos», salvo el por
 * defecto: lo usa el índice de autocompletado, que con 150 esquemas de sistema se
 * iría a cientos de miles de nombres que nadie escribe. En modo lista no se aplica:
 * si el usuario marcó SYS a mano, lo quiere.
 */
export function resolverVisibles(
  conf: DbEsquemasVisibles | undefined,
  todos: readonly string[],
  porDefecto: string | null,
  sistema?: ReadonlySet<string> | readonly string[]
): string[] {
  const c = configEfectiva(conf)
  const out: string[] = []
  const vistos = new Set<string>()
  if (c.modo === 'todos') {
    const excluir = sistema === undefined ? null : new Set<string>(sistema)
    for (const e of todos) {
      if (vistos.has(e)) continue
      vistos.add(e)
      if (excluir !== null && excluir.has(e) && e !== porDefecto) continue
      out.push(e)
    }
    return out
  }
  const marcados = new Set(c.esquemas)
  if (c.porDefecto && porDefecto !== null) marcados.add(porDefecto)
  for (const e of todos) {
    if (vistos.has(e)) continue
    vistos.add(e)
    if (marcados.has(e)) out.push(e)
  }
  return out
}

/**
 * N de "N de M". Con `todos` es exacto (`resolverVisibles`). Sin él —la insignia
 * pintada antes de conectar, con solo `introspeccion`— se estima con lo guardado y
 * se acota a `total`.
 */
export function contarVisibles(
  conf: DbEsquemasVisibles | undefined,
  total: number,
  porDefecto: string | null,
  todos?: readonly string[]
): number {
  if (todos !== undefined) return resolverVisibles(conf, todos, porDefecto).length
  const c = configEfectiva(conf)
  const m = Math.max(0, Math.floor(total))
  if (c.modo === 'todos') return m
  const nombres = new Set(c.esquemas)
  let n = nombres.size
  // El por defecto se suma si su bandera está puesta y no está ya en la lista. Si
  // no se conoce su nombre, se suma igualmente: la sesión siempre tiene uno.
  if (c.porDefecto && (porDefecto === null || !nombres.has(porDefecto))) n++
  return Math.min(n, m)
}

/** Estado de la casilla tri-estado «Todos los esquemas». */
export function estadoCasillaTodos(
  conf: DbEsquemasVisibles | undefined,
  todos: readonly string[],
  porDefecto: string | null
): EstadoCasillaTodos {
  const c = configEfectiva(conf)
  if (c.modo === 'todos') return 'llena'
  const n = resolverVisibles(c, todos, porDefecto).length
  if (n === 0) return 'vacia'
  // Una lista que cubre todos los esquemas se VE llena, y así se pinta; sigue siendo
  // una lista (un esquema nuevo no aparecería solo), pero la casilla describe lo que
  // hay marcado, no el modo.
  return n === new Set(todos).size ? 'llena' : 'parcial'
}

/** Pulsar «Todos»: llena -> vacía; vacía o parcial -> todos. */
export function alternarTodos(
  conf: DbEsquemasVisibles | undefined,
  todos: readonly string[],
  porDefecto: string | null
): DbEsquemasVisibles {
  if (estadoCasillaTodos(conf, todos, porDefecto) === 'llena') {
    return { modo: 'lista', porDefecto: false, esquemas: [] }
  }
  return { modo: 'todos' }
}

/**
 * Marcar o desmarcar UN esquema. Desde «Todos», desmarcar deja la lista de todos
 * menos él (el por defecto, por su bandera). Desmarcar el esquema por defecto quita
 * también la bandera: si no, seguiría viéndose por ella y la casilla no respondería.
 */
export function alternarEsquema(
  conf: DbEsquemasVisibles | undefined,
  esquema: string,
  todos: readonly string[],
  porDefecto: string | null
): DbEsquemasVisibles {
  const c = configEfectiva(conf)
  const esElPorDefecto = porDefecto !== null && esquema === porDefecto
  if (c.modo === 'todos') {
    const esquemas: string[] = []
    const vistos = new Set<string>()
    for (const e of todos) {
      if (e === esquema || vistos.has(e)) continue
      vistos.add(e)
      // El por defecto va por la bandera, no por nombre: así sigue siendo dinámico.
      if (porDefecto !== null && e === porDefecto) continue
      esquemas.push(e)
    }
    return { modo: 'lista', porDefecto: !esElPorDefecto, esquemas }
  }
  if (estaVisible(c, esquema, porDefecto)) {
    return {
      modo: 'lista',
      porDefecto: esElPorDefecto ? false : c.porDefecto,
      esquemas: c.esquemas.filter((e) => e !== esquema)
    }
  }
  if (c.esquemas.length >= ESQUEMAS_VISIBLES_MAX) return c
  return { modo: 'lista', porDefecto: c.porDefecto, esquemas: [...c.esquemas, esquema] }
}

/**
 * Pulsar «Por defecto (X)». En modo lista alterna la bandera. Desde «Todos» equivale
 * a desmarcar el esquema por defecto (la casilla se pinta marcada en ese modo).
 */
export function alternarPorDefecto(
  conf: DbEsquemasVisibles | undefined,
  todos: readonly string[],
  porDefecto: string | null
): DbEsquemasVisibles {
  const c = configEfectiva(conf)
  if (c.modo === 'todos') {
    if (porDefecto === null) return { modo: 'lista', porDefecto: false, esquemas: [...new Set(todos)] }
    return alternarEsquema(c, porDefecto, todos, porDefecto)
  }
  return { modo: 'lista', porDefecto: !c.porDefecto, esquemas: [...c.esquemas] }
}
