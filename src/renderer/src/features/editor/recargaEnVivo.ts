// =============================================================================
// Decide qué pestañas releen disco (o comprueban su borrado) cuando un archivo cambia por
// fuera. Lógica pura: el efecto que sube los tokens vive en `useRecargaEnVivo`.
// Reglas: solo el target activo, nunca un buffer sucio, `parcial` manda sobre la lista.
// Decisiones: docs/decisiones/editor/recarga-en-vivo.md
// =============================================================================

import type { PestanaEditor } from './modeloPestanasEditor'

/** Datos de un aviso del watcher sobre las pestañas del target activo. */
export interface EntradaRecarga {
  /** Pestañas del target ACTIVO (las que `usePestanasEditor` expone). */
  pestanas: readonly PestanaEditor[]
  /** Rutas POSIX que el watcher dice que cambiaron. */
  cambiadas: readonly string[]
  /** ¿La lista de rutas venía truncada? Entonces no se puede confiar en ella. */
  parcial: boolean
  /** paneKeys con cambios SIN GUARDAR (los que no se pueden tocar). */
  sucios: ReadonlySet<string>
  /** Target activo; null = no hay proyecto confirmado y no se recarga nada. */
  claveDestino: string | null
  /** Cómo se compone la clave de un pane (la de `useEditorApp`: target + id de tab). */
  clavePane: (claveDestino: string, pestanaId: string) => string
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
  if (e.claveDestino === null) return []
  const cambiadas = new Set(e.cambiadas)
  const salida: string[] = []
  for (const pestana of e.pestanas) {
    if (pestana.pane.tipo !== 'file') continue
    if (!e.parcial && !cambiadas.has(pestana.id)) continue
    salida.push(e.clavePane(e.claveDestino, pestana.id))
  }
  return salida
}
