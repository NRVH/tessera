// =============================================================================
// Cabecera del pane del agente. En la vista normal: selector de agente, conversación
// (historial y chat nuevo), bases montadas, cuenta, maximizar y, en el agente de la terminal,
// cerrarlo. La cuenta dice también si corre nativo o en Docker. En una casilla del mosaico la
// identidad va entera (punto, perfil, proyecto, agente y bases) y el selector de agente se va,
// porque cambiaría el agente de TODO el perfil.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { ProfileDot } from '../pestanas'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { PuntoMosaico } from '../mosaico'
import { etiquetaModPrincipal } from '../../util/atajos'
import { IconoCerrar } from '../../comun/iconosMenu'
import { agenteManualDe, nombreAgente, type MosaicoPane } from './agentPaneTipos'
import { PestanasAgente } from './PestanasAgente'
import { rotuloHistorialConversaciones, textosMontajeBases, type LugarAgente } from './textosMontajeBases'
import { txPane } from './textosPane.ts'
import { IconoMaximizar, IconoRestaurar } from '../../comun/iconosPanel'
import {
  DbMountIcon, HistoryIcon, IconoCaret, IconoContenedor, IconoEquipo, IrAlProyectoIcon, NewChatIcon, UpdateIcon
} from './iconosAgentPane'
import type { ModeloAgentPane } from './useAgentPane'
import { nombreVisible } from './selectorCuenta.ts'

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
      aria-label={txPane().cabecera.basesAria}
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
      title={txPane().cabecera.elegirProyecto(mosaico.perfil, mosaico.proyecto, nombreAgente(m.p.pestanasAgente, m.p.target.agente))}
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
  const t = txPane().cabecera
  if (otro.esperando) return t.otroEsperando(otro.nombre)
  if (otro.trabajando) return t.otroTrabajando(otro.nombre)
  if (otro.sinVer) return t.otroSinVer(otro.nombre)
  return t.otroVer(otro.nombre)
}

/** La etiqueta del agente es el conmutador al siguiente agente del proyecto, SOLO en esta casilla. */
function ChipAgente({ m, mosaico }: PropsParte & { mosaico: MosaicoPane }): React.JSX.Element {
  const { agente } = m.p.target
  const corta = m.p.pestanasAgente.find((x) => x.id === agente)?.corta ?? nombreAgente(m.p.pestanasAgente, agente)
  const otro = mosaico.otroAgente
  if (!otro) return <span className="casilla-agente">{corta}</span>
  return (
    <button
      type="button"
      className="casilla-agente casilla-agente-btn"
      onClick={() => {
        if (mosaico.otroAgente) mosaico.onElegirDestino(mosaico.otroAgente.key)
      }}
      title={tituloOtroAgente(otro)}
      aria-label={txPane().cabecera.cambiarA(otro.nombre)}
    >
      {corta}
      {/* El otro agente reclama: sin este punto su trabajo quedaría invisible. */}
      {(otro.trabajando || otro.sinVer || otro.esperando) && (
        <PuntoMosaico color={mosaico.color} trabajando={otro.trabajando} sinVer={otro.sinVer} esperando={otro.esperando} />
      )}
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
        waiting={mosaico.esperando}
      />
      <BotonNombreCasilla m={m} mosaico={mosaico} />
      <ChipAgente m={m} mosaico={mosaico} />
      <BotonBases m={m} />
    </span>
  )
}

/** Pestañas de agente; en un proyecto, con el «+» y sus menús. */
function SelectorAgente({ m }: PropsParte): React.JSX.Element {
  const { pestanasAgente, onSelectAgent, target, lugar } = m.p
  return (
    <PestanasAgente
      pestanas={pestanasAgente}
      activo={target.agente}
      profileId={target.profileId}
      soloElegir={lugar !== 'proyecto'}
      onSelect={(id) => onSelectAgent?.(target.profileId, id)}
    />
  )
}

/**
 * Historial y chat nuevo, pegados al selector porque actúan sobre la conversación del
 * agente elegido. El historial va primero: el chat nuevo abandona el hilo en curso. Un agente
 * manual no tiene historial que leer, solo el chat nuevo (sin sus argumentos de reanudar).
 */
function AccionesConversacion({ m }: PropsParte): React.JSX.Element {
  const { s, ui, p } = m
  const manual = agenteManualDe(p.pestanasAgente, p.target.agente) !== null
  const t = txPane().cabecera
  return (
    <span className="panel-title-actions">
      {!manual && (
        <button
          type="button"
          className="btn btn-icon"
          onClick={() => ui.setShowHistory(true)}
          disabled={s.actualizando}
          title={rotuloHistorialConversaciones(p.lugar)}
          aria-label={t.historialAria}
        >
          <HistoryIcon />
        </button>
      )}
      <button
        type="button"
        className="btn btn-icon"
        onClick={() => m.sesion.nueva()}
        disabled={!s.sessionId || s.status === 'booting' || s.reloading || s.actualizando}
        title={t.nuevaTitulo}
        aria-label={t.nuevaAria}
      >
        <NewChatIcon />
      </button>
    </span>
  )
}

/**
 * El nombre del botón de cuenta: la del sistema si corre nativo; si no, la de Docker en uso, con su modo
 * delante cuando el agente puede pasar de uno a otro. null = no hay botón.
 */
function nombreBotonCuenta(m: ModeloAgentPane): string | null {
  const t = txPane().menus
  const conModo = m.p.onElegirModo !== undefined
  if (m.p.hostMode) return conModo ? t.modoNativo(nombresSistema(window.tessera.plataforma).sistema) : null
  // En Docker y sin cuenta, el botón sigue: es la vuelta a nativo.
  if (!m.currentAccount) return conModo ? t.cuentaDocker(t.sinCuenta) : null
  const nombre = nombreVisible(m.currentAccount, t.predeterminada)
  return conModo ? t.cuentaDocker(nombre) : nombre
}

/**
 * Botón de cuenta: el icono de dónde corre (una pantalla, nativo; un cubo, Docker). Abre
 * el selector, que pasa a nativo o a otra cuenta de Docker, crea una, cierra sesión o la elimina.
 */
function BotonCuenta({ m }: PropsParte): React.JSX.Element | null {
  const nombre = nombreBotonCuenta(m)
  if (nombre === null) return null
  const { accountMenu, setAccountMenu } = m.ui
  const titulo = txPane().cabecera.cuenta(nombre)
  return (
    <button
      type="button"
      className="btn btn-icon cuenta-btn"
      // Cambiar de modo remonta el pane: a mitad de una actualización no hay relanzar.
      disabled={m.s.actualizando}
      // El selector se cierra con el mousedown de fuera; con el suyo abierto, sin esto el clic lo reabriría.
      // Solo entonces: cerrado, el mousedown tiene que llegar al selector abierto de otro pane.
      onMouseDown={(e) => {
        if (accountMenu) e.stopPropagation()
      }}
      onClick={(e) => {
        if (accountMenu) return setAccountMenu(null)
        const r = e.currentTarget.getBoundingClientRect()
        m.cuenta.recargar()
        setAccountMenu({ right: r.right, top: r.top, bottom: r.bottom })
      }}
      aria-haspopup="menu"
      aria-expanded={accountMenu !== null}
      title={titulo}
      aria-label={titulo}
    >
      {m.p.hostMode ? <IconoEquipo /> : <IconoContenedor />}
    </button>
  )
}

/** «Ir a» lleva a donde vive el agente: su proyecto, la vista de bases de datos o la terminal. */
function textosIrA(lugar: LugarAgente): { titulo: string; aria: string } {
  const t = txPane().cabecera
  if (lugar === 'datos') return { titulo: t.irADatos, aria: t.irADatosAria }
  if (lugar === 'terminal') return { titulo: t.irALaTerminal, aria: t.irALaTerminalAria }
  return { titulo: t.irAlProyecto, aria: t.irAlProyectoAria }
}

/** En una casilla: ampliar la casilla (mismo gesto que maximizar) e ir a donde vive el agente. */
function AccionesCasilla({ mosaico, lugar }: { mosaico: MosaicoPane; lugar: LugarAgente }): React.JSX.Element {
  const mod = etiquetaModPrincipal()
  const t = txPane().cabecera
  const irA = textosIrA(lugar)
  return (
    <>
      <button
        type="button"
        className={`btn btn-icon${mosaico.ampliada ? ' active' : ''}`}
        onClick={mosaico.onAmpliar}
        aria-pressed={mosaico.ampliada}
        title={mosaico.ampliada ? t.restaurarMosaico(mod) : t.ampliar(mod)}
        aria-label={mosaico.ampliada ? t.restaurarMosaicoAria : t.ampliarAria}
      >
        {mosaico.ampliada ? <IconoRestaurar /> : <IconoMaximizar />}
      </button>
      <button
        type="button"
        className="btn btn-icon"
        onClick={mosaico.onIrAlProyecto}
        title={irA.titulo}
        aria-label={irA.aria}
      >
        <IrAlProyectoIcon />
      </button>
    </>
  )
}

/** Lo que tapa el agente al maximizarse: los archivos abiertos, las terminales o las pestañas de BD. */
function textosRestaurar(lugar: string): { titulo: string; aria: string; sinCerrar: string } {
  const c = txPane().cabecera
  if (lugar === 'terminal') return { titulo: c.restaurarTerminales, aria: c.restaurarTerminalesAria, sinCerrar: c.sinCerrarTerminales }
  if (lugar === 'datos') return { titulo: c.restaurarPestanasBd, aria: c.restaurarPestanasBdAria, sinCerrar: c.sinCerrarPestanasBd }
  return { titulo: c.restaurarArchivos, aria: c.restaurarArchivosAria, sinCerrar: c.sinCerrarArchivos }
}

/** Maximizar/restaurar el agente sobre lo que tiene al lado. */
function BotonMaximizar({ m }: PropsParte): React.JSX.Element {
  const { expanded, onToggleExpand } = m.p
  const t = textosRestaurar(m.p.lugar)
  const agente = nombreAgente(m.p.pestanasAgente, m.p.target.agente)
  return (
    <button
      className="btn btn-icon"
      onClick={onToggleExpand}
      title={expanded ? t.titulo : txPane().cabecera.maximizar(agente, t.sinCerrar)}
      aria-label={expanded ? t.aria : txPane().cabecera.maximizarAria(agente)}
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
      title={txPane().cabecera.cerrarAgente}
      aria-label={txPane().cabecera.cerrarAgenteAria}
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
      {mosaico && <AccionesCasilla mosaico={mosaico} lugar={m.p.lugar} />}
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
  const { mosaico, pestanasAgente, hostMode, lugar } = m.p
  return (
    <header className="panel-header" onDoubleClick={alDobleClic(mosaico)}>
      <span className="panel-title">
        {mosaico ? (
          <IdentidadCasilla m={m} mosaico={mosaico} />
        ) : pestanasAgente.length > 1 || lugar === 'proyecto' ? (
          <SelectorAgente m={m} />
        ) : (
          nombreAgente(pestanasAgente, m.p.target.agente)
        )}
        <AccionesConversacion m={m} />
        {/* Actualizar agentes rehornea la IMAGEN: ni en nativo (tiene su botón en la barra
            de título) ni en una casilla (es una acción de la aplicación). */}
        {!hostMode && !mosaico && (
          <button
            type="button"
            className="btn btn-icon panel-name-btn"
            onClick={() => m.ui.setShowAgentsUpdate(true)}
            title={txPane().cabecera.actualizarAgentes}
            aria-label={txPane().cabecera.actualizarAgentesAria}
          >
            <UpdateIcon />
          </button>
        )}
      </span>
      <AccionesPanel m={m} />
    </header>
  )
}
