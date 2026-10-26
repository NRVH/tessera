// =============================================================================
// Selección múltiple y arrastre del riel de conexiones SSH, en lógica pura: qué queda marcado tras
// un clic (Ctrl o ⌘ alterna, Mayús hace un rango) o una tecla, a qué grupo va lo que se suelta sobre
// una fila, qué conexiones cambian de verdad y los textos de borrar varias. Solo se marcan
// conexiones: un clic en un grupo lo sigue plegando. Sin React ni DOM: se fija bajo `node`
// (`test-seleccion-lista-ssh.mts`). Molde: la selección múltiple del explorador.
// Decisiones: docs/decisiones/terminales/riel-de-conexiones.md
// =============================================================================

import type { SshConexion } from '../../../../shared/ssh-ipc.ts'
import { ID_SIN_GRUPO, cabeceraDe, type FilaLista } from './listaSsh.ts'
import { txSsh } from './textos.ts'

/** Las conexiones marcadas (por id) y dónde empieza un rango de Mayús. */
export interface SeleccionSsh {
  ids: ReadonlySet<string>
  /** La mueven el clic normal y el Ctrl/⌘+clic; Mayús no, para poder ampliar y reducir el mismo rango. */
  ancla: string | null
}

export const SELECCION_SSH_VACIA: SeleccionSsh = { ids: new Set(), ancla: null }

/** Los modificadores de un clic: `mod` es Ctrl en Windows y ⌘ en Mac. */
export interface ModificadoresClicSsh {
  mod: boolean
  shift: boolean
}

/** Las conexiones que se ven, en su orden: las únicas que se pueden marcar. */
export function idsVisibles(filas: readonly FilaLista[]): string[] {
  const ids: string[] = []
  for (const f of filas) if (f.tipo === 'conexion') ids.push(f.conexion.id)
  return ids
}

/** Las ids entre `desde` y `hasta`, las dos incluidas y en cualquier dirección; `null` si alguna no se ve. */
function rango(visibles: readonly string[], desde: string | null, hasta: string): string[] | null {
  if (desde === null) return null
  const a = visibles.indexOf(desde)
  const b = visibles.indexOf(hasta)
  if (a < 0 || b < 0) return null
  return a <= b ? visibles.slice(a, b + 1) : visibles.slice(b, a + 1)
}

/**
 * La selección tras un clic en la conexión `id`:
 *   ninguno   -> solo ella; mueve el ancla
 *   mod       -> la alterna; mueve el ancla
 *   shift     -> el rango [ancla…id] en lugar de lo que hubiera; el ancla no se mueve
 *   mod+shift -> añade el rango
 * Sin ancla (o con una que ya no se ve), Mayús es un clic normal.
 */
export function resolverClicSsh(s: SeleccionSsh, visibles: readonly string[], id: string, mods: ModificadoresClicSsh): SeleccionSsh {
  if (mods.shift) {
    const r = rango(visibles, s.ancla, id)
    if (r === null) return { ids: new Set([id]), ancla: id }
    const ids = new Set(mods.mod ? s.ids : [])
    for (const x of r) ids.add(x)
    return { ids, ancla: s.ancla }
  }
  if (mods.mod) {
    const ids = new Set(s.ids)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    return { ids, ancla: id }
  }
  return { ids: new Set([id]), ancla: id }
}

/** Mayús+↑/↓ hasta la conexión `id`: el rango desde el ancla (o desde `desde`, si no hay ancla). */
export function extenderHasta(s: SeleccionSsh, visibles: readonly string[], desde: string | null, id: string): SeleccionSsh {
  const ancla = s.ancla !== null && visibles.includes(s.ancla) ? s.ancla : (desde ?? id)
  return { ids: new Set(rango(visibles, ancla, id) ?? [id]), ancla }
}

/**
 * La selección al pulsar con el botón derecho: una conexión marcada no cambia nada (el menú actúa sobre todas);
 * una sin marcar pasa a ser la única, para no secuestrar una selección que no la incluía.
 */
export function resolverClicDerechoSsh(s: SeleccionSsh, id: string): SeleccionSsh {
  return s.ids.has(id) ? s : { ids: new Set([id]), ancla: id }
}

/**
 * Lo marcado que sigue a la vista: un grupo plegado, un filtro o un borrado lo sacan. Se poda, no se vacía, y
 * devuelve el MISMO objeto si no cayó nada (así no hay un render de más).
 */
export function podarSeleccion(s: SeleccionSsh, visibles: readonly string[]): SeleccionSsh {
  const vivas = new Set(visibles)
  const ids = [...s.ids].filter((id) => vivas.has(id))
  const ancla = s.ancla !== null && vivas.has(s.ancla) ? s.ancla : null
  if (ids.length === s.ids.size && ancla === s.ancla) return s
  return { ids: new Set(ids), ancla }
}

/** Lo que se arrastra desde la conexión `id`: toda la selección si está en ella, si no solo ella. */
export function idsDelArrastre(s: SeleccionSsh, visibles: readonly string[], id: string): string[] {
  if (!s.ids.has(id)) return [id]
  return visibles.filter((x) => s.ids.has(x))
}

/**
 * El grupo al que va lo que se suelta sobre la fila `indice`: el suyo si es una cabecera, el de su cabecera si es
 * una conexión que cuelga de un grupo (`ID_SIN_GRUPO` = «Sin grupo»). `null` donde no se puede soltar: la lista
 * plana de un perfil sin grupos.
 */
export function destinoDeFila(filas: readonly FilaLista[], indice: number): string | null {
  const f = filas[indice]
  if (f === undefined) return null
  if (f.tipo === 'grupo') return f.grupoId
  const cabecera = cabeceraDe(filas, indice)
  const g = filas[cabecera]
  return g?.tipo === 'grupo' ? g.grupoId : null
}

/** El grupo que pinta la lista para una conexión: el suyo si existe en el perfil, si no «Sin grupo». */
function grupoVisible(c: SshConexion, grupos: ReadonlySet<string>): string {
  return c.grupoId !== null && grupos.has(c.grupoId) ? c.grupoId : ID_SIN_GRUPO
}

/** Las conexiones de `ids` que cambian de grupo al soltarlas en `destino` (las que ya están en él no). */
export function idsQueCambian(ids: readonly string[], destino: string, conexiones: readonly SshConexion[], grupos: ReadonlySet<string>): string[] {
  const porId = new Map(conexiones.map((c) => [c.id, c]))
  return ids.filter((id) => {
    const c = porId.get(id)
    return c !== undefined && grupoVisible(c, grupos) !== destino
  })
}

/** El `grupoId` que se manda al main para un destino: `null` para «Sin grupo». */
export function grupoIdDeDestino(destino: string): string | null {
  return destino === ID_SIN_GRUPO ? null : destino
}

/** «1 conexión» / «3 conexiones». */
export function cuantasConexiones(n: number): string {
  return txSsh().cuantasConexiones(n)
}

/** Tope de nombres que lista la confirmación de borrar varias: más no se leen. */
const TOPE_NOMBRES = 10

/** El mensaje de la confirmación de borrar varias: cuántas, cuáles (hasta un tope) y qué pasa con sus pestañas. */
export function mensajeEliminarVarias(alias: readonly string[]): string {
  const t = txSsh()
  const lista = alias.slice(0, TOPE_NOMBRES).map((a) => `• ${a}`)
  if (alias.length > TOPE_NOMBRES) lista.push(t.yMas(alias.length - TOPE_NOMBRES))
  return `${t.eliminarVarias(cuantasConexiones(alias.length))}\n${lista.join('\n')}\n${t.pestanasSiguen}`
}
