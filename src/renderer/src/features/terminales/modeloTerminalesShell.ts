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
   * Nombre puesto a mano (doble clic en la pestaña). `undefined` = el de por defecto
   * ("Local"), que se deriva de `indice` y no se materializa aquí.
   */
  nombre?: string
}

/** Las terminales de UN proyecto. */
export interface TerminalesProyecto {
  /** Orden de la lista = orden de creación (las nuevas se añaden al final). */
  lista: ShellTerminal[]
  /** Ranura que se está mirando, o null si la lista quedó vacía. */
  activoId: string | null
  /** Siguiente ordinal a repartir. Monótono: nunca decrece ni reutiliza. */
  siguienteOrdinal: number
}

/** Estado global: proyecto (clave) -> sus terminales. */
export type EstadoTerminalesShell = Record<string, TerminalesProyecto>

export const estadoInicialTerminalesShell: EstadoTerminalesShell = {}

/**
 * Clave de proyecto, con la forma de `claveDestinoEditor` (`${profileId}|${projectHostPath}`).
 * El agente no entra: una terminal de shell cuelga del proyecto.
 */
export function claveProyectoTerminal(perfilId: string, rutaHostProyecto: string): string {
  return `${perfilId}|${rutaHostProyecto}`
}

/** Clave de un pane: la del proyecto más el id de su ranura (también su React key). */
export function clavePaneTerminal(claveProyecto: string, terminalId: string): string {
  return `${claveProyecto}|${terminalId}`
}

/**
 * Nombre visible de una ranura: "Local", donde corre el shell, no qué binario es. El (2)
 * aparece desde la segunda; la primera es "Local" a secas.
 */
export function nombreTerminal(t: ShellTerminal): string {
  if (t.nombre !== undefined && t.nombre !== '') return t.nombre
  return nombreAutomatico(t.indice)
}

/** El nombre que le tocaría a la ranura `indice`, sin mirar el suyo. */
function nombreAutomatico(indice: number): string {
  return indice <= 1 ? 'Local' : `Local (${indice})`
}

/** El hueco de rótulo más bajo que no esté ocupado por una ranura viva. */
function indiceLibre(lista: readonly ShellTerminal[]): number {
  const usados = new Set(lista.map((t) => t.indice))
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
export function asegurarProyecto(estado: EstadoTerminalesShell, clave: string): EstadoTerminalesShell {
  if (estado[clave]) return estado
  return { ...estado, [clave]: { lista: [{ id: 't1', n: 1, indice: 1 }], activoId: 't1', siguienteOrdinal: 2 } }
}

/** ¿Es la entrada que deja `asegurarProyecto`, sin tocar? */
function deSerie(p: TerminalesProyecto | undefined): boolean {
  return p !== undefined && p.siguienteOrdinal === 2 && p.lista.length === 1 && p.lista[0].id === 't1' && p.lista[0].nombre === undefined
}

/**
 * Recrea las terminales que un proyecto tenía al cerrar (shells nuevos, con sus nombres y la activa). Solo si
 * aún no tiene ninguna o tiene la primera de serie, que conserva su id (y con él su pane): nunca pisa lo que el
 * usuario ya abrió en esta sesión. `activa` es el índice en `nombres`.
 */
export function restaurarTerminales(
  estado: EstadoTerminalesShell,
  clave: string,
  nombres: readonly (string | undefined)[],
  activa: number
): EstadoTerminalesShell {
  if (nombres.length === 0 || (estado[clave] !== undefined && !deSerie(estado[clave]))) return estado
  const lista: ShellTerminal[] = nombres.map((nombre, i) => ({
    id: `t${i + 1}`,
    n: i + 1,
    indice: i + 1,
    ...(nombre !== undefined && nombre !== '' && nombre !== nombreAutomatico(i + 1) ? { nombre } : {})
  }))
  const activoId = lista[activa >= 0 && activa < lista.length ? activa : 0].id
  return { ...estado, [clave]: { lista, activoId, siguienteOrdinal: lista.length + 1 } }
}

/** Añade una terminal al final y la deja ACTIVA (es lo que hace el "+"). */
export function anadirTerminal(estado: EstadoTerminalesShell, clave: string): EstadoTerminalesShell {
  const cur = estado[clave] ?? { lista: [], activoId: null, siguienteOrdinal: 1 }
  const t: ShellTerminal = { id: `t${cur.siguienteOrdinal}`, n: cur.siguienteOrdinal, indice: indiceLibre(cur.lista) }
  return {
    ...estado,
    [clave]: { lista: [...cur.lista, t], activoId: t.id, siguienteOrdinal: cur.siguienteOrdinal + 1 }
  }
}

/**
 * Renombra una ranura. Un nombre en blanco, o igual al automático, devuelve la ranura a
 * su nombre automático en vez de guardar el texto. Borrar el campo es la única forma de
 * deshacer un renombrado.
 */
export function renombrarTerminal(
  estado: EstadoTerminalesShell,
  clave: string,
  id: string,
  nombre: string
): EstadoTerminalesShell {
  const cur = estado[clave]
  if (!cur) return estado
  const i = cur.lista.findIndex((t) => t.id === id)
  if (i === -1) return estado
  const limpio = nombre.trim()
  const siguiente = limpio === '' || limpio === nombreAutomatico(cur.lista[i].indice) ? undefined : limpio
  if (cur.lista[i].nombre === siguiente) return estado
  const lista = cur.lista.map((t, j) => (j === i ? { ...t, nombre: siguiente } : t))
  return { ...estado, [clave]: { ...cur, lista } }
}

/**
 * Cierra una ranura. Su pane se desmontará (React key fuera de la lista) y ESE
 * desmontaje es el que cierra la sesión pty: aquí no hay IPC.
 *
 * Sucesión de la activa: si cerraste la que mirabas, pasa a
 * la de la DERECHA; si no había, a la de la IZQUIERDA; si no queda ninguna, null.
 */
export function cerrarTerminal(
  estado: EstadoTerminalesShell,
  clave: string,
  id: string
): EstadoTerminalesShell {
  const cur = estado[clave]
  if (!cur) return estado
  const i = cur.lista.findIndex((t) => t.id === id)
  if (i === -1) return estado
  const lista = cur.lista.filter((t) => t.id !== id)
  let activoId = cur.activoId
  if (activoId === id) activoId = lista.length === 0 ? null : (lista[i] ?? lista[i - 1]).id
  return { ...estado, [clave]: { ...cur, lista, activoId } }
}

/** Cambia la terminal que se mira. Ignora ids que no existan (no inventa activas). */
export function seleccionarTerminal(
  estado: EstadoTerminalesShell,
  clave: string,
  id: string
): EstadoTerminalesShell {
  const cur = estado[clave]
  if (!cur || !cur.lista.some((t) => t.id === id) || cur.activoId === id) return estado
  return { ...estado, [clave]: { ...cur, activoId: id } }
}

/**
 * Olvida los proyectos que ya no están abiertos (cerraste su pestaña o su perfil).
 * Sus panes ya se desmontaron —y con ellos murieron sus sesiones—; esto solo evita
 * que el estado crezca sin límite y que un proyecto reabierto herede la lista vieja.
 * Devuelve el MISMO objeto si no sobra nada (identidad estable: no re-renderiza).
 */
export function podarProyectosTerminales(
  estado: EstadoTerminalesShell,
  clavesValidas: Iterable<string>
): EstadoTerminalesShell {
  const validas = new Set(clavesValidas)
  const claves = Object.keys(estado)
  if (claves.every((k) => validas.has(k))) return estado
  const siguiente: EstadoTerminalesShell = {}
  for (const k of claves) if (validas.has(k)) siguiente[k] = estado[k]
  return siguiente
}
