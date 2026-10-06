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
import { TerminalAppearanceContext } from '../../theme/terminalAppearance'
import { conexionPorId, destinoSsh, useStoreSsh } from '../ssh'
import { crearAjusteTamano } from './ajusteTamano'
import { CapasTerminal } from './CapasTerminal'
import type { OrigenTerminal, TerminalPaneProps } from './terminalPaneTipos'
import { useActivado, useEstadoSesion, useRefsTerminal, type EstadoSesion } from './useEstadoTerminalPane'
import { useInterfazTerminal } from './useInterfazTerminal'
import { useAperturaSesion, usePrimerDatoSsh, usePublicacionPane } from './useSesionShell'
import { useAjustesVivosXterm, useCicloXterm } from './useXtermPane'
import { contarRender } from '../../util/contadorRenders'

/** «Conectando a usuario@host…» mientras una sesión SSH no ha dicho nada; `null` en cualquier otro caso. */
function useTextoConectando(origen: OrigenTerminal, estado: EstadoSesion): string | null {
  const conexion = useStoreSsh((s) => (origen.tipo === 'ssh' ? conexionPorId(s, origen.conexionId) : undefined))
  if (origen.tipo !== 'ssh') return null
  const sinDatos = estado.status === 'booting' || (estado.status === 'live' && !estado.datosRecibidos)
  if (!sinDatos) return null
  return conexion ? `Conectando a ${destinoSsh(conexion)}…` : 'Conectando…'
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
    { ...ui, setExitCode: estado.setExitCode, setStatus: estado.setStatus, fitAndSyncDebounced },
    origen
  )
  useAjustesVivosXterm(refs, { appearance, accentColor, visible, activated }, fitAndSyncNow)
  useAperturaSesion(props, refs, estado, activated, fitAndSyncNow)
  usePrimerDatoSsh(props, refs, estado)
  usePublicacionPane(props, refs, estado, fitAndSyncNow)
  const conectando = useTextoConectando(origen, estado)

  return (
    <div className={`terminal-pane${visible ? '' : ' hidden'}${esSsh ? ' ssh' : ''}`} aria-hidden={!visible}>
      {/* El mensaje llega ENVUELTO por el IPC de Electron; clasificarErrorArranque lo
          desenvuelve y, si es Docker apagado, dice qué hacer. */}
      {estado.error && !esSsh && (
        <AvisoCaja tono="error" {...clasificarErrorArranque(estado.error, 'No se pudo abrir la terminal')} />
      )}
      {/* El main explica en español, sin rutas, por qué no abrió: se enseña tal cual, no plegado. */}
      {estado.error && esSsh && (
        <AvisoCaja tono="error" titulo="No se pudo abrir la conexión SSH" sugerencia={normalizarErrorIpc(estado.error)} />
      )}
      <div
        className="terminal-host"
        ref={refs.host}
        onClick={ui.enfocar}
        onContextMenu={ui.alClicDerecho}
      />
      <CapasTerminal ui={ui} conectando={conectando} />
    </div>
  )
}
