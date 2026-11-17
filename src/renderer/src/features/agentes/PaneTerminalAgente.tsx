// =============================================================================
// Pane de la terminal del agente: UN xterm con UNA sesión viva, atado a un target
// (perfil, proyecto, agente). La columna monta uno por target abierto (keep-alive):
// montar crea el xterm, la sesión se abre la primera vez que se mira y desmontar la
// cierra. El mosaico solo cambia clases y estilos de este nodo, nunca lo envuelve.
// Estado y efectos en `usePaneAgente`; aquí solo se compone lo que se pinta.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// Decisiones: docs/decisiones/agentes/pane-del-agente-sin-re-render.md
// =============================================================================

import { Presente } from '../../comun/Presente'
import { useUltimoValor } from '../../comun/presencia'
import { memo } from 'react'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { ChipsImagenTerminal } from '../terminales'
import { clasificarErrorArranque } from '../../../../shared/erroresDocker'
import { mismasPropsPane, nombreAgente, type PropsPaneTerminalAgente } from './tiposPaneAgente'
import { CabeceraPaneAgente } from './CabeceraPaneAgente'
import { clasePane, estiloCasilla } from './estiloPaneAgente'
import { MenusPaneAgente } from './MenusPaneAgente'
import { PanePieAgente } from './PanePieAgente'
import { PopoverMontaje } from './PopoverMontaje'
import { txPane } from './textosPane.ts'
import { alClicDerecho } from './terminalAgente'
import { usePaneAgente, type ModeloPaneAgente } from './usePaneAgente'
import { contarPintado } from '../../util/contadorRenders'

/** Sin cuenta para el agente en modo contenedor: la entrada es iniciar sesión. */
function SinCuenta({ m }: { m: ModeloPaneAgente }): React.JSX.Element {
  const t = txPane().terminal
  return (
    <div className="agent-empty-account">
      <div className="agent-empty-title">{t.sinCuenta(nombreAgente(m.p.pestanasAgente, m.p.target.agente))}</div>
      {/* Solo un agente que elige su modo tiene la opción de su equipo en el botón de cuenta. */}
      <div className="agent-empty-hint">{t.sinCuentaPista(nombreAgente(m.p.pestanasAgente, m.p.target.agente), m.p.onElegirModo !== undefined)}</div>
      <div className="agent-empty-actions">
        <button className="btn btn-primary" onClick={() => m.ui.setAnadiendoCuenta(true)}>
          {t.iniciarSesion}
        </button>
      </div>
    </div>
  )
}

/** El hueco del xterm (plegado sin cuenta) y las miniaturas de lo pegado. */
function CuerpoTerminal({ m }: { m: ModeloPaneAgente }): React.JSX.Element {
  const { r, s, ui, uiTerm, verSelector } = m
  return (
    <>
      <div
        className={`terminal-host${verSelector ? ' collapsed' : ''}`}
        ref={r.host}
        onClick={() => r.term.current?.focus()}
        onContextMenu={(e) => alClicDerecho(e, r, { ...uiTerm, setCtxMenu: ui.setCtxMenu }, s.sesionId)}
      />
      <ChipsImagenTerminal
        elementos={ui.previasImagen}
        onDescartar={(id) => ui.setPreviasImagen((prev) => prev.filter((x) => x.id !== id))}
      />
    </>
  )
}

function PaneTerminalAgenteSinMemo(props: PropsPaneTerminalAgente): React.JSX.Element {
  contarPintado('AgentTerminalPane', props.target.key)
  const m = usePaneAgente(props)
  const { p, s } = m
  const ultimoError = useUltimoValor(s.error || null)
  const { mosaico } = p
  return (
    <div
      className={clasePane(p.mostradoReal, mosaico)}
      // Dónde vive: el atajo de pantalla completa reconoce por aquí el agente de la terminal.
      data-lugar={p.lugar}
      aria-hidden={!p.mostradoReal}
      // En el mosaico cada casilla es una REGIÓN con nombre completo.
      role={mosaico ? 'region' : undefined}
      aria-label={mosaico ? `${mosaico.perfil} · ${mosaico.proyecto} · ${nombreAgente(p.pestanasAgente, p.target.agente)}` : undefined}
      style={estiloCasilla(mosaico, p.celda)}
      onFocusCapture={mosaico ? mosaico.onEnfocar : undefined}
    >
      <CabeceraPaneAgente m={m} />
      {m.montaje.verMontajeDb && <PopoverMontaje m={m} />}
      {/* El error llega envuelto por el IPC: `clasificarErrorArranque` lo desenvuelve. */}
      <Presente visible={!!s.error} className="mov-despliega">{ultimoError && <AvisoCaja tono="error" {...clasificarErrorArranque(ultimoError, txPane().terminal.noSePudoIniciar)} />}</Presente>
      {m.verSelector && <SinCuenta m={m} />}
      <CuerpoTerminal m={m} />
      <PanePieAgente m={m} />
      <MenusPaneAgente m={m} />
    </div>
  )
}

/**
 * Pane de la terminal del agente de un target. Memoizado: la columna mantiene vivos los
 * panes de todos los perfiles y sin esto cada render de la ventana los repintaría todos.
 */
export const PaneTerminalAgente = memo(PaneTerminalAgenteSinMemo, mismasPropsPane)
