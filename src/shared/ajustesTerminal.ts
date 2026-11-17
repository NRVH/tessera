// =============================================================================
// Ajustes de la terminal que se persisten: qué grupos de conexiones SSH tiene plegados cada perfil,
// el riel de conexiones a pantalla completa (su ancho, global) y si se ve el
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

/**
 * El mapa de grupos plegados SANEADO. Se descarta la ENTRADA mala y nunca el mapa entero: está
 * indexado por perfil, y tirarlo por la clave de uno desplegaría los grupos de todos. Un perfil
 * sin ningún plegado no ocupa entrada, y los ids se guardan sin repetir y en el orden en que
 * llegan.
 */
export function normalizarGruposPlegados(crudo: unknown): SshGruposPlegadosPorPerfil {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return {}
  const salida: SshGruposPlegadosPorPerfil = {}
  for (const [perfil, ids] of Object.entries(crudo as Record<string, unknown>)) {
    if (perfil.length === 0 || !Array.isArray(ids)) continue
    const limpios: string[] = []
    for (const id of ids) {
      if (typeof id !== 'string' || !ID_PLEGADO.test(id) || limpios.includes(id)) continue
      if (limpios.length >= SSH_PLEGADOS_MAX) break
      limpios.push(id)
    }
    if (limpios.length > 0) salida[perfil] = limpios
  }
  return salida
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
  const salida = { ...mapa }
  if (siguientes.length === 0) delete salida[perfilId]
  else salida[perfilId] = siguientes
  return salida
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
  const salida: Record<string, V> = {}
  for (const k of claves) if (vivos.has(k)) salida[k] = mapa[k]
  return salida
}

// --- El riel de conexiones a pantalla completa ---------------------------------------------

/**
 * Ancho del riel: por defecto, mínimo y máximo (px). Son los del lateral de la app
 * (`ANCHO_LATERAL_DEFECTO`, `ANCHO_LATERAL_MIN` y `ANCHO_LATERAL_MAX` de `workspace-state-ipc.ts`, que
 * importa este módulo y por eso no puede ser al revés): `test-foto-workspace.mts` fija que no se separen.
 */
export const SSH_RIEL_ANCHO_POR_DEFECTO = 260
export const SSH_RIEL_ANCHO_MIN = 180
export const SSH_RIEL_ANCHO_MAX = 480

/**
 * El ancho del riel SANEADO: un número finito se redondea y se acota al rango; cualquier otra cosa
 * (texto, `null`, `NaN`, infinito) vuelve al ancho por defecto.
 */
export function normalizarAnchoRiel(crudo: unknown): number {
  if (typeof crudo !== 'number' || !Number.isFinite(crudo)) return SSH_RIEL_ANCHO_POR_DEFECTO
  return Math.min(SSH_RIEL_ANCHO_MAX, Math.max(SSH_RIEL_ANCHO_MIN, Math.round(crudo)))
}

// --- Conexiones SSH ------------------------------------------------------------------------

/**
 * Un id de conexión del registro SSH (`[A-Za-z0-9_-]`, no vacío). Es la ÚNICA expresión: el registro
 * del main la reexporta como `ID_SEGURO` (también nombra archivos, `ssh/huellas/<id>`).
 */
export const ID_CONEXION = /^[A-Za-z0-9_-]{1,128}$/

// --- Las pestañas SSH abiertas, para el siguiente arranque --------------------------------------

/** Tope de pestañas SSH que se recuerdan por perfil: más no las abre nadie a mano. */
export const SSH_PESTANAS_MAX = 30

/** Tope del nombre puesto a mano y del alias que se recuerdan de una pestaña. */
const SSH_NOMBRE_PESTANA_MAX = 200

/** Una pestaña SSH (o del explorador SFTP) abierta: su conexión, su nombre a mano y el alias que se le conocía. */
export interface SshPestanaGuardada {
  conexionId: string
  /** El alias de la conexión al cerrar, para rotularla antes de que llegue la lista de conexiones. */
  alias: string
  nombre?: string
  sftp?: true
}

/** Lo que se guarda: perfil -> sus pestañas SSH abiertas, en su orden. */
export type SshPestanasPorPerfil = Record<string, SshPestanaGuardada[]>

/** Una pestaña guardada saneada, o `null` si no tiene la forma. */
function pestanaGuardada(crudo: unknown): SshPestanaGuardada | null {
  if (typeof crudo !== 'object' || crudo === null) return null
  const p = crudo as Record<string, unknown>
  if (typeof p.conexionId !== 'string' || !ID_CONEXION.test(p.conexionId) || typeof p.alias !== 'string') return null
  const salida: SshPestanaGuardada = { conexionId: p.conexionId, alias: p.alias.slice(0, SSH_NOMBRE_PESTANA_MAX) }
  if (typeof p.nombre === 'string' && p.nombre.trim() !== '') salida.nombre = p.nombre.slice(0, SSH_NOMBRE_PESTANA_MAX)
  if (p.sftp === true) salida.sftp = true
  return salida
}

/**
 * Las pestañas SSH guardadas SANEADAS: se descarta la entrada mala y nunca el mapa entero, con tope por
 * perfil. Un perfil sin ninguna no ocupa entrada.
 */
export function normalizarPestanasSshPorPerfil(crudo: unknown): SshPestanasPorPerfil {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return {}
  const salida: SshPestanasPorPerfil = {}
  for (const [perfil, lista] of Object.entries(crudo as Record<string, unknown>)) {
    if (perfil.length === 0 || !Array.isArray(lista)) continue
    const limpias = lista.map(pestanaGuardada).filter((p): p is SshPestanaGuardada => p !== null).slice(0, SSH_PESTANAS_MAX)
    if (limpias.length > 0) salida[perfil] = limpias
  }
  return salida
}

// --- El agente de la terminal --------------------------------------------------------------

/** Lo que se guarda: perfil -> el usuario quiere ver el agente de la terminal a pantalla completa. Sin entrada = oculto. */
export type AgenteTerminalVisiblePorPerfil = Record<string, boolean>

/**
 * El mapa de visibilidad del agente de la terminal SANEADO. Como los demás mapas por perfil, se descarta la
 * ENTRADA mala y nunca el mapa entero. Oculto es lo de por defecto, así que solo se conservan los `true`.
 */
export function normalizarAgenteTerminalVisible(crudo: unknown): AgenteTerminalVisiblePorPerfil {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return {}
  const salida: AgenteTerminalVisiblePorPerfil = {}
  for (const [perfil, visible] of Object.entries(crudo as Record<string, unknown>)) {
    if (perfil.length > 0 && visible === true) salida[perfil] = true
  }
  return salida
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
  const salida = { ...mapa }
  if (visible) salida[perfilId] = true
  else delete salida[perfilId]
  return salida
}
