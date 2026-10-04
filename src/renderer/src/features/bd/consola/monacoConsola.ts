// =============================================================================
// Adaptador de Monaco de la consola SQL: traduce el estado puro (el lote, sus marcas, los
// errores del servidor y de compilación, los atajos) a decoraciones, marcadores y
// acciones, y los mantiene vivos mientras el usuario edita. Lo que se DECIDE vive en
// `marcasConsola.ts` y `vivoConsola.ts`; aquí solo se pinta. Los avisos vivos están en
// `validadorAvisos.ts` y se reexportan desde aquí.
// Decisiones: docs/decisiones/bd/ui-consola-monaco.md
// =============================================================================

import type { editor, IDisposable, IMarkdownString, MarkerSeverity } from 'monaco-editor'
import type { Plataforma } from '../../../../../shared/plataforma.ts'
import { ensureMonaco } from '../../../comun/monacoSetup.ts'
import { marcaDe, type Lote } from './lote.ts'
import type { MarcaCompilacion } from './marcasConsola.ts'
import { cambioTocaRango } from './vivoConsola.ts'

export { ValidadorAvisos } from './validadorAvisos.ts'

/** Dueño de los marcadores de error del servidor y de compilación. */
export const DUENO_EJECUCION = 'tessera-sql-ejecucion'

/**
 * Un texto para un hover de Markdown, escapado: los mensajes del servidor traen `*`,
 * `_` y corchetes (`[ORA-00942]`) que Markdown convertiría en formato o en enlaces.
 */
function md(texto: string): IMarkdownString {
  return { value: texto.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&') }
}

// --- Marcas del lote ----------------------------------------------------------------

interface MarcaSentencia {
  /** Offsets VIVOS [desde, hasta) de la sentencia (contenido, sin terminador). */
  desde: number
  hasta: number
  viva: boolean
  /** Decoraciones de esta sentencia; la primera es siempre la de `rango`. */
  ids: string[]
  /** Error del servidor a subrayar (desplazamiento relativo al inicio), o null. */
  error: { desplazamiento: number; mensaje: string; codigo: string | null } | null
  /** Errores y avisos de compilación situados (`marcasCompilacion`). */
  compilacion: readonly MarcaCompilacion[]
}

/**
 * Glifos, barras, tinte y tiempos de las sentencias del ÚLTIMO lote, y el
 * subrayado del error del servidor. Un lote nuevo sustituye al anterior entero.
 */
export class MarcasLoteMonaco {
  private marcas: MarcaSentencia[] = []
  private loteId: number | null = null
  private readonly suscripcion: IDisposable

  constructor(private readonly modelo: editor.ITextModel) {
    this.suscripcion = modelo.onDidChangeContent((e) => {
      if (this.marcas.length === 0) return
      let invalidadas = false
      for (const c of e.changes) {
        for (const m of this.marcas) {
          if (m.viva && cambioTocaRango(m.desde, m.hasta, { offset: c.rangeOffset, largo: c.rangeLength })) {
            m.viva = false
            invalidadas = true
          }
        }
      }
      if (invalidadas) {
        const quitar: string[] = []
        for (const m of this.marcas) {
          if (!m.viva && m.ids.length > 0) {
            quitar.push(...m.ids)
            m.ids = []
            m.error = null
            m.compilacion = []
          }
        }
        this.modelo.deltaDecorations(quitar, [])
        this.pintarErrores()
      }
      this.refrescar()
    })
  }

  /** Id del lote que tienen pintado (el «ir a la posición» solo vale para ese). */
  get lote(): number | null {
    return this.loteId
  }

  /** Empieza un lote: quita todo lo anterior y crea una marca por sentencia. */
  iniciar(lote: Lote, ahora: number): void {
    this.limpiar()
    this.loteId = lote.id
    this.marcas = lote.sentencias.map((x) => ({
      desde: x.s.desde,
      hasta: x.s.hastaContenido,
      viva: true,
      ids: [],
      error: null,
      compilacion: []
    }))
    this.pintar(lote, ahora)
  }

  /**
   * Repinta con el estado del lote. `solo`: repinta solo esas sentencias (el
   * cronómetro de la que corre). Un lote que no es el marcado se ignora.
   */
  pintar(lote: Lote, ahora: number, solo?: readonly number[]): void {
    if (lote.id !== this.loteId) return
    this.refrescar()
    const indices = solo ?? lote.sentencias.map((_x, i) => i)
    const viejos: string[] = []
    const nuevas: editor.IModelDeltaDecoration[] = []
    const cuantas: number[] = []
    for (const i of indices) {
      const m = this.marcas[i]
      const x = lote.sentencias[i]
      if (!m || !x || !m.viva) {
        cuantas.push(0)
        continue
      }
      viejos.push(...m.ids)
      const decos = this.decoracionesDe(m, marcaDe(x, ahora, lote.plan === true), x.estado === 'corriendo', x.codigo !== null)
      nuevas.push(...decos)
      cuantas.push(decos.length)
    }
    const ids = this.modelo.deltaDecorations(viejos, nuevas)
    let k = 0
    indices.forEach((i, n) => {
      const m = this.marcas[i]
      if (!m || cuantas[n] === 0) return
      m.ids = ids.slice(k, k + cuantas[n])
      k += cuantas[n]
    })
  }

  /** Inicio VIVO (offset UTF-16) de la sentencia `i`, o null si su marca ya no existe. */
  inicioVivo(i: number): number | null {
    this.refrescar()
    const m = this.marcas[i]
    return m && m.viva ? m.desde : null
  }

  /** Rango VIVO de la sentencia `i`, o null. */
  rangoVivo(i: number): { desde: number; hasta: number } | null {
    this.refrescar()
    const m = this.marcas[i]
    return m && m.viva ? { desde: m.desde, hasta: m.hasta } : null
  }

  /**
   * Línea y columna (1-based, como Monaco) del desplazamiento `d` dentro de la
   * sentencia `i`, acotado a la sentencia. Null si su marca ya no existe.
   */
  posicion(i: number, d: number): { linea: number; columna: number; offset: number } | null {
    const r = this.rangoVivo(i)
    if (!r) return null
    const offset = Math.max(r.desde, Math.min(r.hasta, r.desde + Math.max(0, d)))
    const p = this.modelo.getPositionAt(offset)
    return { linea: p.lineNumber, columna: p.column, offset }
  }

  /** Subraya el error del servidor de la sentencia `i` en su posición exacta. */
  ponerError(i: number, desplazamiento: number, mensaje: string, codigo: string | null): void {
    const m = this.marcas[i]
    if (!m || !m.viva) return
    m.error = { desplazamiento, mensaje, codigo }
    this.pintarErrores()
  }

  /**
   * Subraya los errores (rojo) y avisos (ámbar) de compilación de la sentencia `i`,
   * cada uno en su posición. Van con el MISMO dueño que el error del servidor: son
   * resultado de ejecutar, y se van igual al editar la sentencia o al lanzar otro lote.
   */
  ponerCompilacion(i: number, lista: readonly MarcaCompilacion[]): void {
    const m = this.marcas[i]
    if (!m || !m.viva) return
    m.compilacion = lista
    this.pintarErrores()
  }

  /** Quita todo: decoraciones y subrayados del lote. */
  limpiar(): void {
    const ids: string[] = []
    for (const m of this.marcas) ids.push(...m.ids)
    if (ids.length > 0) this.modelo.deltaDecorations(ids, [])
    this.marcas = []
    this.loteId = null
    this.pintarErrores()
  }

  dispose(): void {
    this.suscripcion.dispose()
    if (!this.modelo.isDisposed()) this.limpiar()
  }

  /** Relee los offsets vivos desde las decoraciones `rango`. */
  private refrescar(): void {
    for (const m of this.marcas) {
      if (!m.viva || m.ids.length === 0) continue
      const r = this.modelo.getDecorationRange(m.ids[0])
      if (!r) {
        m.viva = false
        continue
      }
      m.desde = this.modelo.getOffsetAt(r.getStartPosition())
      m.hasta = this.modelo.getOffsetAt(r.getEndPosition())
    }
  }

  private decoracionesDe(
    m: MarcaSentencia,
    d: ReturnType<typeof marcaDe>,
    corriendo: boolean,
    conCodigo: boolean
  ): editor.IModelDeltaDecoration[] {
    const monaco = ensureMonaco()
    const inicio = this.modelo.getPositionAt(m.desde)
    const fin = this.modelo.getPositionAt(Math.max(m.desde, m.hasta))
    const rango = new monaco.Range(inicio.lineNumber, inicio.column, fin.lineNumber, fin.column)
    const out: editor.IModelDeltaDecoration[] = [
      // La PRIMERA es siempre el rango vivo (ver `refrescar`).
      {
        range: rango,
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          linesDecorationsClassName: d.claseBarra ? `db-barra ${d.claseBarra}` : null
        }
      },
      // El glifo cuelga del PRIMER CARÁCTER de la sentencia y no de un punto vacío en
      // la columna 1: con `NeverGrows`, un Intro delante de la sentencia arrastra al
      // primer carácter (y al glifo) a la línea de abajo, mientras que un rango vacío
      // se quedaba en la línea en blanco que el Intro dejaba encima.
      {
        range: new monaco.Range(
          inicio.lineNumber,
          inicio.column,
          inicio.lineNumber,
          Math.min(inicio.column + 1, this.modelo.getLineMaxColumn(inicio.lineNumber))
        ),
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          glyphMarginClassName: `db-glifo ${d.claseGlifo}`,
          glyphMarginHoverMessage: md(d.hover)
        }
      }
    ]
    if (corriendo) {
      out.push({
        range: rango,
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          className: 'db-rango-corriendo',
          isWholeLine: true
        }
      })
    }
    if (d.despues) {
      const col = this.modelo.getLineMaxColumn(fin.lineNumber)
      out.push({
        range: new monaco.Range(fin.lineNumber, col, fin.lineNumber, col),
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
          // SIN ESTO EL TIEMPO NO SE PINTA NUNCA: el rango es vacío (el final de la
          // línea) y Monaco descarta el texto inyectado de un rango vacío salvo con
          // `showIfCollapsed`. Solo lo ve el e2e: Monaco no carga bajo node.
          showIfCollapsed: true,
          after: {
            content: d.despues,
            inlineClassName: conCodigo ? 'db-tiempo-linea db-tiempo-error' : 'db-tiempo-linea',
            // El cursor no se para dentro del texto inyectado: no es texto del usuario.
            cursorStops: monaco.editor.InjectedTextCursorStops.None
          }
        }
      })
    }
    return out
  }

  private pintarErrores(): void {
    if (this.modelo.isDisposed()) return
    const monaco = ensureMonaco()
    const lista: editor.IMarkerData[] = []
    for (const m of this.marcas) {
      if (!m.viva) continue
      if (m.error) {
        lista.push(this.marcador(m, m.error.desplazamiento, m.error.mensaje, m.error.codigo, monaco.MarkerSeverity.Error))
      }
      for (const c of m.compilacion) {
        lista.push(
          this.marcador(
            m,
            c.desplazamiento,
            c.mensaje,
            // El `code` del marcador lleva la línea y la columna DEL SERVIDOR: es lo
            // que el usuario verá en la Salida junto a ese mismo mensaje.
            `línea ${c.linea}, col. ${c.columna}`,
            c.severidad === 'aviso' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error
          )
        )
      }
    }
    monaco.editor.setModelMarkers(this.modelo, DUENO_EJECUCION, lista)
  }

  /** Un marcador en `desplazamiento` (acotado a la sentencia), sobre la palabra que toca. */
  private marcador(
    m: MarcaSentencia,
    desplazamiento: number,
    mensaje: string,
    codigo: string | null,
    severity: MarkerSeverity
  ): editor.IMarkerData {
    const offset = Math.max(m.desde, Math.min(m.hasta, m.desde + desplazamiento))
    const p = this.modelo.getPositionAt(offset)
    // Subraya la PALABRA del error (un token), no un carácter suelto: con un solo
    // carácter el subrayado ondulado casi no se ve. Al final de la línea el rango
    // queda vacío y Monaco lo ensancha solo hasta algo visible.
    const palabra = this.modelo.getWordAtPosition(p)
    const maxCol = this.modelo.getLineMaxColumn(p.lineNumber)
    const finCol =
      palabra && palabra.startColumn <= p.column && palabra.endColumn > p.column
        ? palabra.endColumn
        : Math.min(maxCol, p.column + 1)
    return {
      severity,
      message: mensaje,
      code: codigo ?? undefined,
      startLineNumber: p.lineNumber,
      startColumn: p.column,
      endLineNumber: p.lineNumber,
      endColumn: finCol
    }
  }
}

// --- Atajos ---------------------------------------------------------------------------

/** Lo que hace cada atajo de la consola (lo aporta `useConsola`). */
export interface ManejadoresConsola {
  ejecutar: () => void
  ejecutarTodo: () => void
  detener: () => void
  commit: () => void
  rollback: () => void
  /** El plan de la sentencia del cursor o de la selección. */
  explicar: () => void
  /** El historial de consultas. */
  historial: () => void
  /** Formatear la selección o, sin ella, todo el texto. */
  formatear: () => void
}

const GRUPO_CONSOLA = '1_consola'

function enMenu(orden: number, grupo: string = GRUPO_CONSOLA): { contextMenuGroupId: string; contextMenuOrder: number } {
  return { contextMenuGroupId: grupo, contextMenuOrder: orden }
}

/**
 * Registra los atajos de la consola con `addAction`, UNO POR EDITOR: `addCommand` dejaba
 * el atajo al último editor creado aunque el foco estuviera en otro. Los acordes son los
 * de `ACORDES` en `util/atajos.ts` (de allí salen los `title` de la barra): si se cambia
 * uno, se cambia en los dos sitios. Detener es OTRA TECLA en Mac (⌘. es el Cancelar
 * nativo; ⌘F2 exige fn), y pisa sus acciones de serie solo dentro de la consola.
 */
export function registrarAccionesConsola(
  ed: editor.IStandaloneCodeEditor,
  plataforma: Plataforma,
  h: ManejadoresConsola
): IDisposable[] {
  const { KeyMod, KeyCode } = ensureMonaco()
  const mod = KeyMod.CtrlCmd
  const acciones: editor.IActionDescriptor[] = [
    { id: 'tessera.consola.ejecutar', label: 'Ejecutar sentencia o selección', keybindings: [mod | KeyCode.Enter], ...enMenu(1), run: () => h.ejecutar() },
    {
      id: 'tessera.consola.ejecutarTodo',
      label: 'Ejecutar todo',
      keybindings: [KeyMod.Alt | KeyCode.KeyX, mod | KeyMod.Shift | KeyCode.Enter],
      ...enMenu(2),
      run: () => h.ejecutarTodo()
    },
    {
      id: 'tessera.consola.detener',
      label: 'Detener',
      keybindings: [plataforma === 'mac' ? mod | KeyCode.Period : mod | KeyCode.F2],
      ...enMenu(3),
      run: () => h.detener()
    },
    { id: 'tessera.consola.commit', label: 'Confirmar (Commit)', keybindings: [mod | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyK], run: () => h.commit() },
    { id: 'tessera.consola.rollback', label: 'Revertir (Rollback)', keybindings: [mod | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyR], run: () => h.rollback() },
    // `explicar`, `historial` y `formatear`: su porqué, y lo que no pisan, junto a
    // `esExplicar` en `util/atajos.ts`.
    { id: 'tessera.consola.explicar', label: 'Explicar plan', keybindings: [mod | KeyMod.Shift | KeyCode.KeyE], ...enMenu(4), run: () => h.explicar() },
    { id: 'tessera.consola.historial', label: 'Historial de consultas…', keybindings: [mod | KeyMod.Shift | KeyCode.KeyH], ...enMenu(5), run: () => h.historial() },
    {
      id: 'tessera.consola.formatear',
      label: 'Formatear SQL',
      keybindings: [mod | KeyMod.Alt | KeyCode.KeyL],
      // En Mac, ⌥⌘L es también «Buscar en la selección» del buscador, pero solo con el
      // buscador ABIERTO: ahí se le deja. En Windows su acorde es Alt+L, sin Ctrl.
      keybindingContext: plataforma === 'mac' ? '!findWidgetVisible' : undefined,
      // Un grupo propio: formatear es sobre el TEXTO, no sobre la ejecución.
      ...enMenu(1, '1_modification'),
      run: () => h.formatear()
    }
  ]
  return acciones.map((a) => ed.addAction(a))
}
