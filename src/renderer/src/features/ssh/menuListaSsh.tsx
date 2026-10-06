// =============================================================================
// Los menús de la lista de conexiones SSH: el de una conexión (Conectar, Ir a la sesión abierta,
// Editar, Mover a grupo, Eliminar) y el de un grupo real (Nueva conexión aquí, Renombrar, Eliminar
// grupo; «Sin grupo» no tiene), más el componente que los pinta en la capa flotante: la lista flotante tiene su propio
// recorte y el menú no puede colgar de ella. Depende de `ContextMenu` y `capaFlotante`.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import type { RefObject } from 'react'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { IconoCarpetaNueva, IconoEliminar, IconoRenombrar } from '../../comun/iconosMenu'
import { IconoSftp } from '../sftp'
import { IconoServidor, IconoServidorNuevo } from './iconosSsh'

/** Lo que hace cada opción del menú de una conexión. */
export interface AccionesMenuConexion {
  onConectar: () => void
  /** Abre una pestaña con el explorador SFTP de la conexión. */
  onAbrirSftp: () => void
  /** Lleva a la pestaña ya abierta de esta conexión; `null` si no hay ninguna (la opción no sale). */
  onIrASesion: (() => void) | null
  onEditar: () => void
  /** Abre «Editar» con el foco en el selector de grupo. */
  onMoverAGrupo: () => void
  onEliminar: () => void
}

/** Conectar · Abrir explorador SFTP · Ir a la sesión abierta (si hay) · — · Editar… · Mover a grupo… · — · Eliminar… */
export function itemsMenuConexion(a: AccionesMenuConexion): ContextMenuEntry[] {
  return [
    { label: 'Conectar', icon: <IconoServidor />, onClick: a.onConectar },
    { label: 'Abrir explorador SFTP', icon: <IconoSftp />, onClick: a.onAbrirSftp },
    ...(a.onIrASesion ? [{ label: 'Ir a la sesión abierta', onClick: a.onIrASesion }] : []),
    SEP,
    { label: 'Editar…', icon: <IconoRenombrar />, onClick: a.onEditar },
    { label: 'Mover a grupo…', icon: <IconoCarpetaNueva />, onClick: a.onMoverAGrupo },
    SEP,
    { label: 'Eliminar…', icon: <IconoEliminar />, danger: true, onClick: a.onEliminar }
  ]
}

/** Lo que hace cada opción del menú de un grupo. `real` es `false` en «Sin grupo». */
export interface AccionesMenuGrupo {
  real: boolean
  onNuevaConexion: () => void
  onRenombrar: () => void
  onEliminar: () => void
}

/**
 * Nueva conexión en este grupo… · — · Renombrar… · — · Eliminar grupo… «Sin grupo» no tiene menú (`[]`): su
 * «Nueva conexión…» repetía la del pie del lanzador y la de la cabecera del riel.
 */
export function itemsMenuGrupo(a: AccionesMenuGrupo): ContextMenuEntry[] {
  if (!a.real) return []
  return [
    { label: 'Nueva conexión en este grupo…', icon: <IconoServidorNuevo />, onClick: a.onNuevaConexion },
    SEP,
    { label: 'Renombrar…', icon: <IconoRenombrar />, onClick: a.onRenombrar },
    SEP,
    { label: 'Eliminar grupo…', icon: <IconoEliminar />, danger: true, onClick: a.onEliminar }
  ]
}

/** Dónde y qué menú: lo que la lista guarda mientras hay uno abierto. */
export interface MenuFilaAbierto {
  x: number
  y: number
  items: ContextMenuEntry[]
}

/** El menú de una fila, en la capa flotante. Al cerrarse devuelve el foco a `disparador` (el filtro de la lista). */
export function MenuFilaSsh({
  menu,
  disparador,
  onClose
}: {
  menu: MenuFilaAbierto
  disparador: RefObject<HTMLElement>
  onClose: () => void
}): React.JSX.Element {
  return (
    <EnCapaFlotante>
      <ContextMenu x={menu.x} y={menu.y} items={menu.items} disparador={disparador} onClose={onClose} />
    </EnCapaFlotante>
  )
}
