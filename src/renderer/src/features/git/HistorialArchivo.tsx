// =============================================================================
// HistorialArchivo: la historia de UN archivo, como pestaña de la franja de Git y en
// dos columnas: los commits que tocaron el archivo y el diff de ese archivo en el
// commit elegido, a la vez. Es una pestaña junto al log y no un panel flotante porque
// son dos consultas distintas sobre lo mismo. Carga y estado: `useHistorialArchivo`.
// Ver docs/decisiones/git/cambios-historial-de-archivo.md.
// =============================================================================

import type { DiffEditorPane, DiffTarget } from '../editor'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { IconoGitVacio } from './iconos'
import { Splitter } from '../../comun/Splitter'
import { VirtualList } from '../../comun/VirtualList'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { fechaCorta } from './modelo/formatoFecha'
import type { FileRef } from '../../../../shared/git-ipc'
import { useHistorialArchivo, type HistorialDeArchivo } from './useHistorialArchivo'

export interface HistorialArchivoProps {
  /** Archivo cuya historia se enseña. Ruta POSIX relativa a la contenedora. */
  path: string
  /** Alto de fila en px (theme/densidad; el mismo que ve el CSS). */
  altoFila: number
  /** Ancho de la columna de commits, persistido por el panel que lo monta. */
  anchoLista: number
  onAnchoLista: (px: number) => void
  colMin: number
  colMax: number
  /** Doble clic: abre ese diff como pestaña del editor central, a todo lo ancho. */
  onAbrirEnEditor: (target: DiffTarget) => void
  /** "Saltar al fuente" del visor: abre el ARCHIVO en la línea que se está mirando. */
  onSaltarAlFuente: (target: DiffTarget, linea: number) => void
  /**
   * El visor de diff del editor central (`DiffEditorPane`). Llega por prop desde quien
   * monta la franja: importarlo de `../editor` cerraría el ciclo git ↔ editor entre barriles.
   */
  VisorDiff: typeof DiffEditorPane
  /** Plegado de fragmentos sin cambios. Ajuste GLOBAL, el mismo del editor. */
  colapsarSinCambios: boolean
  onColapsarSinCambios: (valor: boolean) => void
}

/** La historia de un archivo: lista de commits a la izquierda y su diff a la derecha. */
export function HistorialArchivo(props: HistorialArchivoProps): React.JSX.Element {
  const { path, anchoLista, onAnchoLista, colMin, colMax } = props
  const historial = useHistorialArchivo(path)
  const { commits, error } = historial
  const nombre = path.slice(path.lastIndexOf('/') + 1)

  if (error !== null) {
    return (
      <div className="git-log-body">
        <AvisoCaja tono="error" titulo="No se pudo leer el historial" detalle={error} />
      </div>
    )
  }

  if (commits !== null && commits.length === 0) {
    return (
      <div className="git-log-body">
        <EstadoVacio
          icono={<IconoGitVacio />}
          titulo="Sin historial"
          pista={`git no conoce ningún commit que haya tocado "${nombre}". Puede que sea un archivo nuevo que todavía no se ha confirmado.`}
        />
      </div>
    )
  }

  return (
    <div className="git-log-body">
      <div className="git-log-col git-historial-lista" style={{ flex: `0 0 ${anchoLista}px` }}>
        {listaDeCommits(historial, nombre, props)}
      </div>
      <Splitter
        orientation="vertical"
        size={anchoLista}
        min={colMin}
        max={colMax}
        direction={1}
        onResize={onAnchoLista}
        label="Ancho de la lista de commits del archivo"
      />
      <div className="git-log-col git-historial-diff">{columnaDiff(historial, nombre, props)}</div>
    </div>
  )
}

function listaDeCommits(
  { commits, hashActivo, seleccionar, abrirEnGrande }: HistorialDeArchivo,
  nombre: string,
  props: HistorialArchivoProps
): React.JSX.Element {
  return (
    <VirtualList<FileRef>
      className="git-historial-scroll"
      ariaLabel={`Commits de ${nombre}`}
      items={commits ?? []}
      itemHeight={props.altoFila}
      getKey={(c) => c.hash}
      header={
        commits === null ? <div className="git-state-inline">Cargando el historial…</div> : null
      }
      renderItem={(c) => (
        <div
          className={`git-hist-fila${c.hash === hashActivo ? ' activa' : ''}`}
          onClick={() => void seleccionar(c.hash)}
          onDoubleClick={() => abrirEnGrande(c.hash, props.onAbrirEnEditor)}
          title={`${c.subject}\n${c.author} · ${fechaCorta(c.isoDate)}\n${c.hash}`}
        >
          <span className="git-hist-autor">{c.author}</span>
          <span className="git-hist-fecha">{fechaCorta(c.isoDate)}</span>
          <span className="git-hist-asunto">{c.subject}</span>
        </div>
      )}
    />
  )
}

function columnaDiff(
  { target, errorDiff, hashActivo }: HistorialDeArchivo,
  nombre: string,
  props: HistorialArchivoProps
): React.JSX.Element {
  if (errorDiff !== null) {
    return <AvisoCaja tono="error" titulo="No se pudo preparar el diff" detalle={errorDiff} />
  }
  if (target === 'no-aparece') {
    return (
      <AvisoCaja
        tono="info"
        titulo="Este commit no toca el archivo con este nombre"
        detalle={`En "${nombre}" el historial cruza renames, así que la lista incluye commits en los que el archivo se llamaba de otra forma. En ese punto no hay un cambio que comparar bajo el nombre actual.`}
      />
    )
  }
  if (target !== null) {
    // El MISMO visor de diff que el editor central. `key` por hash: cambiar de commit no
    // reutiliza los modelos del anterior.
    const { VisorDiff } = props
    return (
      <VisorDiff
        key={`${target.commitHash}:${target.path}`}
        target={target}
        visible
        onSaltarAlFuente={(linea) => props.onSaltarAlFuente(target, linea)}
        colapsarSinCambios={props.colapsarSinCambios}
        onColapsarSinCambios={props.onColapsarSinCambios}
      />
    )
  }
  return (
    <div className="git-state-inline">
      {hashActivo === null ? 'Elige un commit para ver qué cambió.' : 'Preparando el diff…'}
    </div>
  )
}
