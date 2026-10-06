// =============================================================================
// Pane de la terminal del agente: UN xterm con UNA sesión viva, atado a un target
// (perfil, proyecto, agente). La columna monta uno por target abierto (keep-alive):
// montar crea el xterm, la sesión se abre la primera vez que se mira y desmontar la
// cierra. El mosaico solo cambia clases y estilos de este nodo, nunca lo envuelve.
// Estado y efectos en `useAgentPane`; aquí solo se compone lo que se pinta.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// Decisiones: docs/decisiones/agentes/pane-del-agente-sin-re-render.md
// =============================================================================

import { memo } from 'react'
import { SearchBox } from '../../comun/SearchBox'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { TerminalImageChips } from '../terminales'
import { clasificarErrorArranque } from '../../../../shared/dockerErrors'
import { AGENT_LABEL, mismasPropsPane, type AgentTerminalPaneProps } from './agentPaneTipos'
import { CabeceraAgentPane } from './CabeceraAgentPane'
import { clasePane, estiloCasilla } from './estiloAgentPane'
import { MenusAgentPane } from './MenusAgentPane'
import { PieAgentPane } from './PieAgentPane'
import { PopoverMontaje } from './PopoverMontaje'
import { alClicDerecho, closeSearch, runSearch } from './terminalAgente'
import { useAgentPane, type ModeloAgentPane } from './useAgentPane'
import { contarRender } from '../../util/contadorRenders'

/** Sin cuenta para el agente en modo contenedor: la entrada es iniciar sesión. */
function SinCuenta({ m }: { m: ModeloAgentPane }): React.JSX.Element {
  return (
    <div className="agent-empty-account">
      <div className="agent-empty-title">Sin cuenta para {AGENT_LABEL[m.p.target.agente]}</div>
      <div className="agent-empty-hint">
        Inicia sesión con la cuenta de <strong>{m.p.profileName}</strong> para este agente. Se
        usará en todos los proyectos de este perfil en modo Docker.
      </div>
      <div className="agent-empty-actions">
        <button className="btn btn-primary" onClick={() => m.ui.setAddingAccount(true)}>
          Iniciar sesión
        </button>
      </div>
    </div>
  )
}

/** El hueco del xterm (plegado sin cuenta), el buscador y las miniaturas de lo pegado. */
function CuerpoTerminal({ m }: { m: ModeloAgentPane }): React.JSX.Element {
  const { r, s, ui, uiTerm, showSelector } = m
  return (
    <>
      <div
        className={`terminal-host${showSelector ? ' collapsed' : ''}`}
        ref={r.host}
        onClick={() => r.term.current?.focus()}
        onContextMenu={(e) => alClicDerecho(e, r, { ...uiTerm, setCtxMenu: ui.setCtxMenu }, s.sessionId)}
      />
      {ui.searchOpen && !showSelector && (
        <SearchBox
          onFind={(q, o) => runSearch(r, uiTerm, q, o, 'next')}
          onNavigate={(q, o, d) => runSearch(r, uiTerm, q, o, d)}
          results={ui.searchResults}
          onClose={() => closeSearch(r, uiTerm)}
        />
      )}
      <TerminalImageChips
        items={ui.imagePreviews}
        onDismiss={(id) => ui.setImagePreviews((prev) => prev.filter((x) => x.id !== id))}
      />
    </>
  )
}

function AgentTerminalPaneSinMemo(props: AgentTerminalPaneProps): React.JSX.Element {
  contarRender('AgentTerminalPane', props.target.key)
  const m = useAgentPane(props)
  const { p, s } = m
  const { mosaico } = p
  return (
    <div
      className={clasePane(p.mostradoReal, mosaico)}
      // Dónde vive: el atajo de pantalla completa reconoce por aquí el agente de la terminal.
      data-lugar={p.lugar}
      aria-hidden={!p.mostradoReal}
      // En el mosaico cada casilla es una REGIÓN con nombre completo.
      role={mosaico ? 'region' : undefined}
      aria-label={mosaico ? `${mosaico.perfil} · ${mosaico.proyecto} · ${AGENT_LABEL[p.target.agente]}` : undefined}
      style={estiloCasilla(mosaico, p.celda)}
      onFocusCapture={mosaico ? mosaico.onEnfocar : undefined}
    >
      <CabeceraAgentPane m={m} />
      {m.montaje.showDbMount && <PopoverMontaje m={m} />}
      {/* El error llega envuelto por el IPC: `clasificarErrorArranque` lo desenvuelve. */}
      {s.error && <AvisoCaja tono="error" {...clasificarErrorArranque(s.error, 'No se pudo iniciar el agente')} />}
      {m.showSelector && <SinCuenta m={m} />}
      <CuerpoTerminal m={m} />
      <PieAgentPane m={m} />
      <MenusAgentPane m={m} />
    </div>
  )
}

/**
 * Pane de la terminal del agente de un target. Memoizado: la columna mantiene vivos los
 * panes de todos los perfiles y sin esto cada render de la ventana los repintaría todos.
 */
export const AgentTerminalPane = memo(AgentTerminalPaneSinMemo, mismasPropsPane)
