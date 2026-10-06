// =============================================================================
// Pie del pane del agente: uso de la cuenta y contexto de la conversación (solo en
// pantalla y con cuenta) y el botón de reinicio, abajo y lejos de maximizar porque es
// destructivo. Qué ofrece el botón lo decide `botonReinicio` (puro, con prueba); un agente que no
// es pestaña y está hibernado ofrece en su lugar «Despertar» (`puedeDespertarseAMano`).
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { botonReinicio } from '../terminales'
import { useStorePestanas } from '../pestanas'
import { ContextRing } from './ContextRing'
import { despertarAlVerse, puedeDespertarseAMano } from './hibernacionFueraDePestanas'
import { actualizarHibernadosFueraDePestanas } from './store'
import { UsageBars } from './UsageBars'
import { ETIQUETA_REINICIO, HOST_ACCOUNT_ID, MAX_CONTAINER_RECOVERY_ATTEMPTS } from './agentPaneTipos'
import { ReloadIcon } from './iconosAgentPane'
import { compactConversation } from './terminalAgente'
import type { ModeloAgentPane } from './useAgentPane'

/**
 * Qué ofrece el botón. `puedeAbrir` replica las condiciones del reconcile, y «preparado
 * para actualizar» cuenta como un reinicio en vuelo con otro gerundio.
 */
function estadoBoton(m: ModeloAgentPane): ReturnType<typeof botonReinicio> {
  const { p, s } = m
  return botonReinicio({
    status: s.status,
    sessionId: s.sessionId,
    reloading: s.reloading || s.actualizando,
    recuperando: s.recuperando,
    faseRecuperacion: s.recovery?.phase ?? null,
    intentoRecuperacion: s.recovery?.phase === 'recovering' ? s.recovery.attempt : 0,
    maxIntentos: MAX_CONTAINER_RECOVERY_ATTEMPTS,
    hibernated: p.hibernated,
    puedeAbrir: p.dbReady && (p.hostMode || !!p.selectedAccountId),
    etiquetaNormal: 'Reiniciar',
    etiquetaProgreso: s.actualizando ? 'Actualizando…' : 'Reiniciando…',
    // Sólo en nativo: las de contenedor llevan el CLI de la imagen y su propio botón.
    versiones: p.hostMode ? p.versionesAgente : null
  })
}

/**
 * Uso (cuenta) y contexto (chat), agrupados para que al estrecharse el pie la pieza que
 * queda siga anclada a la izquierda. Los dos se callan fuera de pantalla (keep-alive y
 * columna plegada) y se ponen al día al volver a mostrarse.
 */
function EstadisticasPie({ m }: { m: ModeloAgentPane }): React.JSX.Element {
  const { p, s, r, activated, showSelector } = m
  const { agente, projectHostPath } = p.target
  const accountId = p.hostMode ? HOST_ACCOUNT_ID : p.selectedAccountId
  const mode = p.hostMode ? 'host' : 'container'
  return (
    <div className="agent-footer-stats">
      <UsageBars
        agente={agente}
        accountId={accountId}
        mode={mode}
        enabled={p.enPantallaReal && activated && !showSelector}
      />
      <ContextRing
        agente={agente}
        accountId={accountId}
        mode={mode}
        projectHostPath={projectHostPath}
        enabled={p.enPantallaReal && activated && !showSelector}
        conversationEpoch={s.conversationEpoch}
        // Compactar escribe en el pty: exige sesión VIVA. El % se lee del disco.
        canCompact={!!s.sessionId && s.status === 'live' && !s.actualizando}
        onCompact={() => compactConversation(r)}
      />
    </div>
  )
}

/**
 * «Despertar» en el sitio del botón de reinicio: un agente que no es pestaña (el de datos, el de la
 * terminal) hibernado no tiene una pestaña cuyo clic lo despierte, y si se estaba mirando al hibernar,
 * tampoco «volver a verlo». Lo desmarca y su pane abre otra sesión.
 */
function BotonDespertar({ clave }: { clave: string }): React.JSX.Element {
  return (
    <button
      className="btn btn-icon boton-reinicio agent-reload-btn"
      onClick={() => actualizarHibernadosFueraDePestanas((marcados) => despertarAlVerse(marcados, clave))}
      title="Este agente cerró su sesión al hibernarse: despiértalo para abrir otra"
    >
      <ReloadIcon />
      Despertar
    </button>
  )
}

/**
 * Pie del pane. El botón es de ICONO en reposo y despliega su nombre al pasar el ratón;
 * cuando el estado tiene algo que decir («Reintentar», «Recuperando… (1/2)») la
 * etiqueta va fija y el hover no añade nada.
 */
export function PieAgentPane({ m }: { m: ModeloAgentPane }): React.JSX.Element {
  const boton = estadoBoton(m)
  const perfilHibernando = useStorePestanas((s) => s.hibernando.has(m.p.target.profileId))
  if (puedeDespertarseAMano(m.p.lugar, m.p.hibernated, perfilHibernando)) {
    return (
      <footer className="agent-pane-footer">
        <EstadisticasPie m={m} />
        <BotonDespertar clave={m.p.target.key} />
      </footer>
    )
  }
  return (
    <footer className="agent-pane-footer">
      <EstadisticasPie m={m} />
      <button
        className={`btn btn-icon boton-reinicio agent-reload-btn${boton.soloIcono ? ' solo-icono' : ''}`}
        onClick={() => m.sesion.reiniciar(boton.accion)}
        disabled={!boton.habilitado}
        title={boton.titulo}
        aria-label={boton.soloIcono ? ETIQUETA_REINICIO : boton.etiqueta}
      >
        <ReloadIcon />
        {boton.soloIcono ? (
          // El `<span>` de dentro no es decorativo: la caja de fuera anima
          // `grid-template-columns` y ésta es la que recorta (ver el CSS).
          <span className="boton-reinicio-etiqueta">
            <span>{ETIQUETA_REINICIO}</span>
          </span>
        ) : (
          boton.etiqueta
        )}
      </button>
    </footer>
  )
}
