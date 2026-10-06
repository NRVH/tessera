// =============================================================================
// Cabecera del pane del agente. En la vista normal: selector de agente, conversación
// (historial y chat nuevo), bases montadas, cuenta, maximizar y, en el agente de la terminal,
// cerrarlo. En una casilla del
// mosaico la identidad va entera (punto, perfil, proyecto, agente, modo y bases) y el
// selector de agente se va, porque cambiaría el agente de TODO el perfil.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { ProfileDot, ModeIcon } from '../pestanas'
import { PuntoMosaico } from '../mosaico'
import { etiquetaModPrincipal } from '../../util/atajos'
import { IconoCerrar } from '../../comun/iconosMenu'
import { AGENT_LABEL, AGENT_LABEL_SHORT, type MosaicoPane } from './agentPaneTipos'
import { rotuloHistorialConversaciones, textosMontajeBases } from './textosMontajeBases'
import { IconoMaximizar, IconoRestaurar } from '../../comun/iconosPanel'
import {
  AccountIcon, CaretIcon, DbMountIcon, HistoryIcon, IconoCaret, IrAlProyectoIcon, NewChatIcon, UpdateIcon
} from './iconosAgentPane'
import type { ModeloAgentPane } from './useAgentPane'

interface PropsParte {
  m: ModeloAgentPane
}

/**
 * Bases montadas: icono con el número montado que abre el popover. Es ESTADO, así que en
 * una casilla va con la identidad y en la vista normal junto a la cuenta.
 */
function BotonBases({ m }: PropsParte): React.JSX.Element | null {
  const { p, montaje } = m
  if (!p.onChangeDbMounted) return null
  const textosBases = textosMontajeBases(p.lugar, p.dbMounted.length)
  return (
    <button
      type="button"
      className={`btn btn-icon db-mount-btn${p.dbMounted.length > 0 ? ' activo' : ''}`}
      onClick={() => montaje.setShowDbMount((v) => !v)}
      title={textosBases.rotuloBoton}
      aria-label="Bases de datos montadas"
      aria-pressed={montaje.showDbMount}
    >
      <DbMountIcon />
      {p.dbMounted.length > 0 && (
        <span className="db-mount-badge" aria-hidden="true">
          {p.dbMounted.length}
        </span>
      )}
    </button>
  )
}

/** El nombre de la casilla es también su selector de proyecto (cuesta cero píxeles). */
function BotonNombreCasilla({ m, mosaico }: PropsParte & { mosaico: MosaicoPane }): React.JSX.Element {
  const { menuDestinos, setMenuDestinos } = m.menus
  return (
    <button
      type="button"
      className="casilla-nombre-btn"
      // El menú se cierra con el mousedown global; sin esto, pulsar el botón con el menú
      // abierto lo cerraría y el click lo reabriría.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setMenuDestinos((mm) => (mm ? null : { x: r.left, y: r.bottom + 4 }))
      }}
      aria-haspopup="menu"
      aria-expanded={menuDestinos !== null}
      title={`${mosaico.perfil} · ${mosaico.proyecto} · ${AGENT_LABEL[m.p.target.agente]} — elegir qué proyecto se ve aquí`}
    >
      <span className="casilla-nombre">
        <span className="casilla-perfil">{mosaico.perfil}</span>
        <span className="casilla-sep" aria-hidden="true">
          ·
        </span>
        <span className="casilla-proyecto">{mosaico.proyecto}</span>
      </span>
      <IconoCaret />
    </button>
  )
}

function tituloOtroAgente(otro: NonNullable<MosaicoPane['otroAgente']>): string {
  if (otro.trabajando) return `${AGENT_LABEL[otro.agente]} está TRABAJANDO en este proyecto: pulsa para verlo aquí`
  if (otro.sinVer) return `${AGENT_LABEL[otro.agente]} terminó y no lo has revisado: pulsa para verlo aquí`
  return `Ver ${AGENT_LABEL[otro.agente]} de este proyecto en esta casilla`
}

/** La etiqueta del agente es el conmutador al otro agente del proyecto, SOLO en esta casilla. */
function ChipAgente({ m, mosaico }: PropsParte & { mosaico: MosaicoPane }): React.JSX.Element {
  const { agente } = m.p.target
  const otro = mosaico.otroAgente
  if (!otro) return <span className="casilla-agente">{AGENT_LABEL_SHORT[agente]}</span>
  return (
    <button
      type="button"
      className="casilla-agente casilla-agente-btn"
      onClick={() => {
        if (mosaico.otroAgente) mosaico.onElegirDestino(mosaico.otroAgente.key)
      }}
      title={tituloOtroAgente(otro)}
      aria-label={`Cambiar a ${AGENT_LABEL[otro.agente]}`}
    >
      {AGENT_LABEL_SHORT[agente]}
      {/* El otro agente reclama: sin este punto su trabajo quedaría invisible. */}
      {(otro.trabajando || otro.sinVer) && (
        <PuntoMosaico color={mosaico.color} trabajando={otro.trabajando} sinVer={otro.sinVer} />
      )}
    </button>
  )
}

/** Glifo del modo (cubo = contenedor, monitor = nativo); también cambia el modo del proyecto. */
function BotonModo({ m, mosaico }: PropsParte & { mosaico: MosaicoPane }): React.JSX.Element {
  const { hostMode } = m.p
  const icono = <ModeIcon windows={hostMode} color={hostMode ? 'var(--mode-windows)' : 'var(--azul)'} size={13} />
  if (!mosaico.onCambiarModo) return icono
  const { menuModo, setMenuModo } = m.menus
  return (
    <button
      type="button"
      className="casilla-modo-btn"
      // Cambiar de modo remonta el pane: a mitad de una actualización no hay relanzar.
      disabled={m.s.actualizando}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setMenuModo((mm) => (mm ? null : { x: r.left, y: r.bottom + 4 }))
      }}
      aria-haspopup="menu"
      aria-expanded={menuModo !== null}
      title={`Modo ${hostMode ? 'nativo' : 'contenedor'}: cambiarlo reinicia la sesión de este proyecto`}
      aria-label={`Modo ${hostMode ? 'nativo' : 'contenedor'}`}
    >
      {icono}
    </button>
  )
}

/** Identidad completa de la casilla; el punto es a la vez color del perfil y estado del agente. */
function IdentidadCasilla({ m, mosaico }: PropsParte & { mosaico: MosaicoPane }): React.JSX.Element {
  return (
    <span className="casilla-identidad">
      <ProfileDot
        state={m.s.status === 'booting' && !m.showSelector ? 'waking' : 'active'}
        color={mosaico.color ?? 'var(--accent)'}
        working={mosaico.trabajando}
        attention={mosaico.terminadaSinVer}
      />
      <BotonNombreCasilla m={m} mosaico={mosaico} />
      <ChipAgente m={m} mosaico={mosaico} />
      <BotonModo m={m} mosaico={mosaico} />
      <BotonBases m={m} />
    </span>
  )
}

/** Selector segmentado de agente; el CSS elige nombre completo o abreviatura por ancho. */
function SelectorAgente({ m }: PropsParte): React.JSX.Element {
  const { agentsInProfile, onSelectAgent } = m.p
  const { agente } = m.p.target
  return (
    <span className="agent-switch" role="tablist" aria-label="Agente">
      {agentsInProfile.map((a) => (
        <button
          key={a}
          type="button"
          role="tab"
          aria-selected={a === agente}
          className={`agent-switch-btn${a === agente ? ' active' : ''}`}
          onClick={() => {
            if (a !== agente) onSelectAgent?.(m.p.target.profileId, a)
          }}
          title={`Cambiar a ${AGENT_LABEL[a]}`}
          aria-label={AGENT_LABEL[a]}
        >
          <span className="agent-switch-full">{AGENT_LABEL[a]}</span>
          <span className="agent-switch-short" aria-hidden="true">
            {AGENT_LABEL_SHORT[a]}
          </span>
        </button>
      ))}
    </span>
  )
}

/**
 * Historial y chat nuevo, pegados al selector porque actúan sobre la conversación del
 * agente elegido. El historial va primero: el chat nuevo abandona el hilo en curso.
 */
function AccionesConversacion({ m }: PropsParte): React.JSX.Element {
  const { s, ui, p } = m
  return (
    <span className="panel-title-actions">
      <button
        type="button"
        className="btn btn-icon"
        onClick={() => ui.setShowHistory(true)}
        disabled={s.actualizando}
        title={rotuloHistorialConversaciones(p.lugar)}
        aria-label="Historial de conversaciones"
      >
        <HistoryIcon />
      </button>
      <button
        type="button"
        className="btn btn-icon"
        onClick={() => m.sesion.nueva()}
        disabled={!s.sessionId || s.status === 'booting' || s.reloading || s.actualizando}
        title="Nueva conversación (empieza un chat nuevo, sin reanudar el último)"
        aria-label="Nueva conversación"
      >
        <NewChatIcon />
      </button>
    </span>
  )
}

/** Botón de cuenta (solo en contenedor y con cuenta): su menú cierra sesión o la elimina. */
function BotonCuenta({ m }: PropsParte): React.JSX.Element | null {
  const { currentAccount } = m
  if (m.p.hostMode || !currentAccount) return null
  return (
    <button
      type="button"
      className="account-btn"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        m.ui.setAccountMenu({ x: r.left, y: r.bottom + 4 })
      }}
      title={`Cuenta: ${currentAccount.nombre}`}
    >
      <AccountIcon />
      <span className="account-btn-name">{currentAccount.nombre}</span>
      <CaretIcon />
    </button>
  )
}

/** En una casilla: ampliar la casilla (mismo gesto que maximizar) e ir al proyecto. */
function AccionesCasilla({ mosaico }: { mosaico: MosaicoPane }): React.JSX.Element {
  const mod = etiquetaModPrincipal()
  return (
    <>
      <button
        type="button"
        className={`btn btn-icon${mosaico.ampliada ? ' active' : ''}`}
        onClick={mosaico.onAmpliar}
        aria-pressed={mosaico.ampliada}
        title={
          mosaico.ampliada
            ? `Restaurar: vuelve a enseñar todo el mosaico (${mod}+Shift+Enter)`
            : `Ampliar: esta terminal ocupa todo el mosaico (${mod}+Shift+Enter)`
        }
        aria-label={mosaico.ampliada ? 'Restaurar el mosaico' : 'Ampliar esta terminal'}
      >
        {mosaico.ampliada ? <IconoRestaurar /> : <IconoMaximizar />}
      </button>
      <button
        type="button"
        className="btn btn-icon"
        onClick={mosaico.onIrAlProyecto}
        title="Ir al proyecto: sale del mosaico y abre esta terminal en la vista normal"
        aria-label="Ir al proyecto"
      >
        <IrAlProyectoIcon />
      </button>
    </>
  )
}

/** Maximizar/restaurar la columna del agente (vista normal, con pestañas de editor). */
function BotonMaximizar({ m }: PropsParte): React.JSX.Element {
  const { expanded, onToggleExpand } = m.p
  return (
    <button
      className="btn btn-icon"
      onClick={onToggleExpand}
      title={
        expanded
          ? 'Restaurar: vuelve a mostrar los archivos abiertos'
          : 'Maximizar: Claude Code ocupa todo el espacio (sin cerrar archivos)'
      }
      aria-label={expanded ? 'Restaurar editor' : 'Maximizar Claude Code'}
    >
      {expanded ? <IconoRestaurar /> : <IconoMaximizar />}
    </button>
  )
}

/**
 * «Cerrar el agente de la terminal»: termina su sesión, que ociosa ocupa más de un giga. Ocultarlo (el
 * botón de la terminal) no la cierra; la conversación queda en el historial y se reanuda al volver.
 */
function BotonCerrar({ m }: PropsParte): React.JSX.Element | null {
  const { onCerrar } = m.p
  if (!onCerrar) return null
  return (
    <button
      type="button"
      className="btn btn-icon"
      onClick={() => onCerrar(m.p.target.profileId)}
      // A mitad de una actualización el pane está bloqueado: el orquestador cuenta con él.
      disabled={m.s.actualizando}
      title="Cerrar el agente de la terminal: termina su sesión y libera la memoria que ocupa (la conversación queda en el historial)"
      aria-label="Cerrar el agente de la terminal"
    >
      <IconoCerrar />
    </button>
  )
}

/** Acciones de la derecha: bases (fuera de casilla), cuenta, ampliar o maximizar, y cerrar (el agente de la terminal). */
function AccionesPanel({ m }: PropsParte): React.JSX.Element {
  const { mosaico, canExpand } = m.p
  return (
    <div className="panel-actions">
      {!mosaico && <BotonBases m={m} />}
      <BotonCuenta m={m} />
      {mosaico && <AccionesCasilla mosaico={mosaico} />}
      {!mosaico && canExpand && <BotonMaximizar m={m} />}
      {!mosaico && <BotonCerrar m={m} />}
    </div>
  )
}

/** Doble clic en la cabecera de una casilla la amplía (salvo sobre un control). */
function alDobleClic(mosaico: MosaicoPane | null): React.MouseEventHandler | undefined {
  if (!mosaico) return undefined
  return (e) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return
    mosaico.onAmpliar()
  }
}

/** Cabecera del pane del agente. */
export function CabeceraAgentPane({ m }: PropsParte): React.JSX.Element {
  const { mosaico, agentsInProfile, hostMode } = m.p
  return (
    <header className="panel-header" onDoubleClick={alDobleClic(mosaico)}>
      <span className="panel-title">
        {mosaico ? (
          <IdentidadCasilla m={m} mosaico={mosaico} />
        ) : agentsInProfile.length > 1 ? (
          <SelectorAgente m={m} />
        ) : (
          AGENT_LABEL[m.p.target.agente]
        )}
        <AccionesConversacion m={m} />
        {/* Actualizar agentes rehornea la IMAGEN: ni en nativo (tiene su botón en la barra
            de título) ni en una casilla (es una acción de la aplicación). */}
        {!hostMode && !mosaico && (
          <button
            type="button"
            className="btn btn-icon panel-name-btn"
            onClick={() => m.ui.setShowAgentsUpdate(true)}
            title="Actualizar agentes (Codex y Claude Code) a la última versión"
            aria-label="Actualizar agentes"
          >
            <UpdateIcon />
          </button>
        )}
      </span>
      <AccionesPanel m={m} />
    </header>
  )
}
