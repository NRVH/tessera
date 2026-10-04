// =============================================================================
// Contexto de la conversación viva, en el pie del panel del agente: un ANILLO a
// la derecha del uso de cuenta. Barras = límites de la CUENTA; anillo = contexto
// de ESTE chat. El anillo es además el botón de compactar.
// El número no se sondea a reloj: se relee con el mismo aviso `usage.onChanged`
// que vigila el transcript; el intervalo largo es solo red de seguridad.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContextSnapshot } from '../../../../shared/context-ipc'
import { usageKey, type UsageRunMode } from '../../../../shared/usage-ipc'
import type { ConvAgent } from '../../../../shared/conversations-ipc'
import { formatoAntiguedad } from '../../util/formatoTiempo'
import { formatoPorcentaje, varNivelUso } from './formatoUso'

interface ContextRingProps {
  agente: ConvAgent
  /** Cuenta activa; null = aún no elegida (no hay carpeta que leer). */
  accountId: string | null
  mode: UsageRunMode
  /** Proyecto del panel: el contexto es POR CONVERSACIÓN, y cada proyecto tiene la suya. */
  projectHostPath: string
  /** El pane ya está activado, visible y con cuenta: hasta entonces no se consulta nada. */
  enabled: boolean
  /**
   * Sube cada vez que el pane CAMBIA de conversación (reanudar, nueva, reiniciar). Es un
   * disparador de refresco, no un dato: sin él el anillo enseñaría el chat anterior
   * hasta el siguiente sondeo.
   */
  conversationEpoch: number
  /** ¿Hay sesión viva a la que mandarle el comando? Sin ella el anillo es solo informativo. */
  canCompact: boolean
  /** Manda `/compact` al agente. Lo implementa el pane, que es el dueño del pty. */
  onCompact: () => void
}

/** Sondeo de RESPALDO (ver cabecera): el refresco bueno llega por `usage.onChanged`. */
const POLL_MS = 60_000

/**
 * Geometría del anillo. `pathLength=100` deja el dasharray en % directos. El radio deja
 * HOLGURA en el cuadro (r + medio trazo = 17 de 18): el grupo del pie va en
 * `overflow: hidden` y el anillo crece al pasar el ratón; si se sube ese `scale`, hay
 * que bajar este radio.
 */
const RING_VIEWBOX = 36
const RING_R = 15

/**
 * Ancho del desplegable (el de `.agent-usage-pop`) y margen mínimo al borde: el anillo
 * vive en el extremo derecho de la ventana y anclarlo sin acotar lo sacaría de ella.
 */
const POP_WIDTH = 240
const POP_MARGIN = 8

/**
 * Cuánto se anuncia «Compactando…» tras pulsar: es el acuse de que el comando salió
 * (el % ya dirá cuándo terminó). Mientras dura, el botón queda bloqueado.
 */
const SENT_FEEDBACK_MS = 6000

type PropsLectura = Omit<ContextRingProps, 'canCompact' | 'onCompact'>

/** Lectura del contexto: al activarse, en bucle de respaldo y con el aviso de fin de turno. */
function useLecturaContexto({
  agente,
  accountId,
  mode,
  projectHostPath,
  enabled,
  conversationEpoch
}: PropsLectura): { snap: ContextSnapshot | null; refresh: () => Promise<void> } {
  const [snap, setSnap] = useState<ContextSnapshot | null>(null)
  const inFlightRef = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || inFlightRef.current) return
    if (mode !== 'host' && !accountId) return
    inFlightRef.current = true
    try {
      setSnap(
        await window.tessera.context.get({
          agente,
          accountId: accountId ?? '',
          projectHostPath,
          mode
        })
      )
    } catch {
      setSnap(null) // main caído / canal no disponible: anillo apagado
    } finally {
      inFlightRef.current = false
    }
    // `conversationEpoch` no se usa dentro, pero va en las deps: cambiar de conversación
    // tiene que re-ejecutar el efecto que llama a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agente, accountId, mode, projectHostPath, enabled, conversationEpoch])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [refresh, enabled])

  // El aviso viaja por cuenta y se filtra por la propia. La suscripción la abre
  // `UsageBars`; aquí solo se escucha, sin duplicar ningún vigilante de disco.
  useEffect(() => {
    if (!enabled) return
    if (mode !== 'host' && !accountId) return
    const mine = usageKey({ agente, accountId: accountId ?? '', mode })
    return window.tessera.usage.onChanged((c) => {
      if (c.key === mine) void refresh()
    })
  }, [agente, accountId, mode, enabled, refresh])

  return { snap, refresh }
}

/** Acuse del comando de compactar: bloquea el botón unos segundos tras pulsarlo. */
function useAcuseCompactar(
  canCompact: boolean,
  onCompact: () => void
): { sent: boolean; armed: boolean; compact: () => void } {
  const [sent, setSent] = useState(false)
  const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // El temporizador del acuse no sobrevive al desmontaje (setState sobre un componente muerto).
  useEffect(() => () => {
    if (sentTimerRef.current) clearTimeout(sentTimerRef.current)
  }, [])

  // Compactar exige sesión viva; el dato de contexto no (se lee del disco), así que el
  // anillo se pinta igual y solo el botón se apaga.
  const armed = canCompact && !sent

  function compact(): void {
    if (!armed) return
    onCompact()
    setSent(true)
    if (sentTimerRef.current) clearTimeout(sentTimerRef.current)
    sentTimerRef.current = setTimeout(() => setSent(false), SENT_FEEDBACK_MS)
  }

  return { sent, armed, compact }
}

/** Anillo de contexto de la conversación viva, con desplegable y acción de compactar. */
export function ContextRing(props: ContextRingProps): React.JSX.Element | null {
  const { agente, enabled, canCompact, onCompact } = props
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const { snap, refresh } = useLecturaContexto(props)
  const { sent, armed, compact } = useAcuseCompactar(canCompact, onCompact)

  if (!enabled) return null

  const percent = porcentajeDe(snap)

  function showPopover(): void {
    const r = rootRef.current?.getBoundingClientRect()
    if (r) {
      const maxLeft = window.innerWidth - POP_WIDTH - POP_MARGIN
      setAnchor({
        left: Math.max(POP_MARGIN, Math.min(r.left, maxLeft)),
        bottom: window.innerHeight - r.top
      })
    }
    setOpen(true)
    void refresh() // al mirarlo de cerca, el dato debe ser de AHORA
  }

  return (
    <div
      className="agent-context"
      ref={rootRef}
      onMouseEnter={showPopover}
      onMouseLeave={() => setOpen(false)}
      aria-label="Contexto de la conversación"
    >
      {/* El área pulsable abarca anillo + %: un blanco de 16 px sería un ejercicio de puntería. */}
      <button
        type="button"
        className={`agent-context-btn${sent ? ' is-sent' : ''}`}
        onClick={compact}
        disabled={!armed}
        aria-label={etiquetaBoton(sent, canCompact, percent)}
      >
        <AnilloContexto percent={percent} />
        <span className="agent-context-pct">{percent === null ? '—' : formatoPorcentaje(percent)}</span>
      </button>

      {open && anchor && (
        <PopoverContexto
          agente={agente}
          snap={snap}
          percent={percent}
          anchor={anchor}
          sent={sent}
          armed={armed}
          canCompact={canCompact}
        />
      )}
    </div>
  )
}

/**
 * Una conversación VACÍA (nueva o recién limpiada) es un cero, no un dato que falte:
 * el guion se reserva para cuando no hay nada que decir (sin chats o fallo al leer).
 */
function porcentajeDe(snap: ContextSnapshot | null): number | null {
  if (snap && !snap.unavailable) return snap.percent
  return snap?.unavailable === 'no-data' ? 0 : null
}

function etiquetaBoton(sent: boolean, canCompact: boolean, percent: number | null): string {
  if (sent) return 'Compactando la conversación'
  const contexto = `Contexto ${percent === null ? 'sin datos' : formatoPorcentaje(percent)}`
  return canCompact ? `${contexto}. Compactar la conversación` : contexto
}

function AnilloContexto({ percent }: { percent: number | null }): React.JSX.Element {
  return (
    <svg className="agent-context-ring" viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`} aria-hidden="true">
      <circle className="agent-context-track" cx={RING_VIEWBOX / 2} cy={RING_VIEWBOX / 2} r={RING_R} />
      {percent !== null && (
        <circle
          className="agent-context-fill"
          cx={RING_VIEWBOX / 2}
          cy={RING_VIEWBOX / 2}
          r={RING_R}
          pathLength={100}
          style={{
            stroke: `var(${varNivelUso(percent)})`,
            // Suelo visible: un chat recién abierto se leería como anillo VACÍO, sin dato.
            strokeDasharray: `${Math.max(percent, percent > 0 ? 1.5 : 0)} 100`
          }}
        />
      )}
    </svg>
  )
}

interface PopoverContextoProps {
  agente: ConvAgent
  snap: ContextSnapshot | null
  percent: number | null
  anchor: { left: number; bottom: number }
  sent: boolean
  armed: boolean
  canCompact: boolean
}

function PopoverContexto(p: PopoverContextoProps): React.JSX.Element {
  const { agente, snap, percent, anchor } = p
  return (
    <div
      className="agent-usage-pop"
      style={{ left: anchor.left, bottom: anchor.bottom }}
      role="tooltip"
    >
      <div className="agent-usage-pop-title">
        Contexto del chat
        <span className="agent-usage-pop-agent">{nombreAgente(agente)}</span>
      </div>

      {/* La barra se pinta SIEMPRE que haya porcentaje, también el 0 % de un chat vacío:
          es el estado que más se consulta. Lo que desaparece es el detalle que no existe. */}
      {percent === null ? (
        <div className="agent-usage-foot">{unavailableText(snap, agente)}</div>
      ) : (
        <DetalleContexto agente={agente} snap={snap} percent={percent} />
      )}

      {/* La ACCIÓN, siempre al pie: el desplegable se abre al pasar el ratón, así que
          nunca se llega al clic sin haberla leído. */}
      <div className={`agent-context-cta${p.armed ? '' : ' is-off'}`}>
        {textoAccion(p.sent, p.canCompact, agente)}
      </div>
    </div>
  )
}

interface DetalleContextoProps {
  agente: ConvAgent
  snap: ContextSnapshot | null
  percent: number
}

function DetalleContexto({ agente, snap, percent }: DetalleContextoProps): React.JSX.Element {
  /** Snapshot con turno detrás: el único que tiene tokens, modelo y hora que enseñar. */
  const medido = snap && !snap.unavailable ? snap : null
  return (
    <>
      <div className="agent-usage-row">
        <div className="agent-usage-row-head">
          <span>Ventana ocupada</span>
          <span className="agent-usage-pct">{formatoPorcentaje(percent)}</span>
        </div>
        <div className="agent-usage-track">
          <i style={{ width: `${percent}%`, background: `var(${varNivelUso(percent)})` }} />
        </div>
        {medido && (
          <div className="agent-usage-reset">
            {formatTokens(medido.usedTokens)} de {formatTokens(medido.windowTokens)} tokens
            {medido.model ? ` · ${medido.model}` : ''}
          </div>
        )}
      </div>
      {/* En claude-code el tamaño de ventana sale de una tabla por modelo, no del transcript. */}
      {medido?.windowEstimated && (
        <div className="agent-usage-foot">Tamaño de ventana estimado por el modelo.</div>
      )}
      {/* 'heuristica' sale sin sesión y también con ella tras un `/clear` o `/resume` en el
          TUI o si el chat anclado ya no existe: lo único cierto es que no se sabe CUÁL es. */}
      {snap?.anclaje === 'heuristica' && (
        <div className="agent-usage-foot">
          Sin confirmar en qué conversación estás: se mide la más reciente de este
          proyecto.
        </div>
      )}
      <div className="agent-usage-foot">
        {!medido
          ? unavailableText(snap, agente)
          : medido.compacted
            ? `Compactada ${formatoAntiguedad(medido.observedAt, Date.now())}; subirá en el próximo turno.`
            : `Último turno ${formatoAntiguedad(medido.observedAt, Date.now())}.`}
      </div>
    </>
  )
}

function nombreAgente(agente: ConvAgent): string {
  return agente === 'codex' ? 'Codex' : 'Claude Code'
}

function textoAccion(sent: boolean, canCompact: boolean, agente: ConvAgent): string {
  if (sent) {
    return `Comando /compact enviado a ${nombreAgente(agente)}. Verás el resumen en la terminal.`
  }
  return canCompact
    ? 'Haz clic para compactar: el agente resume la conversación en un extracto y libera la ventana. Se conserva el hilo, se pierde el detalle literal.'
    : 'Para compactar hace falta una sesión activa; abre o reinicia el agente.'
}

/** 623 650 -> "624k"; 1 000 000 -> "1M". El número exacto no aporta al leerlo de reojo. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function unavailableText(snap: ContextSnapshot | null, agente: ConvAgent): string {
  if (!snap) return 'Consultando…'
  switch (snap.unavailable) {
    case 'no-session':
      return 'Este proyecto aún no tiene ninguna conversación con este agente.'
    // El caso corriente es un chat recién vaciado con `/clear`: nombrarlo evita leer avería.
    case 'no-data':
      return agente === 'codex'
        ? 'Conversación vacía (nueva o recién limpiada): aún no ha hecho ninguna petición.'
        : 'Conversación vacía (nueva o recién limpiada con /clear): aún no hay ningún turno que medir.'
    case 'error':
      return `No se pudo leer el contexto${snap.detail ? `: ${snap.detail}` : '.'}`
    default:
      return 'Sin datos de contexto.'
  }
}
