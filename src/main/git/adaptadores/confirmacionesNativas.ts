// =============================================================================
// Confirmaciones NATIVAS del descarte: los diálogos modales que la raíz de composición inyecta
// en `GitService`. Devuelven true SOLO si el usuario pulsa «Descartar»; cancelar es el
// valor por defecto. Viven en el main, así que la interfaz no puede saltárselos.
// =============================================================================

import { dialog } from 'electron'

/** Diálogo de un borrado irrecuperable (sin seguimiento, o añadido sin commit). */
export async function confirmarDescarteNativo(fileName: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancelar', 'Descartar'],
    defaultId: 0,
    cancelId: 0,
    title: 'Descartar cambios',
    message: `¿Descartar "${fileName}"?`,
    detail:
      'Este archivo no tiene una versión en git a la que volver. Descartar sus cambios lo ELIMINARÁ del disco. Esta acción no se puede deshacer.'
  })
  return response === 1
}

/** Diálogo de un descarte en lote: lista hasta 10 nombres y resume el resto. */
export async function confirmarDescarteLoteNativo(fileNames: string[]): Promise<boolean> {
  const MAX = 10
  const mostrados = fileNames.slice(0, MAX)
  const resto = fileNames.length - mostrados.length
  const lista = mostrados.map((n) => `• ${n}`).join('\n') + (resto > 0 ? `\n…y ${resto} más` : '')
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancelar', 'Descartar'],
    defaultId: 0,
    cancelId: 0,
    title: 'Descartar cambios',
    message:
      fileNames.length === 1
        ? `¿Descartar "${fileNames[0]}"?`
        : `¿Descartar ${fileNames.length} archivos?`,
    detail:
      `Estos archivos no tienen una versión en git a la que volver, así que se ELIMINARÁN del disco. Esta acción no se puede deshacer.\n\n${lista}` +
      '\n\nSi cancelas, el resto de archivos seleccionados SÍ se revertirá a su versión de git (es recuperable).'
  })
  return response === 1
}
