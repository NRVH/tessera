// =============================================================================
// El estado de vista del visor de clave: la tabla del contenido, la fila elegida y su
// detalle, el modo de texto, el panel de detalle y el menú contextual de una fila.
// Lo usa `DbClavePane`; la lógica de tablas y detalles está en `visorClaves.ts`.
// =============================================================================

import { useMemo, useState } from 'react'
import type { DbKvContenido, DbKvValor } from '../../../../../shared/db-claves-ipc'
import { detalleDeFila, tablaDeContenido, type ModoVista, type ParteDetalle, type TablaValor } from './visorClaves'
import { textoParte } from './PiezasVisorClave'
import { copiarTexto } from '../documentos/utilPanes'
import { type ContextMenuEntry } from '../../../comun/ContextMenu'
import { IconoCopiar } from '../../../comun/iconosMenu'

export interface VisorClave {
  contenido: DbKvContenido | null
  tabla: TablaValor | null
  setSeleccion: (clave: string) => void
  /** Índice de la fila elegida en la tabla, o -1. */
  indiceSel: number
  partes: ParteDetalle[]
  modoElegido: ModoVista | null
  setModoElegido: (m: ModoVista | null) => void
  panelDetalle: boolean
  setPanelDetalle: React.Dispatch<React.SetStateAction<boolean>>
  menu: { x: number; y: number; items: ContextMenuEntry[] } | null
  setMenu: (m: { x: number; y: number; items: ContextMenuEntry[] } | null) => void
  abrirMenuFila: (i: number, x: number, y: number) => void
}

/** Estado de la vista del valor leído; el menú de una fila ofrece copiar cada parte de su detalle. */
export function useVisorClave(valor: DbKvValor | null): VisorClave {
  const contenido: DbKvContenido | null = valor?.contenido ?? null
  const tabla: TablaValor | null = useMemo(() => (contenido ? tablaDeContenido(contenido) : null), [contenido])
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const indiceSel = tabla && seleccion !== null ? tabla.filas.findIndex((f) => f.clave === seleccion) : -1
  const partes: ParteDetalle[] = useMemo(() => (contenido && indiceSel >= 0 ? detalleDeFila(contenido, indiceSel) : []), [contenido, indiceSel])
  const [modoElegido, setModoElegido] = useState<ModoVista | null>(null)
  const [panelDetalle, setPanelDetalle] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

  const abrirMenuFila = (i: number, x: number, y: number): void => {
    if (!tabla || !contenido) return
    const f = tabla.filas[i]
    if (!f) return
    setSeleccion(f.clave)
    const items: ContextMenuEntry[] = detalleDeFila(contenido, i)
      .slice(0, 8)
      .map((parte) => ({
        label: `Copiar ${parte.titulo.length > 30 ? `${parte.titulo.slice(0, 30)}…` : parte.titulo}`,
        icon: <IconoCopiar />,
        onClick: () => copiarTexto(textoParte(parte), parte.titulo)
      }))
    setMenu({ x, y, items })
  }

  return { contenido, tabla, setSeleccion, indiceSel, partes, modoElegido, setModoElegido, panelDetalle, setPanelDetalle, menu, setMenu, abrirMenuFila }
}
