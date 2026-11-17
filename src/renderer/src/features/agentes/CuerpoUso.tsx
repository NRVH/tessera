// =============================================================================
// El cuerpo de un detalle de uso: una barra por ventana con cuándo se reinicia y, debajo, de cuándo es el dato o por qué
// no lo hay. Lo comparten el desplegable del pie y la tarjeta de una cuenta de «Uso de las cuentas».
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import type { AgenteConversacion } from '../../../../shared/conversations-ipc'
import type { FotoUso, VentanaUso } from '../../../../shared/usage-ipc'
import { formatoAntiguedad, formatoReinicio } from '../../util/formatoTiempo'
import { etiquetaLargaUso, formatoPorcentaje, variableNivelUso } from './formatoUso'
import { txContexto } from './textosContexto'

/** Las ventanas que trae la cuenta; sin ninguna, por qué. `sinSesion` lo dice sin esperar a consultar. */
export function CuerpoUso({ agente, foto, ahora, sinSesion = false }: { agente: AgenteConversacion; foto: FotoUso | null; ahora: number; sinSesion?: boolean }): React.JSX.Element {
  const t = txContexto().uso
  const ventanas = foto?.windows ?? []
  if (sinSesion || !ventanas.length) return <div className="agent-usage-foot">{sinSesion ? t.sinCredenciales : textoSinDatos(foto, agente)}</div>
  return (
    <>
      {ventanas.map((w) => <FilaUso key={w.clave} w={w} ahora={ahora} />)}
      {/* Solo codex trae `observadoEn`: su dato es el ÚLTIMO CONOCIDO, no una consulta
          en vivo, y decirlo evita leer un 3 % de hace dos horas como de ahora. */}
      {foto?.observadoEn && (
        <div className="agent-usage-foot">
          {t.ultimoDato}
          {formatoAntiguedad(foto.observadoEn, ahora)}
        </div>
      )}
      {/* La última consulta falló y estas barras son las de antes: se dice. */}
      {foto?.desactualizado && (
        <div className="agent-usage-foot">
          {t.noSePudoActualizar(foto.detalle)}
          {formatoAntiguedad(foto.consultadoEn, ahora)}.
        </div>
      )}
    </>
  )
}

function FilaUso({ w, ahora }: { w: VentanaUso; ahora: number }): React.JSX.Element {
  const t = txContexto().uso
  return (
    <div className="agent-usage-row">
      <div className="agent-usage-row-head">
        <span>{etiquetaLargaUso(w.etiqueta)}</span>
        <span className="agent-usage-pct">{formatoPorcentaje(w.porcentaje)}</span>
      </div>
      <div className="agent-usage-track">
        <i style={{ width: `${w.porcentaje}%`, background: `var(${variableNivelUso(w.porcentaje)})` }} />
      </div>
      <div className="agent-usage-reset">
        {w.reiniciada
          ? t.ventanaReiniciada
          : w.restablecimientoEn
            ? t.seReinicia(formatoReinicio(w.restablecimientoEn - ahora))
            : t.sinReinicio}
      </div>
    </div>
  )
}

function textoSinDatos(foto: FotoUso | null, agente: AgenteConversacion): string {
  const t = txContexto().uso
  if (!foto) return t.consultando
  switch (foto.noDisponible) {
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
      return t.errorLeer(foto.detalle)
    default:
      return t.sinDatosUso
  }
}
