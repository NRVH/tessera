// =============================================================================
// El menú contextual del explorador SFTP: las mismas acciones que la barra. Sobre una fila ofrece
// Abrir (una sola carpeta), Descargar, Renombrar (una sola) y Eliminar, y debajo lo de la carpeta
// (nueva, subir, actualizar); sobre el fondo, solo lo de la carpeta. Depende de `ContextMenu` y de
// los iconos.
// =============================================================================

import { SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { IconoAbrir, IconoCarpetaNueva, IconoEliminar, IconoRenombrar } from '../../comun/iconosMenu'
import { IconoActualizar, IconoDescargar, IconoSubirArchivos, IconoSubirCarpeta } from './iconosSftp'

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
  return [
    ...(a.elegidos === 1 && a.unicaEsCarpeta ? [{ label: 'Abrir', icon: <IconoAbrir />, onClick: a.onAbrir }] : []),
    { label: 'Descargar…', icon: <IconoDescargar />, disabled: a.descargables === 0, onClick: a.onDescargar },
    ...(a.elegidos === 1 ? [{ label: 'Renombrar…', icon: <IconoRenombrar />, onClick: a.onRenombrar }] : []),
    { label: a.elegidos > 1 ? `Eliminar ${a.elegidos} elementos…` : 'Eliminar…', icon: <IconoEliminar />, danger: true, onClick: a.onEliminar },
    SEP
  ]
}

/** Las opciones del menú. Con la selección vacía solo salen las de la carpeta. */
export function itemsMenuSftp(a: AccionesMenuSftp): ContextMenuEntry[] {
  return [
    ...(a.elegidos > 0 ? itemsDeSeleccion(a) : []),
    { label: 'Nueva carpeta…', icon: <IconoCarpetaNueva />, onClick: a.onNuevaCarpeta },
    { label: 'Subir archivos…', icon: <IconoSubirArchivos />, onClick: a.onSubirArchivos },
    { label: 'Subir carpeta…', icon: <IconoSubirCarpeta />, onClick: a.onSubirCarpeta },
    SEP,
    { label: 'Actualizar', icon: <IconoActualizar />, onClick: a.onActualizar }
  ]
}
