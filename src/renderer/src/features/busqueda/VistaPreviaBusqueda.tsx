// =============================================================================
// La mitad de abajo del modal de búsqueda: el archivo de la fila seleccionada en un Monaco de
// solo lectura, centrado en la coincidencia y con todas las del archivo resaltadas.
// Los efectos del editor viven en `usePreviaBusqueda`. El host de Monaco no se oculta nunca:
// lo tapa una capa, y la cabecera se oculta con `hidden` en vez de desmontarse.
// Decisiones: docs/decisiones/busqueda/vista-previa-monaco.md
// =============================================================================
import { useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { useVisibleLayout } from '../../comun/useVisibleLayout'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { carpetaDe } from './filasResultado'
import {
  mensajeCargando,
  useCargaFila,
  useEditorPrevia,
  useModeloPrevia,
  useResaltePrevia,
  type Cargado
} from './usePreviaBusqueda'
import type { CoincidenciaArchivo } from '../../../../shared/search-ipc'
import type { OpcionesBusqueda } from '../../../../shared/textSearch'

/** Llaves de código: «aquí se verá el archivo». Solo tiene sentido junto a una lista de resultados. */
function IconoCodigoVacio(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 5.5C6.5 5.5 7.5 11 4.5 12c3 1 2 6.5 4.5 6.5" />
      <path d="M15 5.5c2.5 0 1.5 5.5 4.5 6.5-3 1-2 6.5-4.5 6.5" />
    </svg>
  )
}

interface VistaPreviaBusquedaProps {
  /** Fila seleccionada, o null (sin selección: el visor queda vacío). */
  fila: CoincidenciaArchivo | null
  /** La consulta y sus opciones, para resaltar TODAS las del archivo. */
  query: string
  opts: OpcionesBusqueda
  /** Proyecto para el que vale esta previa: si cambia mientras una lectura viaja, se tira. */
  projectKey: string
}

/** Vista previa del archivo de la fila seleccionada, con sus coincidencias resaltadas. */
export function VistaPreviaBusqueda({
  fila,
  query,
  opts,
  projectKey
}: VistaPreviaBusquedaProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<editor.ITextModel | null>(null)
  const decoracionesRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const [cargado, setCargado] = useState<Cargado | null>(null)
  const [error, setError] = useState<string | null>(null)

  // `cargado` conserva el archivo anterior mientras el nuevo viaja: sin contrastarlo con la
  // fila, la previa enseñaba su contenido bajo la cabecera del nuevo.
  const alDia = cargado !== null && cargado.path === fila?.path && cargado.projectKey === projectKey
  const hayCodigo = alDia && cargado.aviso === null
  useVisibleLayout(hostRef, editorRef, hayCodigo)

  const refs = { hostRef, editorRef, modelRef, decoracionesRef }
  useEditorPrevia(refs)
  useCargaFila({ fila, projectKey, cargado, setCargado, setError })
  useModeloPrevia(refs, cargado)
  useResaltePrevia(refs, { fila, cargado, hayCodigo, query, opts })

  const carpeta = fila !== null ? carpetaDe(fila.path) : ''

  return (
    <div className="buscar-previa">
      {/* Siempre renderizada y oculta con `hidden`: meterla en un `&&` cambiaba el índice del
          host y React lo remontaba, llevándose el DOM de Monaco. */}
      <div className="buscar-previa-cab" hidden={fila === null}>
        {fila !== null && (
          <>
            <span className="buscar-previa-nombre">{fila.nombre}</span>
            {carpeta !== '' && <span className="buscar-previa-ruta">{carpeta}</span>}
          </>
        )}
      </div>
      {/* El host nunca se oculta: con `display:none` Monaco nace midiendo 0×0 y no pinta. */}
      <div className="buscar-previa-cuerpo">
        <div className="buscar-previa-editor" ref={hostRef} />
        {!hayCodigo && (
          <div className="buscar-previa-tapa">
            <TapaPrevia fila={fila} aviso={error ?? (alDia ? cargado.aviso : null)} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Lo que tapa el editor sin código: el vacío, o una línea de aviso o de carga. */
function TapaPrevia({
  fila,
  aviso
}: {
  fila: CoincidenciaArchivo | null
  aviso: string | null
}): React.JSX.Element {
  if (fila === null) {
    return (
      <EstadoVacio
        icono={<IconoCodigoVacio />}
        titulo="Elige un resultado"
        pista="El archivo se abre aquí, centrado en la coincidencia."
        className="buscar-vacio"
      />
    )
  }
  // Con fila elegida es transitorio (cargando) o un aviso concreto: línea, no vacío centrado.
  return <div className="buscar-previa-aviso">{aviso ?? mensajeCargando(fila)}</div>
}
