// =============================================================================
// Ajustes de la terminal que se persisten: qué grupos de conexiones SSH tiene plegados cada perfil,
// el riel de conexiones a pantalla completa (su ancho, global, y si se ve, por perfil), lo que
// recuerda el lanzador de conexiones por perfil (las últimas conexiones abiertas) y si se ve el
// agente de la terminal, con su saneado y su valor por defecto. Puro y ES2020:
// lo leen `workspace-state-ipc.ts`, el main y el renderer, y los tres tienen que llegar al mismo valor. Sin imports.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/terminales/riel-de-conexiones.md,
// docs/decisiones/terminales/lanzador-de-conexiones.md, docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

/**
 * El id con el que el mapa de plegados nombra a «Sin grupo», que no tiene id propio: las
 * conexiones sin grupo se pliegan como un grupo más.
 */
export const SSH_PLEGADO_SIN_GRUPO = ''

/** Tope de ids plegados que se conservan por perfil: un archivo con más es un archivo raro. */
const SSH_PLEGADOS_MAX = 500

/** Un id de grupo del registro SSH (`[A-Za-z0-9_-]`) o `''` (Sin grupo). */
const ID_PLEGADO = /^[A-Za-z0-9_-]{0,128}$/

/** Lo que se guarda: perfil -> ids de los grupos plegados (`''` = «Sin grupo»). */
export type SshGruposPlegadosPorPerfil = Record<string, string[]>

/** Sin ningún grupo plegado: es lo que ve quien nunca plegó nada. */
export const SSH_GRUPOS_PLEGADOS_POR_DEFECTO: SshGruposPlegadosPorPerfil = {}

/**
 * El mapa de grupos plegados SANEADO. Se descarta la ENTRADA mala y nunca el mapa entero: está
 * indexado por perfil, y tirarlo por la clave de uno desplegaría los grupos de todos. Un perfil
 * sin ningún plegado no ocupa entrada, y los ids se guardan sin repetir y en el orden en que
 * llegan.
 */
export function normalizarGruposPlegados(raw: unknown): SshGruposPlegadosPorPerfil {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: SshGruposPlegadosPorPerfil = {}
  for (const [perfil, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (perfil.length === 0 || !Array.isArray(ids)) continue
    const limpios: string[] = []
    for (const id of ids) {
      if (typeof id !== 'string' || !ID_PLEGADO.test(id) || limpios.includes(id)) continue
      if (limpios.length >= SSH_PLEGADOS_MAX) break
      limpios.push(id)
    }
    if (limpios.length > 0) out[perfil] = limpios
  }
  return out
}

/**
 * Pliega o despliega un grupo de un perfil devolviendo el mapa nuevo, o el MISMO objeto si no hay
 * nada que cambiar (identidad estable: no repinta ni dispara un guardado).
 */
export function conPlegado(
  mapa: SshGruposPlegadosPorPerfil,
  perfilId: string,
  grupoId: string,
  plegado: boolean
): SshGruposPlegadosPorPerfil {
  const actuales = mapa[perfilId] ?? []
  if (actuales.includes(grupoId) === plegado) return mapa
  const siguientes = plegado ? [...actuales, grupoId] : actuales.filter((id) => id !== grupoId)
  const out = { ...mapa }
  if (siguientes.length === 0) delete out[perfilId]
  else out[perfilId] = siguientes
  return out
}

/**
 * Olvida los perfiles que ya no existen de un mapa indexado por perfil. Con una lista vacía devuelve
 * el mapa tal cual: sin perfiles cargados todavía no se sabe cuáles sobran. Devuelve el MISMO objeto
 * si no sobra nada.
 */
export function podarMapaPorPerfil<V>(mapa: Record<string, V>, perfilesVivos: Iterable<string>): Record<string, V> {
  const vivos = new Set(perfilesVivos)
  if (vivos.size === 0) return mapa
  const claves = Object.keys(mapa)
  if (claves.every((k) => vivos.has(k))) return mapa
  const out: Record<string, V> = {}
  for (const k of claves) if (vivos.has(k)) out[k] = mapa[k]
  return out
}

// --- El riel de conexiones a pantalla completa ---------------------------------------------

/**
 * Ancho del riel: por defecto, mínimo y máximo (px). Son los del lateral de la app
 * (`DEFAULT_SIDEBAR_WIDTH`, `SIDEBAR_WIDTH_MIN` y `SIDEBAR_WIDTH_MAX` de `workspace-state-ipc.ts`, que
 * importa este módulo y por eso no puede ser al revés): `test-workspace-snapshot.mts` fija que no se separen.
 */
export const SSH_RIEL_ANCHO_POR_DEFECTO = 260
export const SSH_RIEL_ANCHO_MIN = 180
export const SSH_RIEL_ANCHO_MAX = 480

/** Lo que se guarda: perfil -> el riel se ve a pantalla completa. Sin entrada = se ve. */
export type SshRielVisiblePorPerfil = Record<string, boolean>

/**
 * El ancho del riel SANEADO: un número finito se redondea y se acota al rango; cualquier otra cosa
 * (texto, `null`, `NaN`, infinito) vuelve al ancho por defecto.
 */
export function normalizarAnchoRiel(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return SSH_RIEL_ANCHO_POR_DEFECTO
  return Math.min(SSH_RIEL_ANCHO_MAX, Math.max(SSH_RIEL_ANCHO_MIN, Math.round(raw)))
}

/**
 * El mapa de visibilidad del riel SANEADO. Como el de grupos plegados, se descarta la ENTRADA mala y
 * nunca el mapa entero: está indexado por perfil, y tirarlo por la clave de uno cambiaría el riel de todos.
 */
export function normalizarRielVisiblePorPerfil(raw: unknown): SshRielVisiblePorPerfil {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: SshRielVisiblePorPerfil = {}
  for (const [perfil, visible] of Object.entries(raw as Record<string, unknown>)) {
    if (perfil.length > 0 && typeof visible === 'boolean') out[perfil] = visible
  }
  return out
}

/**
 * Muestra u oculta el riel de un perfil devolviendo el mapa nuevo, o el MISMO objeto si ya estaba así
 * (identidad estable: no repinta ni dispara un guardado). Verse es lo de por defecto, así que mostrarlo
 * borra la entrada en vez de guardar un `true`.
 */
export function conRielVisible(mapa: SshRielVisiblePorPerfil, perfilId: string, visible: boolean): SshRielVisiblePorPerfil {
  if ((mapa[perfilId] !== false) === visible) return mapa
  const out = { ...mapa }
  if (visible) delete out[perfilId]
  else out[perfilId] = false
  return out
}

// --- El lanzador de conexiones SSH ---------------------------------------------------------

/** Cuántas conexiones recientes se recuerdan, y se enseñan, por perfil. */
export const SSH_RECIENTES_MAX = 3

/**
 * Un id de conexión del registro SSH (`[A-Za-z0-9_-]`, no vacío). Es la ÚNICA expresión: el registro
 * del main la reexporta como `ID_SEGURO` (también nombra archivos, `ssh/huellas/<id>`).
 */
export const ID_CONEXION = /^[A-Za-z0-9_-]{1,128}$/

/** Lo que se guarda: perfil -> ids de sus últimas conexiones abiertas desde Tessera, la más reciente primero. */
export type SshRecientesPorPerfil = Record<string, string[]>

/**
 * El mapa de conexiones recientes SANEADO: se descarta la ENTRADA mala y nunca el mapa entero, los ids se
 * guardan sin repetir y en el orden en que llegan, y no pasan de `SSH_RECIENTES_MAX`. Un perfil sin
 * ninguna no ocupa entrada.
 */
export function normalizarRecientesPorPerfil(raw: unknown): SshRecientesPorPerfil {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: SshRecientesPorPerfil = {}
  for (const [perfil, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (perfil.length === 0 || !Array.isArray(ids)) continue
    const limpios: string[] = []
    for (const id of ids) {
      if (typeof id !== 'string' || !ID_CONEXION.test(id) || limpios.includes(id)) continue
      if (limpios.length >= SSH_RECIENTES_MAX) break
      limpios.push(id)
    }
    if (limpios.length > 0) out[perfil] = limpios
  }
  return out
}

/**
 * Pone una conexión la primera de las recientes de un perfil (sin repetirla y sin pasar de
 * `SSH_RECIENTES_MAX`) devolviendo el mapa nuevo, o el MISMO objeto si ya era la primera.
 */
export function conReciente(mapa: SshRecientesPorPerfil, perfilId: string, conexionId: string): SshRecientesPorPerfil {
  const actuales = mapa[perfilId] ?? []
  if (actuales[0] === conexionId) return mapa
  return { ...mapa, [perfilId]: [conexionId, ...actuales.filter((id) => id !== conexionId)].slice(0, SSH_RECIENTES_MAX) }
}

/**
 * Olvida de las recientes las conexiones que ya no existen (`vivas`), y la entrada de un perfil que se
 * queda sin ninguna. Devuelve el MISMO objeto si no sobra nada.
 */
export function podarRecientes(mapa: SshRecientesPorPerfil, vivas: ReadonlySet<string>): SshRecientesPorPerfil {
  let cambio = false
  const out: SshRecientesPorPerfil = {}
  for (const [perfil, ids] of Object.entries(mapa)) {
    const quedan = ids.filter((id) => vivas.has(id))
    if (quedan.length !== ids.length) cambio = true
    if (quedan.length > 0) out[perfil] = quedan
  }
  return cambio ? out : mapa
}

// --- El agente de la terminal --------------------------------------------------------------

/** Lo que se guarda: perfil -> el usuario quiere ver el agente de la terminal a pantalla completa. Sin entrada = oculto. */
export type AgenteTerminalVisiblePorPerfil = Record<string, boolean>

/**
 * El mapa de visibilidad del agente de la terminal SANEADO. Como los demás mapas por perfil, se descarta la
 * ENTRADA mala y nunca el mapa entero. Oculto es lo de por defecto, así que solo se conservan los `true`.
 */
export function normalizarAgenteTerminalVisible(raw: unknown): AgenteTerminalVisiblePorPerfil {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: AgenteTerminalVisiblePorPerfil = {}
  for (const [perfil, visible] of Object.entries(raw as Record<string, unknown>)) {
    if (perfil.length > 0 && visible === true) out[perfil] = true
  }
  return out
}

/**
 * Muestra u oculta el agente de la terminal de un perfil devolviendo el mapa nuevo, o el MISMO objeto si ya
 * estaba así (identidad estable: no repinta ni dispara un guardado). Ocultarlo borra la entrada.
 */
export function conAgenteTerminalVisible(
  mapa: AgenteTerminalVisiblePorPerfil,
  perfilId: string,
  visible: boolean
): AgenteTerminalVisiblePorPerfil {
  if ((mapa[perfilId] === true) === visible) return mapa
  const out = { ...mapa }
  if (visible) out[perfilId] = true
  else delete out[perfilId]
  return out
}
