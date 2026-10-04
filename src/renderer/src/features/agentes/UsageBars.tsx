// =============================================================================
// Uso de la cuenta en el pie del panel del agente: una línea compacta con
// micro-barras (`5h 3% · 7d 13% · Fable 7d 2%`: las ventanas que traiga la cuenta)
// que al pasar el ratón despliega sus barras grandes y cuándo se reinicia cada una.
// El desplegable va `fixed` desde el rect del disparador y no `absolute`: el pie
// es una franja de 34 px y un ancestro con overflow lo recortaría.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  proximoReset,
  usageKey,
  type UsageRunMode,
  type UsageSnapshot,
  type UsageWindow
} from '../../../../shared/usage-ipc'
import type { ConvAgent } from '../../../../shared/conversations-ipc'
import { formatoAntiguedad, formatoReinicio } from '../../util/formatoTiempo'
import { etiquetaCortaUso, etiquetaLargaUso, formatoPorcentaje, tramoVentanas, varNivelUso } from './formatoUso'

interface UsageBarsProps {
  agente: ConvAgent
  /** Cuenta activa; null = aún no elegida (no hay nada que consultar). */
  accountId: string | null
  mode: UsageRunMode
  /** El pane ya está activado y con cuenta: hasta entonces no se consulta nada. */
  enabled: boolean
}

/**
 * Sondeo de RESPALDO: lo bueno es el aviso `onChanged` del main al terminar un turno.
 * El reloj cubre el consumo hecho desde otra máquina o fuera de Tessera y las ventanas
 * que se reinician solas, así que va holgado: en claude-code es una llamada de red con
 * límite por token; en codex, leer la cola de un fichero.
 */
const POLL_MS: Record<ConvAgent, number> = {
  'claude-code': 180_000,
  codex: 30_000
}

/** Recalculo del texto relativo con el desplegable abierto: cambia de minuto, 30 s basta. */
const TICK_TEXTO_MS = 30_000

/**
 * Espera DESPUÉS del `resetsAt` para re-consultar. En el filo exacto el servidor puede
 * devolver aún la ventana vieja, y esa respuesta gastaría el suelo de relectura del main.
 */
const MARGEN_RESET_MS = 2_000

type RefrescarUso = (force?: boolean) => Promise<void>

/** Consulta del uso: al activarse, en bucle de respaldo y al avisar el main de fin de turno. */
function useSondeoUso({ agente, accountId, mode, enabled }: UsageBarsProps): {
  snap: UsageSnapshot | null
  refresh: RefrescarUso
} {
  const [snap, setSnap] = useState<UsageSnapshot | null>(null)
  // Sondeo en vuelo: evita solaparlos (una consulta lenta + un tick = dos fetch).
  const inFlightRef = useRef(false)

  const refresh = useCallback(
    async (force = false): Promise<void> => {
      if (!enabled || inFlightRef.current) return
      if (mode !== 'host' && !accountId) return
      inFlightRef.current = true
      try {
        const s = await window.tessera.usage.get({
          agente,
          accountId: accountId ?? '',
          mode,
          force
        })
        setSnap(s)
      } catch {
        setSnap(null) // main caído / canal no disponible: se pinta el guion
      } finally {
        inFlightRef.current = false
      }
    },
    [agente, accountId, mode, enabled]
  )

  // El main cachea con TTL: un tick de más devuelve lo cacheado, no genera tráfico.
  useEffect(() => {
    if (!enabled) return
    void refresh()
    const id = setInterval(() => void refresh(), POLL_MS[agente])
    return () => clearInterval(id)
  }, [refresh, enabled, agente])

  // El aviso de fin de turno llega a TODOS los paneles; cada uno se queda con el de SU
  // cuenta (dos proyectos con la misma cuenta comparten uso y ambos se refrescan).
  useEffect(() => {
    if (!enabled) return
    if (mode !== 'host' && !accountId) return
    const req = { agente, accountId: accountId ?? '', mode }
    const mine = usageKey(req)
    void window.tessera.usage.watch(req)
    const off = window.tessera.usage.onChanged((c) => {
      if (c.key === mine) void refresh(true)
    })
    return () => {
      off()
      void window.tessera.usage.unwatch(req)
    }
  }, [agente, accountId, mode, enabled, refresh])

  return { snap, refresh }
}

/** «Ahora» de los textos relativos y la relectura al cruzar un reinicio de ventana. */
function useRelojUso(
  open: boolean,
  snap: UsageSnapshot | null,
  { agente, enabled }: UsageBarsProps,
  refresh: RefrescarUso
): number {
  // Estado y no `Date.now()` en el render: leer el reloj en el JSX no repinta al pasar el tiempo.
  const [ahora, setAhora] = useState(() => Date.now())

  // Solo corre con el desplegable abierto. Se re-siembra al abrir: con el reloj parado
  // mientras estaba cerrado, la primera pintada restaría contra un `ahora` de hace horas.
  useEffect(() => {
    if (!open) return
    setAhora(Date.now())
    const id = setInterval(() => setAhora(Date.now()), TICK_TEXTO_MS)
    return () => clearInterval(id)
  }, [open])

  // Al cruzar el reinicio el dato cacheado deja de valer: relectura justo después (no en
  // el filo). Si cae más allá del sondeo normal, ya llegará por el camino de siempre.
  useEffect(() => {
    if (!enabled) return
    const proximo = proximoReset(snap, Date.now())
    if (proximo === undefined) return
    const espera = proximo - Date.now() + MARGEN_RESET_MS
    if (espera <= 0 || espera > POLL_MS[agente]) return
    const id = setTimeout(() => {
      setAhora(Date.now())
      void refresh(true)
    }, espera)
    return () => clearTimeout(id)
  }, [snap, enabled, agente, refresh])

  return ahora
}

/** Uso de la cuenta del agente en el pie de su panel, con desplegable al pasar el ratón. */
export function UsageBars(props: UsageBarsProps): React.JSX.Element | null {
  const { agente, enabled } = props
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const { snap, refresh } = useSondeoUso(props)
  const ahora = useRelojUso(open, snap, props, refresh)

  if (!enabled) return null

  // La línea compacta enseña TODAS las ventanas que trae la cuenta (dos semanales si las
  // tiene, una si no): cuáles ceden cuando el pie se estrecha lo decide el CSS.
  const windows = snap?.windows ?? []

  function showPopover(): void {
    const r = rootRef.current?.getBoundingClientRect()
    if (r) setAnchor({ left: r.left, bottom: window.innerHeight - r.top })
    setOpen(true)
    void refresh(true) // al mirarlo de cerca, el dato debe ser de AHORA
  }

  return (
    <div
      className="agent-usage"
      ref={rootRef}
      onMouseEnter={showPopover}
      onMouseLeave={() => setOpen(false)}
      aria-label="Uso de la cuenta"
      data-ventanas={tramoVentanas(windows.length)}
    >
      {windows.length ? (
        windows.map((w) => (
          <span className="agent-usage-item" key={w.key}>
            <span className="agent-usage-label" aria-label={etiquetaLargaUso(w.label)}>
              {etiquetaCortaUso(w.label)}
            </span>
            <span className="agent-usage-mini">
              <i style={{ width: `${w.percent}%`, background: `var(${varNivelUso(w.percent)})` }} />
            </span>
            <span className="agent-usage-pct">{formatoPorcentaje(w.percent)}</span>
          </span>
        ))
      ) : (
        <span className="agent-usage-empty">uso —</span>
      )}

      {open && anchor && (
        <PopoverUso agente={agente} snap={snap} windows={windows} anchor={anchor} ahora={ahora} />
      )}
    </div>
  )
}

interface PopoverUsoProps {
  agente: ConvAgent
  snap: UsageSnapshot | null
  windows: UsageWindow[]
  anchor: { left: number; bottom: number }
  ahora: number
}

function PopoverUso({ agente, snap, windows, anchor, ahora }: PopoverUsoProps): React.JSX.Element {
  return (
    <div
      className="agent-usage-pop"
      style={{ left: anchor.left, bottom: anchor.bottom }}
      role="tooltip"
    >
      <div className="agent-usage-pop-title">
        Uso de la cuenta
        <span className="agent-usage-pop-agent">{agente === 'codex' ? 'Codex' : 'Claude Code'}</span>
      </div>

      {windows.length ? (
        <>
          {windows.map((w) => (
            <FilaUso key={w.key} w={w} ahora={ahora} />
          ))}
          {/* Solo codex trae `observedAt`: su dato es el ÚLTIMO CONOCIDO, no una consulta
              en vivo, y decirlo evita leer un 3 % de hace dos horas como de ahora. */}
          {snap?.observedAt && (
            <div className="agent-usage-foot">
              Último dato: {formatoAntiguedad(snap.observedAt, ahora)}
            </div>
          )}
          {/* La última consulta falló y estas barras son las de antes: se dice. */}
          {snap?.stale && (
            <div className="agent-usage-foot">
              No se pudo actualizar ahora{snap.detail ? ` (${snap.detail})` : ''}; el dato es
              de {formatoAntiguedad(snap.fetchedAt, ahora)}.
            </div>
          )}
        </>
      ) : (
        <div className="agent-usage-foot">{unavailableText(snap, agente)}</div>
      )}
    </div>
  )
}

function FilaUso({ w, ahora }: { w: UsageWindow; ahora: number }): React.JSX.Element {
  return (
    <div className="agent-usage-row">
      <div className="agent-usage-row-head">
        <span>{etiquetaLargaUso(w.label)}</span>
        <span className="agent-usage-pct">{formatoPorcentaje(w.percent)}</span>
      </div>
      <div className="agent-usage-track">
        <i style={{ width: `${w.percent}%`, background: `var(${varNivelUso(w.percent)})` }} />
      </div>
      <div className="agent-usage-reset">
        {w.reiniciada
          ? 'Ventana reiniciada; se actualizará en tu próxima petición'
          : w.resetsAt
            ? `Se reinicia ${formatoReinicio(w.resetsAt - ahora)}`
            : 'Sin fecha de reinicio'}
      </div>
    </div>
  )
}

function unavailableText(snap: UsageSnapshot | null, agente: ConvAgent): string {
  if (!snap) return 'Consultando…'
  switch (snap.unavailable) {
    case 'no-credentials':
      return 'Esta cuenta aún no ha iniciado sesión.'
    case 'no-data':
      return agente === 'codex'
        ? 'Codex aún no ha reportado límites: escribe un primer mensaje y aparecerán.'
        : 'El agente aún no reporta límites de uso.'
    case 'auth-expired':
      return 'Credencial caducada; se renovará sola al usar el agente.'
    case 'not-subscription':
      return 'Cuenta por API key: no tiene límites de suscripción que mostrar.'
    case 'rate-limited':
      return 'Demasiadas consultas seguidas; se reintenta en un momento.'
    case 'error':
      return `No se pudo leer el uso${snap.detail ? `: ${snap.detail}` : '.'}`
    default:
      return 'Sin datos de uso.'
  }
}
