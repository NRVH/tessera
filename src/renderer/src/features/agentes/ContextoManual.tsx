// =============================================================================
// Contexto de un agente manual en el pie: el mismo anillo que el de los de serie, leído
// con la fuente que definió el usuario (un comando o un archivo). Sin transcript que avise
// del fin del turno, se consulta a reloj y solo mientras está en pantalla; sin acción de
// compactar, porque Tessera no conoce los comandos de ese agente.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { LecturaContexto } from '../../../../shared/contextoAgenteManual'
import { AnilloContexto, formatTokens } from './ContextRing'
import { formatoPorcentaje, varNivelUso } from './formatoUso'
import { txContexto } from './textosContexto.ts'

/** Cada cuánto se relee: un comando ajeno cuesta un proceso por lectura. */
const SONDEO_MS = 15_000
const POP_WIDTH = 240
const POP_MARGIN = 8

interface Props {
  nombre: string
  sessionId: string | null
  /** En pantalla y con la sesión abierta: hasta entonces no se consulta nada. */
  enabled: boolean
}

function useLecturaManual(sessionId: string | null, enabled: boolean): LecturaContexto | null {
  const [lectura, setLectura] = useState<LecturaContexto | null>(null)
  useEffect(() => {
    if (!enabled || !sessionId) return
    let vivo = true
    const leer = (): void => {
      window.tessera.agentesManuales.contexto(sessionId).then(
        (l) => vivo && setLectura(l),
        () => vivo && setLectura(null)
      )
    }
    leer()
    const id = setInterval(leer, SONDEO_MS)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [sessionId, enabled])
  return lectura
}

/** Anillo de contexto de un agente manual, con su desplegable al pasar el ratón. */
export function ContextoManual({ nombre, sessionId, enabled }: Props): React.JSX.Element | null {
  const lectura = useLecturaManual(sessionId, enabled)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const t = txContexto().contexto
  if (!enabled) return null
  const percent = lectura?.ok ? lectura.percent : null

  function mostrar(): void {
    const r = rootRef.current?.getBoundingClientRect()
    if (!r) return
    const maxLeft = window.innerWidth - POP_WIDTH - POP_MARGIN
    setAnchor({ left: Math.max(POP_MARGIN, Math.min(r.left, maxLeft)), bottom: window.innerHeight - r.top })
  }

  return (
    <div className="agent-context" ref={rootRef} onMouseEnter={mostrar} onMouseLeave={() => setAnchor(null)} aria-label={t.ariaAgente}>
      <span className="agent-context-btn" role="img" aria-label={t.etiqueta(percent === null ? null : formatoPorcentaje(percent))}>
        <AnilloContexto percent={percent} />
        <span className="agent-context-pct">{percent === null ? '—' : formatoPorcentaje(percent)}</span>
      </span>
      {anchor && (
        <div className="agent-usage-pop" style={{ left: anchor.left, bottom: anchor.bottom }} role="tooltip">
          <div className="agent-usage-pop-title">
            {t.tituloAgente}
            <span className="agent-usage-pop-agent">{nombre}</span>
          </div>
          <DetalleManual lectura={lectura} />
        </div>
      )}
    </div>
  )
}

function DetalleManual({ lectura }: { lectura: LecturaContexto | null }): React.JSX.Element {
  const t = txContexto().contexto
  if (!lectura) return <div className="agent-usage-foot">{t.leyendo}</div>
  if (!lectura.ok) return <div className="agent-usage-foot">{lectura.error}</div>
  return (
    <div className="agent-usage-row">
      <div className="agent-usage-row-head">
        <span>{t.ventanaOcupada}</span>
        <span className="agent-usage-pct">{formatoPorcentaje(lectura.percent)}</span>
      </div>
      <div className="agent-usage-track">
        <i style={{ width: `${lectura.percent}%`, background: `var(${varNivelUso(lectura.percent)})` }} />
      </div>
      <div className="agent-usage-reset">
        {formatTokens(lectura.usado)}
        {t.de}
        {formatTokens(lectura.maximo)}
      </div>
    </div>
  )
}
