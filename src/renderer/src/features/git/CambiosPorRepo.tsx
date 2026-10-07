// =============================================================================
// CambiosPorRepo: la zona de cambios del panel. Con un solo repo se pinta plana;
// con varios, una sección colapsable por repo CON CAMBIOS (cabecera con casilla del
// repo, nombre, conteo y rama) dentro de una lista virtual; los limpios no salen. Es
// el dueño de la fila seleccionada y la activa, del menú contextual único y de las
// marcas, para que crucen repos.
// Ver docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import { useCallback, useMemo, useState } from 'react'
import type { DetectedRepo } from '../../../../shared/workspace-ipc'
import type { RepoStatus, WorkingChange } from '../../../../shared/git-ipc'
import { ContextMenu } from '../../comun/ContextMenu'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { ChevronArbol } from '../../comun/iconosArbol'
import { VirtualList } from '../../comun/VirtualList'
import { Casilla } from './Casilla'
import { AccionesLote, CuerpoRepo } from './CuerpoRepo'
import { entradasMenuCambios } from './entradasMenuCambios'
import { IconoGitVacio, IconoRama, IconoTodoLimpio } from './iconos'
import { MARGEN_VECINOS, UMBRAL_PEREZOSO, dividirSecciones, type Seccion } from './modelo/estadoRepos'
import { resolveWorkingDiffTarget } from './modelo/resolveWorkingDiffTarget'
import {
  alturaSeccionExpandida,
  clavesDeRepo,
  ejeDe,
  marcaDeRepo,
  repartirOrdenado,
  reposConCambios,
  soloCambios,
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
  // Solo los repos con cambios (o con un error): los limpios no ocupan la lista.
  const visibles = useMemo(
    () => (repos ? reposConCambios(repos, (r) => statusPorRepo.get(r), repos.length > UMBRAL_PEREZOSO) : null),
    [repos, statusPorRepo]
  )
  const { alturaSeccion, avisarVisibles } = useAlturasYVisibles(props, visibles, statusPorRepo)

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
  const marcas: MarcasRepo = { marcadas, alternarMarcas, acciones: manejadores }

  return (
    <div className="working-changes">
      {uno
        ? vistaRepoUnico(repos, repoUnico, cuerpo)
        : listaDeRepos(visibles ?? [], props, statusPorRepo, { alturaSeccion, avisarVisibles }, cuerpo, marcas)}
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
  repos: DetectedRepo[] | null,
  statusPorRepo: Map<string, RepoStatus>
): {
  alturaSeccion: (i: number) => number
  avisarVisibles: (inicio: number, fin: number) => void
} {
  const { isRepoExpanded, altoCabecera, altoFila, onReposVisibles } = props
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

/** Lo que necesita la cabecera de un repo para su casilla y sus acciones de lote. */
interface MarcasRepo {
  marcadas: ReadonlySet<string>
  alternarMarcas: (claves: readonly string[], marcar: boolean) => void
  acciones: ManejadoresArchivo
}

// Lista VIRTUALIZADA de secciones de repo: el rango montado dispara la carga perezosa. Solo trae
// los repos con cambios; sin ninguno, el vacío de «todo al día» (o el aviso de carga si aún faltan).
function listaDeRepos(
  repos: DetectedRepo[],
  props: PropsCambiosPorRepo,
  statusPorRepo: Map<string, RepoStatus>,
  medidas: {
    alturaSeccion: (i: number) => number
    avisarVisibles: (inicio: number, fin: number) => void
  },
  cuerpo: (repo: string, anidado: boolean) => React.JSX.Element,
  marcas: MarcasRepo
): React.JSX.Element {
  const { repoLabels, activeRepoPath, isRepoExpanded, onToggleRepo } = props
  if (repos.length === 0) {
    const total = props.repos?.length ?? 0
    if (statusPorRepo.size < total) return <div className="git-state">Cargando cambios…</div>
    return (
      <EstadoVacio
        icono={<IconoTodoLimpio />}
        titulo="Sin cambios"
        pista={`Ninguno de los ${total} repositorios tiene cambios sin commitear.`}
      />
    )
  }
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
            <CabeceraRepo
              status={statusPorRepo.get(path)}
              expandida={expandida}
              activo={path === activeRepoPath}
              etiqueta={repoLabels.get(path) ?? repo.name}
              onToggle={() => onToggleRepo(path)}
              marcas={marcas}
            />
            {expandida && cuerpo(path, true)}
          </div>
        )
      }}
    />
  )
}

/**
 * La cabecera de un repo: chevron, casilla de todo el repo y nombre a la izquierda; a la derecha
 * las acciones de lote (cuando «Cambios» va sin su cabecera), el conteo y la rama, en gris. Toda la
 * fila abre y cierra; la casilla y los botones no.
 */
function CabeceraRepo(d: {
  status: RepoStatus | undefined
  expandida: boolean
  activo: boolean
  etiqueta: string
  onToggle: () => void
  marcas: MarcasRepo
}): React.JSX.Element {
  const { marcadas, alternarMarcas, acciones } = d.marcas
  const conteo = d.status?.changes.length ?? 0
  const claves = useMemo(() => clavesDeRepo(d.status), [d.status])
  const marca = marcaDeRepo(claves, marcadas)
  // Sin la cabecera de «Cambios», sus acciones de lote viven aquí.
  const seleccionCambios = useMemo(() => {
    if (!d.status || !soloCambios(dividirSecciones(d.status.changes))) return []
    return repartirOrdenado(d.status.changes)
      .unstaged.map((c) => c.path)
      .filter((p) => marcadas.has(`unstaged ${p}`))
  }, [d.status, marcadas])
  return (
    <div
      className="repo-header"
      role="button"
      tabIndex={0}
      onClick={d.onToggle}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        d.onToggle()
      }}
      aria-expanded={d.expandida}
      title={d.activo ? 'Repositorio activo (el del historial de abajo)' : 'Abrir este repositorio y graficar su historial'}
    >
      <ChevronArbol abierto={d.expandida} />
      {claves.length > 0 && (
        <Casilla estado={marca} etiqueta={`Marcar todo ${d.etiqueta}`} onAlternar={() => alternarMarcas(claves, marca !== 'llena')} />
      )}
      <span className="repo-name">{d.etiqueta}</span>
      <span className="repo-derecha">
        {/* Los botones no abren ni cierran el repo. */}
        <span onClick={(e) => e.stopPropagation()}>
          <AccionesLote seccion="unstaged" seleccion={seleccionCambios} acciones={acciones} />
        </span>
        {/* Mientras hay marcas, los botones ocupan el sitio del conteo y de la rama: el nombre no se recorta. */}
        {seleccionCambios.length === 0 && conteo > 0 && <span className="repo-count">{conteo}</span>}
        {seleccionCambios.length === 0 && d.status?.branch && (
          <span className="repo-branch" title={`Rama actual: ${d.status.branch}`}>
            <IconoRama />
            {/* El asterisco marca "tiene cambios". */}
            <span className="repo-branch-name">
              {d.status.branch}
              {conteo > 0 ? '*' : ''}
            </span>
          </span>
        )}
      </span>
    </div>
  )
}
