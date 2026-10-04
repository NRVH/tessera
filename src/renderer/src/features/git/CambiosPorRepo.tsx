// =============================================================================
// CambiosPorRepo: la zona de cambios del panel. Con un solo repo se pinta plana;
// con varios, una sección colapsable por repo (cabecera con nombre, rama y conteo)
// dentro de una lista virtual. Es el dueño de la fila seleccionada y la activa, del
// menú contextual único y de las marcas, para que crucen repos.
// Ver docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import { useCallback, useMemo, useState } from 'react'
import type { DetectedRepo } from '../../../../shared/workspace-ipc'
import type { RepoStatus, WorkingChange } from '../../../../shared/git-ipc'
import { ContextMenu } from '../../comun/ContextMenu'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { ChevronArbol } from '../../comun/iconosArbol'
import { VirtualList } from '../../comun/VirtualList'
import { CuerpoRepo } from './CuerpoRepo'
import { entradasMenuCambios } from './entradasMenuCambios'
import { IconoGitVacio, IconoRama } from './iconos'
import { MARGEN_VECINOS, type Seccion } from './modelo/estadoRepos'
import { resolveWorkingDiffTarget } from './modelo/resolveWorkingDiffTarget'
import {
  alturaSeccionExpandida,
  ejeDe,
  type FilaRef,
  type ManejadoresArchivo,
  type ObjetivoMenu
} from './modelo/seccionesCambios'
import { useMarcasCambios } from './useMarcasCambios'

interface PropsCambiosPorRepo {
  altoFila: number
  altoCabecera: number
  repos: DetectedRepo[] | null
  repoLabels: Map<string, string>
  activeRepoPath: string | null
  repoStatuses: RepoStatus[] | null
  isRepoExpanded: (repo: string) => boolean
  onToggleRepo: (repo: string) => void
  onSelectRepo: (repo: string) => void
  /** Qué repos se están viendo. Enciende la carga perezosa en contenedoras grandes. */
  onReposVisibles?: (repos: string[]) => void
  manejadores: ManejadoresArchivo
}

/** Zona de cambios del panel: plana con un repo, una sección colapsable por repo con varios. */
export function CambiosPorRepo(props: PropsCambiosPorRepo): React.JSX.Element {
  const { altoFila, altoCabecera, repos, activeRepoPath, manejadores } = props
  const { seleccionada, activa, seleccionar, abrirDiff } = useFilaActiva(props)
  // Menú contextual: uno vivo a la vez, con el OBJETIVO ya calculado por la fila que lo abrió.
  const [menu, setMenu] = useState<{
    x: number
    y: number
    datos: ObjetivoMenu
  } | null>(null)
  const { marcadas, alternarMarcas } = useMarcasCambios(props.repoStatuses)

  const statusPorRepo = useMemo<Map<string, RepoStatus>>(
    () => new Map((props.repoStatuses ?? []).map((s) => [s.repo, s])),
    [props.repoStatuses]
  )
  const { alturaSeccion, avisarVisibles } = useAlturasYVisibles(props, statusPorRepo)

  // `anidado` = va DENTRO de una .repo-section (multi-repo): ahí no se virtualiza.
  const cuerpo = (repo: string, anidado: boolean): React.JSX.Element => (
    <CuerpoRepo
      // `key` OBLIGATORIA: el repo único monta un solo CuerpoRepo y, sin ella, el
      // repo nuevo heredaría el estado de colapso y de marcas del anterior.
      key={repo}
      anidado={anidado}
      status={statusPorRepo.get(repo) ?? null}
      // CARGANDO POR REPO, no del panel entero: el estado gotea repo a repo.
      cargando={!statusPorRepo.has(repo)}
      altoFila={altoFila}
      altoCabecera={altoCabecera}
      seleccionada={seleccionada?.repo === repo ? seleccionada : null}
      activa={activa?.repo === repo ? activa : null}
      marcadas={marcadas}
      onAlternarMarcas={alternarMarcas}
      acciones={manejadores}
      onSeleccionar={(change, seccion) => seleccionar(repo, change, seccion)}
      onAbrirDiff={(change, seccion) => abrirDiff(repo, change, seccion)}
      onMenu={(x, y, datos) => setMenu({ x, y, datos })}
    />
  )

  // Sin lista de repos aún (escaneo en vuelo) o con uno solo: vista plana.
  const uno = repos === null || repos.length <= 1
  const repoUnico = repos?.[0]?.repoHostPath ?? activeRepoPath

  return (
    <div className="working-changes">
      {uno
        ? vistaRepoUnico(repos, repoUnico, cuerpo)
        : listaDeRepos(repos, props, statusPorRepo, { alturaSeccion, avisarVisibles }, cuerpo)}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={entradasMenuCambios(menu.datos, manejadores)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

// Fila SELECCIONADA (un clic) y fila ACTIVA (su diff está abierto): globales a
// todos los repos, porque solo hay un diff en pantalla.
function useFilaActiva(props: PropsCambiosPorRepo): {
  seleccionada: FilaRef | null
  activa: FilaRef | null
  seleccionar: (repo: string, change: WorkingChange, seccion: Seccion) => void
  abrirDiff: (repo: string, change: WorkingChange, seccion: Seccion) => void
} {
  const [seleccionada, setSeleccionada] = useState<FilaRef | null>(null)
  const [activa, setActiva] = useState<FilaRef | null>(null)
  const seleccionar = (repo: string, change: WorkingChange, seccion: Seccion): void =>
    setSeleccionada({ repo, path: change.path, seccion })
  function abrirDiff(repo: string, change: WorkingChange, seccion: Seccion): void {
    setActiva({ repo, path: change.path, seccion })
    // Abrir un archivo de un repo lo ACTIVA (el historial de abajo lo sigue).
    if (repo !== props.activeRepoPath) props.onSelectRepo(repo)
    // Diff DEL EJE de la sección: Preparados -> HEAD-vs-índice; Cambios -> índice-vs-disco.
    props.manejadores.onOpenDiff(resolveWorkingDiffTarget(change, ejeDe(seccion)))
  }
  return { seleccionada, activa, seleccionar, abrirDiff }
}

function useAlturasYVisibles(
  props: PropsCambiosPorRepo,
  statusPorRepo: Map<string, RepoStatus>
): {
  alturaSeccion: (i: number) => number
  avisarVisibles: (inicio: number, fin: number) => void
} {
  const { repos, isRepoExpanded, altoCabecera, altoFila, onReposVisibles } = props
  // Alto de la sección de un repo para la lista virtual: colapsado es solo su cabecera.
  const alturaSeccion = useCallback(
    (i: number): number => {
      const repo = repos?.[i]
      if (repo === undefined) return altoCabecera
      const ruta = repo.repoHostPath
      if (!isRepoExpanded(ruta)) return altoCabecera
      return alturaSeccionExpandida(statusPorRepo.get(ruta), altoCabecera, altoFila)
    },
    [repos, isRepoExpanded, statusPorRepo, altoCabecera, altoFila]
  )
  // Sube al padre QUÉ repos se están viendo: enciende la carga perezosa.
  const avisarVisibles = useCallback(
    (inicio: number, fin: number): void => {
      if (!repos || !onReposVisibles) return
      onReposVisibles(repos.slice(inicio, fin).map((r) => r.repoHostPath))
    },
    [repos, onReposVisibles]
  )
  return { alturaSeccion, avisarVisibles }
}

// Se exige que el escaneo HAYA TERMINADO (`repos !== null`) para afirmar que aquí no
// hay git: "aún no sé si hay repos" y "ya miré y no hay" son cosas distintas.
function vistaRepoUnico(
  repos: DetectedRepo[] | null,
  repoUnico: string | null,
  cuerpo: (repo: string, anidado: boolean) => React.JSX.Element
): React.JSX.Element {
  if (repoUnico === null && repos !== null) {
    return (
      <EstadoVacio
        icono={<IconoGitVacio />}
        titulo="Esto no es un repositorio de git"
        pista="La carpeta abierta no está versionada, así que no hay cambios que seguir."
      />
    )
  }
  if (repoUnico === null) return <div className="git-state">Cargando cambios…</div>
  return cuerpo(repoUnico, false)
}

// Lista VIRTUALIZADA de secciones de repo: el rango montado dispara la carga perezosa.
function listaDeRepos(
  repos: DetectedRepo[],
  props: PropsCambiosPorRepo,
  statusPorRepo: Map<string, RepoStatus>,
  medidas: {
    alturaSeccion: (i: number) => number
    avisarVisibles: (inicio: number, fin: number) => void
  },
  cuerpo: (repo: string, anidado: boolean) => React.JSX.Element
): React.JSX.Element {
  const { repoLabels, activeRepoPath, isRepoExpanded, onToggleRepo } = props
  return (
    <VirtualList
      className="repo-list"
      ariaLabel="Repositorios con cambios"
      items={repos}
      itemHeight={medidas.alturaSeccion}
      getKey={(r) => r.repoHostPath}
      // El colchón es el mismo número que el margen de prefetch: lo que se monta es lo que se pide.
      overscan={MARGEN_VECINOS}
      onRangoVisible={medidas.avisarVisibles}
      renderItem={(repo) => {
        const path = repo.repoHostPath
        const expandida = isRepoExpanded(path)
        return (
          <div className={`repo-section${path === activeRepoPath ? ' active' : ''}`}>
            {cabeceraRepo({
              status: statusPorRepo.get(path),
              expandida,
              activo: path === activeRepoPath,
              etiqueta: repoLabels.get(path) ?? repo.name,
              onToggle: () => onToggleRepo(path)
            })}
            {expandida && cuerpo(path, true)}
          </div>
        )
      }}
    />
  )
}

function cabeceraRepo(d: {
  status: RepoStatus | undefined
  expandida: boolean
  activo: boolean
  etiqueta: string
  onToggle: () => void
}): React.JSX.Element {
  const conteo = d.status?.changes.length ?? 0
  return (
    <button
      className="repo-header"
      onClick={d.onToggle}
      aria-expanded={d.expandida}
      title={
        d.activo
          ? 'Repositorio activo (el del historial de abajo)'
          : 'Abrir este repositorio y graficar su historial'
      }
    >
      <ChevronArbol abierto={d.expandida} />
      <span className="repo-name">{d.etiqueta}</span>
      {d.status?.branch && (
        <span className="repo-branch" title={`Rama actual: ${d.status.branch}`}>
          <IconoRama />
          {/* El asterisco marca "tiene cambios". */}
          <span className="repo-branch-name">
            {d.status.branch}
            {conteo > 0 ? '*' : ''}
          </span>
        </span>
      )}
      {conteo > 0 && <span className="repo-count">{conteo}</span>}
    </button>
  )
}
