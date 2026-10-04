// =============================================================================
// La plantilla del menú de aplicación: ninguno en Windows y Linux, el mínimo en
// macOS (Tessera, Edición, Ventana, con rótulos en español y sin `close` ni `reload`).
// Puro, para probarlo con `node` (`test-menu-aplicacion.mts`); lo monta `arranque.ts`
// con `Menu.buildFromTemplate`. Salir va por `before-quit` a `iniciarCierre`.
// Decisiones: docs/decisiones/app/atajos-y-menu.md
// =============================================================================

import type { MenuItemConstructorOptions } from 'electron'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/**
 * La plantilla del menú de aplicación para una plataforma, o `null` si esa
 * plataforma no debe tener menú. Explícita para poder probar las dos desde una.
 */
export function plantillaMenuAplicacion(
  plataforma: Plataforma = plataformaActual()
): MenuItemConstructorOptions[] | null {
  if (plataforma !== 'mac') return null
  return [
    // Sin `about` (ver el ADR): el «Acerca de» es una categoría de Configuración.
    {
      label: 'Tessera',
      submenu: [
        { role: 'hide', label: 'Ocultar Tessera' },
        { role: 'hideOthers', label: 'Ocultar otros' },
        { role: 'unhide', label: 'Mostrar todo' },
        { type: 'separator' },
        { role: 'quit', label: 'Salir de Tessera' }
      ]
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Traer todo al frente' }
      ]
    }
  ]
}
