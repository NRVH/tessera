// =============================================================================
// HistorialArchivo: la historia de UN archivo, como pestaña de la franja de Git y en
// dos columnas: los commits que tocaron el archivo y el diff de ese archivo en el
// commit elegido, a la vez. Es una pestaña junto al log y no un panel flotante porque
// son dos consultas distintas sobre lo mismo. Carga y estado: `useHistorialArchivo`.
// Ver docs/decisiones/git/cambios-historial-de-archivo.md.
// =============================================================================

import type { PaneDiffEditor, DestinoDiff } from '../editor'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { EsperaCarga } from '../../comun/IndicadorCarga'
import { Cruce } from '../../comun/Presente'
import { IconoGitVacio } from './iconos'
import { Divisor } from '../../comun/Divisor'
import { ListaVirtual } from '../../comun/ListaVirtual'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { fechaCorta } from './modelo/formatoFecha'
import { txGit } from './textos.ts'
import type { ReferenciaCommitArchivo } from '../../../../shared/git-ipc'
import { useHistorialArchivo, type HistorialDeArchivo } from './useHistorialArchivo'

export interface PropsHistorialArchivo {
  /** Archivo cuya historia se enseña. Ruta POSIX relativa a la contenedora. */
  ruta: string
  /** Alto de fila en px (theme/densidad; el mismo que ve el CSS). */
  altoFila: number
  /** Ancho de la columna de commits, persistido por el panel que lo monta. */
  anchoLista: number
  onAnchoLista: (px: number) => void
  colMin: number
  colMax: number
  /** Doble clic: abre ese diff como pestaña del editor central, a todo lo ancho. */
  onAbrirEnEditor: (destino: DestinoDiff) => void
  /** "Saltar al fuente" del visor: abre el ARCHIVO en la línea que se está mirando. */
  onSaltarAlFuente: (destino: DestinoDiff, linea: number) => void
  /**
   * El visor de diff del editor central (`PaneDiffEditor`). Llega por prop desde quien
   * monta la franja: importarlo de `../editor` cerraría el ciclo git ↔ editor entre barriles.
   */
  VisorDiff: typeof PaneDiffEditor
  /** Plegado de fragmentos sin cambios. Ajuste GLOBAL, el mismo del editor. */
  colapsarSinCambios: boolean
  onColapsarSinCambios: (valor: boolean) => void
}

/** La historia de un archivo: lista de commits a la izquierda y su diff a la derecha. */
export function HistorialArchivo(props: PropsHistorialArchivo): React.JSX.Element {
  const { ruta, anchoLista, onAnchoLista, colMin, colMax } = props
  const historial = useHistorialArchivo(ruta)
  const { commits, error } = historial
  const nombre = ruta.slice(ruta.lastIndexOf('/') + 1)
  const t = txGit()

  return (
    <div className="git-log-body git-lista-con-estado">
      <Cruce className="git-lista-tapa" clave={error !== null ? 'error' : commits?.length === 0 ? 'vacio' : 'lista'}>
        {error !== null ? <AvisoCaja tono="error" titulo={t.errorHistorial} detalle={error} /> : commits?.length === 0 ? (
          <EstadoVacio icono={<IconoGitVacio />} titulo={t.sinHistorialTitulo} pista={t.sinHistorialPista(nombre)} />
        ) : null}
      </Cruce>
      <div className="git-log-col git-historial-lista" style={{ flex: `0 0 ${anchoLista}px` }}>
        {listaDeCommits(historial, nombre, props)}
      </div>
      <Divisor
        orientacion="vertical"
        className="splitter-hueco"
        tamano={anchoLista}
        min={colMin}
        max={colMax}
        direccion={1}
        onRedimensionar={onAnchoLista}
        etiqueta={t.anchoListaArchivo}
      />
      <div className="git-log-col git-historial-diff">{columnaDiff(historial, nombre, props)}</div>
    </div>
  )
}

function listaDeCommits(
  { commits, hashActivo, seleccionar, abrirEnGrande }: HistorialDeArchivo,
  nombre: string,
  props: PropsHistorialArchivo
): React.JSX.Element {
  const t = txGit()
  return (
    <ListaVirtual<ReferenciaCommitArchivo>
      className="git-historial-scroll"
      etiquetaAria={t.commitsDe(nombre)}
      elementos={commits ?? []}
      altoElemento={props.altoFila}
      obtenerClave={(c) => c.hash}
      cabecera={
        <Cruce clave={commits === null ? 'cargando' : 'lista'}>
          {commits === null ? <EsperaCarga texto={t.cargandoHistorialArchivo} className="git-state-inline" /> : null}
        </Cruce>
      }
      pintarElemento={(c) => (
        <div
          className={`git-hist-fila${c.hash === hashActivo ? ' activa' : ''}`}
          onClick={() => void seleccionar(c.hash)}
          onDoubleClick={() => abrirEnGrande(c.hash, props.onAbrirEnEditor)}
          title={`${c.asunto}\n${c.autor} · ${fechaCorta(c.fechaIso)}\n${c.hash}`}
        >
          <span className="git-hist-autor">{c.autor}</span>
          <span className="git-hist-fecha">{fechaCorta(c.fechaIso)}</span>
          <span className="git-hist-asunto">{c.asunto}</span>
        </div>
      )}
    />
  )
}

function columnaDiff(
  { destino, errorDiff, hashActivo }: HistorialDeArchivo,
  nombre: string,
  props: PropsHistorialArchivo
): React.JSX.Element {
  const t = txGit()
  if (errorDiff !== null) {
    return <AvisoCaja tono="error" titulo={t.errorDiff} detalle={errorDiff} />
  }
  if (destino === 'no-aparece') {
    return (
      <AvisoCaja tono="info" titulo={t.noTocaArchivoTitulo} detalle={t.noTocaArchivoDetalle(nombre)} />
    )
  }
  if (destino !== null) {
    // El MISMO visor de diff que el editor central. `key` por hash: cambiar de commit no
    // reutiliza los modelos del anterior.
    const { VisorDiff } = props
    return (
      <VisorDiff
        key={`${destino.commitHash}:${destino.ruta}`}
        destino={destino}
        visible
        onSaltarAlFuente={(linea) => props.onSaltarAlFuente(destino, linea)}
        colapsarSinCambios={props.colapsarSinCambios}
        onColapsarSinCambios={props.onColapsarSinCambios}
      />
    )
  }
  return (
    <div className="git-state-inline">
      {hashActivo === null ? t.elegirCommit : t.preparandoDiff}
    </div>
  )
}
