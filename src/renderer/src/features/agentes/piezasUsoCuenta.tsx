// =============================================================================
// Piezas comunes del uso de una cuenta en la lista de «Uso de las cuentas» y en las fijadas de la barra de estado:
// su nombre, el icono de dónde corre y la celda de una ventana.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import type { VentanaUso } from '../../../../shared/usage-ipc'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import { documentoDe } from '../../util/ventanaDe'
import { IconoContenedor, IconoEntrar, IconoEquipo, IconoGlobal } from './iconosPaneAgente'
import { formatoPorcentaje, variableNivelUso } from './formatoUso'
import { nombreCorto, type CuentaUso } from './modeloUsoCuentas'
import { nombreVisible } from './selectorCuenta'
import { txContexto } from './textosContexto'
import { txCuentasConfiguracion } from './textosCuentasConfiguracion'
import { useInicioSesionCuenta } from './InicioSesionCuenta'

export function BotonIniciarSesionCuenta({ perfilId, cuenta, alAbrir }: { perfilId: string; cuenta: CuentaAgente; alAbrir: () => void }): React.JSX.Element {
  const { proyecto, iniciar } = useInicioSesionCuenta(perfilId)
  const t = txContexto().uso
  const etiqueta = t.iniciarSesion(nombreVisible(cuenta, t.predeterminada))
  return <button type="button" className="cuenta-uso-fijar cuenta-uso-iniciar" disabled={!proyecto}
    aria-label={etiqueta} title={proyecto ? etiqueta : txCuentasConfiguracion().sinProyecto}
    onClick={(e) => { alAbrir(); iniciar(cuenta, { documento: documentoDe(e.currentTarget) }) }}>
    <IconoEntrar />
  </button>
}

/** La nativa se nombra por su agente («Claude», «Codex»); la de Docker, por su nombre. */
export function nombreCuenta(cuenta: CuentaUso): string {
  return cuenta.cuenta ? nombreVisible(cuenta.cuenta, txContexto().uso.predeterminada) : nombreCorto(cuenta.agente)
}

/**
 * Dónde corre la cuenta: en el equipo, en Docker solo en este perfil o en Docker global. Sin tooltip propio: lo dice la
 * tarjeta de la cuenta, que sale al pasar el puntero por la fila o la cápsula.
 */
export function ModoCuenta({ cuenta, tam }: { cuenta: CuentaUso; tam: number }): React.JSX.Element {
  const t = txContexto().uso
  const [icono, nombre] = cuenta.accountId === null
    ? [<IconoEquipo key="i" tam={tam} />, t.equipo]
    : cuenta.cuenta?.global
      ? [<IconoGlobal key="i" tam={tam} />, t.dockerGlobal]
      : [<IconoContenedor key="i" tam={tam} />, t.dockerPerfil]
  return <span className="cuenta-uso-modo" role="img" aria-label={nombre}>{icono}</span>
}

/** Una ventana: su etiqueta, su micro-barra y su porcentaje. */
export function CeldaUsoCuenta({ ventana, etiqueta, clase = '' }: { ventana: VentanaUso | undefined; etiqueta: string; clase?: string }): React.JSX.Element {
  return <span className={`agent-usage-item cuenta-uso-celda${clase ? ` ${clase}` : ''}`}>
    <span className="agent-usage-label">{ventana?.etiqueta ?? etiqueta}</span>
    {ventana && <span className="agent-usage-mini"><i style={{ width: `${ventana.porcentaje}%`, background: `color-mix(in srgb, var(${variableNivelUso(ventana.porcentaje)}), white var(--uso-aclarado, 0%))` }} /></span>}
    <span className="agent-usage-pct">{ventana ? formatoPorcentaje(ventana.porcentaje) : txContexto().uso.guion}</span>
  </span>
}
