// =============================================================================
// La plantilla del menú de aplicación: ninguno en Windows y Linux, el mínimo en
// macOS (Tessera, Edición, Ventana, con rótulos en el idioma de la app y sin `close` ni `reload`).
// Puro, para probarlo con `node` (`test-menu-aplicacion.mts`); lo monta `arranque.ts`
// con `Menu.buildFromTemplate`. Salir va por `before-quit` a `iniciarCierre`.
// Decisiones: docs/decisiones/app/atajos-y-menu.md
// =============================================================================

import type { MenuItemConstructorOptions } from 'electron'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { txApp } from './textos.ts'

/**
 * La plantilla del menú de aplicación para una plataforma, o `null` si esa
 * plataforma no debe tener menú. Explícita para poder probar las dos desde una.
 */
export function plantillaMenuAplicacion(
  plataforma: Plataforma = plataformaActual()
): MenuItemConstructorOptions[] | null {
  if (plataforma !== 'mac') return null
  const t = txApp().menu
  return [
    // Sin `about` (ver el ADR): el «Acerca de» es una categoría de Configuración.
    {
      label: 'Tessera',
      submenu: [
        { role: 'hide', label: t.ocultar },
        { role: 'hideOthers', label: t.ocultarOtros },
        { role: 'unhide', label: t.mostrarTodo },
        { type: 'separator' },
        { role: 'quit', label: t.salir }
      ]
    },
    {
      label: t.edicion,
      submenu: [
        { role: 'undo', label: t.deshacer },
        { role: 'redo', label: t.rehacer },
        { type: 'separator' },
        { role: 'cut', label: t.cortar },
        { role: 'copy', label: t.copiar },
        { role: 'paste', label: t.pegar },
        { role: 'selectAll', label: t.seleccionarTodo }
      ]
    },
    {
      label: t.ventana,
      submenu: [
        { role: 'minimize', label: t.minimizar },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: t.traerAlFrente }
      ]
    }
  ]
}
