// =============================================================================
// La copia de la configuración que llegó del sistema (doble clic en un `.tessera`: argv del
// arranque, segunda instancia u `open-file`) y espera a que la ventana pueda importarla. Guarda
// solo la ruta, la ÚLTIMA: el importar abre un archivo a la vez. La lee y la abre `ipc.ts` cuando
// el renderer la pide; `app/proceso.ts` encola al cargar, antes de que exista la ventana.
// Decisiones: docs/decisiones/configuracion/archivos-tessera-del-sistema.md
// =============================================================================

import { logUpdate } from '../update/logUpdate'

let pendiente: string | null = null

/** A quién avisar de que hay una copia nueva. Lo fija `conectarAvisoCopias`. */
let avisar: (() => void) | null = null

/** Apunta las copias que llegaron; si son varias, gana la última. Vale antes de que haya ventana. */
export function encolarCopias(rutas: readonly string[]): void {
  const ultima = rutas[rutas.length - 1]
  if (ultima === undefined) return
  if (rutas.length > 1 || pendiente !== null) logUpdate('llegaron varias copias de la configuración; se importa solo la última.')
  pendiente = ultima
  logUpdate('copia de la configuración recibida del sistema; se abrirá el importar.')
  avisar?.()
}

/** Fija a quién se avisa cuando entra una copia (el `send` a la ventana). */
export function conectarAvisoCopias(fn: () => void): void {
  avisar = fn
}

/** Recoge y vacía la copia pendiente, o `null` si no hay ninguna. */
export function tomarCopiaPendiente(): string | null {
  const ruta = pendiente
  pendiente = null
  return ruta
}
