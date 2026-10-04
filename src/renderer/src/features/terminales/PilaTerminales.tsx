// =============================================================================
// Pila de terminales del panel: una ranura por cada terminal de cada proyecto abierto,
// de TODOS los perfiles, montadas a la vez. Solo una es visible; el resto vive oculta
// con su sesión. El estado vacío es un OVERLAY, nunca un reemplazo: los panes siguen
// montados debajo para no matar sus sesiones.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { EstadoVacio, IconoTerminalVacia } from '../../comun/EstadoVacio'
import { PlusIcon } from './IconosTerminales'
import { terminalPaneKey, type ShellTerminal } from './shellTerminalsModel'
import { TerminalPane } from './TerminalPane'
import type { TerminalPaneApi, TerminalPaneInfo, TerminalProjectTarget } from './terminalPaneTipos'
import type { ActivoTerminales, TerminalsPanelProps } from './TerminalsPanel'
import { enOrdenEstable } from '../../util/ordenEstable'

interface PilaTerminalesProps {
  panel: TerminalsPanelProps
  activo: ActivoTerminales
  onInfo: (paneKey: string, info: TerminalPaneInfo) => void
  onApi: (paneKey: string, api: TerminalPaneApi | null) => void
}

/** Estado vacío por encima de los panes: sin proyecto, o proyecto sin terminales. */
function EstadoVacioPila({
  activeProject,
  activeList,
  onAdd
}: {
  activeProject: TerminalProjectTarget | null
  activeList: ShellTerminal[]
  onAdd: (projectKey: string) => void
}): React.JSX.Element {
  if (activeProject === null) {
    return (
      <EstadoVacio
        icono={<IconoTerminalVacia />}
        titulo="Sin proyecto abierto"
        pista="Abre un proyecto para usar la terminal."
      />
    )
  }
  if (activeList.length > 0) return <></>
  return (
    <EstadoVacio
      icono={<IconoTerminalVacia />}
      titulo="No hay terminales"
      pista="Cerraste todas las de este proyecto."
      accion={
        <button className="btn" onClick={() => onAdd(activeProject.key)}>
          <PlusIcon />
          Nueva terminal
        </button>
      }
    />
  )
}

/** Los panes de todas las ranuras de todos los proyectos abiertos, más el estado vacío. */
export function PilaTerminales({ panel, activo, onInfo, onApi }: PilaTerminalesProps): React.JSX.Element {
  return (
    <div className="terminal-stack">
      {/* En orden ESTABLE y no en el de las pestañas de proyecto: una terminal que React
          cambia de sitio en el DOM pierde su scroll. */}
      {enOrdenEstable(panel.projects, (p) => p.key).flatMap((project) => {
        const hostMode = panel.windowsModeKeys.has(project.key)
        const hibernated = panel.hibernatedProjectKeys.has(project.key)
        return (panel.terminals[project.key]?.list ?? []).map((t) => {
          const key = terminalPaneKey(project.key, t.id)
          return (
            // La React key incluye el MODO: alternar nativo⇄Docker REMONTA el pane (cierra la
            // sesión vieja y abre otra en el shell correcto) en vez de dejar una sesión viva
            // con el modo equivocado. El resto de la key es fijo: el pane sobrevive a todo lo demás.
            <ErrorBoundary key={`${key}${hostMode ? '|host' : ''}`} label="la terminal" variant="pane">
              <TerminalPane
                paneKey={key}
                profileId={project.profileId}
                projectHostPath={project.projectHostPath}
                visible={panel.visible && key === activo.activePaneKey}
                hostMode={hostMode}
                dbMounted={
                  panel.dbMountsByProject?.[`${project.profileId}|${project.projectHostPath}`] ?? []
                }
                dbReady={panel.dbReady}
                hibernated={hibernated}
                accentColor={panel.profileColors?.[project.profileId] ?? null}
                onInfo={onInfo}
                onApi={onApi}
              />
            </ErrorBoundary>
          )
        })
      })}
      <EstadoVacioPila
        activeProject={activo.activeProject}
        activeList={activo.activeList}
        onAdd={panel.onAdd}
      />
    </div>
  )
}
