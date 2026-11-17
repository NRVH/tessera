// =============================================================================
// Estado PURO de las pestañas de archivos y diffs de la columna central del editor.
// Sin React, Monaco ni IPC. Cada pestaña envuelve un `PaneCentral` y tiene un id estable derivado
// de su contenido (`derivarIdPestana`): abrir un id ya abierto lo activa, y el mismo path como archivo
// y como diff son dos pestañas. El activo es por clave y es null solo si no hay pestañas.
// =============================================================================

import type { PaneCentral } from './paneCentral'
import { txEditor } from './textos.ts'

/** Una tab abierta en la columna central: id estable + el pane que muestra. */
export interface PestanaEditor {
  /** Id estable y único de la tab (derivado del pane). Clave de identidad y de activo. */
  id: string
  /** Contenido de la tab: el PaneCentral existente (file | diff). */
  pane: PaneCentral
  /**
   * Pestaña de vista previa: como mucho una por target; abrir otra efímera la sustituye en su hueco.
   * Solo se abren efímeras pestañas que nunca pueden ensuciarse (diffs de commit, no editables),
   * por eso sustituirlas puede saltarse `cerrarPestanaEditor` sin dejar estado sucio huérfano.
   */
  efimera?: true
}

/** Estado completo de las tabs de editor: colección ordenada + activo por clave. */
export interface EstadoPestanasEditor {
  /** Colección ORDENADA (orden visual de las tabs). */
  pestanas: PestanaEditor[]
  /** Id de la tab activa, o null sii tabs está vacío. */
  pestanaActivaId: string | null
}

/** Estado vacío inicial: sin tabs abiertas. */
export const estadoInicialPestanasEditor: EstadoPestanasEditor = { pestanas: [], pestanaActivaId: null }

/**
 * Clave de target del editor: las pestañas viven por (perfil, proyecto), no por agente.
 * `|` separa; `rutaHostProyecto` no lo contiene.
 */
export function claveDestinoEditor(perfilId: string, rutaHostProyecto: string): string {
  return `${perfilId}|${rutaHostProyecto}`
}

/**
 * Identidad única de un pane montado entre todos los targets (un id de pestaña nunca contiene `\u0000`). La de
 * un archivo coincide con la clave de su modelo (`claveModeloTexto`), porque su id es su ruta.
 */
export function clavePaneEditor(claveDestino: string, pestanaId: string): string {
  return `${claveDestino}\u0000${pestanaId}`
}

/** El perfil de un target (`claveDestinoEditor`); '' sin target, la clave de «sin perfil». */
export function perfilDeDestino(claveDestino: string | null): string {
  if (claveDestino === null) return ''
  const i = claveDestino.indexOf('|')
  return i === -1 ? '' : claveDestino.slice(0, i)
}

/** La contenedora del proyecto de un target (la inversa de `claveDestinoEditor`); '' si no lo es. */
export function raizDeDestino(claveDestino: string): string {
  const i = claveDestino.indexOf('|')
  return i === -1 ? '' : claveDestino.slice(i + 1)
}

/** Deriva el id estable de una tab: la ruta si es archivo, `diff:commit:ruta` si es diff. */
export function derivarIdPestana(pane: PaneCentral): string {
  if (pane.tipo === 'file') return pane.archivo.ruta
  // Sin título: el id sale del id opaco del buffer; el nombre cambia al guardarlo.
  if (pane.tipo === 'untitled') return `untitled:${pane.sinTitulo.id}`
  return `diff:${pane.destino.commitHash}:${pane.destino.ruta}`
}

/** Nombre por defecto del n-ésimo archivo sin título. */
export function nombreSinTitulo(n: number): string {
  return txEditor().sinTitulo(n)
}

/** Menor número libre para un sin título nuevo; los ya guardados liberan el suyo. */
export function siguienteNumeroSinTitulo(estado: EstadoPestanasEditor): number {
  const usados = new Set<string>()
  for (const t of estado.pestanas) {
    if (t.pane.tipo === 'untitled' && t.pane.sinTitulo.guardado !== true) usados.add(t.pane.sinTitulo.nombre)
  }
  let n = 1
  while (usados.has(nombreSinTitulo(n))) n++
  return n
}

// Acciones puras: nunca mutan la entrada; sobre ids inexistentes devuelven el mismo estado.

/**
 * Abre un pane (o activa su tab si ya está abierta). `efimera` la abre como vista previa:
 * una ya abierta asciende si se abre en serio (nunca al revés); una efímera sustituye a la
 * anterior en su índice. Un sin título nunca es efímero: sustituirlo perdería lo escrito.
 */
export function abrirPestanaEditor(
  estado: EstadoPestanasEditor,
  pane: PaneCentral,
  efimera = false
): EstadoPestanasEditor {
  const id = derivarIdPestana(pane)
  const comoEfimera = efimera && pane.tipo !== 'untitled'
  const idx = estado.pestanas.findIndex((t) => t.id === id)
  if (idx !== -1) {
    // Ya abierta. Solo hay algo que reescribir si toca ASCENDERLA.
    if (!comoEfimera && estado.pestanas[idx].efimera === true) {
      const pestanas = estado.pestanas.map((t, i) => (i === idx ? { id: t.id, pane: t.pane } : t))
      return { pestanas, pestanaActivaId: id }
    }
    if (estado.pestanaActivaId === id) return estado
    return { ...estado, pestanaActivaId: id }
  }
  const nueva: PestanaEditor = comoEfimera ? { id, pane, efimera: true } : { id, pane }
  if (comoEfimera) {
    const previa = estado.pestanas.findIndex((t) => t.efimera === true)
    if (previa !== -1) {
      const pestanas = estado.pestanas.map((t, i) => (i === previa ? nueva : t))
      return { pestanas, pestanaActivaId: id }
    }
  }
  return { pestanas: [...estado.pestanas, nueva], pestanaActivaId: id }
}

/**
 * Reemplaza en su sitio el contenido de la tab `id` por otro pane (al guardar un sin título).
 * Si el id nuevo ya tenía otra tab, se queda esa y se cierra la vieja. No-op si `id` no existe.
 */
export function reemplazarPestanaEditor(estado: EstadoPestanasEditor, id: string, pane: PaneCentral): EstadoPestanasEditor {
  const idx = estado.pestanas.findIndex((t) => t.id === id)
  if (idx === -1) return estado
  const nuevoId = derivarIdPestana(pane)
  const clash = estado.pestanas.findIndex((t) => t.id === nuevoId && t.id !== id)
  if (clash !== -1) {
    // El destino ya estaba abierto: nos quedamos con ESA tab (con su contenido ya
    // releído del disco) y soltamos la que se estaba guardando.
    const pestanas = estado.pestanas.filter((_, i) => i !== idx)
    return { pestanas, pestanaActivaId: nuevoId }
  }
  // El flag de efímera se propaga aunque hoy sea inalcanzable, por si aparece otro llamador.
  const pestanas = estado.pestanas.map((t, i) =>
    i === idx ? (t.efimera === true ? { id: nuevoId, pane, efimera: true as const } : { id: nuevoId, pane }) : t
  )
  const pestanaActivaId = estado.pestanaActivaId === id ? nuevoId : estado.pestanaActivaId
  return { pestanas, pestanaActivaId }
}

/** Activa la tab `id` si existe; no-op si no. */
export function activarPestanaEditor(estado: EstadoPestanasEditor, id: string): EstadoPestanasEditor {
  if (estado.pestanaActivaId === id) return estado
  if (!estado.pestanas.some((t) => t.id === id)) return estado // id desconocido: no-op
  return { ...estado, pestanaActivaId: id }
}

/** Cierra la tab `id`; si era la activa, elige una vecina (o null si queda vacío). */
export function cerrarPestanaEditor(estado: EstadoPestanasEditor, id: string): EstadoPestanasEditor {
  const idx = estado.pestanas.findIndex((t) => t.id === id)
  if (idx === -1) return estado // no estaba abierta: no-op
  const pestanas = estado.pestanas.filter((_, i) => i !== idx)
  const eraActiva = estado.pestanaActivaId === id
  const pestanaActivaId = eraActiva ? neighborId(pestanas, idx) : estado.pestanaActivaId
  return { pestanas, pestanaActivaId }
}

/**
 * Elige la tab que hereda el "activo" tras cerrar la que estaba en `idx`. Tras
 * el filtro, la vecina que ocupa el hueco es la de índice `idx` (la que estaba
 * a la derecha), acotada al último; null si la lista quedó vacía.
 */
function neighborId(pestanas: PestanaEditor[], idx: number): string | null {
  if (pestanas.length === 0) return null
  const siguienteIdx = Math.min(idx, pestanas.length - 1)
  return pestanas[siguienteIdx].id
}

/** La tab activa completa, o null si no hay ninguna activa. */
export function obtenerPestanaActiva(estado: EstadoPestanasEditor): PestanaEditor | null {
  if (estado.pestanaActivaId === null) return null
  return estado.pestanas.find((t) => t.id === estado.pestanaActivaId) ?? null
}
