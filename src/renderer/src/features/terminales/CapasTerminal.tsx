// =============================================================================
// Capas que un `TerminalPane` pinta sobre su xterm, como hermanas del hueco: el
// buscador, las miniaturas de las imágenes pegadas y el menú de Copiar/Pegar. Devuelve
// un fragmento (sin envoltorio: el CSS selecciona por la estructura del pane).
// =============================================================================

import { ContextMenu } from '../../comun/ContextMenu'
import { Presente } from '../../comun/Presente'
import './sshTerminal.css'
import { useRef } from 'react'
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
  const t = txTerminales()
  return <ContextMenu x={x} y={y} onClose={onClose} items={[
    { label: t.copiar, onClick: onCopy, disabled: !canCopy },
    { label: t.pegar, onClick: onPaste }
  ]} />
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
    <>
      <span className="terminal-fin-ssh-motivo">{fin.motivo}</span>
      {fin.onReconectar ? (
        <button className="btn terminal-fin-ssh-boton" onClick={fin.onReconectar} disabled={fin.enVuelo} title={t.reconectarIntro}>
          {fin.enVuelo ? t.reconectando : t.reconectar}
        </button>
      ) : (
        <span className="terminal-fin-ssh-nota">{t.conexionEliminada}</span>
      )}
    </>
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
  const ultimoConectando = useRef(conectando)
  const ultimoFin = useRef(fin)
  if (conectando) ultimoConectando.current = conectando
  if (fin) ultimoFin.current = fin
  return (
    <>
      {/* Capa ABSOLUTA: no empuja ni encoge la xterm; solo «Cancelar» recibe el ratón. */}
      <Presente visible={conectando !== null} className="terminal-conectando mov-aparece terminal-fundido" role="status">
        <span className="terminal-conectando-texto">{ultimoConectando.current?.texto}</span>
        <button
          className="terminal-conectando-cancelar"
          onClick={conectando?.onCancelar ?? undefined}
          disabled={!conectando?.onCancelar}
          aria-hidden={!conectando?.onCancelar}
        >
          {txTerminales().cancelar}
        </button>
      </Presente>
      <Presente visible={fin !== null} className="terminal-fin-ssh mov-aparece terminal-fundido" role="status">
        {ultimoFin.current && <FranjaFinSsh fin={ultimoFin.current} />}
      </Presente>
      {/* Buscar y navegar van al mismo runSearch: el SearchAddon reancla desde la posición actual. */}
      <Presente visible={ui.searchOpen} className="mov-aparece mov-desde-arriba" style={{ position: 'absolute', top: 0, right: 0, zIndex: 3 }}>
        <SearchBox
          onFind={(q, o) => ui.runSearch(q, o, 'next')}
          onNavigate={ui.runSearch}
          results={ui.searchResults}
          onClose={ui.closeSearch}
        />
      </Presente>
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
