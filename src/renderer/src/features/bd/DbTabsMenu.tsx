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
import { txArea } from './textosArea.ts'

/** Lo que el menú necesita de la tira. */
interface AccionesMenuPestana {
  onCerrar: (ids: string[]) => void
  onMostrarEnArbol: (id: string) => void
  onRenombrarConsola: (id: string) => void
}

/** Las entradas del menú de `tabMenu` en la tira `estadoTira` (ver la cabecera). */
export function itemsMenuPestana(estadoTira: DbTabsState, tabMenu: DbTab, a: AccionesMenuPestana): ContextMenuEntry[] {
  const { tabs } = estadoTira
  const t = txArea()
  return [
    { icon: <IconoCerrar />, label: t.cerrar, onClick: () => a.onCerrar([tabMenu.id]) },
    {
      label: t.cerrarOtras,
      disabled: tabs.length <= 1,
      onClick: () => a.onCerrar(tabs.filter((t) => t.id !== tabMenu.id).map((t) => t.id))
    },
    {
      label: t.cerrarIzquierda,
      disabled: idsIzquierda(estadoTira, tabMenu.id).length === 0,
      onClick: () => a.onCerrar(idsIzquierda(estadoTira, tabMenu.id))
    },
    {
      label: t.cerrarDerecha,
      disabled: idsDerecha(estadoTira, tabMenu.id).length === 0,
      onClick: () => a.onCerrar(idsDerecha(estadoTira, tabMenu.id))
    },
    {
      icon: <IconoCerrarTodo />,
      label: t.cerrarTodas,
      onClick: () => a.onCerrar(tabs.map((t) => t.id))
    },
    SEP,
    { label: t.mostrarEnArbol, onClick: () => a.onMostrarEnArbol(tabMenu.id) },
    ...(tabMenu.pane.kind === 'consola'
      ? [
          {
            icon: <IconoRenombrar />,
            label: t.renombrarConsolaPuntos,
            onClick: () => a.onRenombrarConsola(tabMenu.id)
          }
        ]
      : [])
  ]
}
