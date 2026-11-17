// =============================================================================
// La cuenta de una tarea delegada en su fila del indicador: dónde corre, su nombre y sus dos ventanas de límite, con
// las mismas piezas que «Uso de las cuentas». Se lee mientras la fila se ve.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import type { CuentaFijada } from '../../../../shared/workspace-state-ipc'
import { ventanasCuenta } from './modeloUsoCuentas'
import { CeldaUsoCuenta, ModoCuenta } from './piezasUsoCuenta'
import { txContexto } from './textosContexto'
import { useUsoDeCuenta } from './useUsoCuentas'

interface Props {
  perfilId: string
  agente: CuentaFijada['agente']
  cuentaId: string
  /** Agente y cuenta, como los nombra la tarea. */
  nombre: string
}

export function UsoCuentaTarea({ perfilId, agente, cuentaId: accountId, nombre }: Props): React.JSX.Element {
  const leida = useUsoDeCuenta(perfilId, agente, accountId)
  const cuenta = leida ?? { agente, accountId, cuenta: null, foto: null }
  const [corta, larga] = ventanasCuenta(cuenta.foto)
  return (
    <div className="cuenta-tarea">
      <span className="cuenta-uso-nombre"><ModoCuenta cuenta={cuenta} tam={13} /><span>{nombre}</span></span>
      {cuenta.cuenta?.conSesion === false
        ? <span className="cuenta-uso-sin-sesion">{txContexto().uso.sinSesion}</span>
        : <span className="cuenta-tarea-uso">
          <CeldaUsoCuenta ventana={corta} etiqueta="5h" />
          <span className="uso-fijada-sep" aria-hidden="true" />
          <CeldaUsoCuenta ventana={larga} etiqueta="7d" />
        </span>}
    </div>
  )
}
