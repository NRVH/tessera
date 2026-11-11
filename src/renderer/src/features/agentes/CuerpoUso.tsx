// =============================================================================
// El cuerpo de un detalle de uso: una barra por ventana con cuándo se reinicia y, debajo, de cuándo es el dato o por qué
// no lo hay. Lo comparten el desplegable del pie y la tarjeta de una cuenta de «Uso de las cuentas».
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import type { ConvAgent } from '../../../../shared/conversations-ipc'
import type { UsageSnapshot, UsageWindow } from '../../../../shared/usage-ipc'
import { formatoAntiguedad, formatoReinicio } from '../../util/formatoTiempo'
import { etiquetaLargaUso, formatoPorcentaje, varNivelUso } from './formatoUso'
import { txContexto } from './textosContexto'

/** Las ventanas que trae la cuenta; sin ninguna, por qué. `sinSesion` lo dice sin esperar a consultar. */
export function CuerpoUso({ agente, snap, ahora, sinSesion = false }: { agente: ConvAgent; snap: UsageSnapshot | null; ahora: number; sinSesion?: boolean }): React.JSX.Element {
  const t = txContexto().uso
  const windows = snap?.windows ?? []
  if (sinSesion || !windows.length) return <div className="agent-usage-foot">{sinSesion ? t.sinCredenciales : textoSinDatos(snap, agente)}</div>
  return (
    <>
      {windows.map((w) => <FilaUso key={w.key} w={w} ahora={ahora} />)}
      {/* Solo codex trae `observedAt`: su dato es el ÚLTIMO CONOCIDO, no una consulta
          en vivo, y decirlo evita leer un 3 % de hace dos horas como de ahora. */}
      {snap?.observedAt && (
        <div className="agent-usage-foot">
          {t.ultimoDato}
          {formatoAntiguedad(snap.observedAt, ahora)}
        </div>
      )}
      {/* La última consulta falló y estas barras son las de antes: se dice. */}
      {snap?.stale && (
        <div className="agent-usage-foot">
          {t.noSePudoActualizar(snap.detail)}
          {formatoAntiguedad(snap.fetchedAt, ahora)}.
        </div>
      )}
    </>
  )
}

function FilaUso({ w, ahora }: { w: UsageWindow; ahora: number }): React.JSX.Element {
  const t = txContexto().uso
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
          ? t.ventanaReiniciada
          : w.resetsAt
            ? t.seReinicia(formatoReinicio(w.resetsAt - ahora))
            : t.sinReinicio}
      </div>
    </div>
  )
}

function textoSinDatos(snap: UsageSnapshot | null, agente: ConvAgent): string {
  const t = txContexto().uso
  if (!snap) return t.consultando
  switch (snap.unavailable) {
    case 'no-credentials':
      return t.sinCredenciales
    case 'no-data':
      return agente === 'codex' ? t.sinDatosCodex : t.sinDatosAgente
    case 'auth-expired':
      return t.credencialCaducada
    case 'not-subscription':
      return t.cuentaApi
    case 'rate-limited':
      return t.demasiadasConsultas
    case 'error':
      return t.errorLeer(snap.detail)
    default:
      return t.sinDatosUso
  }
}
