// =============================================================================
// Los efectos de la vista previa de la búsqueda, como hooks de `VistaPreviaBusqueda`: crear
// el editor una vez, cargar el archivo de la fila, instalar su modelo y resaltar coincidencias.
// Se llaman en este orden, y importa: el modelo necesita el editor, y el resalte, el modelo.
// Decisiones: docs/decisiones/busqueda/vista-previa-monaco.md
// =============================================================================
import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { editor } from 'monaco-editor'
import { BARRAS_MONACO, TEMA_MONACO, OPCIONES_BASE_MONACO, asegurarMonaco } from '../../comun/monacoSetup'
import { conLetraEditor, opcionesLetraEditor } from '../../comun/letraEditor'
import { lenguajeDeNombreArchivo } from '../../../../shared/archivos-ipc'
import { extensionDeOficina } from '../../../../shared/documentosOficina'
import type { CoincidenciaArchivo } from '../../../../shared/busqueda-ipc'
import { txBusqueda } from './textos.ts'
import { raizDeDestino } from '../editor'
import {
  MAX_COINCIDENCIAS,
  coincidenciasCon,
  compilarBusqueda,
  type OpcionesBusqueda
} from '../../../../shared/busquedaTexto'

/** Fondo de las coincidencias en la previa. Reusa los tokens del buscador de documento. */
const CLASE_RESALTE = 'busqueda-previa-match'
const CLASE_RESALTE_ACTIVO = 'busqueda-previa-match-activo'

/** Lo que se está enseñando, para no re-pedir lo mismo al mover entre filas del mismo archivo. */
export interface Cargado {
  ruta: string
  claveProyecto: string
  contenido: string
  lenguaje: string
  /** Aviso cuando no hay código que enseñar (binario, sin JVM, motor que falló…). */
  aviso: string | null
}

/** Las refs de Monaco que comparten los hooks de la previa; las posee el componente. */
export interface RefsPrevia {
  hostRef: RefObject<HTMLDivElement | null>
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>
  modeloRef: MutableRefObject<editor.ITextModel | null>
  decoracionesRef: MutableRefObject<editor.IEditorDecorationsCollection | null>
}

/**
 * ¿Esta fila es una CLASE COMPILADA? Lo decide la extensión y no el origen: una fila que
 * casó por el nombre de un .class sigue siendo una clase que hay que descompilar. De esta
 * función dependen a la vez el visor y el mensaje de espera, y tienen que ir juntos.
 */
function esClaseCompilada(fila: CoincidenciaArchivo): boolean {
  return fila.origen === 'clase' || fila.ruta.toLowerCase().endsWith('.class')
}

/** Qué se dice mientras carga: una clase es una JVM arrancando (300-700 ms), no un «cargando». */
export function mensajeCargando(fila: CoincidenciaArchivo): string {
  const t = txBusqueda()
  return esClaseCompilada(fila) ? t.descompilando : t.cargando
}

/** Crea el editor de solo lectura una sola vez y lo libera al desmontar. */
export function useEditorPrevia({
  hostRef,
  editorRef,
  modeloRef,
  decoracionesRef
}: RefsPrevia): void {
  useEffect(() => {
    const host = hostRef.current
    if (!host || editorRef.current) return
    const monaco = asegurarMonaco()
    const editorPrevia = conLetraEditor(monaco.editor.create(host, {
      ...OPCIONES_BASE_MONACO,
      ...opcionesLetraEditor(),
      value: '',
      language: 'plaintext',
      theme: TEMA_MONACO,
      readOnly: true,
      // Sin minimapa: la previa es una franja baja y el minimapa se comería ancho de lectura.
      minimap: { enabled: false },
      renderWhitespace: 'none',
      // Se lee, no se edita: sin cursor parpadeante ni línea resaltada que compita con la coincidencia.
      renderLineHighlight: 'none',
      cursorBlinking: 'solid',
      scrollbar: { ...BARRAS_MONACO, alwaysConsumeMouseWheel: false }
    }))
    editorRef.current = editorPrevia
    decoracionesRef.current = editorPrevia.createDecorationsCollection([])

    // `automaticLayout` viene a false y el host nace oculto: se mide con dimensiones
    // explícitas, porque el `layout()` sin argumentos puede reusar una medición en cero.
    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        editorPrevia.layout({ width: host.clientWidth, height: host.clientHeight })
      }
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      editorPrevia.dispose()
      editorRef.current = null
      decoracionesRef.current = null
      modeloRef.current?.dispose()
      modeloRef.current = null
    }
  }, [hostRef, editorRef, modeloRef, decoracionesRef])
}

/** Lee la fila (descompilando si es una clase) y entrega lo cargado a `aplicar`. */
async function leerFila(
  fila: CoincidenciaArchivo,
  pedidoPara: string,
  aplicar: (c: Cargado) => void
): Promise<void> {
  if (extensionDeOficina(fila.ruta) !== null) {
    aplicar({ ruta: fila.ruta, claveProyecto: pedidoPara, contenido: '', lenguaje: 'plaintext', aviso: txBusqueda().archivoBinario })
    return
  }
  if (esClaseCompilada(fila)) {
    return window.tessera.java
      .descompilar({ raiz: raizDeDestino(pedidoPara), ruta: fila.ruta, motor: 'auto', claveDestino: pedidoPara, token: 0 })
      .then((r) => {
        const ok = r.estado === 'ok' || r.estado === 'cache'
        aplicar({
          ruta: fila.ruta,
          claveProyecto: pedidoPara,
          contenido: ok ? r.fuente : '',
          lenguaje: 'java',
          aviso: ok ? null : r.mensaje
        })
      })
  }
  return window.tessera.files.leerArchivo({ raiz: raizDeDestino(pedidoPara), ruta: fila.ruta }).then((r) => {
    aplicar({
      ruta: fila.ruta,
      claveProyecto: pedidoPara,
      contenido: r.contenido,
      lenguaje: r.lenguaje,
      aviso: r.binario ? txBusqueda().archivoBinario : null
    })
  })
}

interface CargaArgs {
  fila: CoincidenciaArchivo | null
  claveProyecto: string
  cargado: Cargado | null
  setCargado: Dispatch<SetStateAction<Cargado | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

/** Carga el contenido de la fila; moverse entre coincidencias del mismo archivo no relee. */
export function useCargaFila({
  fila,
  claveProyecto,
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
    if (cargado !== null && cargado.ruta === fila.ruta && cargado.claveProyecto === claveProyecto) return

    let cancelado = false
    const pedidoPara = claveProyecto
    setError(null)
    // Si el proyecto cambió mientras viajaba, la respuesta viene resuelta contra otra raíz.
    const aplicar = (c: Cargado): void => {
      if (cancelado || pedidoPara !== claveProyecto) return
      setCargado(c)
    }
    leerFila(fila, pedidoPara, aplicar).catch((err) => {
      if (!cancelado) setError(err instanceof Error ? err.message : String(err))
    })

    return () => {
      cancelado = true
    }
  }, [fila, claveProyecto, cargado, setCargado, setError])
}

/** Instala el modelo del archivo cargado (reemplazándolo, no mutándolo) o lo quita si hay aviso. */
export function useModeloPrevia(
  { editorRef, modeloRef }: Pick<RefsPrevia, 'editorRef' | 'modeloRef'>,
  cargado: Cargado | null
): void {
  useEffect(() => {
    const editorPrevia = editorRef.current
    if (!editorPrevia) return
    if (cargado === null || cargado.aviso !== null) {
      editorPrevia.setModel(null)
      modeloRef.current?.dispose()
      modeloRef.current = null
      return
    }
    const monaco = asegurarMonaco()
    const anterior = modeloRef.current
    const modelo = monaco.editor.createModel(
      cargado.contenido,
      cargado.lenguaje === 'plaintext' ? lenguajeDeNombreArchivo(cargado.ruta) : cargado.lenguaje
    )
    modeloRef.current = modelo
    editorPrevia.setModel(modelo)
    anterior?.dispose()
  }, [cargado, editorRef, modeloRef])
}

type Monaco = ReturnType<typeof asegurarMonaco>

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
  consulta: string
  opts: OpcionesBusqueda
}

/** Resalta las coincidencias y centra la de la fila; va aparte porque la fila cambia sin recargar. */
export function useResaltePrevia(
  { editorRef, modeloRef, decoracionesRef }: Omit<RefsPrevia, 'hostRef'>,
  { fila, cargado, hayCodigo, consulta, opts }: ResalteArgs
): void {
  useEffect(() => {
    const editorPrevia = editorRef.current
    const modelo = modeloRef.current
    const col = decoracionesRef.current
    // `!hayCodigo` cubre «lo cargado es de la fila anterior»: no se resalta lo que no se enseña.
    if (!editorPrevia || !modelo || !col || fila === null || !hayCodigo) {
      col?.set([])
      return
    }
    const monaco = asegurarMonaco()
    const re = compilarBusqueda(consulta, opts)
    if (re === null) {
      col.set([])
      return
    }
    const { rangos, objetivo } = resaltesDe(monaco, modelo, re, fila)
    col.set(rangos)

    const destino = objetivo ?? (fila.linea > 0 ? { linea: fila.linea, columna: 1 } : null)
    if (destino !== null) {
      editorPrevia.revealLineInCenter(Math.min(destino.linea, modelo.getLineCount()))
      editorPrevia.setPosition({ lineNumber: destino.linea, column: destino.columna })
    }
  }, [fila, cargado, hayCodigo, consulta, opts, editorRef, modeloRef, decoracionesRef])
}
