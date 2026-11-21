// =============================================================================
// Contexto de un agente manual en el pie: el mismo anillo que el de los de serie, leído
// con la fuente que definió el usuario (un comando o un archivo). Sin transcript que avise
// del fin del turno, se consulta a reloj y solo mientras está en pantalla; sin acción de
// compactar, porque Tessera no conoce los comandos de ese agente.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { LecturaContexto } from '../../../../shared/contextoAgenteManual'
import { AnilloContexto, formatearCantidadTokens } from './ControlAnilloContexto'
import { formatoPorcentaje, variableNivelUso } from './formatoUso'
import { txContexto } from './textosContexto.ts'
import { useDespedida } from '../../comun/despedida.ts'
import { ventanaDeNodo } from '../../util/ventanaDe'

/** Cada cuánto se relee: un comando ajeno cuesta un proceso por lectura. */
const SONDEO_MS = 15_000
const ANCHO_POPOVER = 240
const MARGEN_POPOVER = 8

interface Props {
  nombre: string
  sesionId: string | null
  /** En pantalla y con la sesión abierta: hasta entonces no se consulta nada. */
  habilitado: boolean
}

function useLecturaManual(sesionId: string | null, habilitado: boolean): LecturaContexto | null {
  const [lectura, setLectura] = useState<LecturaContexto | null>(null)
  useEffect(() => {
    if (!habilitado || !sesionId) return
    let vivo = true
    const leer = (): void => {
      window.tessera.agentesManuales.contexto(sesionId).then(
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
  }, [sesionId, habilitado])
  return lectura
}

/** Anillo de contexto de un agente manual, con su desplegable al pasar el ratón. */
export function ContextoManual({ nombre, sesionId, habilitado }: Props): React.JSX.Element | null {
  const lectura = useLecturaManual(sesionId, habilitado)
  const [ancla, setAncla] = useState<{ left: number; bottom: number } | null>(null)
  const raizRef = useRef<HTMLDivElement>(null)
  const t = txContexto().contexto
  if (!habilitado) return null
  const porcentaje = lectura?.ok ? lectura.porcentaje : null

  function mostrar(): void {
    const raiz = raizRef.current
    const r = raiz?.getBoundingClientRect()
    if (!raiz || !r) return
    const ventana = ventanaDeNodo(raiz)
    const maxIzquierda = ventana.innerWidth - ANCHO_POPOVER - MARGEN_POPOVER
    setAncla({ left: Math.max(MARGEN_POPOVER, Math.min(r.left, maxIzquierda)), bottom: ventana.innerHeight - r.top })
  }

  return (
    <div className="agent-context" ref={raizRef} onMouseEnter={mostrar} onMouseLeave={() => setAncla(null)} aria-label={t.ariaAgente}>
      <span className="agent-context-btn" role="img" aria-label={t.etiqueta(porcentaje === null ? null : formatoPorcentaje(porcentaje))}>
        <AnilloContexto porcentaje={porcentaje} />
        <span className="agent-context-pct">{porcentaje === null ? '—' : formatoPorcentaje(porcentaje)}</span>
      </span>
      {ancla && <PopoverManual ancla={ancla} nombre={nombre} lectura={lectura} />}
    </div>
  )
}

/** El desplegable del anillo; un componente propio para que se despida al irse el ratón. */
function PopoverManual(p: { ancla: { left: number; bottom: number }; nombre: string; lectura: LecturaContexto | null }): React.JSX.Element {
  const t = txContexto().contexto
  const ref = useDespedida<HTMLDivElement>('flotante')
  return (
    <div ref={ref} className="agent-usage-pop" style={{ left: p.ancla.left, bottom: p.ancla.bottom }} role="tooltip">
      <div className="agent-usage-pop-title">
        {t.tituloAgente}
        <span className="agent-usage-pop-agent">{p.nombre}</span>
      </div>
      <DetalleManual lectura={p.lectura} />
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
        <span className="agent-usage-pct">{formatoPorcentaje(lectura.porcentaje)}</span>
      </div>
      <div className="agent-usage-track">
        <i style={{ width: `${lectura.porcentaje}%`, background: `var(${variableNivelUso(lectura.porcentaje)})` }} />
      </div>
      <div className="agent-usage-reset">
        {formatearCantidadTokens(lectura.usado)}
        {t.de}
        {formatearCantidadTokens(lectura.maximo)}
      </div>
    </div>
  )
}
