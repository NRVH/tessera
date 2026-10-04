// =============================================================================
// CuerpoRepo: los archivos de UN repo en sus cuatro secciones de `git status`
// (Conflictos, Preparados, Cambios, Sin versionar), como una lista plana con la
// carpeta en gris detrás del nombre. Un archivo MM está en Preparados Y en Cambios,
// con la letra de su eje en cada una. Solo calcula el OBJETIVO de los menús: los
// ejecuta `CambiosPorRepo`. Ver docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import type { RepoStatus, WorkingChange } from '../../../../shared/git-ipc'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { VirtualList } from '../../comun/VirtualList'
import { FilaArbolArchivo } from './FilaArbolArchivo'
import { IconoTodoLimpio } from './iconos'
import { prefetchDiff } from './modelo/blobCache'
import type { Seccion } from './modelo/estadoRepos'
import { resolveWorkingDiffTarget } from './modelo/resolveWorkingDiffTarget'
import {
  ejeDe,
  type FilaRef,
  type ItemCambio,
  type ManejadoresArchivo,
  type ObjetivoMenu
} from './modelo/seccionesCambios'
import { useListaCambios, type ListaCambios } from './useListaCambios'

interface PropsCuerpoRepo {
  /** En una .repo-section (multi-repo) no se virtualiza: el scroll es del padre. */
  anidado: boolean
  status: RepoStatus | null
  cargando: boolean
  /** Alto de fila / de cabecera en px: los decide el tamaño de letra de la interfaz. */
  altoFila: number
  altoCabecera: number
  seleccionada: FilaRef | null
  activa: FilaRef | null
  /** Claves `${seccion} ${path}` marcadas en TODO el panel (ver CambiosPorRepo). */
  marcadas: ReadonlySet<string>
  onAlternarMarcas: (claves: readonly string[], marcar: boolean) => void
  /** Los manejadores de lote, solo para saber qué botones tienen sentido. */
  acciones: ManejadoresArchivo
  onSeleccionar: (change: WorkingChange, seccion: Seccion) => void
  onAbrirDiff: (change: WorkingChange, seccion: Seccion) => void
  // Preparar/quitar/descartar no bajan hasta aquí: los ejecuta el menú de CambiosPorRepo.
  onMenu: (x: number, y: number, datos: ObjetivoMenu) => void
}

/** Cuerpo de UN repo: sus archivos en las secciones de git status, o su estado vacío/de carga. */
export function CuerpoRepo(props: PropsCuerpoRepo): React.JSX.Element {
  const { anidado, status, cargando, altoFila, altoCabecera, marcadas, acciones } = props
  const changes = status?.changes ?? null
  const lista = useListaCambios(changes, marcadas, altoCabecera, altoFila)
  const pintarItem = (item: ItemCambio): React.JSX.Element => {
    if (item.kind === 'header') return cabeceraSubseccion(item, lista, acciones)
    return filaCambio(item, lista, props)
  }
  const estados = estadosTransitorios(status, cargando)
  // Working-tree LIMPIO: un vacío de verdad. Solo en el modo NO anidado: dentro de
  // una sección de repo el centrado de 100% empujaría a los repos de abajo.
  const limpio = status !== null && !status.error && changes?.length === 0

  // ANIDADO (multi-repo): sin scroll propio -> lista plana.
  if (anidado) {
    return (
      <div className="working-changes-list">
        {estados}
        {limpio && <div className="git-state-inline">Sin cambios en el working-tree.</div>}
        {lista.items.map((item) => (
          <div key={item.id}>{pintarItem(item)}</div>
        ))}
      </div>
    )
  }

  if (limpio) {
    return (
      <EstadoVacio
        icono={<IconoTodoLimpio />}
        titulo="Sin cambios"
        pista="El working-tree está limpio: no hay nada modificado ni sin versionar."
      />
    )
  }

  // REPO ÚNICO: la lista es su propio scroller -> VIRTUALIZADA.
  return (
    <VirtualList<ItemCambio>
      className="working-changes-list"
      ariaLabel="Cambios del working-tree"
      items={lista.items}
      itemHeight={lista.altoItem}
      getKey={(item) => item.id}
      header={estados}
      renderItem={(item) => pintarItem(item)}
    />
  )
}

/** Qué archivos toca el menú abierto desde una fila (ver ObjetivoMenu). */
function objetivoDe(seccion: Seccion, ruta: string, lista: ListaCambios): ObjetivoMenu {
  const { cambioPorRuta, marcadasPorSeccion, marcadasOrdenadas } = lista
  const change = cambioPorRuta.get(`${seccion}:${ruta}`) ?? null
  // Fila MARCADA -> toda la selección de esa sección; SIN marcar -> solo ella.
  const objetivo = marcadasPorSeccion[seccion].has(ruta) ? marcadasOrdenadas(seccion) : [ruta]
  const nuevos = objetivo.filter(
    (p) => cambioPorRuta.get(`${seccion}:${p}`)?.worktreeStatus === '?'
  )
  return { seccion, change, objetivo, nuevos }
}

function cabeceraSubseccion(
  item: Extract<ItemCambio, { kind: 'header' }>,
  lista: ListaCambios,
  acciones: ManejadoresArchivo
): React.JSX.Element {
  const seleccion = lista.marcadasOrdenadas(item.seccion)
  const n = seleccion.length
  const puedePreparar = item.seccion !== 'staged' && acciones.onStageMany
  // Descartar no se ofrece en conflictos: el lote lo revertiría a HEAD sin diálogo.
  const puedeDescartar =
    item.seccion !== 'staged' && item.seccion !== 'conflict' && acciones.onDiscardMany
  const etiquetaPreparar =
    item.seccion === 'conflict' ? `Marcar ${n} como resueltos` : `Preparar ${n}`
  return (
    <div className="working-subsection-header">
      <span className="subseccion-titulo">
        {item.label} ({item.total})
      </span>
      {n > 0 && <span className="subseccion-marcadas">· {n}</span>}
      {n > 0 && (
        <span className="subseccion-acciones">
          {item.seccion === 'staged' && acciones.onUnstageMany && (
            <button
              className="subseccion-btn"
              onClick={() => acciones.onUnstageMany?.(seleccion)}
              title={`Quitar ${n} de preparados`}
            >
              Quitar {n}
            </button>
          )}
          {puedePreparar && (
            <button
              className="subseccion-btn"
              onClick={() => acciones.onStageMany?.(seleccion)}
              title={
                item.seccion === 'conflict'
                  ? `Marcar ${n} archivos como resueltos`
                  : `Preparar ${n} archivos`
              }
            >
              {etiquetaPreparar}
            </button>
          )}
          {puedeDescartar && (
            <button
              className="subseccion-btn danger"
              onClick={() => acciones.onDiscardMany?.(seleccion)}
              title={`Descartar los cambios de ${n} archivos`}
            >
              Descartar {n}
            </button>
          )}
        </span>
      )}
    </div>
  )
}

function filaCambio(
  item: Extract<ItemCambio, { kind: 'fila' }>,
  lista: ListaCambios,
  props: PropsCuerpoRepo
): React.JSX.Element {
  const { seleccionada, activa, onAlternarMarcas, onSeleccionar, onAbrirDiff, onMenu } = props
  const { fila, seccion } = item
  const ruta = fila.nodo.ruta
  const change = lista.cambioPorRuta.get(`${seccion}:${ruta}`)
  if (!change) return <div className="git-arbol-fila" />
  const marcada = lista.marcadasPorSeccion[seccion].has(ruta)
  return (
    <FilaArbolArchivo
      fila={fila}
      plana
      marca={marcada ? 'llena' : 'vacia'}
      seleccionada={seleccionada?.path === ruta && seleccionada.seccion === seccion}
      activa={activa?.path === ruta && activa.seccion === seccion}
      onAlternarMarca={() => onAlternarMarcas([`${seccion} ${ruta}`], !marcada)}
      onSeleccionar={() => onSeleccionar(change, seccion)}
      onAbrir={() => onAbrirDiff(change, seccion)}
      onPrefetch={() => {
        const t = resolveWorkingDiffTarget(change, ejeDe(seccion))
        prefetchDiff(t.before, t.after)
      }}
      onMenu={(x, y) => onMenu(x, y, objetivoDe(seccion, ruta, lista))}
    />
  )
}

// Estados TRANSITORIOS (error y carga), comunes a los dos modos. Siguen siendo
// líneas: centrar un "cargando" hace saltar el layout al llegar los datos.
function estadosTransitorios(status: RepoStatus | null, cargando: boolean): React.JSX.Element {
  return (
    <>
      {status?.error && (
        // `title`: dentro de una sección de repo la línea se recorta a una fila; el texto entero vive aquí.
        <div className="git-error" title={status.error}>
          No se pudieron leer los cambios: {status.error}
        </div>
      )}
      {!status && cargando && <div className="git-state-inline">Cargando cambios…</div>}
    </>
  )
}
