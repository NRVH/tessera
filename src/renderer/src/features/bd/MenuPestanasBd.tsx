// =============================================================================
// MenuPestanasBd: las entradas del menú contextual de una pestaña de BD. Cerrar, otras,
// izquierda, derecha y todas piden cerrar una LISTA de ids por el mismo `onCerrar`
// (las guardas de consola ejecutando o transacción pendiente son del área); más
// «Mostrar en el árbol» y, en una consola, «Renombrar consola…». La usa `PestanasBd`.
// Decisiones: docs/decisiones/bd/ui-area-tira-de-pestanas.md
// =============================================================================

import { SEP, type EntradaMenuContextual } from '../../comun/MenuContextual'
import { IconoCerrar, IconoCerrarTodo, IconoRenombrar } from '../../comun/iconosMenu'
import { idsDerecha, idsIzquierda, type PestanaBd, type EstadoPestanasBd } from './modeloPestanasBd'
import { txArea } from './textosArea.ts'

/** Lo que el menú necesita de la tira. */
interface AccionesMenuPestana {
  onCerrar: (ids: string[]) => void
  onMostrarEnArbol: (id: string) => void
  onRenombrarConsola: (id: string) => void
}

/** Las entradas del menú de `menuPestana` en la tira `estadoTira` (ver la cabecera). */
export function elementosMenuPestana(estadoTira: EstadoPestanasBd, menuPestana: PestanaBd, a: AccionesMenuPestana): EntradaMenuContextual[] {
  const { pestanas } = estadoTira
  const t = txArea()
  return [
    { icon: <IconoCerrar />, label: t.cerrar, onClick: () => a.onCerrar([menuPestana.id]) },
    {
      label: t.cerrarOtras,
      disabled: pestanas.length <= 1,
      onClick: () => a.onCerrar(pestanas.filter((t) => t.id !== menuPestana.id).map((t) => t.id))
    },
    {
      label: t.cerrarIzquierda,
      disabled: idsIzquierda(estadoTira, menuPestana.id).length === 0,
      onClick: () => a.onCerrar(idsIzquierda(estadoTira, menuPestana.id))
    },
    {
      label: t.cerrarDerecha,
      disabled: idsDerecha(estadoTira, menuPestana.id).length === 0,
      onClick: () => a.onCerrar(idsDerecha(estadoTira, menuPestana.id))
    },
    {
      icon: <IconoCerrarTodo />,
      label: t.cerrarTodas,
      onClick: () => a.onCerrar(pestanas.map((t) => t.id))
    },
    SEP,
    { label: t.mostrarEnArbol, onClick: () => a.onMostrarEnArbol(menuPestana.id) },
    ...(menuPestana.pane.tipoPane === 'consola'
      ? [
          {
            icon: <IconoRenombrar />,
            label: t.renombrarConsolaPuntos,
            onClick: () => a.onRenombrarConsola(menuPestana.id)
          }
        ]
      : [])
  ]
}
