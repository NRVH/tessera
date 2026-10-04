// =============================================================================
// DbTabs: la tira de pestañas del área de bases de datos (tablas, fuentes, consolas,
// colecciones y claves abiertas del perfil que se ve), sobre las clases de la tira del
// editor para verse idéntica; lo propio va en `area.css` y solo AÑADE. Cerrar no
// cierra aquí: pide cerrar (`onCerrar`) y el área pregunta a la consola.
// Decisiones: docs/decisiones/bd/ui-area-tira-de-pestanas.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { DbMotor } from '../../../../shared/db-ipc'
import { ContextMenu } from '../../comun/ContextMenu'
import type { DbTab, DbTabsState, IndicadorPestana, TituloPestana } from './dbTabsModel'
import { useArrastrePestanas } from './useArrastrePestanas'
import { DbTabsPestana } from './DbTabsPestana'
import { itemsMenuPestana } from './DbTabsMenu'

interface DbTabsProps {
  tabs: readonly DbTab[]
  activeId: string | null
  titulos: ReadonlyMap<string, TituloPestana>
  /** Indicador visible de cada pestaña (ya resuelto por prioridad), por id. */
  indicadores: ReadonlyMap<string, IndicadorPestana>
  /** Motor de cada conexión (id -> motor): el icono de las pestañas de consola. */
  motores: ReadonlyMap<string, DbMotor>
  onActivar: (id: string) => void
  /** Pide cerrar esas pestañas (la consola puede preguntar antes). */
  onCerrar: (ids: string[]) => void
  /** Arrastre: `id` pasa a quedar antes de `antesDe` (null = al final). */
  onMover: (id: string, antesDe: string | null) => void
  onMostrarEnArbol: (id: string) => void
  /** Solo pestañas de consola. */
  onRenombrarConsola: (id: string) => void
}

export function DbTabs(props: DbTabsProps): React.JSX.Element {
  const { tabs, activeId, titulos, indicadores, motores, onActivar, onCerrar, onMover } = props
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  // La activa se trae a la vista al cambiar (abrir desde el árbol una pestaña que ya
  // estaba abierta pero fuera del scroll de la tira).
  const refs = useRef(new Map<string, HTMLDivElement>())
  useEffect(() => {
    if (activeId === null) return
    refs.current.get(activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const arrastre = useArrastrePestanas(tabs, onMover, refs)

  const tabMenu = menu ? tabs.find((t) => t.id === menu.id) : undefined
  // Los ids a cada lado salen del modelo (lo mismo que prueba `test-db-tabs`).
  const estadoTira: DbTabsState = { tabs, activeId }

  return (
    <div
      className="editor-tabs db-tabs"
      role="tablist"
      aria-label="Pestañas de bases de datos"
      onDragOver={arrastre.alSobrevolarTira}
      onDragLeave={arrastre.alSalirTira}
      onDrop={arrastre.soltar}
    >
      {tabs.map((tab) => (
        <DbTabsPestana
          key={tab.id}
          tab={tab}
          activa={tab.id === activeId}
          titulo={titulos.get(tab.id)}
          indicador={indicadores.get(tab.id) ?? null}
          motor={motores.get(tab.pane.conexionId)}
          arrastre={arrastre}
          refs={refs}
          onActivar={onActivar}
          onCerrar={onCerrar}
          onMenu={(x, y, id) => setMenu({ x, y, id })}
        />
      ))}
      {menu && tabMenu && (
        <ContextMenu x={menu.x} y={menu.y} items={itemsMenuPestana(estadoTira, tabMenu, props)} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
