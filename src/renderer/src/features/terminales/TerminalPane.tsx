// =============================================================================
// TerminalPane: UNA terminal real (xterm.js + una sesión pty por IPC), cuerpo de una
// ranura de la lista multi-terminal; el marco lo pone TerminalsPanel. Está atado a su
// ranura (React key estable): la sesión se abre la primera vez que se ve y solo se
// cierra al desmontar. Cambiar de perfil, proyecto o terminal solo alterna `visible`.
// Los hooks se llaman en el orden en que se registran sus efectos; el detalle vive en ellos.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useContext } from 'react'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { clasificarErrorArranque } from '../../../../shared/dockerErrors'
import { TerminalAppearanceContext } from '../../theme/terminalAppearance'
import { crearAjusteTamano } from './ajusteTamano'
import { CapasTerminal } from './CapasTerminal'
import type { TerminalPaneProps } from './terminalPaneTipos'
import { useActivado, useEstadoSesion, useRefsTerminal } from './useEstadoTerminalPane'
import { useInterfazTerminal } from './useInterfazTerminal'
import { useAperturaSesion, usePublicacionPane } from './useSesionShell'
import { useAjustesVivosXterm, useCicloXterm } from './useXtermPane'
import { contarRender } from '../../util/contadorRenders'

/** Una terminal de shell (xterm y sesión pty) que reporta su estado y acciones al panel. */
export function TerminalPane(props: TerminalPaneProps): React.JSX.Element {
  contarRender('TerminalPane', props.paneKey)
  const { visible, accentColor = null } = props
  const appearance = useContext(TerminalAppearanceContext)
  const refs = useRefsTerminal(props.dbMounted, visible, appearance, accentColor)
  const estado = useEstadoSesion()
  const activated = useActivado(visible)
  const ui = useInterfazTerminal(refs)
  const { fitAndSyncNow, fitAndSyncDebounced } = crearAjusteTamano(refs)

  useCicloXterm(activated, refs, {
    ...ui,
    setExitCode: estado.setExitCode,
    setStatus: estado.setStatus,
    fitAndSyncDebounced
  })
  useAjustesVivosXterm(refs, { appearance, accentColor, visible, activated }, fitAndSyncNow)
  useAperturaSesion(props, refs, estado, activated, fitAndSyncNow)
  usePublicacionPane(props, refs, estado, fitAndSyncNow)

  return (
    <div className={`terminal-pane${visible ? '' : ' hidden'}`} aria-hidden={!visible}>
      {/* El mensaje llega ENVUELTO por el IPC de Electron; clasificarErrorArranque lo
          desenvuelve y, si es Docker apagado, dice qué hacer. */}
      {estado.error && (
        <AvisoCaja tono="error" {...clasificarErrorArranque(estado.error, 'No se pudo abrir la terminal')} />
      )}
      <div
        className="terminal-host"
        ref={refs.host}
        onClick={ui.enfocar}
        onContextMenu={ui.alClicDerecho}
      />
      <CapasTerminal ui={ui} />
    </div>
  )
}
