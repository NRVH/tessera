// =============================================================================
// Capas que un `TerminalPane` pinta sobre su xterm, como hermanas del hueco: el
// buscador, las miniaturas de las imágenes pegadas y el menú de Copiar/Pegar. Devuelve
// un fragmento (sin envoltorio: el CSS selecciona por la estructura del pane).
// =============================================================================

import { useEffect } from 'react'
import { SearchBox } from '../../comun/SearchBox'
import { TerminalImageChips } from './TerminalImageChips'
import type { InterfazTerminal } from './useInterfazTerminal'

interface TerminalContextMenuProps {
  x: number
  y: number
  canCopy: boolean
  onCopy: () => void
  onPaste: () => void
  onClose: () => void
}

/**
 * Popover de Copiar/Pegar (clic derecho): `position: fixed` en (x, y), se cierra al hacer
 * clic fuera o con Escape y detiene su propio mousedown para no auto-cerrarse.
 */
function TerminalContextMenu({
  x,
  y,
  canCopy,
  onCopy,
  onPaste,
  onClose
}: TerminalContextMenuProps): React.JSX.Element {
  useEffect(() => {
    function onDown(): void {
      onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="ctx-menu" style={{ top: y, left: x }} onMouseDown={(e) => e.stopPropagation()}>
      <button className="ctx-menu-item" onClick={onCopy} disabled={!canCopy}>
        Copiar
      </button>
      <button className="ctx-menu-item" onClick={onPaste}>
        Pegar
      </button>
    </div>
  )
}

/** Buscador, miniaturas pegadas y menú contextual de una terminal, según su `InterfazTerminal`. */
export function CapasTerminal({ ui }: { ui: InterfazTerminal }): React.JSX.Element {
  const { ctxMenu, setCtxMenu } = ui
  return (
    <>
      {/* Buscar y navegar van al mismo runSearch: el SearchAddon reancla desde la posición actual. */}
      {ui.searchOpen && (
        <SearchBox
          onFind={(q, o) => ui.runSearch(q, o, 'next')}
          onNavigate={ui.runSearch}
          results={ui.searchResults}
          onClose={ui.closeSearch}
        />
      )}
      <TerminalImageChips
        items={ui.imagePreviews}
        onDismiss={(id) => ui.setImagePreviews((prev) => prev.filter((x) => x.id !== id))}
      />
      {ctxMenu && (
        <TerminalContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          canCopy={ctxMenu.hasSelection}
          onCopy={() => {
            ui.copySelection()
            setCtxMenu(null)
            ui.enfocar()
          }}
          onPaste={() => {
            ui.pasteFromClipboard()
            setCtxMenu(null)
            ui.enfocar()
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  )
}
