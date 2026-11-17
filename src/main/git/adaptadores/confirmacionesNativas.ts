// =============================================================================
// Confirmaciones NATIVAS del descarte: los diálogos modales que la raíz de composición inyecta
// en `ServicioGit`. Devuelven true SOLO si el usuario confirma; cancelar es el valor por defecto.
// Viven en el main, así que la interfaz no puede saltárselos. El botón nombra lo más grave del
// gesto: eliminar del disco pesa más que volver a HEAD.
// =============================================================================

import { dialog } from 'electron'
import { txConfirmaciones } from './textos.ts'

/** Cuántos nombres se listan por grupo antes de resumir el resto. */
const MAX_LISTADOS = 10

/** El diálogo de aviso con «Cancelar» por defecto; true si se pulsó el segundo botón. */
async function preguntar(boton: string, mensaje: string, detalle: string): Promise<boolean> {
  const t = txConfirmaciones()
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: [t.cancelar, boton],
    defaultId: 0,
    cancelId: 0,
    title: t.titulo,
    message: mensaje,
    detail: detalle
  })
  return response === 1
}

/** Diálogo del descarte de un archivo: vuelve a HEAD o, si `borra`, se elimina del disco. */
export function confirmarDescarteNativo(nombreArchivo: string, borra: boolean): Promise<boolean> {
  const t = txConfirmaciones()
  return borra
    ? preguntar(t.eliminar, t.unoBorrarPregunta(nombreArchivo), t.unoBorrarDetalle)
    : preguntar(t.descartar, t.unoPregunta(nombreArchivo), t.unoDetalle)
}

/** Lista de viñetas con hasta `MAX_LISTADOS` nombres y el resto resumido. */
function lista(nombres: string[]): string {
  const resto = nombres.length - MAX_LISTADOS
  return nombres.slice(0, MAX_LISTADOS).map((n) => `• ${n}`).join('\n') + (resto > 0 ? txConfirmaciones().resto(resto) : '')
}

/** Diálogo de un descarte en lote: lo que vuelve a HEAD y, aparte, lo que se elimina del disco. */
export function confirmarDescarteLoteNativo(aBorrar: string[], aRevertir: string[]): Promise<boolean> {
  const t = txConfirmaciones()
  const total = aBorrar.length + aRevertir.length
  if (total === 1) {
    return aBorrar.length === 1 ? confirmarDescarteNativo(aBorrar[0], true) : confirmarDescarteNativo(aRevertir[0], false)
  }
  const partes: string[] = []
  if (aRevertir.length > 0) partes.push(t.revierten(lista(aRevertir)))
  if (aBorrar.length > 0) partes.push(t.borran(lista(aBorrar)))
  partes.push(t.sinDeshacer)
  const boton = aBorrar.length === 0 ? t.descartar : aRevertir.length === 0 ? t.eliminar : t.descartarYEliminar
  return preguntar(boton, t.variosPregunta(total), partes.join('\n\n'))
}
