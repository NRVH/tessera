// =============================================================================
// PestanasBd: la tira de pestañas del área de bases de datos (tablas, fuentes, consolas,
// colecciones y claves abiertas del perfil que se ve), sobre las clases de la tira del
// editor para verse idéntica; lo propio va en `area.css` y solo AÑADE. Cerrar no
// cierra aquí: pide cerrar (`onCerrar`) y el área pregunta a la consola.
// Decisiones: docs/decisiones/bd/ui-area-tira-de-pestanas.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { DbMotor } from '../../../../shared/db-ipc'
import { MenuContextual } from '../../comun/MenuContextual'
import type { PestanaBd, EstadoPestanasBd, IndicadorPestana, TituloPestana } from './modeloPestanasBd'
import { useArrastrePestanas } from '../../comun/useArrastrePestanas'
import { PestanaTiraBd } from './PestanaTiraBd'
import { elementosMenuPestana } from './MenuPestanasBd'
import { txArea } from './textosArea.ts'

/** Tipo propio del arrastre: solo lo nuestro pinta raya y se suelta en la tira. */
const TIPO_ARRASTRE = 'application/x-tessera-db-pestana'

interface PropsPestanasBd {
  pestanas: readonly PestanaBd[]
  pestanaActivaId: string | null
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

export function PestanasBd(props: PropsPestanasBd): React.JSX.Element {
  const { pestanas, pestanaActivaId, titulos, indicadores, motores, onActivar, onCerrar, onMover } = props
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  // La activa se trae a la vista al cambiar (abrir desde el árbol una pestaña que ya
  // estaba abierta pero fuera del scroll de la tira).
  const refs = useRef(new Map<string, HTMLDivElement>())
  useEffect(() => {
    if (pestanaActivaId === null) return
    refs.current.get(pestanaActivaId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pestanaActivaId])

  const arrastre = useArrastrePestanas(TIPO_ARRASTRE, pestanas, onMover, refs)

  const menuPestana = menu ? pestanas.find((t) => t.id === menu.id) : undefined
  // Los ids a cada lado salen del modelo (lo mismo que prueba `test-pestanas-bd`).
  const estadoTira: EstadoPestanasBd = { pestanas, pestanaActivaId }

  return (
    <div
      className="editor-tabs db-tabs"
      role="tablist"
      aria-label={txArea().tiraAria}
      onDragOver={arrastre.alSobrevolarTira}
      onDragLeave={arrastre.alSalirTira}
      onDrop={arrastre.soltar}
    >
      {pestanas.map((pestana) => (
        <PestanaTiraBd
          key={pestana.id}
          pestana={pestana}
          activa={pestana.id === pestanaActivaId}
          titulo={titulos.get(pestana.id)}
          indicador={indicadores.get(pestana.id) ?? null}
          motor={motores.get(pestana.pane.conexionId)}
          arrastre={arrastre}
          refs={refs}
          onActivar={onActivar}
          onCerrar={onCerrar}
          onMenu={(x, y, id) => setMenu({ x, y, id })}
        />
      ))}
      {menu && menuPestana && (
        <MenuContextual x={menu.x} y={menu.y} items={elementosMenuPestana(estadoTira, menuPestana, props)} onCerrar={() => setMenu(null)} />
      )}
    </div>
  )
}
