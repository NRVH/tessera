// =============================================================================
// Pila de terminales del panel: una ranura por cada terminal de cada proyecto abierto y una por
// cada pestaña SSH de cada perfil, de TODOS los perfiles, montadas a la vez. Solo una es visible; el
// resto vive oculta con su sesión. El estado vacío es un OVERLAY, nunca un reemplazo: los panes
// siguen montados debajo para no matar sus sesiones, y solo sale si no hay ningún pane que ver.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useState } from 'react'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { EstadoVacio, IconoTerminalVacia } from '../../comun/EstadoVacio'
import { IconoServidor } from '../ssh'
import { PlusIcon } from './IconosTerminales'
import { terminalPaneKey } from './shellTerminalsModel'
import { motivoFinSsh } from './finSesionSsh'
import { ExploradorSftp } from '../sftp'
import { esPestanaSftp, sshPaneKey } from './sshTabsModel'
import { TerminalPane } from './TerminalPane'
import type { TerminalPaneApi, TerminalPaneInfo } from './terminalPaneTipos'
import { txTerminales } from './textos.ts'
import type { TerminalsPanelProps } from './TerminalsPanel'
import type { ActivoTerminales } from './activoTerminales'
import { enOrdenEstable } from '../../util/ordenEstable'

interface PilaTerminalesProps {
  panel: TerminalsPanelProps
  activo: ActivoTerminales
  onInfo: (paneKey: string, info: TerminalPaneInfo) => void
  onApi: (paneKey: string, api: TerminalPaneApi | null) => void
  /** Enseña las conexiones SSH del perfil: el riel si se ve y, si no, el lanzador de la cabecera. */
  onConectarPorSsh: () => void
}

/** El botón que enseña la lista de conexiones SSH del perfil. */
function BotonConectarPorSsh({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button className="btn" onClick={onClick}>
      <IconoServidor />
      {txTerminales().conectarPorSsh}
    </button>
  )
}

interface PropsEstadoVacio {
  activo: ActivoTerminales
  perfilId: string
  onAdd: (projectKey: string) => void
  onConectarPorSsh: () => void
}

/** Estado vacío por encima de los panes, solo cuando no hay ninguno que ver: sin proyecto ni SSH, o proyecto sin terminales. */
function EstadoVacioPila({ activo, perfilId, onAdd, onConectarPorSsh }: PropsEstadoVacio): React.JSX.Element {
  const { activeProject } = activo
  if (activo.pane !== null) return <></>
  const t = txTerminales()
  if (activeProject === null) {
    return (
      <EstadoVacio
        icono={<IconoTerminalVacia />}
        titulo={t.sinProyecto}
        pista={t.sinProyectoPista}
        accion={perfilId === '' ? undefined : <BotonConectarPorSsh onClick={onConectarPorSsh} />}
      />
    )
  }
  return (
    <EstadoVacio
      icono={<IconoTerminalVacia />}
      titulo={t.noHayTerminales}
      pista={t.cerrasteTodas}
      accion={
        <button className="btn" onClick={() => onAdd(activeProject.key)}>
          <PlusIcon />
          {t.nuevaTerminal}
        </button>
      }
    />
  )
}

/** Los panes de las ranuras de todos los proyectos abiertos, en orden estable. */
function PanesLocales({ panel, activo, onInfo, onApi }: PilaTerminalesProps): React.JSX.Element {
  return (
    <>
      {/* En orden ESTABLE y no en el de las pestañas de proyecto: una terminal que React
          cambia de sitio en el DOM pierde su scroll. */}
      {enOrdenEstable(panel.projects, (p) => p.key).flatMap((project) => {
        const hibernated = panel.hibernatedProjectKeys.has(project.key)
        return (panel.terminals[project.key]?.list ?? []).map((t) => {
          const key = terminalPaneKey(project.key, t.id)
          return (
            <ErrorBoundary key={key} label={txTerminales().zonaTerminal} variant="pane">
              <TerminalPane
                paneKey={key}
                profileId={project.profileId}
                // La terminal de un proyecto corre siempre en el equipo: Docker es solo para las cuentas de los agentes.
                origen={{ tipo: 'local', projectHostPath: project.projectHostPath, hostMode: true }}
                visible={panel.visible && key === activo.activePaneKey}
                dbMounted={panel.dbMountsByProject?.[`${project.profileId}|${project.projectHostPath}`] ?? []}
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
    </>
  )
}

/** El motivo de un fallo del explorador SFTP, con las mismas palabras que el de una pestaña SSH que no conecta. */
const textoMotivoSftp = (motivo: Parameters<typeof motivoFinSsh>[2]): string => motivoFinSsh(null, 0, motivo)

/**
 * Los panes de las pestañas SSH de TODOS los perfiles. La React key no lleva el modo de ningún
 * proyecto (una conexión SSH no depende de él) ni la hibernación: sobreviven a las dos.
 */
/** Monta su contenido la primera vez que es visible y ya no lo desmonta al ocultarse. */
function TrasVerse({ visible, children }: { visible: boolean; children: React.ReactNode }): React.JSX.Element | null {
  const [visto, setVisto] = useState(visible)
  if (visible && !visto) setVisto(true)
  return visto || visible ? <>{children}</> : null
}

function PanesSsh({ panel, activo, onInfo, onApi }: PilaTerminalesProps): React.JSX.Element {
  const todas = Object.entries(panel.ssh.estado.porPerfil).flatMap(([perfil, cur]) => cur.lista.map((tab) => ({ perfil, tab })))
  return (
    <>
      {enOrdenEstable(todas, ({ perfil, tab }) => sshPaneKey(perfil, tab.id)).map(({ perfil, tab }) => {
        const key = sshPaneKey(perfil, tab.id)
        if (esPestanaSftp(tab)) {
          const visible = panel.visible && key === activo.activePaneKey
          return (
            <ErrorBoundary key={key} label={txTerminales().zonaSftp} variant="pane">
              <div className={`terminal-pane${visible ? '' : ' hidden'}`}>
                {/* La clave del pane es la id de la sesión: lleva el perfil, porque las ids de pestaña se repiten
                    entre perfiles (con la id sola, dos exploradores compartirían sesión y servidor). Al desmontarse
                    el pane, el explorador cierra la suya. Se monta (y conecta) la primera vez que se ve: una
                    pestaña restaurada al arrancar no se conecta sola. */}
                <TrasVerse visible={visible}>
                  <ExploradorSftp
                    sesionId={key}
                    profileId={perfil}
                    conexionId={tab.conexionId}
                    altoFila={panel.ssh.altoFila}
                    textoMotivo={textoMotivoSftp}
                  />
                </TrasVerse>
              </div>
            </ErrorBoundary>
          )
        }
        return (
          <ErrorBoundary key={key} label={txTerminales().zonaSsh} variant="pane">
            <TerminalPane
              paneKey={key}
              profileId={perfil}
              origen={{ tipo: 'ssh', conexionId: tab.conexionId }}
              visible={panel.visible && key === activo.activePaneKey}
              accentColor={panel.profileColors?.[perfil] ?? null}
              onInfo={onInfo}
              onApi={onApi}
            />
          </ErrorBoundary>
        )
      })}
    </>
  )
}

/** Los panes de todas las ranuras y pestañas SSH, más el estado vacío. */
export function PilaTerminales(props: PilaTerminalesProps): React.JSX.Element {
  const { panel, activo } = props
  return (
    <div className="terminal-stack">
      <PanesLocales {...props} />
      <PanesSsh {...props} />
      <EstadoVacioPila activo={activo} perfilId={panel.ssh.perfilId} onAdd={panel.onAdd} onConectarPorSsh={props.onConectarPorSsh} />
    </div>
  )
}
