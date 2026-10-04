// =============================================================================
// ColumnaCentro y ListaCommits: la columna central del panel de Log, con la barra de
// filtros y la lista virtualizada de commits (grafo, chips, copiar hash) y sus estados.
// Solo pintan: el estado viene de `useEstadoLog`. El foco vive en el contenedor de la
// lista, no en las filas, que se desmontan al salir de la ventana virtual.
// Decisiones: docs/decisiones/git/log-apertura-y-teclado.md
// =============================================================================

import { EstadoVacio } from '../../comun/EstadoVacio'
import { VirtualList } from '../../comun/VirtualList'
import { BarraFiltros } from './BarraFiltros'
import { SIN_COMMITS } from './constantesLog'
import { FilaCommit } from './FilaCommit'
import { IconoGitVacio } from './iconos'
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
    <div className="git-state-inline">
      {lista.length} de {commits.length} commits
      {hayMas ? ' cargados (el filtro solo mira dentro de estos)' : ''}
    </div>
  )
}

/** Estados de arriba de la lista: error, cargando, sin coincidencias y lo que se esconde. */
function EncabezadoLista({ e }: { e: EstadoLog }): React.JSX.Element {
  const { error, commits } = e.datos
  const lista = e.vista.visibles ?? SIN_COMMITS
  return (
    <>
      {error && <div className="git-error">No se pudo leer la historia de git:{'\n'}{error}</div>}
      {/* «Cargando» va como línea y no centrado: centrarlo haría saltar el layout. */}
      {!error && commits === null && <div className="git-state">Cargando historial…</div>}
      {!error && commits !== null && commits.length > 0 && lista.length === 0 && (
        <div className="git-state">Ningún commit coincide con los filtros.</div>
      )}
      <AvisoOculto e={e} />
    </>
  )
}

/** Pie de la lista: cargar el historial completo, solo si la página estaba acotada. */
function pieLista(e: EstadoLog): React.JSX.Element | null {
  const { hayMas, error, commits, cargando } = e.datos
  if (!(hayMas && !error && commits !== null && commits.length > 0)) return null
  return (
    <div className="git-cargar-todo">
      <button
        onClick={() => void e.cargadores.cargarCommits(e.filtros.rama, undefined, { completo: true })}
        disabled={cargando || !e.anclado}
        title={`Mostrando los últimos ${commits.length} commits; cargar el historial completo del repositorio`}
      >
        {cargando ? 'Cargando…' : `Cargar el historial completo (más de ${commits.length})`}
      </button>
    </div>
  )
}

function ListaCommits({ e, altoFila }: { e: EstadoLog; altoFila: number }): React.JSX.Element {
  const { hashSeleccionado, revelar } = e.sel
  const { layout, chipsPorHash, busqueda } = e.vista
  return (
    <VirtualList<Commit>
      className="git-historial"
      ariaLabel="Historial de commits"
      role="listbox"
      aria-activedescendant={hashSeleccionado === null ? undefined : idFilaCommit(hashSeleccionado)}
      // Una sola parada de tabulador para toda la lista (las filas están a -1).
      tabIndex={0}
      onKeyDown={e.teclas.teclasCommits}
      // `onMouseDown` y no `onClick`: el foco tiene que llegar ANTES que el handler de la fila.
      onMouseDown={(ev) => ev.currentTarget.focus()}
      items={e.vista.visibles ?? SIN_COMMITS}
      // El MISMO número que recibe FilaCommit: si difirieran, el scroll iría descuadrado.
      itemHeight={altoFila}
      getKey={(commit) => commit.hash}
      scrollToIndex={revelar?.indice ?? null}
      scrollToken={revelar?.token}
      header={<EncabezadoLista e={e} />}
      footer={pieLista(e)}
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
          titulo="Aún no hay commits"
          pista="Este repositorio está recién creado. En cuanto confirmes el primer commit, su historial aparecerá aquí."
        />
      ) : (
        <ListaCommits e={e} altoFila={altoFila} />
      )}
    </div>
  )
}
