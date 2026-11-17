// =============================================================================
// Piezas de PaneClaseJava sin estado de React: pedido al descompilador, editor de solo
// lectura y modelo local de la fuente. El pane crea su propio modelo (no usa el registro).
// Lo usa `useClaseJava`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import type { editor } from 'monaco-editor'
import type { MutableRefObject } from 'react'
import { asegurarMonaco, TEMA_MONACO, OPCIONES_BASE_MONACO } from '../../comun/monacoSetup'
import { conLetraEditor, opcionesLetraEditor } from '../../comun/letraEditor'
import type { ResultadoDescompilar, MotorDescompilador, MotorPedido } from '../../../../shared/java-ipc'

/** Etiqueta corta de cada motor para la barra. */
export const NOMBRE_MOTOR: Record<string, string> = { cfr: 'CFR', vineflower: 'Vineflower' }

/** ¿El resultado trae fuente que enseñar? */
export function hayFuente(r: ResultadoDescompilar | null): boolean {
  return r !== null && (r.estado === 'ok' || r.estado === 'cache')
}

/**
 * El motor que ofrece el reintento. Sale de lo PEDIDO, no de `r.motor`: si el intento falló
 * `r.motor` es null y se propondría otra vez el que acaba de fallar, dejando el botón inerte.
 */
export function motorAlternativo(
  r: ResultadoDescompilar | null,
  motorPedido: MotorPedido
): MotorDescompilador {
  const usado: MotorDescompilador = r?.motor ?? (motorPedido === 'cfr' ? 'cfr' : 'vineflower')
  return usado === 'vineflower' ? 'cfr' : 'vineflower'
}

/** Resultado sintético para cuando el invoke rechaza (sin proyecto activo, ruta rechazada…). */
function resultadoRechazado(
  ruta: string,
  claveDestino: string,
  token: number,
  err: unknown
): ResultadoDescompilar {
  return {
    ruta,
    claveDestino,
    token,
    estado: 'motor-fallo',
    fuente: '',
    truncado: false,
    motor: null,
    motorVersion: '',
    versionMayorJava: 0,
    bytecode: null,
    sinNombresLocales: false,
    ms: 0,
    mensaje: err instanceof Error ? err.message : String(err),
    diagnostico: ''
  }
}

/**
 * Pide la descompilación. El contrato no rechaza por un fallo del motor, pero el invoke sí
 * puede; sin convertirlo en resultado el pane se quedaría en «Descompilando…» para siempre.
 */
export async function pedirDescompilacion(
  pedido: { raiz: string; ruta: string; motor: MotorPedido; claveDestino: string; token: number; ignorarCache: boolean }
): Promise<{ r: ResultadoDescompilar; rechazada: boolean }> {
  try {
    return { r: await window.tessera.java.descompilar(pedido), rechazada: false }
  } catch (err) {
    const { ruta, claveDestino, token } = pedido
    return { r: resultadoRechazado(ruta, claveDestino, token, err), rechazada: true }
  }
}

/**
 * Crea el editor de solo lectura sobre `host`. Devuelve su limpieza, o undefined si ya
 * hay editor. Nace `readOnly` (no después): si una recarga fallara a mitad, nunca queda
 * editable sobre un contenido que no se puede guardar.
 */
export function crearEditorJava(
  host: HTMLDivElement | null,
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  modeloRef: MutableRefObject<editor.ITextModel | null>
): (() => void) | undefined {
  if (!host || editorRef.current) return
  const monaco = asegurarMonaco()
  const editorMonaco = conLetraEditor(monaco.editor.create(host, {
    ...OPCIONES_BASE_MONACO,
    ...opcionesLetraEditor(),
    value: '',
    language: 'java',
    theme: TEMA_MONACO,
    readOnly: true,
    // Al revés que PaneEditor: el texto es de solo lectura y largo, así que se navega mirando.
    minimap: { enabled: true },
    // El espaciado lo genera el descompilador: no hay nada que vigilar ahí.
    renderWhitespace: 'none'
  }))
  editorRef.current = editorMonaco

  // Reflow ante cualquier cambio de tamaño del host, incluido el paso de display:none a tener
  // caja cuando llega la fuente: un layout() justo tras setModel mediría 0 otra vez.
  const ro = new ResizeObserver(() => editorMonaco.layout())
  ro.observe(host)

  return () => {
    ro.disconnect()
    editorMonaco.dispose()
    editorRef.current = null
    modeloRef.current?.dispose()
    modeloRef.current = null
  }
}

/**
 * Enseña `fuente` en el editor con un modelo nuevo. Si el texto es el que ya se ve (una
 * re-petición del watcher) no toca nada, para no perder scroll, plegado ni selección.
 */
export function mostrarFuente(
  editorMonaco: editor.IStandaloneCodeEditor | null,
  modeloRef: MutableRefObject<editor.ITextModel | null>,
  fuente: string
): void {
  if (!editorMonaco) return
  const anterior = modeloRef.current
  if (anterior !== null && anterior.getValue() === fuente) return
  const modelo = asegurarMonaco().editor.createModel(fuente, 'java')
  modeloRef.current = modelo
  editorMonaco.setModel(modelo)
  editorMonaco.revealLine(1)
  anterior?.dispose()
}
