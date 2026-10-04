// =============================================================================
// Los efectos de la vista previa de la búsqueda, como hooks de `VistaPreviaBusqueda`: crear
// el editor una vez, cargar el archivo de la fila, instalar su modelo y resaltar coincidencias.
// Se llaman en este orden, y importa: el modelo necesita el editor, y el resalte, el modelo.
// Decisiones: docs/decisiones/busqueda/vista-previa-monaco.md
// =============================================================================
import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { editor } from 'monaco-editor'
import { MONACO_THEME, OPCIONES_BASE_MONACO, ensureMonaco } from '../../comun/monacoSetup'
import { languageForFilename } from '../../../../shared/files-ipc'
import type { CoincidenciaArchivo } from '../../../../shared/search-ipc'
import {
  MAX_COINCIDENCIAS,
  coincidenciasCon,
  compilarBusqueda,
  type OpcionesBusqueda
} from '../../../../shared/textSearch'

/** Fondo de las coincidencias en la previa. Reusa los tokens del buscador de documento. */
const CLASE_RESALTE = 'busqueda-previa-match'
const CLASE_RESALTE_ACTIVO = 'busqueda-previa-match-activo'

/** Lo que se está enseñando, para no re-pedir lo mismo al mover entre filas del mismo archivo. */
export interface Cargado {
  path: string
  projectKey: string
  contenido: string
  language: string
  /** Aviso cuando no hay código que enseñar (binario, sin JVM, motor que falló…). */
  aviso: string | null
}

/** Las refs de Monaco que comparten los hooks de la previa; las posee el componente. */
export interface RefsPrevia {
  hostRef: RefObject<HTMLDivElement | null>
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>
  modelRef: MutableRefObject<editor.ITextModel | null>
  decoracionesRef: MutableRefObject<editor.IEditorDecorationsCollection | null>
}

/**
 * ¿Esta fila es una CLASE COMPILADA? Lo decide la extensión y no el origen: una fila que
 * casó por el nombre de un .class sigue siendo una clase que hay que descompilar. De esta
 * función dependen a la vez el visor y el mensaje de espera, y tienen que ir juntos.
 */
function esClaseCompilada(fila: CoincidenciaArchivo): boolean {
  return fila.origen === 'clase' || fila.path.toLowerCase().endsWith('.class')
}

/** Qué se dice mientras carga: una clase es una JVM arrancando (300-700 ms), no un «cargando». */
export function mensajeCargando(fila: CoincidenciaArchivo): string {
  return esClaseCompilada(fila) ? 'Descompilando la clase…' : 'Cargando…'
}

/** Crea el editor de solo lectura una sola vez y lo libera al desmontar. */
export function useEditorPrevia({
  hostRef,
  editorRef,
  modelRef,
  decoracionesRef
}: RefsPrevia): void {
  useEffect(() => {
    const host = hostRef.current
    if (!host || editorRef.current) return
    const monaco = ensureMonaco()
    const ed = monaco.editor.create(host, {
      ...OPCIONES_BASE_MONACO,
      value: '',
      language: 'plaintext',
      theme: MONACO_THEME,
      readOnly: true,
      // Sin minimapa: la previa es una franja baja y el minimapa se comería ancho de lectura.
      minimap: { enabled: false },
      renderWhitespace: 'none',
      // Se lee, no se edita: sin cursor parpadeante ni línea resaltada que compita con la coincidencia.
      renderLineHighlight: 'none',
      cursorBlinking: 'solid',
      scrollbar: { alwaysConsumeMouseWheel: false }
    })
    editorRef.current = ed
    decoracionesRef.current = ed.createDecorationsCollection([])

    // `automaticLayout` viene a false y el host nace oculto: se mide con dimensiones
    // explícitas, porque el `layout()` sin argumentos puede reusar una medición en cero.
    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        ed.layout({ width: host.clientWidth, height: host.clientHeight })
      }
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      ed.dispose()
      editorRef.current = null
      decoracionesRef.current = null
      modelRef.current?.dispose()
      modelRef.current = null
    }
  }, [hostRef, editorRef, modelRef, decoracionesRef])
}

/** Lee la fila (descompilando si es una clase) y entrega lo cargado a `aplicar`. */
function leerFila(
  fila: CoincidenciaArchivo,
  pedidoPara: string,
  aplicar: (c: Cargado) => void
): Promise<void> {
  if (esClaseCompilada(fila)) {
    return window.tessera.java
      .decompile({ path: fila.path, motor: 'auto', targetKey: pedidoPara, token: 0 })
      .then((r) => {
        const ok = r.estado === 'ok' || r.estado === 'cache'
        aplicar({
          path: fila.path,
          projectKey: pedidoPara,
          contenido: ok ? r.fuente : '',
          language: 'java',
          aviso: ok ? null : r.mensaje
        })
      })
  }
  return window.tessera.files.read(fila.path).then((r) => {
    aplicar({
      path: fila.path,
      projectKey: pedidoPara,
      contenido: r.content,
      language: r.language,
      aviso: r.binary ? 'Archivo binario: no se muestra.' : null
    })
  })
}

interface CargaArgs {
  fila: CoincidenciaArchivo | null
  projectKey: string
  cargado: Cargado | null
  setCargado: Dispatch<SetStateAction<Cargado | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

/** Carga el contenido de la fila; moverse entre coincidencias del mismo archivo no relee. */
export function useCargaFila({
  fila,
  projectKey,
  cargado,
  setCargado,
  setError
}: CargaArgs): void {
  useEffect(() => {
    if (fila === null) {
      setCargado(null)
      setError(null)
      return
    }
    if (cargado !== null && cargado.path === fila.path && cargado.projectKey === projectKey) return

    let cancelado = false
    const pedidoPara = projectKey
    setError(null)
    // Si el proyecto cambió mientras viajaba, la respuesta viene resuelta contra otra raíz.
    const aplicar = (c: Cargado): void => {
      if (cancelado || pedidoPara !== projectKey) return
      setCargado(c)
    }
    leerFila(fila, pedidoPara, aplicar).catch((err) => {
      if (!cancelado) setError(err instanceof Error ? err.message : String(err))
    })

    return () => {
      cancelado = true
    }
  }, [fila, projectKey, cargado, setCargado, setError])
}

/** Instala el modelo del archivo cargado (reemplazándolo, no mutándolo) o lo quita si hay aviso. */
export function useModeloPrevia(
  { editorRef, modelRef }: Pick<RefsPrevia, 'editorRef' | 'modelRef'>,
  cargado: Cargado | null
): void {
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    if (cargado === null || cargado.aviso !== null) {
      ed.setModel(null)
      modelRef.current?.dispose()
      modelRef.current = null
      return
    }
    const monaco = ensureMonaco()
    const anterior = modelRef.current
    const modelo = monaco.editor.createModel(
      cargado.contenido,
      cargado.language === 'plaintext' ? languageForFilename(cargado.path) : cargado.language
    )
    modelRef.current = modelo
    ed.setModel(modelo)
    anterior?.dispose()
  }, [cargado, editorRef, modelRef])
}

type Monaco = ReturnType<typeof ensureMonaco>

/**
 * Las decoraciones de cada coincidencia del texto que SE ENSEÑA (no de la línea de la fila:
 * en un .class la fila no tiene línea y en un archivo el disco pudo cambiar) y el destino al
 * que centrar. La expresión llega ya compilada: compilarla por línea era una por pulsación.
 */
function resaltesDe(
  monaco: Monaco,
  modelo: editor.ITextModel,
  re: RegExp,
  fila: CoincidenciaArchivo
): { rangos: editor.IModelDeltaDecoration[]; objetivo: { linea: number; columna: number } | null } {
  const rangos: editor.IModelDeltaDecoration[] = []
  let objetivo: { linea: number; columna: number } | null = null
  const totalLineas = modelo.getLineCount()
  // El tope es el del motor pero aplicado al archivo entero: una letra sobre un archivo grande
  // pediría cientos de miles de decoraciones.
  for (let n = 1; n <= totalLineas && rangos.length < MAX_COINCIDENCIAS; n++) {
    for (const c of coincidenciasCon(modelo.getLineContent(n), re)) {
      // Sin línea propia (una clase, o un archivo que casó por su nombre) se toma la primera
      // coincidencia del contenido, que es lo único que se puede prometer.
      const esLaDeLaFila = objetivo === null && (fila.linea === 0 || n === fila.linea)
      if (esLaDeLaFila) objetivo = { linea: n, columna: c.inicio + 1 }
      rangos.push({
        range: new monaco.Range(n, c.inicio + 1, n, c.fin + 1),
        options: {
          className: esLaDeLaFila ? CLASE_RESALTE_ACTIVO : CLASE_RESALTE,
          // La marca del overview ruler convierte la barra de scroll en un mapa de coincidencias.
          overviewRuler: {
            color: 'rgba(209, 154, 102, 0.8)',
            position: monaco.editor.OverviewRulerLane.Center
          }
        }
      })
    }
  }
  return { rangos, objetivo }
}

interface ResalteArgs {
  fila: CoincidenciaArchivo | null
  cargado: Cargado | null
  hayCodigo: boolean
  query: string
  opts: OpcionesBusqueda
}

/** Resalta las coincidencias y centra la de la fila; va aparte porque la fila cambia sin recargar. */
export function useResaltePrevia(
  { editorRef, modelRef, decoracionesRef }: Omit<RefsPrevia, 'hostRef'>,
  { fila, cargado, hayCodigo, query, opts }: ResalteArgs
): void {
  useEffect(() => {
    const ed = editorRef.current
    const modelo = modelRef.current
    const col = decoracionesRef.current
    // `!hayCodigo` cubre «lo cargado es de la fila anterior»: no se resalta lo que no se enseña.
    if (!ed || !modelo || !col || fila === null || !hayCodigo) {
      col?.set([])
      return
    }
    const monaco = ensureMonaco()
    const re = compilarBusqueda(query, opts)
    if (re === null) {
      col.set([])
      return
    }
    const { rangos, objetivo } = resaltesDe(monaco, modelo, re, fila)
    col.set(rangos)

    const destino = objetivo ?? (fila.linea > 0 ? { linea: fila.linea, columna: 1 } : null)
    if (destino !== null) {
      ed.revealLineInCenter(Math.min(destino.linea, modelo.getLineCount()))
      ed.setPosition({ lineNumber: destino.linea, column: destino.columna })
    }
  }, [fila, cargado, hayCodigo, query, opts, editorRef, modelRef, decoracionesRef])
}
