// =============================================================================
// PaneComprimidoDiff: diff de un .jar/.war/.ear/.zip. Arriba, las entradas que cambiaron
// entre las dos revisiones; abajo, el diff de la elegida, con el `PaneDiffEditor` de siempre.
// Elegir un contenedor anidado entra en él (miga de pan para volver). El estado vive en
// `useComprimidoDiff`; la lógica pura, en `comprimidoDiffModelo`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { PaneDiffEditor } from './DiffEditorPane'
import type { DestinoDiff } from './diffEditorTipos'
import { Divisor } from '../../comun/Divisor'
import { ListaVirtual } from '../../comun/ListaVirtual'
import { FilaArbolArchivo, etiquetaRevisiones, type FilaArbol } from '../git'
import { MIN_LISTA, maxLista, migas, tituloEntrada } from './comprimidoDiffModelo'
import { useComprimidoDiff } from './useComprimidoDiff'
import type { EntradaComparada, ProcedenciaJava } from '../../../../shared/comprimidos-ipc'
import { txComprimido } from './textosVisores.ts'

export interface PropsPaneComprimidoDiff {
  destino: DestinoDiff
  visible: boolean
  /** Identidad del pane para el main: con ella descarta lo que ya no interesa. */
  clavePane: string
  /**
   * Ámbito (perfil + proyecto) de ESTE pane y el activo ahora mismo. Los lados 'worktree' e
   * 'index' se piden por ruta relativa y el main la resuelve contra el proyecto activo: solo
   * el pane del activo compara, o compararía el .jar del proyecto equivocado.
   */
  claveDestino: string
  /** Ver `claveDestino`. */
  claveDestinoActivo: string
  altoFila: number
  variablesDensidad: CSSProperties
  colapsarSinCambios?: boolean
  onColapsarSinCambios?: (valor: boolean) => void
  /** Tick del watcher; solo se atiende si algún lado puede cambiar (disco o índice). */
  fsTick?: number
}

type EstadoComprimido = ReturnType<typeof useComprimidoDiff>

export function PaneComprimidoDiff({
  destino,
  visible,
  clavePane,
  claveDestino,
  claveDestinoActivo,
  altoFila,
  variablesDensidad,
  colapsarSinCambios,
  onColapsarSinCambios,
  fsTick = 0
}: PropsPaneComprimidoDiff): React.JSX.Element {
  const c = useComprimidoDiff({ destino, visible, clavePane, claveDestino, claveDestinoActivo, altoFila, fsTick })
  const zonaRef = useRef<HTMLDivElement>(null)

  return (
    <PaneDiffEditor
      destino={destino}
      visible={visible}
      colapsarSinCambios={colapsarSinCambios}
      onColapsarSinCambios={onColapsarSinCambios}
      contenidoEnMemoria={c.enMemoria}
      aviso={c.aviso}
      identidad={<IdentidadComprimido destino={destino} c={c} />}
      sobreElHost={<ListaEntradas c={c} zonaRef={zonaRef} altoFila={altoFila} variablesDensidad={variablesDensidad} />}
    />
  )
}

/** Piso de abajo de la cabecera del diff: revisiones y miga de pan del contenedor. */
function IdentidadComprimido({ destino, c }: { destino: DestinoDiff; c: EstadoComprimido }): React.JSX.Element {
  const { dentro, setDentro, seleccionada, procedencia } = c
  return (
    <div className="diff-identidad">
      <span className="diff-revisiones">
        {etiquetaRevisiones(destino.commitHash)}
      </span>
      <span className="diff-ruta comprimido-miga">
        {migas(destino.ruta, dentro).map((m, i) => (
          <span key={m.ruta}>
            {i > 0 && <span className="comprimido-miga-sep">›</span>}
            {m.nivel === null ? (
              <span>{m.nombre}</span>
            ) : (
              <button
                type="button"
                className="comprimido-miga-btn"
                onClick={() => setDentro((prev) => prev.slice(0, m.nivel as number))}
                title={txComprimido().volverA(m.nombre)}
              >
                {m.nombre}
              </button>
            )}
          </span>
        ))}
        {seleccionada !== null && (
          <>
            <span className="comprimido-miga-sep">›</span>
            <span>{seleccionada}</span>
          </>
        )}
      </span>
      {procedencia !== null && procedencia.motor !== null && <ChipProcedencia p={procedencia} />}
    </div>
  )
}

function ChipProcedencia({ p }: { p: ProcedenciaJava }): React.JSX.Element {
  const t = txComprimido()
  const titulo =
    t.descompiladoCon(p.motor, p.motorVersion, p.versionMayorJava) +
    (p.bytecode ? t.bytecode(p.bytecode.major, p.bytecode.minor, p.bytecode.plataforma) : '') +
    (p.sinNombresLocales ? t.sinNombresLocales : '')
  return (
    <span className="comprimido-procedencia" title={titulo}>
      {p.motor} · {p.ms} ms
    </span>
  )
}

interface PropsListaEntradas {
  c: EstadoComprimido
  zonaRef: RefObject<HTMLDivElement>
  altoFila: number
  variablesDensidad: CSSProperties
}

/** Lista de entradas cambiadas y el divisor con el diff de abajo. */
function ListaEntradas({ c, zonaRef, altoFila, variablesDensidad }: PropsListaEntradas): React.JSX.Element {
  const { comparacion, cargando, altoLista, seleccionada } = c
  const t = txComprimido()
  return (
    <>
      <div
        className="comprimido-lista git-ui"
        ref={zonaRef}
        style={{ ...variablesDensidad, flex: `0 0 ${altoLista}px` }}
      >
        <ListaVirtual<FilaArbol>
          className="comprimido-lista-scroll"
          etiquetaAria={t.entradasQueCambiaron}
          elementos={c.filas}
          altoElemento={altoFila}
          obtenerClave={(fila) => `${fila.nodo.tipo === 'carpeta' ? 'd' : 'f'}:${fila.nodo.ruta}`}
          cabecera={
            <>
              {cargando && <div className="git-state-inline">{t.comparando}</div>}
              {comparacion !== null && comparacion.error !== '' && (
                <div className="git-error">{comparacion.error}</div>
              )}
              {comparacion?.avisos.map((a) => (
                <div key={a} className="git-state-inline">
                  {a}
                </div>
              ))}
            </>
          }
          pie={comparacion === null || cargando ? null : <PieLista c={c} />}
          pintarElemento={(fila) => (
            <FilaEntrada
              fila={fila}
              entrada={c.porNombre.get(fila.nodo.ruta)}
              seleccionada={fila.nodo.ruta === seleccionada}
              onElegir={c.elegir}
              onAlternarCarpeta={c.alternarCarpeta}
            />
          )}
        />
      </div>
      {/* Arrastrar hacia abajo agranda la lista. El techo se mide en el propio arrastre: el alto
          del pane cambia sin volver a renderizar (franja de git, divisor del agente). */}
      <Divisor
        orientacion="horizontal"
        tamano={altoLista}
        min={MIN_LISTA}
        max={maxLista(zonaRef.current)}
        direccion={1}
        onRedimensionar={(px) => {
          c.repartidoAManoRef.current = true
          c.setAltoLista(Math.min(px, maxLista(zonaRef.current)))
        }}
        etiqueta={t.repartoEntradasDiff}
      />
    </>
  )
}

function PieLista({ c }: { c: EstadoComprimido }): React.JSX.Element | null {
  const { comparacion } = c
  if (comparacion === null) return null
  const n = comparacion.entradas.length
  const t = txComprimido()
  return (
    <div className="comprimido-pie">
      {n === 0 ? t.sinDiferencias : t.entradasCambiadas(n)}
      {comparacion.iguales > 0 && t.identicas(comparacion.iguales)}
      {comparacion.truncado && t.listaRecortada}
    </div>
  )
}

/** Fila del árbol de entradas; reusa la del árbol de archivos de un commit sin tocarla. */
function FilaEntrada({
  fila,
  entrada,
  seleccionada,
  onElegir,
  onAlternarCarpeta
}: {
  fila: FilaArbol
  entrada: EntradaComparada | undefined
  seleccionada: boolean
  onElegir: (nombre: string) => void
  onAlternarCarpeta: (ruta: string) => void
}): React.JSX.Element {
  if (fila.nodo.tipo === 'carpeta') {
    return (
      <FilaArbolArchivo
        fila={fila}
        seleccionada={seleccionada}
        onAlternarCarpeta={() => onAlternarCarpeta(fila.nodo.ruta)}
      />
    )
  }
  const ruta = fila.nodo.ruta
  return (
    <FilaArbolArchivo
      fila={fila}
      seleccionada={seleccionada}
      onSeleccionar={() => onElegir(ruta)}
      onAbrir={() => onElegir(ruta)}
      // Sin `onPrecargar` a propósito: precalentar aquí sería arrancar una JVM al pasar el ratón.
      titulo={entrada === undefined ? undefined : tituloEntrada(entrada)}
    />
  )
}
