// =============================================================================
// El menú contextual del explorador SFTP: las mismas acciones que la barra. Sobre una fila ofrece
// Abrir (una sola carpeta), Descargar, Renombrar (una sola) y Eliminar, y debajo lo de la carpeta
// (nueva, subir, actualizar); sobre el fondo, solo lo de la carpeta. Depende de `ContextMenu` y de
// los iconos.
// =============================================================================

import { SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { IconoAbrir, IconoCarpetaNueva, IconoEliminar, IconoRenombrar } from '../../comun/iconosMenu'
import { IconoActualizar, IconoDescargar, IconoSubirArchivos, IconoSubirCarpeta } from './iconosSftp'
import { txSftp } from './textos.ts'

export interface AccionesMenuSftp {
  /** Cuántas filas están elegidas (la fila del clic derecho ya cuenta) y si la única es una carpeta. */
  elegidos: number
  unicaEsCarpeta: boolean
  descargables: number
  onAbrir: () => void
  onDescargar: () => void
  onRenombrar: () => void
  onEliminar: () => void
  onNuevaCarpeta: () => void
  onSubirArchivos: () => void
  onSubirCarpeta: () => void
  onActualizar: () => void
}

function itemsDeSeleccion(a: AccionesMenuSftp): ContextMenuEntry[] {
  const t = txSftp()
  return [
    ...(a.elegidos === 1 && a.unicaEsCarpeta ? [{ label: t.abrir, icon: <IconoAbrir />, onClick: a.onAbrir }] : []),
    { label: t.descargarMenu, icon: <IconoDescargar />, disabled: a.descargables === 0, onClick: a.onDescargar },
    ...(a.elegidos === 1 ? [{ label: t.renombrarMenu, icon: <IconoRenombrar />, onClick: a.onRenombrar }] : []),
    { label: a.elegidos > 1 ? t.eliminarVarios(a.elegidos) : t.eliminarMenu, icon: <IconoEliminar />, danger: true, onClick: a.onEliminar },
    SEP
  ]
}

/** Las opciones del menú. Con la selección vacía solo salen las de la carpeta. */
export function itemsMenuSftp(a: AccionesMenuSftp): ContextMenuEntry[] {
  const t = txSftp()
  return [
    ...(a.elegidos > 0 ? itemsDeSeleccion(a) : []),
    { label: t.nuevaCarpetaMenu, icon: <IconoCarpetaNueva />, onClick: a.onNuevaCarpeta },
    { label: t.subirArchivos, icon: <IconoSubirArchivos />, onClick: a.onSubirArchivos },
    { label: t.subirCarpeta, icon: <IconoSubirCarpeta />, onClick: a.onSubirCarpeta },
    SEP,
    { label: t.actualizar, icon: <IconoActualizar />, onClick: a.onActualizar }
  ]
}
