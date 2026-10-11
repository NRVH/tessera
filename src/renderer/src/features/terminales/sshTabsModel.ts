// =============================================================================
// Modelo puro de las pestañas SSH de las terminales: son del PERFIL, no de un proyecto, así que se
// ven en todos sus proyectos y también sin ninguno. Por perfil, una lista ordenada de pestañas; y
// por CONTEXTO (el proyecto que se mira, o «ningún proyecto» del perfil) cuál es la elegida, si lo
// es alguna: sin elegida se ve la terminal local activa. El pty, el xterm y el sessionId son del
// pane; aquí solo cuántas hay, en qué orden y cuál se mira. El `id` no se reutiliza jamás.
// Las pestañas abiertas se guardan para el siguiente arranque y vuelven sin elegir (sin conectar).
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import type { SshPestanaGuardada, SshPestanasPorPerfil } from '../../../../shared/ajustesTerminal.ts'

/** Una pestaña SSH de un perfil. */
export interface SshTab {
  /** `s${n}`. Estable, único en el perfil, jamás reutilizado. React key del pane. */
  id: string
  /** Ordinal de creación (1, 2, 3…). Identidad, no rótulo. */
  n: number
  /** La conexión guardada que abre. */
  conexionId: string
  /** El hueco libre más bajo entre las pestañas de ESA conexión: la 2.ª se llama «alias (2)». Se recicla al cerrar. */
  indice: number
  /** Nombre puesto a mano (doble clic en la pestaña). `undefined` = el del alias. */
  nombre?: string
  /** El alias de la conexión la última vez que se supo: sobrevive a que la conexión se elimine. */
  aliasConocido: string
  /** `true` = no es una terminal SSH sino el explorador SFTP de la conexión: «SFTP · alias», sin pty ni reinicio. */
  sftp?: true
  /**
   * Vuelve del arranque anterior y aún no se ha elegido: no hace de pane de reserva (la primera SSH cuando no hay
   * otra cosa que enseñar), o se conectaría sola. Elegirla lo quita.
   */
  restaurada?: true
}

/** Las pestañas SSH de UN perfil. */
export interface SshTabsPerfil {
  /** Orden de la lista = orden de creación (las nuevas se añaden al final). */
  lista: SshTab[]
  /** Siguiente ordinal a repartir. Monótono: nunca decrece ni reutiliza. */
  siguiente: number
}

/** Estado: las pestañas de cada perfil y la elegida de cada contexto. */
export interface SshTabsState {
  porPerfil: Record<string, SshTabsPerfil>
  /** contexto (`perfil|ruta` o `perfil|`) -> id de la pestaña SSH elegida. Sin entrada = la terminal local activa. */
  activaPorContexto: Record<string, string>
}

export const initialSshTabsState: SshTabsState = { porPerfil: {}, activaPorContexto: {} }

/** Sin pestañas: una constante, para que un perfil sin ninguna no devuelva un array nuevo en cada render. */
export const SIN_PESTANAS_SSH: readonly SshTab[] = []

/** El alias de una pestaña cuya conexión aún no se conocía al abrirla. */
export const ALIAS_SSH_DESCONOCIDO = 'SSH'

/**
 * El contexto en que se mira la terminal: el proyecto (`perfil|ruta`, la clave de proyecto de las
 * terminales) o, sin proyecto, el perfil solo (`perfil|`).
 */
export function contextoSsh(perfilId: string, projectHostPath: string | null): string {
  return `${perfilId}|${projectHostPath ?? ''}`
}

/** El perfil de un contexto: lo que va antes del primer `|`. */
export function perfilDeContexto(contexto: string): string {
  const i = contexto.indexOf('|')
  return i === -1 ? contexto : contexto.slice(0, i)
}

/** Clave de un pane SSH (también su React key). SIN el modo del proyecto: no depende de él. */
export function sshPaneKey(perfilId: string, id: string): string {
  return `ssh|${perfilId}|${id}`
}

/** Las pestañas SSH de un perfil (la constante vacía si no tiene). */
export function sshDePerfil(s: SshTabsState, perfilId: string): readonly SshTab[] {
  return s.porPerfil[perfilId]?.lista ?? SIN_PESTANAS_SSH
}

/** El rótulo que lleva delante el explorador SFTP. */
export const PREFIJO_SFTP = 'SFTP · '

/** ¿Es la pestaña del explorador SFTP y no una terminal SSH? */
export function esPestanaSftp(t: Pick<SshTab, 'sftp'>): boolean {
  return t.sftp === true
}

/** El hueco de rótulo más bajo que no ocupe otra pestaña de la misma conexión y la misma clase (SSH o SFTP). */
function indiceLibre(lista: readonly SshTab[], conexionId: string, sftp: boolean): number {
  const usados = new Set(lista.filter((t) => t.conexionId === conexionId && esPestanaSftp(t) === sftp).map((t) => t.indice))
  let i = 1
  while (usados.has(i)) i++
  return i
}

/** El nombre que le tocaría sin mirar el puesto a mano: el alias (con «SFTP · » delante en el explorador), con « (n)» desde la segunda de esa conexión. */
function nombreAutomatico(t: Pick<SshTab, 'aliasConocido' | 'indice' | 'sftp'>): string {
  const base = `${esPestanaSftp(t) ? PREFIJO_SFTP : ''}${t.aliasConocido}`
  return t.indice <= 1 ? base : `${base} (${t.indice})`
}

/** Nombre visible de una pestaña: el puesto a mano o, si no, el alias (con « (n)» si la conexión se repite). */
export function nombreSsh(t: SshTab): string {
  return t.nombre !== undefined && t.nombre !== '' ? t.nombre : nombreAutomatico(t)
}

/**
 * Abre una pestaña al final de la lista del perfil y la deja ELEGIDA en este contexto. Con `sftp` es el
 * explorador de archivos de la conexión: abrir dos veces la misma abre una segunda, como las SSH.
 */
export function abrirSsh(
  s: SshTabsState,
  contexto: string,
  perfilId: string,
  conexionId: string,
  alias: string,
  sftp = false
): SshTabsState {
  const cur = s.porPerfil[perfilId] ?? { lista: [], siguiente: 1 }
  const tab: SshTab = {
    id: `s${cur.siguiente}`,
    n: cur.siguiente,
    conexionId,
    indice: indiceLibre(cur.lista, conexionId, sftp),
    aliasConocido: alias.trim() === '' ? ALIAS_SSH_DESCONOCIDO : alias,
    ...(sftp ? { sftp: true as const } : {})
  }
  return {
    porPerfil: { ...s.porPerfil, [perfilId]: { lista: [...cur.lista, tab], siguiente: cur.siguiente + 1 } },
    activaPorContexto: { ...s.activaPorContexto, [contexto]: tab.id }
  }
}

/**
 * Cierra una pestaña. Su pane se desmontará y ESE desmontaje es el que cierra la sesión: aquí no hay
 * IPC. En cada contexto del perfil que la tenía elegida pasa a la de la DERECHA, si no a la de la
 * IZQUIERDA y, si no queda ninguna, se suelta la elección: se ve la terminal local activa.
 */
export function cerrarSsh(s: SshTabsState, perfilId: string, id: string): SshTabsState {
  const cur = s.porPerfil[perfilId]
  const i = cur ? cur.lista.findIndex((t) => t.id === id) : -1
  if (!cur || i === -1) return s
  const lista = cur.lista.filter((t) => t.id !== id)
  const sucesora = (lista[i] ?? lista[i - 1])?.id
  const activaPorContexto: Record<string, string> = {}
  for (const [contexto, elegida] of Object.entries(s.activaPorContexto)) {
    if (perfilDeContexto(contexto) !== perfilId || elegida !== id) activaPorContexto[contexto] = elegida
    else if (sucesora !== undefined) activaPorContexto[contexto] = sucesora
  }
  return { porPerfil: { ...s.porPerfil, [perfilId]: { ...cur, lista } }, activaPorContexto }
}

/** Elige la pestaña que se mira en este contexto (y deja de ser «restaurada»). Ignora ids que no existan en el perfil. */
export function elegirSsh(s: SshTabsState, perfilId: string, contexto: string, id: string): SshTabsState {
  const tab = sshDePerfil(s, perfilId).find((t) => t.id === id)
  if (!tab || (s.activaPorContexto[contexto] === id && tab.restaurada === undefined)) return s
  const cur = s.porPerfil[perfilId]
  const porPerfil =
    tab.restaurada === undefined
      ? s.porPerfil
      : { ...s.porPerfil, [perfilId]: { ...cur, lista: cur.lista.map((t) => (t.id === id ? sinRestaurada(t) : t)) } }
  return { porPerfil, activaPorContexto: { ...s.activaPorContexto, [contexto]: id } }
}

/** La pestaña sin la marca de restaurada. */
function sinRestaurada(t: SshTab): SshTab {
  const { restaurada: _restaurada, ...resto } = t
  return resto
}

/** Suelta la elección de este contexto (al elegir una terminal local): vuelve a verse la local activa. */
export function soltarSsh(s: SshTabsState, contexto: string): SshTabsState {
  if (!(contexto in s.activaPorContexto)) return s
  const activaPorContexto = { ...s.activaPorContexto }
  delete activaPorContexto[contexto]
  return { ...s, activaPorContexto }
}

/**
 * Renombra una pestaña. Un nombre en blanco, o igual al automático, la devuelve a su nombre
 * automático en vez de guardar el texto: si se guardara, no seguiría al alias cuando éste cambie.
 */
export function renombrarSsh(s: SshTabsState, perfilId: string, id: string, nombre: string): SshTabsState {
  const cur = s.porPerfil[perfilId]
  const tab = cur?.lista.find((t) => t.id === id)
  if (!cur || !tab) return s
  const limpio = nombre.trim()
  const siguiente = limpio === '' || limpio === nombreAutomatico(tab) ? undefined : limpio
  if (tab.nombre === siguiente) return s
  const lista = cur.lista.map((t) => (t.id === id ? { ...t, nombre: siguiente } : t))
  return { ...s, porPerfil: { ...s.porPerfil, [perfilId]: { ...cur, lista } } }
}

/**
 * Pone al día el alias de las pestañas cuya conexión cambió de nombre (`aliasPorConexion`: id -> alias
 * vigente). Las de una conexión que ya no está conservan el último alias que se supo. Devuelve el
 * MISMO objeto si nada cambia (se llama en cada recarga de las conexiones).
 */
export function actualizarAliasSsh(s: SshTabsState, aliasPorConexion: ReadonlyMap<string, string>): SshTabsState {
  let cambio = false
  const porPerfil: Record<string, SshTabsPerfil> = {}
  for (const [perfil, cur] of Object.entries(s.porPerfil)) {
    const lista = cur.lista.map((t) => {
      const alias = aliasPorConexion.get(t.conexionId)
      if (alias === undefined || alias === t.aliasConocido) return t
      cambio = true
      return { ...t, aliasConocido: alias }
    })
    porPerfil[perfil] = lista.some((t, i) => t !== cur.lista[i]) ? { ...cur, lista } : cur
  }
  return cambio ? { ...s, porPerfil } : s
}

/**
 * Olvida los perfiles que ya no existen (cerraste el perfil): sus panes ya se desmontaron y con
 * ellos murieron sus sesiones. Una lista vacía es «ya no queda ningún perfil»: distinguirla de
 * «aún no han cargado» es de quien llama, que es quien sabe si la carga terminó. Devuelve el MISMO
 * objeto si no sobra nada.
 */
export function podarSsh(s: SshTabsState, perfilesVivos: Iterable<string>): SshTabsState {
  const vivos = new Set(perfilesVivos)
  const sobraPerfil = Object.keys(s.porPerfil).some((p) => !vivos.has(p))
  const sobraContexto = Object.keys(s.activaPorContexto).some((c) => !vivos.has(perfilDeContexto(c)))
  if (!sobraPerfil && !sobraContexto) return s
  const porPerfil: Record<string, SshTabsPerfil> = {}
  for (const [p, cur] of Object.entries(s.porPerfil)) if (vivos.has(p)) porPerfil[p] = cur
  const activaPorContexto: Record<string, string> = {}
  for (const [c, id] of Object.entries(s.activaPorContexto)) {
    if (vivos.has(perfilDeContexto(c))) activaPorContexto[c] = id
  }
  return { porPerfil, activaPorContexto }
}

/**
 * Los contextos que existen: el de cada proyecto abierto (su clave de proyecto) y el de «ningún
 * proyecto» de cada perfil vivo.
 */
export function contextosVivosSsh(proyectosAbiertos: Iterable<string>, perfilesVivos: Iterable<string>): string[] {
  return [...proyectosAbiertos, ...[...perfilesVivos].map((perfilId) => contextoSsh(perfilId, null))]
}

/**
 * Olvida cuál pestaña se miraba en los contextos que ya no existen: al cerrar un proyecto sus
 * terminales locales se olvidan, y la SSH que se miraba en él no debe tapar la local nueva cuando se
 * reabra, ni el mapa crecer con cada proyecto que pasó por aquí. No toca las pestañas: son del
 * perfil. Devuelve el MISMO objeto si no sobra nada.
 */
export function podarContextosSsh(s: SshTabsState, contextosVivos: Iterable<string>): SshTabsState {
  const vivos = new Set(contextosVivos)
  const contextos = Object.keys(s.activaPorContexto)
  if (contextos.every((c) => vivos.has(c))) return s
  const activaPorContexto: Record<string, string> = {}
  for (const c of contextos) if (vivos.has(c)) activaPorContexto[c] = s.activaPorContexto[c]
  return { ...s, activaPorContexto }
}

/**
 * Las pestañas que se guardan para el siguiente arranque: las de cada perfil, en su orden, con su nombre a
 * mano y el alias que se les conoce. Con `existe`, sin las de una conexión que ya no está (no tendría nada que
 * reabrir). Un perfil sin ninguna no ocupa entrada.
 */
export function pestanasAGuardar(s: SshTabsState, existe?: (conexionId: string) => boolean): SshPestanasPorPerfil {
  const out: SshPestanasPorPerfil = {}
  for (const [perfil, cur] of Object.entries(s.porPerfil)) {
    const lista = cur.lista
      .filter((t) => existe === undefined || existe(t.conexionId))
      .map((t): SshPestanaGuardada => ({
        conexionId: t.conexionId,
        alias: t.aliasConocido,
        ...(t.nombre !== undefined ? { nombre: t.nombre } : {}),
        ...(esPestanaSftp(t) ? { sftp: true as const } : {})
      }))
    if (lista.length > 0) out[perfil] = lista
  }
  return out
}

/**
 * Vuelve a poner las pestañas guardadas de los perfiles que aún no tienen ninguna, SIN elegir ninguna: un pane
 * sin elegir no se ve y no abre su sesión, así que nada se conecta hasta que se mira. Un perfil que ya tiene
 * pestañas (se abrió alguna antes de leer lo guardado) se deja como está. Devuelve el MISMO objeto si no cambia.
 */
export function restaurarSsh(s: SshTabsState, guardadas: SshPestanasPorPerfil): SshTabsState {
  let porPerfil: Record<string, SshTabsPerfil> | null = null
  for (const [perfil, lista] of Object.entries(guardadas)) {
    if (lista.length === 0 || (s.porPerfil[perfil]?.lista.length ?? 0) > 0) continue
    // Los ids siguen al último que repartió el perfil: un id no se reutiliza jamás.
    const desde = s.porPerfil[perfil]?.siguiente ?? 1
    const tabs: SshTab[] = []
    for (const g of lista) {
      const n = desde + tabs.length
      const sftp = g.sftp === true
      tabs.push({
        id: `s${n}`,
        n,
        conexionId: g.conexionId,
        indice: indiceLibre(tabs, g.conexionId, sftp),
        aliasConocido: g.alias.trim() === '' ? ALIAS_SSH_DESCONOCIDO : g.alias,
        ...(g.nombre !== undefined ? { nombre: g.nombre } : {}),
        ...(sftp ? { sftp: true as const } : {}),
        restaurada: true
      })
    }
    porPerfil = { ...(porPerfil ?? s.porPerfil), [perfil]: { lista: tabs, siguiente: desde + tabs.length } }
  }
  return porPerfil === null ? s : { ...s, porPerfil }
}

/**
 * Cuántas SESIONES SSH (terminales) abiertas tiene cada conexión de un perfil (id -> n): lo que enseña la
 * lista de conexiones. El explorador SFTP no cuenta: no es una sesión a la que «ir» con la terminal.
 */
export function abiertasPorConexion(lista: readonly SshTab[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of lista) if (!esPestanaSftp(t)) out[t.conexionId] = (out[t.conexionId] ?? 0) + 1
  return out
}
