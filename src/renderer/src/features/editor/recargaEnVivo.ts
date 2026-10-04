// =============================================================================
// Decide qué pestañas releen disco (o comprueban su borrado) cuando un archivo cambia por
// fuera. Lógica pura: el efecto que sube los tokens vive en `useRecargaEnVivo`.
// Reglas: solo el target activo, nunca un buffer sucio, `parcial` manda sobre la lista.
// Decisiones: docs/decisiones/editor/recarga-en-vivo.md
// =============================================================================

import type { EditorTab } from './editorTabsModel'

/** Datos de un aviso del watcher sobre las pestañas del target activo. */
export interface EntradaRecarga {
  /** Pestañas del target ACTIVO (las que `useEditorTabs` expone). */
  tabs: readonly EditorTab[]
  /** Rutas POSIX que el watcher dice que cambiaron. */
  cambiadas: readonly string[]
  /** ¿La lista de rutas venía truncada? Entonces no se puede confiar en ella. */
  parcial: boolean
  /** paneKeys con cambios SIN GUARDAR (los que no se pueden tocar). */
  sucios: ReadonlySet<string>
  /** Target activo; null = no hay proyecto confirmado y no se recarga nada. */
  targetKey: string | null
  /** Cómo se compone la clave de un pane (la de `useEditorApp`: target + id de tab). */
  paneKey: (targetKey: string, tabId: string) => string
}

/** paneKeys limpias que deben releer disco. Vacío es el caso normal. */
export function panesARecargar(e: EntradaRecarga): string[] {
  return candidatos(e).filter((pk) => !e.sucios.has(pk))
}

/** paneKeys sucios que solo comprueban si su archivo sigue en disco: complemento de `panesARecargar`. */
export function panesAComprobar(e: EntradaRecarga): string[] {
  return candidatos(e).filter((pk) => e.sucios.has(pk))
}

/** Pestañas de ARCHIVO del target activo que el aviso del watcher toca. */
function candidatos(e: EntradaRecarga): string[] {
  if (e.targetKey === null) return []
  const cambiadas = new Set(e.cambiadas)
  const out: string[] = []
  for (const tab of e.tabs) {
    if (tab.pane.kind !== 'file') continue
    if (!e.parcial && !cambiadas.has(tab.id)) continue
    out.push(e.paneKey(e.targetKey, tab.id))
  }
  return out
}
