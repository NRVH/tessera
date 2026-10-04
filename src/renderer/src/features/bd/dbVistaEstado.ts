// =============================================================================
// dbVistaEstado: estado EN MEMORIA de la vista de bases de datos, por perfil. Pieza
// PURA bajo `useDbVista`: pestañas abiertas, nodos expandidos del árbol, fila
// seleccionada y la petición de «Mostrar en el árbol», con las podas al borrar un
// perfil, una conexión o una consola. Su test es `test-db-vista-estado.mts`.
// Decisiones: docs/decisiones/bd/ui-area-estado-de-la-vista.md
// =============================================================================

import { ancestrosDe, claveDePane, conexionDeClave, consolaDeClave } from './arbolBd.ts'
import {
  ESTADO_PESTANAS_INICIAL,
  abrirPestana,
  activarPestana,
  cerrarVarias,
  filtrarPestanas,
  moverPestana,
  paneKeyDb,
  type DbPane,
  type DbTab,
  type DbTabsState
} from './dbTabsModel.ts'

export interface RevelarBd {
  /** Clave de la fila a la que hay que llevar la lista. */
  clave: string
  /** Crece en cada petición, aunque la clave se repita. */
  token: number
}

export interface DbVistaPerfil {
  pestanas: DbTabsState
  expandidos: ReadonlySet<string>
  /** Clave de la fila seleccionada en el árbol. */
  seleccion: string | null
  revelar: RevelarBd | null
}

export type DbVistaMapa = ReadonlyMap<string, DbVistaPerfil>

const SIN_EXPANDIDOS: ReadonlySet<string> = new Set<string>()

export const VISTA_PERFIL_VACIA: DbVistaPerfil = {
  pestanas: ESTADO_PESTANAS_INICIAL,
  expandidos: SIN_EXPANDIDOS,
  seleccion: null,
  revelar: null
}

export const MAPA_VISTA_VACIO: DbVistaMapa = new Map<string, DbVistaPerfil>()

function estaVacia(v: DbVistaPerfil): boolean {
  return v.pestanas.tabs.length === 0 && v.expandidos.size === 0 && v.seleccion === null && v.revelar === null
}

// --- Mapa por perfil --------------------------------------------------------------

export function vistaDe(m: DbVistaMapa, perfilId: string): DbVistaPerfil {
  return m.get(perfilId) ?? VISTA_PERFIL_VACIA
}

/**
 * Aplica `f` a la vista de un perfil. Si `f` no cambia nada, devuelve el mismo
 * mapa; si la deja vacía, la entrada se borra (no se acumulan perfiles vacíos).
 */
export function actualizarPerfil(
  m: DbVistaMapa,
  perfilId: string,
  f: (v: DbVistaPerfil) => DbVistaPerfil
): DbVistaMapa {
  const previa = vistaDe(m, perfilId)
  const nueva = f(previa)
  if (nueva === previa) return m
  const out = new Map(m)
  if (estaVacia(nueva)) {
    if (!m.has(perfilId)) return m
    out.delete(perfilId)
  } else {
    out.set(perfilId, nueva)
  }
  return out
}

/** Todas las pestañas de todos los perfiles, para el keep-alive del área. */
export function todasLasPestanas(m: DbVistaMapa): Array<{ perfilId: string; tab: DbTab; paneKey: string }> {
  const out: Array<{ perfilId: string; tab: DbTab; paneKey: string }> = []
  for (const [perfilId, v] of m) {
    for (const tab of v.pestanas.tabs) out.push({ perfilId, tab, paneKey: paneKeyDb(perfilId, tab.id) })
  }
  return out
}

// --- Operaciones sobre la vista de un perfil -----------------------------------------

function conPestanas(v: DbVistaPerfil, pestanas: DbTabsState): DbVistaPerfil {
  return pestanas === v.pestanas ? v : { ...v, pestanas }
}

export function abrirEnVista(v: DbVistaPerfil, pane: DbPane): DbVistaPerfil {
  return conPestanas(v, abrirPestana(v.pestanas, pane))
}

export function activarEnVista(v: DbVistaPerfil, id: string): DbVistaPerfil {
  return conPestanas(v, activarPestana(v.pestanas, id))
}

export function cerrarEnVista(v: DbVistaPerfil, ids: readonly string[]): DbVistaPerfil {
  return conPestanas(v, cerrarVarias(v.pestanas, ids))
}

/** Arrastre de la tira: `id` pasa a quedar antes de `antesDe` (null = al final). */
export function moverEnVista(v: DbVistaPerfil, id: string, antesDe: string | null): DbVistaPerfil {
  return conPestanas(v, moverPestana(v.pestanas, id, antesDe))
}

/** Alterna (o fija, con `abierto`) un nodo del árbol. */
export function alternarExpandido(v: DbVistaPerfil, clave: string, abierto?: boolean): DbVistaPerfil {
  const esta = v.expandidos.has(clave)
  const quiere = abierto === undefined ? !esta : abierto
  if (quiere === esta) return v
  const expandidos = new Set(v.expandidos)
  if (quiere) expandidos.add(clave)
  else expandidos.delete(clave)
  return { ...v, expandidos }
}

export function plegarTodo(v: DbVistaPerfil): DbVistaPerfil {
  return v.expandidos.size === 0 ? v : { ...v, expandidos: SIN_EXPANDIDOS }
}

export function fijarSeleccion(v: DbVistaPerfil, clave: string | null): DbVistaPerfil {
  return v.seleccion === clave ? v : { ...v, seleccion: clave }
}

/**
 * «Mostrar en el árbol»: expande la cadena de antepasados de la pestaña, selecciona
 * su fila y pide a la lista que la lleve a la vista.
 */
export function revelarPane(v: DbVistaPerfil, pane: DbPane): DbVistaPerfil {
  const clave = claveDePane(pane)
  const expandidos = new Set(v.expandidos)
  for (const k of ancestrosDe(pane)) expandidos.add(k)
  return {
    ...v,
    expandidos: expandidos.size === v.expandidos.size ? v.expandidos : expandidos,
    seleccion: clave,
    revelar: { clave, token: (v.revelar?.token ?? 0) + 1 }
  }
}

// --- Podas ------------------------------------------------------------------------

/** Quita los perfiles que ya no existen. */
export function podarPerfiles(m: DbVistaMapa, vivos: ReadonlySet<string> | readonly string[]): DbVistaMapa {
  const set = new Set<string>(vivos)
  const muertos: string[] = []
  for (const perfilId of m.keys()) if (!set.has(perfilId)) muertos.push(perfilId)
  if (muertos.length === 0) return m
  const out = new Map(m)
  for (const perfilId of muertos) out.delete(perfilId)
  return out
}

/** Quita de UNA vista todo lo que no cumple `vivaConexion` (pestañas, claves, selección). */
function podarVistaPorConexion(v: DbVistaPerfil, vivaConexion: (conexionId: string) => boolean): DbVistaPerfil {
  const pestanas = filtrarPestanas(v.pestanas, (p) => vivaConexion(p.conexionId))
  const claveViva = (k: string): boolean => {
    const c = conexionDeClave(k)
    return c === null || vivaConexion(c)
  }
  let expandidos = v.expandidos
  const fuera: string[] = []
  for (const k of v.expandidos) if (!claveViva(k)) fuera.push(k)
  if (fuera.length > 0) {
    const nuevo = new Set(v.expandidos)
    for (const k of fuera) nuevo.delete(k)
    expandidos = nuevo
  }
  const seleccion = v.seleccion !== null && !claveViva(v.seleccion) ? null : v.seleccion
  const revelar = v.revelar !== null && !claveViva(v.revelar.clave) ? null : v.revelar
  if (pestanas === v.pestanas && expandidos === v.expandidos && seleccion === v.seleccion && revelar === v.revelar) {
    return v
  }
  return { pestanas, expandidos, seleccion, revelar }
}

function podarCadaPerfil(
  m: DbVistaMapa,
  f: (v: DbVistaPerfil, perfilId: string) => DbVistaPerfil
): DbVistaMapa {
  let out: DbVistaMapa = m
  for (const perfilId of m.keys()) out = actualizarPerfil(out, perfilId, (v) => f(v, perfilId))
  return out
}

/**
 * Una conexión se borró en UN perfil: fuera de ese perfil sus pestañas, claves y selección.
 * Solo de ese: la misma copia pegada en dos perfiles comparte id, y
 * borrar la de p2 no puede cerrarle a p1 las pestañas de su original. En el caso normal da lo
 * mismo que podar en todos, porque una conexión es de un solo perfil. Los demás perfiles, si
 * algo suyo sobrara, lo quita `podarConexiones` con sus listas vivas.
 */
export function podarConexion(m: DbVistaMapa, conexionId: string, perfilId: string): DbVistaMapa {
  if (!m.has(perfilId)) return m
  return actualizarPerfil(m, perfilId, (v) => podarVistaPorConexion(v, (c) => c !== conexionId))
}

/**
 * Deja en cada perfil del mapa `vivasPorPerfil` solo sus conexiones vivas. Los
 * perfiles que no vienen en el mapa no se tocan.
 */
export function podarConexiones(m: DbVistaMapa, vivasPorPerfil: ReadonlyMap<string, readonly string[]>): DbVistaMapa {
  return podarCadaPerfil(m, (v, perfilId) => {
    const vivas = vivasPorPerfil.get(perfilId)
    if (vivas === undefined) return v
    const set = new Set(vivas)
    return podarVistaPorConexion(v, (c) => set.has(c))
  })
}

/** Quita de un perfil las pestañas (y la selección) de consolas que ya no existen. */
export function podarConsolas(m: DbVistaMapa, perfilId: string, vivas: readonly string[]): DbVistaMapa {
  if (!m.has(perfilId)) return m
  const set = new Set(vivas)
  const viva = (clave: string): boolean => {
    const id = consolaDeClave(clave)
    return id === null || set.has(id)
  }
  return actualizarPerfil(m, perfilId, (v) => {
    const pestanas = filtrarPestanas(v.pestanas, (p) => p.kind !== 'consola' || set.has(p.consolaId))
    const seleccion = v.seleccion !== null && !viva(v.seleccion) ? null : v.seleccion
    const revelar = v.revelar !== null && !viva(v.revelar.clave) ? null : v.revelar
    if (pestanas === v.pestanas && seleccion === v.seleccion && revelar === v.revelar) return v
    return { ...v, pestanas, seleccion, revelar }
  })
}
