// =============================================================================
// DbTabsMenu: las entradas del menú contextual de una pestaña de BD. Cerrar, otras,
// izquierda, derecha y todas piden cerrar una LISTA de ids por el mismo `onCerrar`
// (las guardas de consola ejecutando o transacción pendiente son del área); más
// «Mostrar en el árbol» y, en una consola, «Renombrar consola…». La usa `DbTabs`.
// Decisiones: docs/decisiones/bd/ui-area-tira-de-pestanas.md
// =============================================================================

import { SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { IconoCerrar, IconoCerrarTodo, IconoRenombrar } from '../../comun/iconosMenu'
import { idsDerecha, idsIzquierda, type DbTab, type DbTabsState } from './dbTabsModel'

/** Lo que el menú necesita de la tira. */
interface AccionesMenuPestana {
  onCerrar: (ids: string[]) => void
  onMostrarEnArbol: (id: string) => void
  onRenombrarConsola: (id: string) => void
}

/** Las entradas del menú de `tabMenu` en la tira `estadoTira` (ver la cabecera). */
export function itemsMenuPestana(estadoTira: DbTabsState, tabMenu: DbTab, a: AccionesMenuPestana): ContextMenuEntry[] {
  const { tabs } = estadoTira
  return [
    { icon: <IconoCerrar />, label: 'Cerrar', onClick: () => a.onCerrar([tabMenu.id]) },
    {
      label: 'Cerrar otras',
      disabled: tabs.length <= 1,
      onClick: () => a.onCerrar(tabs.filter((t) => t.id !== tabMenu.id).map((t) => t.id))
    },
    {
      label: 'Cerrar a la izquierda',
      disabled: idsIzquierda(estadoTira, tabMenu.id).length === 0,
      onClick: () => a.onCerrar(idsIzquierda(estadoTira, tabMenu.id))
    },
    {
      label: 'Cerrar a la derecha',
      disabled: idsDerecha(estadoTira, tabMenu.id).length === 0,
      onClick: () => a.onCerrar(idsDerecha(estadoTira, tabMenu.id))
    },
    {
      icon: <IconoCerrarTodo />,
      label: 'Cerrar todas',
      onClick: () => a.onCerrar(tabs.map((t) => t.id))
    },
    SEP,
    { label: 'Mostrar en el árbol', onClick: () => a.onMostrarEnArbol(tabMenu.id) },
    ...(tabMenu.pane.kind === 'consola'
      ? [
          {
            icon: <IconoRenombrar />,
            label: 'Renombrar consola…',
            onClick: () => a.onRenombrarConsola(tabMenu.id)
          }
        ]
      : [])
  ]
}
