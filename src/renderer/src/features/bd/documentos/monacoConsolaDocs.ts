// =============================================================================
// monacoConsolaDocs: lo que la consola de documentos necesita de Monaco: su lenguaje
// (`tessera-mongosh`, solo coloreado), sus acciones de teclado y sus marcas en el margen
// (✓, ✗, el anillo que gira) con el subrayado del error. Lo usa `DbConsolaDocsPane`.
// Decisiones: docs/decisiones/bd/ui-documentos-lenguaje-de-consola.md
// =============================================================================

import type { editor, IDisposable, IMarkdownString } from 'monaco-editor'
import { conf as CONF_JS, language as LENGUAJE_JS } from 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js'
import type { Plataforma } from '../../../../../shared/plataforma'
import { ensureMonaco } from '../../../comun/monacoSetup'

/** Id de Monaco del lenguaje de las consolas de MongoDB (solo coloreado, sin servicio de TS). */
export const LENGUAJE_CONSOLA_DOCS = 'tessera-mongosh'

/** Dueño de los marcadores de error del servidor en la consola de MongoDB. */
export const DUENO_ERRORES_DOCS = 'tessera-docs-ejecucion'

/** Esquema propio de URI: el enrutador de autocompletado SQL no la reconoce como suya. */
const ESQUEMA_URI = 'tessera-consola-docs'

/** La URI del modelo de una consola de MongoDB. */
export function uriConsolaDocs(consolaId: string): string {
  return `${ESQUEMA_URI}://consola/${encodeURIComponent(consolaId)}.js`
}

type MonacoMinimo = ReturnType<typeof ensureMonaco>

const registrados = new WeakSet<object>()

/** Registra `tessera-mongosh` (idempotente por instancia de Monaco). */
export function registrarLenguajeConsolaDocs(monaco: MonacoMinimo): void {
  if (registrados.has(monaco)) return
  registrados.add(monaco)
  const l = monaco.languages
  if (!l.getLanguages().some((x) => x.id === LENGUAJE_CONSOLA_DOCS)) {
    l.register({ id: LENGUAJE_CONSOLA_DOCS, aliases: ['Consola de documentos'] })
  }
  l.setLanguageConfiguration(LENGUAJE_CONSOLA_DOCS, CONF_JS)
  // Síncrono (no una factoría perezosa): el primer pintado ya sale coloreado.
  l.setMonarchTokensProvider(LENGUAJE_CONSOLA_DOCS, LENGUAJE_JS)
}

export interface ManejadoresConsolaDocs {
  ejecutar: () => void
  ejecutarTodo: () => void
  detener: () => void
}

/** Los acordes de la consola en el editor (los mismos que la SQL; ver el ADR). */
export function registrarAccionesConsolaDocs(
  ed: editor.IStandaloneCodeEditor,
  plataforma: Plataforma,
  h: ManejadoresConsolaDocs
): IDisposable[] {
  const { KeyMod, KeyCode } = ensureMonaco()
  const grupo = '1_consola'
  return [
    ed.addAction({
      id: 'tessera.consolaDocs.ejecutar',
      label: 'Ejecutar sentencia o selección',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Enter],
      contextMenuGroupId: grupo,
      contextMenuOrder: 1,
      run: () => h.ejecutar()
    }),
    ed.addAction({
      id: 'tessera.consolaDocs.ejecutarTodo',
      label: 'Ejecutar todo',
      keybindings: [KeyMod.Alt | KeyCode.KeyX, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter],
      contextMenuGroupId: grupo,
      contextMenuOrder: 2,
      run: () => h.ejecutarTodo()
    }),
    ed.addAction({
      id: 'tessera.consolaDocs.detener',
      label: 'Detener',
      keybindings: [plataforma === 'mac' ? KeyMod.CtrlCmd | KeyCode.Period : KeyMod.CtrlCmd | KeyCode.F2],
      contextMenuGroupId: grupo,
      contextMenuOrder: 3,
      run: () => h.detener()
    })
  ]
}

/** Estado de la marca de una sentencia (las clases `db-glifo-*` de `consola.css`). */
export type EstadoMarcaDocs = 'pendiente' | 'corriendo' | 'ok' | 'error' | 'cancelada'

const HOVER: Readonly<Record<EstadoMarcaDocs, string>> = {
  pendiente: 'En cola',
  corriendo: 'Ejecutando…',
  ok: 'Ejecutada',
  error: 'Error',
  cancelada: 'Detenida'
}

/** Texto de un hover, escapado: los mensajes del servidor traen `$`, `*`, `_` y llaves. */
function md(texto: string): IMarkdownString {
  return { value: texto.replace(/[\\`*_{}[\]()#+\-.!|<>~$]/g, '\\$&') }
}

interface MarcaDocs {
  /** Decoración del rango de la sentencia (sigue al texto) y la del glifo. */
  ids: string[]
  estado: EstadoMarcaDocs
}

/**
 * Las marcas de la ÚLTIMA ejecución: una ejecución nueva (`iniciar`) sustituye a la
 * anterior entera, como en la consola SQL.
 */
export class MarcasConsolaDocs {
  private marcas: MarcaDocs[] = []
  private readonly modelo: editor.ITextModel

  constructor(modelo: editor.ITextModel) {
    this.modelo = modelo
  }

  /** Borra todo y pone las sentencias de la nueva ejecución en «pendiente». */
  iniciar(sentencias: readonly { desde: number; hasta: number }[]): void {
    this.limpiar()
    if (this.modelo.isDisposed()) return
    this.marcas = sentencias.map((s) => ({ ids: this.modelo.deltaDecorations([], this.decoraciones(s.desde, s.hasta, 'pendiente')), estado: 'pendiente' }))
  }

  /** Cambia el estado de la sentencia `i` (y su hover, con `detalle` si lo hay). */
  estado(i: number, estado: EstadoMarcaDocs, detalle?: string): void {
    const m = this.marcas[i]
    if (!m || this.modelo.isDisposed()) return
    const r = this.rangoVivo(i)
    if (!r) return
    m.estado = estado
    m.ids = this.modelo.deltaDecorations(m.ids, this.decoraciones(r.desde, r.hasta, estado, detalle))
  }

  /** Offsets VIVOS [desde, hasta) de la sentencia `i` (siguen al texto editado), o null. */
  rangoVivo(i: number): { desde: number; hasta: number } | null {
    const m = this.marcas[i]
    if (!m || this.modelo.isDisposed()) return null
    const rango = this.modelo.getDecorationRange(m.ids[0])
    if (!rango) return null
    return { desde: this.modelo.getOffsetAt(rango.getStartPosition()), hasta: this.modelo.getOffsetAt(rango.getEndPosition()) }
  }

  /**
   * El ✗ de la sentencia `i` y el subrayado del error en `posicion` (offset de la consola,
   * acotado a la sentencia viva), o sin subrayado si el error no trae posición.
   */
  error(i: number, mensaje: string, codigo: string | null, posicion: number | null): void {
    this.estado(i, 'error', mensaje)
    const r = this.rangoVivo(i)
    if (!r || posicion === null) return
    const monaco = ensureMonaco()
    const offset = Math.max(r.desde, Math.min(r.hasta, posicion))
    const p = this.modelo.getPositionAt(offset)
    // La PALABRA del error, no un carácter suelto (el ondulado de uno casi no se ve).
    const palabra = this.modelo.getWordAtPosition(p)
    const maxCol = this.modelo.getLineMaxColumn(p.lineNumber)
    const finCol =
      palabra && palabra.startColumn <= p.column && palabra.endColumn > p.column ? palabra.endColumn : Math.min(maxCol, p.column + 1)
    monaco.editor.setModelMarkers(this.modelo, DUENO_ERRORES_DOCS, [
      {
        severity: monaco.MarkerSeverity.Error,
        message: mensaje,
        code: codigo ?? undefined,
        startLineNumber: p.lineNumber,
        startColumn: p.column,
        endLineNumber: p.lineNumber,
        endColumn: finCol
      }
    ])
  }

  /** Posición (línea y columna de Monaco) de un offset de la consola, o null sin modelo. */
  posicion(offset: number): { lineNumber: number; column: number } | null {
    if (this.modelo.isDisposed()) return null
    return this.modelo.getPositionAt(Math.max(0, Math.min(offset, this.modelo.getValueLength())))
  }

  limpiar(): void {
    if (this.modelo.isDisposed()) {
      this.marcas = []
      return
    }
    const ids = this.marcas.flatMap((m) => m.ids)
    if (ids.length > 0) this.modelo.deltaDecorations(ids, [])
    this.marcas = []
    ensureMonaco().editor.setModelMarkers(this.modelo, DUENO_ERRORES_DOCS, [])
  }

  dispose(): void {
    this.limpiar()
  }

  private decoraciones(desde: number, hasta: number, estado: EstadoMarcaDocs, detalle?: string): editor.IModelDeltaDecoration[] {
    const monaco = ensureMonaco()
    const inicio = this.modelo.getPositionAt(desde)
    const fin = this.modelo.getPositionAt(Math.max(desde, hasta))
    const nunca = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
    const hover = detalle ? `${HOVER[estado]}: ${detalle}` : HOVER[estado]
    return [
      // La PRIMERA es siempre el rango vivo de la sentencia (lo lee `rangoVivo`).
      {
        range: new monaco.Range(inicio.lineNumber, inicio.column, fin.lineNumber, fin.column),
        options: {
          stickiness: nunca,
          linesDecorationsClassName: estado === 'ok' ? 'db-barra db-barra-ok' : estado === 'error' ? 'db-barra db-barra-error' : estado === 'corriendo' ? 'db-barra db-barra-corriendo' : null
        }
      },
      // El glifo cuelga del PRIMER carácter (como en la SQL: un Intro delante lo arrastra).
      {
        range: new monaco.Range(
          inicio.lineNumber,
          inicio.column,
          inicio.lineNumber,
          Math.min(inicio.column + 1, this.modelo.getLineMaxColumn(inicio.lineNumber))
        ),
        options: {
          stickiness: nunca,
          glyphMarginClassName: `db-glifo db-glifo-${estado}`,
          glyphMarginHoverMessage: md(hover)
        }
      }
    ]
  }
}
