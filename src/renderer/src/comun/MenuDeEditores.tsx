// =============================================================================
// MenuDeEditores: anfitrión único del menú contextual de los editores de código. Los editores se
// crean fuera de React, así que abren el menú por `menuEditor.ts` y aquí solo se pinta.
// Se monta una vez en `App`. Decisiones: docs/decisiones/renderer/menu-contextual.md
// =============================================================================

import { useSyncExternalStore } from 'react'
import { ContextMenu } from './ContextMenu'
import { cerrarMenuEditor, menuEditorAbierto, suscribirMenuEditor } from './menuEditor'

export function MenuDeEditores(): React.JSX.Element | null {
  const menu = useSyncExternalStore(suscribirMenuEditor, menuEditorAbierto)
  if (!menu) return null
  // Una opción elegida enfoca ella misma el editor; cerrar sin elegir (Escape, clic fuera) se lo devuelve.
  return <ContextMenu x={menu.x} y={menu.y} items={menu.entradas} onClose={() => cerrarMenuEditor(true)} />
}
