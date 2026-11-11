// =============================================================================
// Uso de la cuenta en el pie del panel del agente: una línea compacta con
// micro-barras (`5h 3% · 7d 13% · Fable 7d 2%`: las ventanas que traiga la cuenta)
// que al pasar el ratón despliega sus barras grandes y cuándo se reinicia cada una.
// El desplegable va `fixed` desde el rect del disparador y no `absolute`: el pie
// es una franja de 34 px y un ancestro con overflow lo recortaría.
// =============================================================================

import { Cruce } from '../../comun/Presente'
import { useEffect, useState } from 'react'
import {
  proximoReset,
  type UsageRunMode,
  type UsageSnapshot
} from '../../../../shared/usage-ipc'
import type { ConvAgent } from '../../../../shared/conversations-ipc'
import { etiquetaCortaUso, etiquetaLargaUso, formatoPorcentaje, tramoVentanas, varNivelUso } from './formatoUso'
import { CuerpoUso } from './CuerpoUso'
import { txContexto } from './textosContexto.ts'
import { useAnunciarCuentaALaVista } from './cuentasALaVista'
import { useDesplegableUso } from './useDesplegableUso'
import { POLL_MS, useSondeoUso } from './useSondeoUso'
import { useDespedida } from '../../comun/despedida.ts'

interface UsageBarsProps {
  profileId: string
  children?: React.ReactNode
  agente: ConvAgent
  /** Cuenta activa; null = aún no elegida (no hay nada que consultar). */
  accountId: string | null
  mode: UsageRunMode
  /** El pane ya está activado y con cuenta: hasta entonces no se consulta nada. */
  enabled: boolean
}

const TICK_TEXTO_MS = 30_000
const MARGEN_RESET_MS = 2_000
type RefrescarUso = (force?: boolean) => Promise<void>

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
  const { agente, enabled, profileId, accountId, mode } = props
  const [open, setOpen] = useState(false)
  // Mientras se ve, esta cuenta no se repite en «Uso de las cuentas» ni en la barra de estado.
  useAnunciarCuentaALaVista(enabled, accountId === null ? null : { profileId, agente, accountId: mode === 'host' ? null : accountId })

  const { snap, refresh } = useSondeoUso(props)
  const ahora = useRelojUso(open, snap, props, refresh)
  const { ancla: anchor, abrir: showPopover, cerrar } = useDesplegableUso({ ponerAbierto: setOpen, profileId, enabled, refrescar: refresh })

  // La línea compacta enseña TODAS las ventanas que trae la cuenta (dos semanales si las
  // tiene, una si no): cuáles ceden cuando el pie se estrecha lo decide el CSS.
  const windows = snap?.windows ?? []

  return (
    <>
    {/* Cada pieza conserva su sitio aunque el pie se calle: el anillo sigue montado, con su lectura y el acuse de compactar. */}
    {enabled && <div
      className="agent-usage"
      onMouseEnter={(e) => showPopover(e.currentTarget)}
      onMouseLeave={cerrar}
      aria-label={txContexto().uso.aria}
      data-ventanas={tramoVentanas(windows.length)}
    >
      <Cruce clave={windows.length ? 'barras' : 'vacio'} className="uso-cruce">
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
        <span className="agent-usage-empty">{txContexto().uso.sinDatos}</span>
      )}
      </Cruce>

    </div>}
    {props.children}
    {enabled && open && anchor && <PopoverUso agente={agente} snap={snap} anchor={anchor} ahora={ahora} />}
    </>
  )
}

interface PopoverUsoProps {
  agente: ConvAgent
  snap: UsageSnapshot | null
  anchor: { left: number; bottom: number }
  ahora: number
}

function PopoverUso({ agente, snap, anchor, ahora }: PopoverUsoProps): React.JSX.Element {
  const t = txContexto().uso
  const ref = useDespedida<HTMLDivElement>('flotante')
  return (
    <div
      ref={ref}
      className="agent-usage-pop"
      style={{ left: anchor.left, bottom: anchor.bottom }}
      role="tooltip"
      aria-label={txContexto().uso.titulo}
    >
      <div className="agent-usage-pop-title">
        {t.titulo}
        <span className="agent-usage-pop-agent">{agente === 'codex' ? 'Codex' : 'Claude Code'}</span>
      </div>
      <CuerpoUso agente={agente} snap={snap} ahora={ahora} />
    </div>
  )
}
