// =============================================================================
// Capas que un `TerminalPane` pinta sobre su xterm, como hermanas del hueco: el
// buscador, las miniaturas de las imágenes pegadas y el menú de Copiar/Pegar. Devuelve
// un fragmento (sin envoltorio: el CSS selecciona por la estructura del pane).
// =============================================================================

import './sshTerminal.css'
import { useEffect } from 'react'
import { SearchBox } from '../../comun/SearchBox'
import { TerminalImageChips } from './TerminalImageChips'
import { txTerminales } from './textos.ts'
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

  const t = txTerminales()
  return (
    <div className="ctx-menu" style={{ top: y, left: x }} onMouseDown={(e) => e.stopPropagation()}>
      <button className="ctx-menu-item" onClick={onCopy} disabled={!canCopy}>
        {t.copiar}
      </button>
      <button className="ctx-menu-item" onClick={onPaste}>
        {t.pegar}
      </button>
    </div>
  )
}

/** Lo que una sesión SSH pinta sobre su xterm; los dos `null` en una local. */
export interface CapasSsh {
  /** Mientras no ha dicho nada: su texto y cómo cancelarla (`null` si aún no hay sesión que cancelar). */
  conectando: { texto: string; onCancelar: (() => void) | null } | null
  /** Terminada: qué pasó y cómo reconectar (`null` si su conexión se eliminó). */
  fin: { motivo: string; enVuelo: boolean; onReconectar: (() => void) | null } | null
}

/** La franja de una sesión SSH terminada: qué pasó y «Reconectar», que también hace Intro. */
function FranjaFinSsh({ fin }: { fin: NonNullable<CapasSsh['fin']> }): React.JSX.Element {
  const t = txTerminales()
  return (
    <div className="terminal-fin-ssh" role="status">
      <span className="terminal-fin-ssh-motivo">{fin.motivo}</span>
      {fin.onReconectar ? (
        <button className="btn terminal-fin-ssh-boton" onClick={fin.onReconectar} disabled={fin.enVuelo} title={t.reconectarIntro}>
          {fin.enVuelo ? t.reconectando : t.reconectar}
        </button>
      ) : (
        <span className="terminal-fin-ssh-nota">{t.conexionEliminada}</span>
      )}
    </div>
  )
}

const SIN_SSH: CapasSsh = { conectando: null, fin: null }

/**
 * Buscador, miniaturas pegadas y menú contextual de una terminal, según su `InterfazTerminal`; y, en una
 * sesión SSH, el «Conectando a…» mientras no ha dicho nada y la franja de reconexión al terminar.
 */
export function CapasTerminal({ ui, ssh = SIN_SSH }: { ui: InterfazTerminal; ssh?: CapasSsh }): React.JSX.Element {
  const { ctxMenu, setCtxMenu } = ui
  const { conectando, fin } = ssh
  return (
    <>
      {/* Capa ABSOLUTA: no empuja ni encoge la xterm; solo «Cancelar» recibe el ratón. */}
      {conectando !== null && (
        <div className="terminal-conectando" role="status">
          <span className="terminal-conectando-texto">{conectando.texto}</span>
          {conectando.onCancelar && (
            <button className="terminal-conectando-cancelar" onClick={conectando.onCancelar}>
              {txTerminales().cancelar}
            </button>
          )}
        </div>
      )}
      {fin !== null && <FranjaFinSsh fin={fin} />}
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
