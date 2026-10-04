// =============================================================================
// TerminalsPanel: la fila inferior de terminales. Es al shell lo que CCPanel es al agente:
// un wrapper que multiplexa N TerminalPane keep-alive y pone el marco (cabecera con
// pestañas, «+», reinicio y ocultar). Cambiar de perfil, proyecto o terminal solo alterna
// cuál se ve; una terminal muere cuando su pane se desmonta (la cierras, o cierras su
// proyecto o perfil). Las acciones se ocultan en reposo con `visibility`, no `display`.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useState } from 'react'
import { HideIcon, PlusIcon } from './IconosTerminales'
import { PilaTerminales } from './PilaTerminales'
import { ZonaPestanas, type Renombrando } from './PestanasTerminales'
import { botonReinicio, type SalidaBotonReinicio } from './reloadButton'
import { terminalPaneKey, type ShellTerminal, type ShellTerminalsState } from './shellTerminalsModel'
import type { TerminalPaneInfo, TerminalProjectTarget } from './terminalPaneTipos'
import { useInfoPanes } from './useInfoPanes'

export interface TerminalsPanelProps {
  /** ¿El panel está desplegado? (toggle de la StatusBar / Ctrl+`). Solo CSS: no desmonta. */
  visible: boolean
  /** Proyectos abiertos de TODOS los perfiles (cada uno con su lista de terminales). */
  projects: TerminalProjectTarget[]
  /** Proyecto que se está mirando (o null). Solo sus terminales pueden verse. */
  activeProjectKey: string | null
  /** Proyectos hibernados: el backend mató sus sesiones; sus panes deben relanzarlas al despertar. */
  hibernatedProjectKeys: Set<string>
  /**
   * Claves `${profileId}|${projectHostPath}` de proyectos en MODO NATIVO: la terminal
   * corre en el host. El nombre del prop conserva el «windows» del modo viejo porque
   * viaja hasta `useModoProyecto`.
   */
  windowsModeKeys: Set<string>
  /** Bases montadas por proyecto: el mismo ámbito que la sesión de agente, para que `tdb` vea lo mismo. */
  dbMountsByProject?: Record<string, string[]>
  /** ¿Ya se hidrataron los ajustes de donde sale el montaje? Ver TerminalPane.dbReady. */
  dbReady?: boolean
  /** Color de cada perfil, YA en tinta (`profileId` -> color). Solo tiñe el CURSOR de cada terminal. */
  profileColors?: Record<string, string>
  /** Las listas de terminales por proyecto (modelo puro, dueño: `useStoreTerminales`). */
  terminals: ShellTerminalsState
  /** «+»: nueva terminal en el proyecto (queda activa). */
  onAdd: (projectKey: string) => void
  /** «✕» de la pestaña: cierra esa terminal (desmonta su pane y mata su pty). */
  onClose: (projectKey: string, terminalId: string) => void
  /** Cambia la terminal que se mira dentro del proyecto. */
  onSelect: (projectKey: string, terminalId: string) => void
  /** Renombra una ranura. El texto llega CRUDO: recortarlo es del modelo, no de la vista. */
  onRename: (projectKey: string, terminalId: string, nombre: string) => void
  /**
   * Guion del HEADER: repliega el panel entero sin matar nada. No confundir con la ✕ de
   * cada pestaña, que sí mata esa terminal.
   */
  onClosePanel: () => void
}

/**
 * Qué ofrece el botón de reinicio (módulo puro `reloadButton`, probado). Sin cuenta que
 * pedir: en modo nativo solo espera a que los ajustes de montaje estén hidratados.
 * «Reiniciar» y no «Recargar»: es la misma acción que en el pane del agente.
 */
function botonDeTerminal(
  info: TerminalPaneInfo | undefined,
  hibernated: boolean,
  puedeAbrir: boolean
): SalidaBotonReinicio {
  return botonReinicio({
    status: info?.status ?? 'booting',
    sessionId: info?.sessionId ?? null,
    reloading: info?.reloading ?? false,
    hibernated,
    puedeAbrir,
    etiquetaNormal: 'Reiniciar',
    etiquetaProgreso: 'Reiniciando…'
  })
}

/** Acciones de la cabecera: el «+» solo si no hay fila de pestañas donde colgarlo, y ocultar el panel. */
function AccionesPanel({
  conNueva,
  activeProjectKey,
  onAdd,
  onClosePanel
}: {
  conNueva: boolean
  activeProjectKey: string | null
  onAdd: (projectKey: string) => void
  onClosePanel: () => void
}): React.JSX.Element {
  return (
    <div className="panel-actions">
      {conNueva && (
        <button
          className="btn btn-icon"
          onClick={() => activeProjectKey && onAdd(activeProjectKey)}
          disabled={activeProjectKey === null}
          title="Nueva terminal"
          aria-label="Nueva terminal"
        >
          <PlusIcon />
        </button>
      )}
      {/* OCULTAR, no cerrar: las sesiones siguen vivas (por eso un guion y no una ✕). */}
      <button
        className="btn btn-icon"
        onClick={onClosePanel}
        title="Ocultar el panel (las terminales siguen corriendo)"
        aria-label="Ocultar el panel de terminal"
      >
        <HideIcon />
      </button>
    </div>
  )
}

/** Lo que se deriva del proyecto activo: su lista, su terminal activa y el botón de reinicio. */
export interface ActivoTerminales {
  activeProject: TerminalProjectTarget | null
  activeList: ShellTerminal[]
  activeTerminalId: string | null
  activePaneKey: string | null
  activeHostMode: boolean
  boton: SalidaBotonReinicio
}

function derivarActivo(
  props: TerminalsPanelProps,
  infoByPane: Record<string, TerminalPaneInfo>
): ActivoTerminales {
  const { projects, activeProjectKey, terminals } = props
  const activeProject = projects.find((p) => p.key === activeProjectKey) ?? null
  const proyecto = activeProjectKey ? terminals[activeProjectKey] : undefined
  const activeTerminalId = proyecto?.activeId ?? null
  const activePaneKey =
    activeProjectKey && activeTerminalId ? terminalPaneKey(activeProjectKey, activeTerminalId) : null
  const key = activeProject?.key
  const activeHostMode = key !== undefined && props.windowsModeKeys.has(key)
  const activeHibernated = key !== undefined && props.hibernatedProjectKeys.has(key)
  const boton = botonDeTerminal(
    activePaneKey ? infoByPane[activePaneKey] : undefined,
    activeHibernated,
    activeHostMode ? (props.dbReady ?? true) : true
  )
  return {
    activeProject,
    activeList: proyecto?.list ?? [],
    activeTerminalId,
    activePaneKey,
    activeHostMode,
    boton
  }
}

/** Panel de terminales de la franja inferior: pestañas por proyecto y una pila de panes keep-alive. */
export function TerminalsPanel(props: TerminalsPanelProps): React.JSX.Element {
  const { visible, projects, terminals, onAdd } = props
  const [renombrando, setRenombrando] = useState<Renombrando | null>(null)
  const { infoByPane, apisRef, handleInfo, handleApi } = useInfoPanes(projects, terminals)
  const activo = derivarActivo(props, infoByPane)
  const { activeProject, activeList, activePaneKey, boton } = activo
  const conPestanas = activeProject !== null && activeList.length > 0

  return (
    <section
      className={`terminal-panel${visible ? '' : ' hidden'}`}
      aria-label="Terminal"
      aria-hidden={!visible}
    >
      <header className="panel-header">
        {/* Solo «Terminal»: la ruta del workspace ya la escribe el prompt del shell, dos píxeles más abajo. */}
        <span className="panel-title">Terminal</span>
        {/* Las pestañas se pintan también con UNA sola: la fila dice cómo se llama la
            terminal, que es lo que hace descubrible el renombrado y el «+». */}
        {conPestanas && (
          <ZonaPestanas
            projectKey={activeProject.key}
            lista={activeList}
            activeTerminalId={activo.activeTerminalId}
            hostMode={activo.activeHostMode}
            infoByPane={infoByPane}
            renombrando={renombrando}
            setRenombrando={setRenombrando}
            onSelect={props.onSelect}
            onClose={props.onClose}
            onRename={props.onRename}
            onAdd={onAdd}
            boton={boton}
            onReload={() => {
              if (activePaneKey) void apisRef.current[activePaneKey]?.reload(boton.accion)
            }}
          />
        )}
        <AccionesPanel
          conNueva={!conPestanas}
          activeProjectKey={props.activeProjectKey}
          onAdd={onAdd}
          onClosePanel={props.onClosePanel}
        />
      </header>

      {/* El error NO se pinta aquí: lo pinta el propio TerminalPane, dentro de su hueco. */}
      <div className="terminal-body">
        <PilaTerminales panel={props} activo={activo} onInfo={handleInfo} onApi={handleApi} />
      </div>
    </section>
  )
}
