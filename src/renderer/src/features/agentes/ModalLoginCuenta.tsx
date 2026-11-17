// =============================================================================
// Diálogo de inicio de sesión en una cuenta Docker sin abrir una pestaña: enseña en qué punto va, con el tiempo que
// lleva la espera, y deja la terminal a la vista solo donde hay que usarla.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { useState } from 'react'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import type { DefinicionAgente } from '../../../../shared/agentesManuales'
import { Modal, ModalPie } from '../../comun/Modal'
import { Cruce, Presente } from '../../comun/Presente'
import { clasificarErrorArranque } from '../../../../shared/erroresDocker'
import { IconoCaret } from './iconosPaneAgente'
import { ayudaVisible, faseLogin, loginGuiado, pasosLogin, relojEspera, SEGUNDOS_AYUDA, terminalVisible, type FaseLogin } from './modeloLoginCuenta'
import { useLoginCuenta, useSegundosDesde } from './useLoginCuenta'
import { txCuentasConfiguracion } from './textosCuentasConfiguracion'

/** `inert` como atributo de texto: los tipos de React 18 no lo declaran. */
const INERTE = { inert: '' } as Record<string, string>

function IconoFase({ fase }: { fase: FaseLogin }): React.JSX.Element {
  if (fase === 'preparando' || fase === 'esperando') return <span className="modal-girando" />
  if (fase === 'confirmado') {
    return (
      <span className="boton-guardar ok">
        <span className="boton-guardar-capa exito">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path className="boton-guardar-palomita" d="M3 8.5l3.2 3L13 4.5" pathLength={1} />
          </svg>
        </span>
      </span>
    )
  }
  return <span className="cuentas-login-alerta">!</span>
}

/** El titular y la explicación de cada momento. */
function rotulos(fase: FaseLogin, guiado: boolean, manual: boolean, tarda: boolean, error: ReturnType<typeof clasificarErrorArranque> | null): { titulo: string; detalle: string } {
  const t = txCuentasConfiguracion()
  if (fase === 'sin-proyecto') return { titulo: t.iniciar, detalle: t.sinProyecto }
  if (fase === 'confirmado') return { titulo: t.confirmado, detalle: t.confirmadoDetalle }
  if (fase === 'error' && error) return { titulo: error.titulo, detalle: [error.sugerencia, error.detalle].filter(Boolean).join(' ') }
  if (fase === 'preparando') return { titulo: t.preparando, detalle: t.preparandoDetalle }
  if (!guiado) return { titulo: t.sigaTerminal, detalle: manual ? t.manual : t.sigaTerminalDetalle }
  return { titulo: t.autorice, detalle: tarda ? t.autoriceTarda : t.autoriceDetalle }
}

export function ModalLoginCuenta(p: { cuenta: CuentaAgente; manual?: DefinicionAgente; rutaHostProyecto?: string; releer: () => Promise<CuentaAgente[]>; onCerrar: () => void }): React.JSX.Element {
  const v = useLoginCuenta(p.cuenta, p.rutaHostProyecto, p.releer, p.onCerrar, p.manual)
  const t = txCuentasConfiguracion()
  const [pedida, setPedida] = useState<boolean | null>(null)
  // Un rechazo del main llega redactado para el usuario (titular y explicación): se presenta así, no en bruto.
  const error = v.error ? clasificarErrorArranque(v.error, t.errorAcceso) : null
  const abierta = v.esperaDesde !== null
  const guiado = loginGuiado(p.cuenta.agente, !!p.manual)
  const fase = faseLogin({ conProyecto: !!p.rutaHostProyecto, confirmado: v.exitos > 0, error: error !== null, abierta })
  const segundos = useSegundosDesde(fase === 'esperando' ? v.esperaDesde : null)
  const tarda = fase === 'esperando' && segundos >= SEGUNDOS_AYUDA
  const verTerminal = terminalVisible({ guiado, fase, abierta, pedida })
  const { titulo, detalle } = rotulos(fase, guiado, !!p.manual, tarda, error)
  const pasos = pasosLogin(fase, abierta)
  const nombrePasos = [t.pasoEntorno, t.pasoAutorizacion, t.pasoConfirmacion]
  const agente = p.manual?.nombre ?? (p.cuenta.agente === 'codex' ? 'Codex' : 'Claude Code')
  const reintentar = (): void => {
    setPedida(null)
    v.reintentar()
  }
  return (
    <Modal
      titulo={t.iniciar}
      tamano="l"
      className="cuentas-login"
      onCerrar={p.onCerrar}
      subtitulo={t.cuentaDe(p.cuenta.nombre, agente)}
      pie={
        <ModalPie
          auxiliares={guiado && fase !== 'sin-proyecto' ? (
            <button type="button" className="btn cuentas-login-ver" aria-expanded={verTerminal} onClick={() => setPedida(!verTerminal)}>
              <IconoCaret />{verTerminal ? t.ocultarTerminal : t.mostrarTerminal}
            </button>
          ) : undefined}
        >
          <button type="button" className="btn" onClick={p.onCerrar}>{fase === 'confirmado' || fase === 'sin-proyecto' ? t.cerrar : t.cancelar}</button>
          {error && <button type="button" className="btn primary" onClick={reintentar}>{t.reintentar}</button>}
        </ModalPie>
      }
    >
      <div className="cuentas-login-cuerpo" data-guiado={guiado ? '' : undefined} data-terminal={verTerminal ? '' : undefined}>
        <div className="cuentas-login-centro">
          <div className="cuentas-login-estado">
            <Cruce clave={fase} className="cuentas-login-icono"><span aria-hidden="true" data-fase={fase}><IconoFase fase={fase} /></span></Cruce>
            <div role="status" className="cuentas-login-textos">
              <Cruce clave={`${fase}:${tarda}`}>
                <div>
                  <h3 className="cuentas-login-titulo">{titulo}</h3>
                  <p className="cuentas-login-detalle">{detalle}</p>
                </div>
              </Cruce>
            </div>
            {guiado && fase !== 'sin-proyecto' && (
              <ul className="cuentas-login-pasos">
                {pasos.map((estado, i) => (
                  <li key={nombrePasos[i]} data-paso={estado}>
                    <span className="cuentas-login-punto" aria-hidden="true" />
                    <span>{nombrePasos[i]}</span>
                    {i === 1 && estado === 'activo' && <span className="cuentas-login-reloj">{relojEspera(segundos)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {guiado && (
              <div className="cuentas-login-ayuda-sitio">
                <Presente visible={ayudaVisible(fase, segundos, verTerminal)} className="mov-aparece cuentas-login-ayuda">{t.ayudaNavegador}</Presente>
              </div>
            )}
          </div>
        </div>
        <div className="cuentas-login-plegable" {...(verTerminal ? {} : INERTE)}>
          <div ref={v.host} className="cuentas-login-terminal" />
        </div>
      </div>
    </Modal>
  )
}
