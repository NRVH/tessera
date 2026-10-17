// =============================================================================
// Confirmaciones NATIVAS del descarte: los diálogos modales que la raíz de composición inyecta
// en `GitService`. Devuelven true SOLO si el usuario pulsa «Descartar»; cancelar es el
// valor por defecto. Viven en el main, así que la interfaz no puede saltárselos.
// =============================================================================

import { dialog } from 'electron'
import { txConfirmaciones } from './textos.ts'

/** Diálogo de un borrado irrecuperable (sin seguimiento, o añadido sin commit). */
export async function confirmarDescarteNativo(fileName: string): Promise<boolean> {
  const t = txConfirmaciones()
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: [t.cancelar, t.descartar],
    defaultId: 0,
    cancelId: 0,
    title: t.titulo,
    message: t.unoPregunta(fileName),
    detail: t.unoDetalle
  })
  return response === 1
}

/** Diálogo de un descarte en lote: lista hasta 10 nombres y resume el resto. */
export async function confirmarDescarteLoteNativo(fileNames: string[]): Promise<boolean> {
  const MAX = 10
  const mostrados = fileNames.slice(0, MAX)
  const resto = fileNames.length - mostrados.length
  const t = txConfirmaciones()
  const lista = mostrados.map((n) => `• ${n}`).join('\n') + (resto > 0 ? t.resto(resto) : '')
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: [t.cancelar, t.descartar],
    defaultId: 0,
    cancelId: 0,
    title: t.titulo,
    message: fileNames.length === 1 ? t.unoPregunta(fileNames[0]) : t.variosPregunta(fileNames.length),
    detail: t.variosDetalle(lista)
  })
  return response === 1
}
