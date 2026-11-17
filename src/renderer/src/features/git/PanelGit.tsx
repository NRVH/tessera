// =============================================================================
// PanelGit: la columna lateral de git, SOLO el working-tree del proyecto en las
// cuatro secciones de `git status` (Conflictos, Preparados, Cambios, Sin versionar);
// con varios repos, una sección colapsable por repo y un botón que las pliega o despliega todas. No pide datos: `estadosRepos`
// baja de `useEstadoGit`, que ya los carga para el badge y las decoraciones, y así
// la lista y el badge no discrepan. La historia vive en `PanelLogGit`.
// Ver docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import { useCallback, useLayoutEffect, useMemo } from 'react'
import type { EstadoRepo } from '../../../../shared/git-ipc'
import type { ProyectoAbiertoDePerfil } from '../pestanas'
import type { RepoDetectado } from '../../../../shared/workspace-ipc'
import type { DestinoDiff, ArchivoAbierto } from '../editor'
import { EstadoVacio, IconoCarpetaVacia } from '../../comun/EstadoVacio'
import { CambiosPorRepo } from './CambiosPorRepo'
import { asegurarEstilosGit } from './estilosGit'
import { IconoPlegarRepos, IconoRecargar } from './iconos'
import { conRepoAbierto, plegarRepos, repoAbierto, reposPorDefecto } from './modelo/expansionRepos'
import { calcularEtiquetasRepos } from './modelo/rutasArchivo'
import { fijarExpansionRepos, useStoreGit } from './store'
import { txGit } from './textos.ts'

export interface PropsPanelGit {
  /** Alto de fila / de cabecera en px (theme/densidad; el mismo que ve el CSS). */
  altoFila: number
  altoCabecera: number
  /**
   * Variables CSS de densidad de ESTA superficie (`variablesCss` de densidad.ts), escritas
   * en la RAÍZ DEL PANEL y no en `:root`. Tienen que salir del mismo número que
   * `altoFila`, o el CSS y el `altoElemento` de las listas virtuales discreparían.
   */
  variablesDensidad?: React.CSSProperties
  /** Proyecto que se mira, o null si no hay ninguno abierto. */
  proyectoActivo: ProyectoAbiertoDePerfil | null
  /** Repo activo del proyecto que se mira, o null si no tiene repo. */
  repoActivo: RepoDetectado | null
  /** Repos escaneados del proyecto activo, o null mientras se escanean. */
  repos: RepoDetectado[] | null
  /**
   * Rama + cambios de CADA repo (los pide `useEstadoGit`). `null` mientras se cargan o
   * si no hay repo. Un repo sin entrada se pinta "cargando"; uno con `error`, con su error.
   */
  estadosRepos: EstadoRepo[] | null
  /** ¿Hay una consulta de estado EN VUELO? Es lo que hace girar el botón de recargar. */
  refrescando: boolean
  /** Cambia el repo activo (el que grafica el historial del panel inferior). */
  onSeleccionarRepo: (rutaHostRepo: string) => void
  /** Qué repos se están viendo ahora mismo: enciende la carga perezosa en contenedoras grandes. */
  onReposVisibles?: (repos: string[]) => void
  /** Re-escanea qué repos contiene la carpeta abierta (botón "Recargar"). */
  onReescanearRepos?: () => void
  /** Sube el diff armado al abrir un archivo (doble clic). */
  onAbrirDiff: (destino: DestinoDiff) => void
  /** Abre el archivo TAL CUAL en el editor, sin diff ("Abrir archivo" del menú). */
  onAbrirArchivo: (archivo: ArchivoAbierto) => void
  /** Aviso de que el working-tree pudo cambiar (refresco manual): sube el tick de `useStoreGit`. */
  onCambioWorktree?: () => void
  /** Descarta los cambios de un archivo. Stage/unstage/descartar NO llevan repo: va en la ruta. */
  onDescartarCambios?: (ruta: string) => void
  /** Añade un archivo al índice (menú contextual "Preparar"). */
  onStage?: (ruta: string) => void
  /** Quita un archivo del índice (menú contextual "Quitar de preparados"). */
  onUnstage?: (ruta: string) => void
  // Acciones EN LOTE (la selección con casillas). Sin ellas los botones y los ítems no salen.
  /** Prepara varios archivos con UNA llamada (un proceso de git por repo). */
  onStageVarios?: (rutas: string[]) => void
  /** Quita varios archivos del índice con UNA llamada. */
  onUnstageVarios?: (rutas: string[]) => void
  /** Descarta varios archivos con UNA sola confirmación. */
  onDescartarVarios?: (rutas: string[]) => void
  /**
   * Excluye archivos de git (solo las rutas marcadas; si una carpeta entera se colapsa a una
   * línea lo decide el main). `local` = `.git/info/exclude` en vez de `.gitignore`.
   */
  onIgnorar?: (rutas: string[], local: boolean) => void
}

/** La columna lateral de Cambios de git: una lista por repo del proyecto activo. */
export function PanelGit(props: PropsPanelGit): React.JSX.Element {
  const {
    variablesDensidad,
    proyectoActivo,
    repoActivo,
    repos,
    estadosRepos,
    refrescando,
    altoFila,
    altoCabecera,
    onSeleccionarRepo,
    onReescanearRepos,
    onCambioWorktree,
    onReposVisibles,
    ...manejadores
  } = props
  const rutaHostProyecto = proyectoActivo?.rutaHostProyecto ?? null
  const rutaHostRepo = repoActivo?.repoHostPath ?? null

  const { estaRepoExpandido, onAlternarRepo } = useExpansionRepos(estadosRepos, rutaHostRepo, onSeleccionarRepo)
  const plegado = plegadoRepos(repos, estaRepoExpandido)

  // El CSS scoped se inyecta en un efecto de LAYOUT: con un useEffect el panel se vería un frame sin estilos.
  useLayoutEffect(() => asegurarEstilosGit(), [])

  const etiquetasRepos = useEtiquetasRepos(repos)

  return (
    <aside className="sidebar git-panel git-ui" aria-label={txGit().panelCambios} style={variablesDensidad}>
      <CabeceraCambios
        repoUnico={repos !== null && repos.length === 1 ? repos[0].name : null}
        deshabilitado={rutaHostProyecto === null}
        girando={(refrescando || estadosRepos === null) && rutaHostProyecto !== null}
        plegado={rutaHostProyecto === null ? null : plegado}
        onReescanearRepos={onReescanearRepos}
        onCambioWorktree={onCambioWorktree}
      />
      <div className="sidebar-body">
        {rutaHostProyecto === null ? (
          estadoSinProyecto()
        ) : (
          <CambiosPorRepo
            // Cambiar de proyecto REMONTA el cuerpo: si no, las marcas sobreviven
            // por clave y "Descartar 1" actuaría sobre un archivo que nadie marcó.
            key={rutaHostProyecto}
            manejadores={manejadores}
            altoFila={altoFila}
            altoCabecera={altoCabecera}
            repos={repos}
            etiquetasRepos={etiquetasRepos}
            rutaRepoActivo={rutaHostRepo}
            estadosRepos={estadosRepos}
            onReposVisibles={onReposVisibles}
            estaRepoExpandido={estaRepoExpandido}
            onAlternarRepo={onAlternarRepo}
            onSeleccionarRepo={onSeleccionarRepo}
          />
        )}
      </div>
    </aside>
  )
}

function estadoSinProyecto(): React.JSX.Element {
  const t = txGit()
  return (
    <EstadoVacio
      icono={<IconoCarpetaVacia />}
      titulo={t.sinProyectoTitulo}
      pista={t.sinProyectoCambios}
    />
  )
}

function useEtiquetasRepos(repos: RepoDetectado[] | null): Map<string, string> {
  return useMemo(() => (repos ? calcularEtiquetasRepos(repos) : new Map<string, string>()), [repos])
}

/**
 * Expansión de cada sección de repo (`modelo/expansionRepos.ts`): lo tocado a mano vive en el
 * store por ruta del repo, así que sobrevive al cambio de proyecto y de perfil. Indexa el estado
 * por repo: la lista virtual pregunta una vez por repo y un `find` sería O(n²).
 */
function useExpansionRepos(
  estadosRepos: EstadoRepo[] | null,
  repoActivo: string | null,
  onSeleccionarRepo: (rutaHostRepo: string) => void
): {
  estaRepoExpandido: (repo: string) => boolean
  onAlternarRepo: (repo: string) => void
} {
  const expansion = useStoreGit((s) => s.expansionRepos)
  const estadoPorRepo = useMemo<Map<string, EstadoRepo>>(
    () => new Map((estadosRepos ?? []).map((s) => [s.repo, s])),
    [estadosRepos]
  )

  const estaRepoExpandido = useCallback(
    (repo: string): boolean => repoAbierto(expansion, repo, (estadoPorRepo.get(repo)?.cambios.length ?? 0) > 0),
    [expansion, estadoPorRepo]
  )
  const onAlternarRepo = (repo: string): void => {
    const estaba = estaRepoExpandido(repo)
    fijarExpansionRepos((m) => conRepoAbierto(m, repo, !estaba))
    // EXPANDIR también ACTIVA: el historial de abajo sigue al repo que abres.
    if (!estaba && repo !== repoActivo) onSeleccionarRepo(repo)
  }
  return { estaRepoExpandido, onAlternarRepo }
}

/** El botón de plegar o desplegar todos los repos: solo con más de uno. */
interface PlegadoRepos {
  /** ¿Hay alguno abierto? Entonces el botón pliega; si no, despliega. */
  plegar: boolean
  onClic: () => void
}

/** Plegar todos cierra cada repo del proyecto a mano; desplegar los devuelve a lo de por defecto. */
function plegadoRepos(repos: RepoDetectado[] | null, estaRepoExpandido: (repo: string) => boolean): PlegadoRepos | null {
  if (repos === null || repos.length < 2) return null
  const plegar = repos.some((r) => estaRepoExpandido(r.repoHostPath))
  const rutas = repos.map((r) => r.repoHostPath)
  return {
    plegar,
    onClic: () => fijarExpansionRepos((m) => (plegar ? plegarRepos(m, rutas) : reposPorDefecto(m, rutas)))
  }
}

function CabeceraCambios(props: {
  repoUnico: string | null
  deshabilitado: boolean
  girando: boolean
  plegado: PlegadoRepos | null
  onReescanearRepos?: () => void
  onCambioWorktree?: () => void
}): React.JSX.Element {
  const { repoUnico, deshabilitado, girando, plegado, onReescanearRepos, onCambioWorktree } = props
  const t = txGit()
  const etiquetaPlegado = plegado?.plegar ? t.plegarRepos : t.desplegarRepos
  return (
    <div
      className="sidebar-header"
      style={{ justifyContent: 'space-between', paddingRight: 8, gap: 8 }}
    >
      <span style={{ flex: '0 0 auto' }}>{t.cambios}</span>
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
        {plegado !== null && (
          <button className="git-icon-btn" onClick={plegado.onClic} title={etiquetaPlegado} aria-label={etiquetaPlegado}>
            <IconoPlegarRepos plegar={plegado.plegar} />
          </button>
        )}
        <button
          className="git-icon-btn"
          onClick={() => {
            // Recarga TODO lo que muestra el panel: la lista de repos y sus cambios.
            onReescanearRepos?.()
            onCambioWorktree?.()
          }}
          disabled={deshabilitado}
          title={t.recargarCambios}
          aria-label={t.recargarCambios}
        >
          <IconoRecargar girando={girando} />
        </button>
      </div>
    </div>
  )
}
