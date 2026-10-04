// =============================================================================
// ComprimidoDiffPane: diff de un .jar/.war/.ear/.zip. Arriba, las entradas que cambiaron
// entre las dos revisiones; abajo, el diff de la elegida, con el `DiffEditorPane` de siempre.
// Elegir un contenedor anidado entra en él (miga de pan para volver). El estado vive en
// `useComprimidoDiff`; la lógica pura, en `comprimidoDiffModelo`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { DiffEditorPane } from './DiffEditorPane'
import type { DiffTarget } from './diffEditorTipos'
import { Splitter } from '../../comun/Splitter'
import { VirtualList } from '../../comun/VirtualList'
import { FilaArbolArchivo, etiquetaRevisiones, type FilaArbol } from '../git'
import { MIN_LISTA, maxLista, migas, tituloEntrada } from './comprimidoDiffModelo'
import { useComprimidoDiff } from './useComprimidoDiff'
import type { EntradaComparada, ProcedenciaJava } from '../../../../shared/comprimidos-ipc'

export interface ComprimidoDiffPaneProps {
  target: DiffTarget
  visible: boolean
  /** Identidad del pane para el main: con ella descarta lo que ya no interesa. */
  paneKey: string
  /**
   * Ámbito (perfil + proyecto) de ESTE pane y el activo ahora mismo. Los lados 'worktree' e
   * 'index' se piden por ruta relativa y el main la resuelve contra el proyecto activo: solo
   * el pane del activo compara, o compararía el .jar del proyecto equivocado.
   */
  targetKey: string
  /** Ver `targetKey`. */
  activeTargetKey: string
  altoFila: number
  varsDensidad: CSSProperties
  colapsarSinCambios?: boolean
  onColapsarSinCambios?: (valor: boolean) => void
  /** Tick del watcher; solo se atiende si algún lado puede cambiar (disco o índice). */
  fsTick?: number
}

type EstadoComprimido = ReturnType<typeof useComprimidoDiff>

export function ComprimidoDiffPane({
  target,
  visible,
  paneKey,
  targetKey,
  activeTargetKey,
  altoFila,
  varsDensidad,
  colapsarSinCambios,
  onColapsarSinCambios,
  fsTick = 0
}: ComprimidoDiffPaneProps): React.JSX.Element {
  const c = useComprimidoDiff({ target, visible, paneKey, targetKey, activeTargetKey, altoFila, fsTick })
  const zonaRef = useRef<HTMLDivElement>(null)

  return (
    <DiffEditorPane
      target={target}
      visible={visible}
      colapsarSinCambios={colapsarSinCambios}
      onColapsarSinCambios={onColapsarSinCambios}
      contenidoEnMemoria={c.enMemoria}
      aviso={c.aviso}
      identidad={<IdentidadComprimido target={target} c={c} />}
      sobreElHost={<ListaEntradas c={c} zonaRef={zonaRef} altoFila={altoFila} varsDensidad={varsDensidad} />}
    />
  )
}

/** Piso de abajo de la cabecera del diff: revisiones y miga de pan del contenedor. */
function IdentidadComprimido({ target, c }: { target: DiffTarget; c: EstadoComprimido }): React.JSX.Element {
  const { dentro, setDentro, seleccionada, procedencia } = c
  return (
    <div className="diff-identidad">
      <span className="diff-revisiones" title="Revisiones que se comparan">
        {etiquetaRevisiones(target.commitHash)}
      </span>
      <span className="diff-ruta comprimido-miga">
        {migas(target.path, dentro).map((m, i) => (
          <span key={m.ruta}>
            {i > 0 && <span className="comprimido-miga-sep">›</span>}
            {m.nivel === null ? (
              <span>{m.nombre}</span>
            ) : (
              <button
                type="button"
                className="comprimido-miga-btn"
                onClick={() => setDentro((prev) => prev.slice(0, m.nivel as number))}
                title={`Volver a ${m.nombre}`}
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
  const titulo =
    `Descompilado con ${p.motor} ${p.motorVersion} sobre JVM ${p.javaMajor}` +
    (p.bytecode ? ` · bytecode ${p.bytecode.major}.${p.bytecode.minor} (${p.bytecode.plataforma})` : '') +
    (p.sinNombresLocales ? ' · sin nombres de variables (la clase no trae LocalVariableTable)' : '')
  return (
    <span className="comprimido-procedencia" title={titulo}>
      {p.motor} · {p.ms} ms
    </span>
  )
}

interface ListaEntradasProps {
  c: EstadoComprimido
  zonaRef: RefObject<HTMLDivElement>
  altoFila: number
  varsDensidad: CSSProperties
}

/** Lista de entradas cambiadas y el divisor con el diff de abajo. */
function ListaEntradas({ c, zonaRef, altoFila, varsDensidad }: ListaEntradasProps): React.JSX.Element {
  const { comparacion, cargando, altoLista, seleccionada } = c
  return (
    <>
      <div
        className="comprimido-lista git-ui"
        ref={zonaRef}
        style={{ ...varsDensidad, flex: `0 0 ${altoLista}px` }}
      >
        <VirtualList<FilaArbol>
          className="comprimido-lista-scroll"
          ariaLabel="Entradas que cambiaron"
          items={c.filas}
          itemHeight={altoFila}
          getKey={(fila) => `${fila.nodo.tipo === 'carpeta' ? 'd' : 'f'}:${fila.nodo.ruta}`}
          header={
            <>
              {cargando && <div className="git-state-inline">Comparando…</div>}
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
          footer={comparacion === null || cargando ? null : <PieLista c={c} />}
          renderItem={(fila) => (
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
      <Splitter
        orientation="horizontal"
        size={altoLista}
        min={MIN_LISTA}
        max={maxLista(zonaRef.current)}
        direction={1}
        onResize={(px) => {
          c.repartidoAManoRef.current = true
          c.setAltoLista(Math.min(px, maxLista(zonaRef.current)))
        }}
        label="Reparto entre las entradas y el diff"
      />
    </>
  )
}

function PieLista({ c }: { c: EstadoComprimido }): React.JSX.Element | null {
  const { comparacion } = c
  if (comparacion === null) return null
  const n = comparacion.entradas.length
  return (
    <div className="comprimido-pie">
      {n === 0
        ? 'Sin diferencias dentro del archivo'
        : `${n} ${n === 1 ? 'entrada cambiada' : 'entradas cambiadas'}`}
      {comparacion.iguales > 0 && ` · ${comparacion.iguales} idénticas`}
      {comparacion.truncado && ' · lista recortada'}
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
      // Sin `onPrefetch` a propósito: precalentar aquí sería arrancar una JVM al pasar el ratón.
      titulo={entrada === undefined ? undefined : tituloEntrada(entrada)}
    />
  )
}
