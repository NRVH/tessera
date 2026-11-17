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
  proximoRestablecimiento,
  type ModoEjecucionUso,
  type FotoUso
} from '../../../../shared/usage-ipc'
import type { AgenteConversacion } from '../../../../shared/conversations-ipc'
import { etiquetaCortaUso, etiquetaLargaUso, formatoPorcentaje, tramoVentanas, variableNivelUso } from './formatoUso'
import { CuerpoUso } from './CuerpoUso'
import { txContexto } from './textosContexto.ts'
import { useAnunciarCuentaALaVista } from './cuentasALaVista'
import { useDesplegableUso } from './useDesplegableUso'
import { SONDEO_MS, useSondeoUso } from './useSondeoUso'
import { useDespedida } from '../../comun/despedida.ts'

interface PropsBarrasUso {
  perfilId: string
  children?: React.ReactNode
  agente: AgenteConversacion
  /** Cuenta activa; null = aún no elegida (no hay nada que consultar). */
  cuentaId: string | null
  modo: ModoEjecucionUso
  /** El pane ya está activado y con cuenta: hasta entonces no se consulta nada. */
  habilitado: boolean
}

const TICK_TEXTO_MS = 30_000
const MARGEN_RESTABLECIMIENTO_MS = 2_000
type RefrescarUso = (force?: boolean) => Promise<void>

/** «Ahora» de los textos relativos y la relectura al cruzar un reinicio de ventana. */
function useRelojUso(
  abierto: boolean,
  foto: FotoUso | null,
  { agente, habilitado }: PropsBarrasUso,
  refrescar: RefrescarUso
): number {
  // Estado y no `Date.now()` en el render: leer el reloj en el JSX no repinta al pasar el tiempo.
  const [ahora, setAhora] = useState(() => Date.now())

  // Solo corre con el desplegable abierto. Se re-siembra al abrir: con el reloj parado
  // mientras estaba cerrado, la primera pintada restaría contra un `ahora` de hace horas.
  useEffect(() => {
    if (!abierto) return
    setAhora(Date.now())
    const id = setInterval(() => setAhora(Date.now()), TICK_TEXTO_MS)
    return () => clearInterval(id)
  }, [abierto])

  // Al cruzar el reinicio el dato cacheado deja de valer: relectura justo después (no en
  // el filo). Si cae más allá del sondeo normal, ya llegará por el camino de siempre.
  useEffect(() => {
    if (!habilitado) return
    const proximo = proximoRestablecimiento(foto, Date.now())
    if (proximo === undefined) return
    const espera = proximo - Date.now() + MARGEN_RESTABLECIMIENTO_MS
    if (espera <= 0 || espera > SONDEO_MS[agente]) return
    const id = setTimeout(() => {
      setAhora(Date.now())
      void refrescar(true)
    }, espera)
    return () => clearTimeout(id)
  }, [foto, habilitado, agente, refrescar])

  return ahora
}

/** Uso de la cuenta del agente en el pie de su panel, con desplegable al pasar el ratón. */
export function BarrasUso(props: PropsBarrasUso): React.JSX.Element | null {
  const { agente, habilitado, perfilId, cuentaId, modo } = props
  const [abierto, setAbierto] = useState(false)
  // Mientras se ve, esta cuenta no se repite en «Uso de las cuentas» ni en la barra de estado.
  useAnunciarCuentaALaVista(habilitado, cuentaId === null ? null : { perfilId, agente, accountId: modo === 'host' ? null : cuentaId })

  const { foto, refrescar } = useSondeoUso(props)
  const ahora = useRelojUso(abierto, foto, props, refrescar)
  const { ancla, abrir: mostrarPopover, cerrar } = useDesplegableUso({ ponerAbierto: setAbierto, perfilId, habilitado, refrescar })

  // La línea compacta enseña TODAS las ventanas que trae la cuenta (dos semanales si las
  // tiene, una si no): cuáles ceden cuando el pie se estrecha lo decide el CSS.
  const ventanas = foto?.windows ?? []

  return (
    <>
    {/* Cada pieza conserva su sitio aunque el pie se calle: el anillo sigue montado, con su lectura y el acuse de compactar. */}
    {habilitado && <div
      className="agent-usage"
      onMouseEnter={(e) => mostrarPopover(e.currentTarget)}
      onMouseLeave={cerrar}
      aria-label={txContexto().uso.aria}
      data-ventanas={tramoVentanas(ventanas.length)}
    >
      <Cruce clave={ventanas.length ? 'barras' : 'vacio'} className="uso-cruce">
      {ventanas.length ? (
        ventanas.map((w) => (
          <span className="agent-usage-item" key={w.clave}>
            <span className="agent-usage-label" aria-label={etiquetaLargaUso(w.etiqueta)}>
              {etiquetaCortaUso(w.etiqueta)}
            </span>
            <span className="agent-usage-mini">
              <i style={{ width: `${w.porcentaje}%`, background: `var(${variableNivelUso(w.porcentaje)})` }} />
            </span>
            <span className="agent-usage-pct">{formatoPorcentaje(w.porcentaje)}</span>
          </span>
        ))
      ) : (
        <span className="agent-usage-empty">{txContexto().uso.sinDatos}</span>
      )}
      </Cruce>

    </div>}
    {props.children}
    {habilitado && abierto && ancla && <PopoverUso agente={agente} foto={foto} ancla={ancla} ahora={ahora} />}
    </>
  )
}

interface PropsPopoverUso {
  agente: AgenteConversacion
  foto: FotoUso | null
  ancla: { left: number; bottom: number }
  ahora: number
}

function PopoverUso({ agente, foto, ancla, ahora }: PropsPopoverUso): React.JSX.Element {
  const t = txContexto().uso
  const ref = useDespedida<HTMLDivElement>('flotante')
  return (
    <div
      ref={ref}
      className="agent-usage-pop"
      style={{ left: ancla.left, bottom: ancla.bottom }}
      role="tooltip"
      aria-label={txContexto().uso.titulo}
    >
      <div className="agent-usage-pop-title">
        {t.titulo}
        <span className="agent-usage-pop-agent">{agente === 'codex' ? 'Codex' : 'Claude Code'}</span>
      </div>
      <CuerpoUso agente={agente} foto={foto} ahora={ahora} />
    </div>
  )
}
