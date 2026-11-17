// =============================================================================
// TerminalPane: UNA terminal real (xterm.js + una sesión pty por IPC), cuerpo de una ranura de la
// lista multi-terminal o de una pestaña SSH del perfil; el marco lo pone PanelTerminalesPuro. Está atado
// a su ranura (React key estable): la sesión se abre la primera vez que se ve y solo se cierra al
// desmontar. Cambiar de perfil, proyecto o terminal solo alterna `visible`. Su `origen` dice si es
// un shell de un proyecto o una conexión SSH. Los hooks se llaman en el orden en que se registran
// sus efectos; el detalle vive en ellos.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { Presente } from '../../comun/Presente'
import { useContext, useRef } from 'react'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { clasificarErrorArranque, normalizarErrorIpc } from '../../../../shared/erroresDocker'
import type { SshConexion } from '../../../../shared/ssh-ipc'
import { ContextoAparienciaTerminal } from '../../theme/aparienciaTerminal'
import { conexionPorId, destinoSsh, useStoreSsh } from '../ssh'
import { crearAjusteTamano } from './ajusteTamano'
import { CapasTerminal, type CapasSsh } from './CapasTerminal'
import type { OrigenTerminal, TerminalPaneProps } from './terminalPaneTipos'
import { txTerminales } from './textos.ts'
import { useActivado, useEstadoSesion, useRefsTerminal, type EstadoSesion } from './useEstadoTerminalPane'
import { useInterfazTerminal } from './useInterfazTerminal'
import {
  useAccionesSsh,
  useAperturaSesion,
  usePrimerDatoSsh,
  usePublicacionPane,
  type AccionesSsh
} from './useSesionShell'
import { useAjustesVivosXterm, useCicloXterm } from './useXtermPane'
import { contarPintado } from '../../util/contadorRenders'

/**
 * Lo que una sesión SSH enseña sobre su xterm: «Conectando a usuario@host…» mientras no ha dicho nada
 * (cancelable una vez abierta la sesión), y la franja de reconexión cuando terminó. Una local, nada.
 */
function capasSsh(origen: OrigenTerminal, estado: EstadoSesion, acciones: AccionesSsh, conexion: SshConexion | undefined): CapasSsh {
  if (origen.tipo !== 'ssh') return { conectando: null, fin: null }
  const t = txTerminales()
  const sinDatos = estado.estadoTerminal === 'booting' || (estado.estadoTerminal === 'live' && !estado.datosRecibidos)
  const conectando = sinDatos
    ? {
        texto: conexion ? t.conectandoA(destinoSsh(conexion)) : t.conectando,
        onCancelar: estado.estadoTerminal === 'live' && !estado.recargando ? acciones.cancelar : null
      }
    : null
  // Un fallo al ABRIR ya lo cuenta su aviso de error: la franja solo trae el botón.
  const terminada = estado.estadoTerminal === 'exited' || estado.estadoTerminal === 'error'
  const fin = terminada
    ? {
        motivo: estado.finSsh ?? (estado.error ? t.noSePudoAbrirConexion : t.sesionTermino),
        enVuelo: estado.recargando,
        onReconectar: conexion ? acciones.reconectar : null
      }
    : null
  return { conectando, fin }
}

/** Una terminal (xterm y sesión pty) que reporta su estado y acciones al panel. */
export function TerminalPane(props: TerminalPaneProps): React.JSX.Element {
  contarPintado('TerminalPane', props.clavePane)
  const { visible, origen, colorAcento = null } = props
  const esSsh = origen.tipo === 'ssh'
  const apariencia = useContext(ContextoAparienciaTerminal)
  const refs = useRefsTerminal(props.basesMontadas, visible, apariencia, colorAcento)
  const estado = useEstadoSesion()
  const activado = useActivado(visible)
  const ui = useInterfazTerminal(refs, esSsh)
  const { ajustarYSincronizarAhora, ajustarYSincronizarConRebote } = crearAjusteTamano(refs)

  useCicloXterm(
    activado,
    refs,
    {
      ...ui,
      setCodigoSalida: estado.setCodigoSalida,
      setEstado: estado.setEstado,
      setFinSsh: estado.setFinSsh,
      ajustarYSincronizarConRebote
    },
    origen
  )
  useAjustesVivosXterm(refs, { apariencia, colorAcento, visible, activado }, ajustarYSincronizarAhora)
  useAperturaSesion(props, refs, estado, activado, ajustarYSincronizarAhora)
  usePrimerDatoSsh(props, refs, estado)
  usePublicacionPane(props, refs, estado, ajustarYSincronizarAhora)
  const conexion = useStoreSsh((s) => (origen.tipo === 'ssh' ? conexionPorId(s, origen.conexionId) : undefined))
  const accionesSsh = useAccionesSsh(props, refs, estado, ajustarYSincronizarAhora, conexion !== undefined)
  const ssh = capasSsh(origen, estado, accionesSsh, conexion)
  const ultimoError = useRef(estado.error)
  if (estado.error) ultimoError.current = estado.error

  return (
    <div className={`terminal-pane${visible ? '' : ' hidden'}${esSsh ? ' ssh' : ''}`} aria-hidden={!visible}>
      {/* El mensaje llega ENVUELTO por el IPC de Electron; clasificarErrorArranque lo
          desenvuelve, respeta un aviso del main al usuario y pliega el detalle técnico. */}
      <Presente visible={!!(estado.error && !esSsh)} className="mov-aparece terminal-fundido">
        <AvisoCaja tono="error" {...clasificarErrorArranque(ultimoError.current ?? '', txTerminales().noSePudoAbrirTerminal)} />
      </Presente>
      {/* El main explica en español, sin rutas, por qué no abrió: se enseña tal cual, no plegado. */}
      <Presente visible={!!(estado.error && esSsh)} className="mov-aparece terminal-fundido">
        <AvisoCaja tono="error" titulo={txTerminales().noSePudoAbrirConexionSsh} sugerencia={normalizarErrorIpc(ultimoError.current ?? '')} />
      </Presente>
      <div
        className="terminal-host"
        ref={refs.host}
        onClick={ui.enfocar}
        onContextMenu={ui.alClicDerecho}
      />
      <CapasTerminal ui={ui} ssh={ssh} />
    </div>
  )
}
