// =============================================================================
// ColumnaCentro y ListaCommits: la columna central del panel de Log, con la barra de
// filtros y la lista virtualizada de commits (grafo, chips, copiar hash) y sus estados.
// Solo pintan: el estado viene de `useEstadoLog`. El foco vive en el contenedor de la
// lista, no en las filas, que se desmontan al salir de la ventana virtual.
// Decisiones: docs/decisiones/git/log-apertura-y-teclado.md
// =============================================================================

import { cargaOcupa, type FaseCarga } from '../../comun/cargaDiferida'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { IndicadorCarga } from '../../comun/IndicadorCarga'
import { useCargaDiferida } from '../../comun/useCargaDiferida'
import { VirtualList } from '../../comun/VirtualList'
import { BarraFiltros } from './BarraFiltros'
import { SIN_COMMITS } from './constantesLog'
import { FilaCommit } from './FilaCommit'
import { IconoGitVacio } from './iconos'
import { txGit } from './textos.ts'
import { esFiltroVacio } from './modelo/filtrosLog'
import type { EstadoLog } from './useEstadoLog'
import type { Commit } from '../../../../shared/git-ipc'

/** Id DOM de una fila de commit, para `aria-activedescendant`. */
function idFilaCommit(hash: string): string {
  return `git-commit-${hash}`
}

/** Aviso de lo que el filtro esconde: si la página está acotada, solo mira lo cargado. */
function AvisoOculto({ e }: { e: EstadoLog }): React.JSX.Element | null {
  const { error, commits, hayMas } = e.datos
  const lista = e.vista.visibles ?? SIN_COMMITS
  const sinFiltrar = esFiltroVacio(e.filtros) && e.vista.busqueda.modo === 'vacio'
  if (error || commits === null || lista.length === 0 || lista.length >= commits.length || sinFiltrar) {
    return null
  }
  return (
    <div className="git-state-inline">{txGit().avisoOculto(lista.length, commits.length, hayMas)}</div>
  )
}

/**
 * Estados de arriba de la lista: error, cargando, sin coincidencias y lo que se esconde.
 * `carga` es la fase del aviso mientras ocupa el sitio de la lista (null = ya no).
 */
function EncabezadoLista({ e, carga }: { e: EstadoLog; carga: FaseCarga | null }): React.JSX.Element {
  const { error, commits } = e.datos
  const lista = e.vista.visibles ?? SIN_COMMITS
  const t = txGit()
  return (
    <>
      {error && <div className="git-error">{t.errorHistoria}{'\n'}{error}</div>}
      {carga !== null && <IndicadorCarga fase={carga} texto={t.cargandoHistorial} className="git-state" />}
      {carga === null && !error && commits !== null && commits.length > 0 && lista.length === 0 && (
        <div className="git-state">{t.ningunCommitCoincide}</div>
      )}
      {carga === null && <AvisoOculto e={e} />}
    </>
  )
}

/** Pie de la lista: cargar el historial completo, solo si la página estaba acotada. */
function pieLista(e: EstadoLog): React.JSX.Element | null {
  const { hayMas, error, commits, cargando } = e.datos
  if (!(hayMas && !error && commits !== null && commits.length > 0)) return null
  const t = txGit()
  return (
    <div className="git-cargar-todo">
      <button
        onClick={() => void e.cargadores.cargarCommits(e.filtros.rama, undefined, { completo: true })}
        disabled={cargando}
        title={t.cargarCompletoTitulo(commits.length)}
      >
        {cargando ? t.cargando : t.cargarCompleto(commits.length)}
      </button>
    </div>
  )
}

function ListaCommits({ e, altoFila }: { e: EstadoLog; altoFila: number }): React.JSX.Element {
  const { hashSeleccionado, revelar } = e.sel
  const { layout, chipsPorHash, busqueda } = e.vista
  const cargando = !e.datos.error && e.datos.commits === null
  const fase = useCargaDiferida(cargando)
  // Mientras el aviso cumple su mínimo visible, los commits que ya llegaron esperan detrás.
  // Con error no ocupa: el aviso y el error no se ven a la vez.
  const ocupa = !e.datos.error && cargaOcupa(cargando, fase)
  return (
    <VirtualList<Commit>
      className="git-historial"
      ariaLabel={txGit().historialDeCommits}
      role="listbox"
      aria-activedescendant={hashSeleccionado === null ? undefined : idFilaCommit(hashSeleccionado)}
      // Una sola parada de tabulador para toda la lista (las filas están a -1).
      tabIndex={0}
      // Mientras el aviso ocupa la lista no hay filas sobre las que actuar.
      onKeyDown={ocupa ? undefined : e.teclas.teclasCommits}
      // `onMouseDown` y no `onClick`: el foco tiene que llegar ANTES que el handler de la fila.
      onMouseDown={(ev) => ev.currentTarget.focus()}
      items={ocupa ? SIN_COMMITS : (e.vista.visibles ?? SIN_COMMITS)}
      // El MISMO número que recibe FilaCommit: si difirieran, el scroll iría descuadrado.
      itemHeight={altoFila}
      getKey={(commit) => commit.hash}
      // Sin lista no hay a dónde saltar: el revelado se pide al soltarla, o se perdería.
      scrollToIndex={ocupa ? null : (revelar?.indice ?? null)}
      scrollToken={revelar?.token}
      header={<EncabezadoLista e={e} carga={ocupa ? fase : null} />}
      footer={ocupa ? null : pieLista(e)}
      renderItem={(commit, i) => (
        <FilaCommit
          commit={commit}
          row={layout.rows[i]}
          laneCount={layout.laneCount}
          alto={altoFila}
          chips={chipsPorHash.get(commit.hash) ?? []}
          enRamaActual={e.datos.enRamaActual.has(commit.hash)}
          activa={commit.hash === hashSeleccionado}
          resaltar={busqueda.modo === 'texto' ? busqueda.texto : null}
          idFila={idFilaCommit(commit.hash)}
          copiado={commit.hash === e.copia.hashCopiado}
          // Un clic en un commit SÍ pide abrir su primer archivo.
          onSeleccionar={() => e.apertura.seleccionarCommit(commit.hash, true)}
          onCopiarHash={() => e.copia.copiarHashDeCommit(commit.hash)}
        />
      )}
    />
  )
}

/** Barra de filtros y lista de commits (o el vacío de un repo recién creado). */
export function ColumnaCentro(p: {
  e: EstadoLog
  altoFila: number
  consulta: string
  onConsulta: (q: string) => void
}): React.JSX.Element {
  const { e, altoFila, consulta, onConsulta } = p
  const { anchoAutorPx, centroRef } = e.ancho
  return (
    // `--git-log-autor-w` viaja como variable CSS y no como prop de cada fila, que son miles.
    <div
      ref={centroRef}
      className="git-log-col git-log-centro"
      style={
        anchoAutorPx === null
          ? undefined
          : ({ '--git-log-autor-w': `${anchoAutorPx}px` } as React.CSSProperties)
      }
    >
      <BarraFiltros
        consulta={consulta}
        onConsulta={onConsulta}
        busqueda={e.vista.busqueda}
        coincidencias={e.vista.coincidencias}
        indiceCoincidencia={e.navegacion.posCoincidencia}
        onSaltarCoincidencia={e.navegacion.saltarCoincidencia}
        filtros={e.filtros}
        onFiltros={e.aplicarFiltrosNuevos}
        branches={e.datos.branches}
        autores={e.vista.autores}
      />
      {/* El vacío va aquí y no en el `header` de la lista: dentro, el centrado se calcula
          contra el contenedor de scroll y el mensaje queda arriba. */}
      {!e.datos.error && e.datos.commits?.length === 0 ? (
        <EstadoVacio
          icono={<IconoGitVacio />}
          titulo={txGit().sinCommitsTitulo}
          pista={txGit().sinCommitsPista}
        />
      ) : (
        <ListaCommits e={e} altoFila={altoFila} />
      )}
    </div>
  )
}
