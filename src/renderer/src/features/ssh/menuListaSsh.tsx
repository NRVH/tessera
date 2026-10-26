// =============================================================================
// Los menús de la lista de conexiones SSH: el de una conexión (Conectar, Ir a la sesión abierta, Editar, Duplicar, Mover a grupo, Olvidar la huella guardada, Eliminar), el de varias marcadas en el riel (Mover a un grupo,
// Exportar a OpenSSH, Eliminar) y el de un grupo real (Nueva conexión aquí, Renombrar, Eliminar grupo; «Sin grupo» no tiene), más el componente que los pinta en la capa flotante: la lista flotante tiene su propio
// recorte y el menú no puede colgar de ella. Depende de `ContextMenu` y `capaFlotante`.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import type { RefObject } from 'react'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { IconoCarpetaNueva, IconoEliminar, IconoRenombrar } from '../../comun/iconosMenu'
import { IconoSftp } from '../sftp'
import { IconoExportar, IconoServidor, IconoServidorNuevo } from './iconosSsh'
import { txSsh } from './textos.ts'

/** Lo que hace cada opción del menú de una conexión. */
export interface AccionesMenuConexion {
  onConectar: () => void
  /** Abre una pestaña con el explorador SFTP de la conexión. */
  onAbrirSftp: () => void
  /** Lleva a la pestaña ya abierta de esta conexión; `null` si no hay ninguna (la opción no sale). */
  onIrASesion: (() => void) | null
  onEditar: () => void
  /** Crea la copia «… (1)» y la deja en la lista, sin abrir nada. */
  onDuplicar: () => void
  /** Abre «Editar» con el foco en el selector de grupo. */
  onMoverAGrupo: () => void
  /** Olvida la huella del servidor ya aceptada; `null` si no hay ninguna guardada (la opción no sale). */
  onOlvidarHuella: (() => void) | null
  onEliminar: () => void
}

/**
 * Conectar · Abrir explorador SFTP · Ir a la sesión abierta (si hay) · — · Editar… · Duplicar · Mover a grupo… ·
 * — · Olvidar la huella guardada… (si hay) · Eliminar…
 */
export function itemsMenuConexion(a: AccionesMenuConexion): ContextMenuEntry[] {
  const t = txSsh()
  return [
    { label: t.conectar, icon: <IconoServidor />, onClick: a.onConectar },
    { label: t.abrirSftp, icon: <IconoSftp />, onClick: a.onAbrirSftp },
    ...(a.onIrASesion ? [{ label: t.irASesion, onClick: a.onIrASesion }] : []),
    SEP,
    { label: t.editar, icon: <IconoRenombrar />, onClick: a.onEditar },
    { label: t.duplicar, onClick: a.onDuplicar },
    { label: t.moverAGrupo, icon: <IconoCarpetaNueva />, onClick: a.onMoverAGrupo },
    SEP,
    ...(a.onOlvidarHuella ? [{ label: t.olvidarHuellaMenu, danger: true, onClick: a.onOlvidarHuella }] : []),
    { label: t.eliminar, icon: <IconoEliminar />, danger: true, onClick: a.onEliminar }
  ]
}

/** Lo que hace cada opción del menú de varias conexiones marcadas en el riel. */
export interface AccionesMenuVarias {
  /** Cuántas hay marcadas. */
  n: number
  onMoverAGrupo: () => void
  onExportar: () => void
  onEliminar: () => void
}

/** Mover N conexiones a un grupo… · Exportar N conexiones a OpenSSH… · — · Eliminar N conexiones… */
export function itemsMenuVarias(a: AccionesMenuVarias): ContextMenuEntry[] {
  const t = txSsh()
  return [
    { label: t.moverVarias(a.n), icon: <IconoCarpetaNueva />, onClick: a.onMoverAGrupo },
    { label: t.exportarVarias(a.n), icon: <IconoExportar />, onClick: a.onExportar },
    SEP,
    { label: t.eliminarVariasMenu(a.n), icon: <IconoEliminar />, danger: true, onClick: a.onEliminar }
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
  const t = txSsh()
  return [
    { label: t.nuevaConexionAqui, icon: <IconoServidorNuevo />, onClick: a.onNuevaConexion },
    SEP,
    { label: t.renombrar, icon: <IconoRenombrar />, onClick: a.onRenombrar },
    SEP,
    { label: t.eliminarGrupoMenu, icon: <IconoEliminar />, danger: true, onClick: a.onEliminar }
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
