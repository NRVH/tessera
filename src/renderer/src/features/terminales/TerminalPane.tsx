// =============================================================================
// TerminalPane: UNA terminal real (xterm.js + una sesión pty por IPC), cuerpo de una ranura de la
// lista multi-terminal o de una pestaña SSH del perfil; el marco lo pone TerminalsPanel. Está atado
// a su ranura (React key estable): la sesión se abre la primera vez que se ve y solo se cierra al
// desmontar. Cambiar de perfil, proyecto o terminal solo alterna `visible`. Su `origen` dice si es
// un shell de un proyecto o una conexión SSH. Los hooks se llaman en el orden en que se registran
// sus efectos; el detalle vive en ellos.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useContext } from 'react'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { clasificarErrorArranque, normalizarErrorIpc } from '../../../../shared/dockerErrors'
import type { SshConexion } from '../../../../shared/ssh-ipc'
import { TerminalAppearanceContext } from '../../theme/terminalAppearance'
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
  useRecuperacionContenedor,
  type AccionesSsh
} from './useSesionShell'
import { useAjustesVivosXterm, useCicloXterm } from './useXtermPane'
import { contarRender } from '../../util/contadorRenders'

/**
 * Lo que una sesión SSH enseña sobre su xterm: «Conectando a usuario@host…» mientras no ha dicho nada
 * (cancelable una vez abierta la sesión), y la franja de reconexión cuando terminó. Una local, nada.
 */
function capasSsh(origen: OrigenTerminal, estado: EstadoSesion, acciones: AccionesSsh, conexion: SshConexion | undefined): CapasSsh {
  if (origen.tipo !== 'ssh') return { conectando: null, fin: null }
  const t = txTerminales()
  const sinDatos = estado.status === 'booting' || (estado.status === 'live' && !estado.datosRecibidos)
  const conectando = sinDatos
    ? {
        texto: conexion ? t.conectandoA(destinoSsh(conexion)) : t.conectando,
        onCancelar: estado.status === 'live' && !estado.reloading ? acciones.cancelar : null
      }
    : null
  // Un fallo al ABRIR ya lo cuenta su aviso de error: la franja solo trae el botón.
  const terminada = estado.status === 'exited' || estado.status === 'error'
  const fin = terminada
    ? {
        motivo: estado.finSsh ?? (estado.error ? t.noSePudoAbrirConexion : t.sesionTermino),
        enVuelo: estado.reloading,
        onReconectar: conexion ? acciones.reconectar : null
      }
    : null
  return { conectando, fin }
}

/** Una terminal (xterm y sesión pty) que reporta su estado y acciones al panel. */
export function TerminalPane(props: TerminalPaneProps): React.JSX.Element {
  contarRender('TerminalPane', props.paneKey)
  const { visible, origen, accentColor = null } = props
  const esSsh = origen.tipo === 'ssh'
  const appearance = useContext(TerminalAppearanceContext)
  const refs = useRefsTerminal(props.dbMounted, visible, appearance, accentColor)
  const estado = useEstadoSesion()
  const activated = useActivado(visible)
  const ui = useInterfazTerminal(refs, esSsh)
  const { fitAndSyncNow, fitAndSyncDebounced } = crearAjusteTamano(refs)

  useCicloXterm(
    activated,
    refs,
    {
      ...ui,
      setExitCode: estado.setExitCode,
      setStatus: estado.setStatus,
      setFinSsh: estado.setFinSsh,
      setCaidaContenedor: estado.setCaidaContenedor,
      fitAndSyncDebounced
    },
    origen
  )
  useAjustesVivosXterm(refs, { appearance, accentColor, visible, activated }, fitAndSyncNow)
  useAperturaSesion(props, refs, estado, activated, fitAndSyncNow)
  usePrimerDatoSsh(props, refs, estado)
  useRecuperacionContenedor(props, refs, estado, fitAndSyncNow)
  usePublicacionPane(props, refs, estado, fitAndSyncNow)
  const conexion = useStoreSsh((s) => (origen.tipo === 'ssh' ? conexionPorId(s, origen.conexionId) : undefined))
  const accionesSsh = useAccionesSsh(props, refs, estado, fitAndSyncNow, conexion !== undefined)
  const ssh = capasSsh(origen, estado, accionesSsh, conexion)

  return (
    <div className={`terminal-pane${visible ? '' : ' hidden'}${esSsh ? ' ssh' : ''}`} aria-hidden={!visible}>
      {/* El mensaje llega ENVUELTO por el IPC de Electron; clasificarErrorArranque lo
          desenvuelve y, si es Docker apagado, dice qué hacer. */}
      {estado.error && !esSsh && (
        <AvisoCaja tono="error" {...clasificarErrorArranque(estado.error, txTerminales().noSePudoAbrirTerminal)} />
      )}
      {/* El main explica en español, sin rutas, por qué no abrió: se enseña tal cual, no plegado. */}
      {estado.error && esSsh && (
        <AvisoCaja tono="error" titulo={txTerminales().noSePudoAbrirConexionSsh} sugerencia={normalizarErrorIpc(estado.error)} />
      )}
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
