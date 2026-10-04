// =============================================================================
// Modelo puro de la lista de terminales de shell por proyecto: para cada (perfil,
// proyecto) abierto, una lista ordenada de ranuras y cuál es la activa. El pty, el
// xterm y el sessionId son del pane; aquí solo cuántas hay, en qué orden y cuál se
// mira. El `id` de una ranura no se reutiliza jamás; el número visible sí se recicla.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

/** Una ranura de terminal dentro de un proyecto. */
export interface ShellTerminal {
  /** `t${n}`. Estable, único en el proyecto, jamás reutilizado. React key del pane. */
  id: string
  /** Ordinal de creación (1, 2, 3…). Identidad, no rótulo. */
  n: number
  /** Número que se ve en la pestaña: el hueco libre más bajo al crearla; se recicla al cerrar. */
  indice: number
  /**
   * Nombre puesto a mano (doble clic en la pestaña). `undefined` = el de por defecto,
   * que depende del modo del proyecto ("Local" nativo, "Docker" en el contenedor) y
   * por eso no se materializa aquí.
   */
  nombre?: string
}

/** Las terminales de UN proyecto. */
export interface ProjectTerminals {
  /** Orden de la lista = orden de creación (las nuevas se añaden al final). */
  list: ShellTerminal[]
  /** Ranura que se está mirando, o null si la lista quedó vacía. */
  activeId: string | null
  /** Siguiente ordinal a repartir. Monótono: nunca decrece ni reutiliza. */
  nextN: number
}

/** Estado global: proyecto (clave) -> sus terminales. */
export type ShellTerminalsState = Record<string, ProjectTerminals>

export const initialShellTerminalsState: ShellTerminalsState = {}

/**
 * Clave de proyecto, con la forma de `editorTargetKey` (`${profileId}|${projectHostPath}`).
 * El agente no entra: una terminal de shell cuelga del proyecto.
 */
export function terminalProjectKey(profileId: string, projectHostPath: string): string {
  return `${profileId}|${projectHostPath}`
}

/** Clave de un pane: la del proyecto más el id de su ranura (también su React key). */
export function terminalPaneKey(projectKey: string, terminalId: string): string {
  return `${projectKey}|${terminalId}`
}

/**
 * Nombre visible de una ranura: dónde corre el shell ("Local" en el host, "Docker"
 * dentro del contenedor del perfil), no qué binario es. El (2) aparece desde la
 * segunda; la primera es "Local" a secas.
 */
export function terminalName(t: ShellTerminal, hostMode: boolean): string {
  if (t.nombre !== undefined && t.nombre !== '') return t.nombre
  return nombreAutomatico(t.indice, hostMode)
}

/** El nombre que le tocaría a la ranura `indice` en ese modo, sin mirar el suyo. */
function nombreAutomatico(indice: number, hostMode: boolean): string {
  const base = hostMode ? 'Local' : 'Docker'
  return indice <= 1 ? base : `${base} (${indice})`
}

/** El hueco de rótulo más bajo que no esté ocupado por una ranura viva. */
function indiceLibre(list: readonly ShellTerminal[]): number {
  const usados = new Set(list.map((t) => t.indice))
  let i = 1
  while (usados.has(i)) i++
  return i
}

/**
 * Garantiza que un proyecto TENGA su entrada, con una primera terminal. Se llama
 * perezosamente (cuando el proyecto se hace visible con el panel abierto), no al
 * abrir el proyecto: así abrir 5 proyectos no crea 5 ptys que nadie pidió.
 *
 * Idempotente y CONSERVADOR: si el proyecto ya tiene entrada NO la toca, ni
 * siquiera con la lista vacía. Cerrar la última terminal a mano deja el proyecto
 * en 0 (con su estado vacío y su "+"); recrearla aquí sería resucitarla en el acto,
 * contra la voluntad explícita del usuario.
 */
export function ensureProject(state: ShellTerminalsState, key: string): ShellTerminalsState {
  if (state[key]) return state
  return { ...state, [key]: { list: [{ id: 't1', n: 1, indice: 1 }], activeId: 't1', nextN: 2 } }
}

/** Añade una terminal al final y la deja ACTIVA (es lo que hace el "+"). */
export function addTerminal(state: ShellTerminalsState, key: string): ShellTerminalsState {
  const cur = state[key] ?? { list: [], activeId: null, nextN: 1 }
  const t: ShellTerminal = { id: `t${cur.nextN}`, n: cur.nextN, indice: indiceLibre(cur.list) }
  return {
    ...state,
    [key]: { list: [...cur.list, t], activeId: t.id, nextN: cur.nextN + 1 }
  }
}

/**
 * Renombra una ranura. Un nombre en blanco, o igual al automático de CUALQUIERA de los
 * dos modos, devuelve la ranura a su nombre automático en vez de guardar el texto: si
 * se guardara, la pestaña se quedaría clavada al cambiar de modo. Borrar el campo es la
 * única forma de deshacer un renombrado.
 */
export function renameTerminal(
  state: ShellTerminalsState,
  key: string,
  id: string,
  nombre: string
): ShellTerminalsState {
  const cur = state[key]
  if (!cur) return state
  const i = cur.list.findIndex((t) => t.id === id)
  if (i === -1) return state
  const limpio = nombre.trim()
  const automaticos = [
    nombreAutomatico(cur.list[i].indice, true),
    nombreAutomatico(cur.list[i].indice, false)
  ]
  const siguiente = limpio === '' || automaticos.includes(limpio) ? undefined : limpio
  if (cur.list[i].nombre === siguiente) return state
  const list = cur.list.map((t, j) => (j === i ? { ...t, nombre: siguiente } : t))
  return { ...state, [key]: { ...cur, list } }
}

/**
 * Cierra una ranura. Su pane se desmontará (React key fuera de la lista) y ESE
 * desmontaje es el que cierra la sesión pty: aquí no hay IPC.
 *
 * Sucesión de la activa: si cerraste la que mirabas, pasa a
 * la de la DERECHA; si no había, a la de la IZQUIERDA; si no queda ninguna, null.
 */
export function closeTerminal(
  state: ShellTerminalsState,
  key: string,
  id: string
): ShellTerminalsState {
  const cur = state[key]
  if (!cur) return state
  const i = cur.list.findIndex((t) => t.id === id)
  if (i === -1) return state
  const list = cur.list.filter((t) => t.id !== id)
  let activeId = cur.activeId
  if (activeId === id) activeId = list.length === 0 ? null : (list[i] ?? list[i - 1]).id
  return { ...state, [key]: { ...cur, list, activeId } }
}

/** Cambia la terminal que se mira. Ignora ids que no existan (no inventa activas). */
export function selectTerminal(
  state: ShellTerminalsState,
  key: string,
  id: string
): ShellTerminalsState {
  const cur = state[key]
  if (!cur || !cur.list.some((t) => t.id === id) || cur.activeId === id) return state
  return { ...state, [key]: { ...cur, activeId: id } }
}

/**
 * Olvida los proyectos que ya no están abiertos (cerraste su pestaña o su perfil).
 * Sus panes ya se desmontaron —y con ellos murieron sus sesiones—; esto solo evita
 * que el estado crezca sin límite y que un proyecto reabierto herede la lista vieja.
 * Devuelve el MISMO objeto si no sobra nada (identidad estable: no re-renderiza).
 */
export function pruneProjects(
  state: ShellTerminalsState,
  validKeys: Iterable<string>
): ShellTerminalsState {
  const valid = new Set(validKeys)
  const keys = Object.keys(state)
  if (keys.every((k) => valid.has(k))) return state
  const next: ShellTerminalsState = {}
  for (const k of keys) if (valid.has(k)) next[k] = state[k]
  return next
}
