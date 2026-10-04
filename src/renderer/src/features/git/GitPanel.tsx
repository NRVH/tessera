// =============================================================================
// GitPanel: la columna lateral de git, SOLO el working-tree del proyecto en las
// cuatro secciones de `git status` (Conflictos, Preparados, Cambios, Sin versionar);
// con varios repos, una sección colapsable por repo. No pide datos: `repoStatuses`
// baja de `useEstadoGit`, que ya los carga para el badge y las decoraciones, y así
// la lista y el badge no discrepan. La historia vive en `GitLogPanel`.
// Ver docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import type { RepoStatus } from '../../../../shared/git-ipc'
import type { OpenProject } from '../pestanas'
import type { DetectedRepo } from '../../../../shared/workspace-ipc'
import type { DiffTarget, OpenFile } from '../editor'
import { EstadoVacio, IconoCarpetaVacia } from '../../comun/EstadoVacio'
import { CambiosPorRepo } from './CambiosPorRepo'
import { asegurarEstilosGit } from './estilosGit'
import { IconoRecargar } from './iconos'
import { computeRepoLabels } from './modelo/rutasArchivo'

export interface GitPanelProps {
  /** Alto de fila / de cabecera en px (theme/densidad; el mismo que ve el CSS). */
  altoFila: number
  altoCabecera: number
  /**
   * Variables CSS de densidad de ESTA superficie (`variablesCss` de densidad.ts), escritas
   * en la RAÍZ DEL PANEL y no en `:root`. Tienen que salir del mismo número que
   * `altoFila`, o el CSS y el `itemHeight` de las listas virtuales discreparían.
   */
  varsDensidad?: React.CSSProperties
  /** Proyecto activo confirmado, o null si no hay ninguno abierto. */
  activeProject: OpenProject | null
  /** Repo activo CONFIRMADO por el backend, o null si el proyecto no tiene repo. */
  activeRepo: DetectedRepo | null
  /** Repos escaneados del proyecto activo, o null mientras se escanean. */
  repos: DetectedRepo[] | null
  /**
   * Rama + cambios de CADA repo (los pide `useEstadoGit`). `null` mientras se cargan o
   * si no hay repo. Un repo sin entrada se pinta "cargando"; uno con `error`, con su error.
   */
  repoStatuses: RepoStatus[] | null
  /** ¿Hay una consulta de estado EN VUELO? Es lo que hace girar el botón de recargar. */
  refrescando: boolean
  /** Cambia el repo activo (el que grafica el historial del panel inferior). */
  onSelectRepo: (repoHostPath: string) => void
  /** Qué repos se están viendo ahora mismo: enciende la carga perezosa en contenedoras grandes. */
  onReposVisibles?: (repos: string[]) => void
  /** Re-escanea qué repos contiene la carpeta abierta (botón "Recargar"). */
  onRescanRepos?: () => void
  /** Sube el diff armado al abrir un archivo (doble clic). */
  onOpenDiff: (target: DiffTarget) => void
  /** Abre el archivo TAL CUAL en el editor, sin diff ("Abrir archivo" del menú). */
  onOpenFile: (file: OpenFile) => void
  /** Aviso de que el working-tree pudo cambiar (refresco manual): sube el tick de `useStoreGit`. */
  onWorktreeChanged?: () => void
  /** Descarta los cambios de un archivo. Stage/unstage/descartar NO llevan repo: va en la ruta. */
  onDiscardChanges?: (path: string) => void
  /** Añade un archivo al índice (menú contextual "Preparar"). */
  onStage?: (path: string) => void
  /** Quita un archivo del índice (menú contextual "Quitar de preparados"). */
  onUnstage?: (path: string) => void
  // Acciones EN LOTE (la selección con casillas). Sin ellas los botones y los ítems no salen.
  /** Prepara varios archivos con UNA llamada (un proceso de git por repo). */
  onStageMany?: (paths: string[]) => void
  /** Quita varios archivos del índice con UNA llamada. */
  onUnstageMany?: (paths: string[]) => void
  /** Descarta varios archivos con UNA sola confirmación. */
  onDiscardMany?: (paths: string[]) => void
  /**
   * Excluye archivos de git (solo las rutas marcadas; si una carpeta entera se colapsa a una
   * línea lo decide el main). `local` = `.git/info/exclude` en vez de `.gitignore`.
   */
  onIgnorar?: (paths: string[], local: boolean) => void
}

/** La columna lateral de Cambios de git: una lista por repo del proyecto activo. */
export function GitPanel(props: GitPanelProps): React.JSX.Element {
  const {
    varsDensidad,
    activeProject,
    activeRepo,
    repos,
    repoStatuses,
    refrescando,
    altoFila,
    altoCabecera,
    onSelectRepo,
    onRescanRepos,
    onWorktreeChanged,
    onReposVisibles,
    ...manejadores
  } = props
  const projectHostPath = activeProject?.projectHostPath ?? null
  const repoHostPath = activeRepo?.repoHostPath ?? null

  const { isRepoExpanded, onToggleRepo } = useExpansionRepos(
    projectHostPath,
    repoStatuses,
    repoHostPath,
    onSelectRepo
  )

  // El CSS scoped se inyecta en un efecto de LAYOUT: con un useEffect el panel se vería un frame sin estilos.
  useLayoutEffect(() => asegurarEstilosGit(), [])

  const repoLabels = useEtiquetasRepos(repos)

  return (
    <aside className="sidebar git-panel git-ui" aria-label="Cambios de git" style={varsDensidad}>
      <CabeceraCambios
        repoUnico={repos !== null && repos.length === 1 ? repos[0].name : null}
        deshabilitado={projectHostPath === null}
        girando={(refrescando || repoStatuses === null) && projectHostPath !== null}
        onRescanRepos={onRescanRepos}
        onWorktreeChanged={onWorktreeChanged}
      />
      <div className="sidebar-body">
        {projectHostPath === null ? (
          estadoSinProyecto()
        ) : (
          <CambiosPorRepo
            // Cambiar de proyecto REMONTA el cuerpo: si no, las marcas sobreviven
            // por clave y "Descartar 1" actuaría sobre un archivo que nadie marcó.
            key={projectHostPath}
            manejadores={manejadores}
            altoFila={altoFila}
            altoCabecera={altoCabecera}
            repos={repos}
            repoLabels={repoLabels}
            activeRepoPath={repoHostPath}
            repoStatuses={repoStatuses}
            onReposVisibles={onReposVisibles}
            isRepoExpanded={isRepoExpanded}
            onToggleRepo={onToggleRepo}
            onSelectRepo={onSelectRepo}
          />
        )}
      </div>
    </aside>
  )
}

function estadoSinProyecto(): React.JSX.Element {
  return (
    <EstadoVacio
      icono={<IconoCarpetaVacia />}
      titulo="Sin proyecto abierto"
      pista="Abre un proyecto para ver sus cambios de git."
    />
  )
}

function useEtiquetasRepos(repos: DetectedRepo[] | null): Map<string, string> {
  return useMemo(() => (repos ? computeRepoLabels(repos) : new Map<string, string>()), [repos])
}

/**
 * Expansión de cada sección de repo. Por DEFECTO se abre solo el repo que TIENE cambios;
 * el mapa guarda solo lo que el usuario abrió o cerró A MANO y cambiar de proyecto lo tira.
 * Indexa el estado por repo: la lista virtual pregunta una vez por repo y un `find` sería O(n²).
 */
function useExpansionRepos(
  projectHostPath: string | null,
  repoStatuses: RepoStatus[] | null,
  repoActivo: string | null,
  onSelectRepo: (repoHostPath: string) => void
): { isRepoExpanded: (repo: string) => boolean; onToggleRepo: (repo: string) => void } {
  const [expandedOverride, setExpandedOverride] = useState<Record<string, boolean>>({})
  useLayoutEffect(() => setExpandedOverride({}), [projectHostPath])

  const estadoPorRepo = useMemo<Map<string, RepoStatus>>(
    () => new Map((repoStatuses ?? []).map((s) => [s.repo, s])),
    [repoStatuses]
  )

  const isRepoExpanded = useCallback(
    (repo: string): boolean => {
      const override = expandedOverride[repo]
      if (override !== undefined) return override
      return (estadoPorRepo.get(repo)?.changes.length ?? 0) > 0
    },
    [expandedOverride, estadoPorRepo]
  )
  const onToggleRepo = (repo: string): void => {
    const estaba = isRepoExpanded(repo)
    setExpandedOverride((prev) => ({ ...prev, [repo]: !estaba }))
    // EXPANDIR también ACTIVA: el historial de abajo sigue al repo que abres.
    if (!estaba && repo !== repoActivo) onSelectRepo(repo)
  }
  return { isRepoExpanded, onToggleRepo }
}

function CabeceraCambios(props: {
  repoUnico: string | null
  deshabilitado: boolean
  girando: boolean
  onRescanRepos?: () => void
  onWorktreeChanged?: () => void
}): React.JSX.Element {
  const { repoUnico, deshabilitado, girando, onRescanRepos, onWorktreeChanged } = props
  return (
    <div
      className="sidebar-header"
      style={{ justifyContent: 'space-between', paddingRight: 8, gap: 8 }}
    >
      <span style={{ flex: '0 0 auto' }}>Cambios</span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          flex: '1 1 auto',
          justifyContent: 'flex-end'
        }}
      >
        {/* Con UN repo su nombre va aquí; con varios, cada sección lleva el suyo. */}
        {repoUnico !== null && (
          <span className="repo-label" title={repoUnico}>
            {repoUnico}
          </span>
        )}
        <button
          className="git-icon-btn"
          onClick={() => {
            // Recarga TODO lo que muestra el panel: la lista de repos y sus cambios.
            onRescanRepos?.()
            onWorktreeChanged?.()
          }}
          disabled={deshabilitado}
          title="Recargar los cambios"
          aria-label="Recargar los cambios"
        >
          <IconoRecargar girando={girando} />
        </button>
      </div>
    </div>
  )
}
