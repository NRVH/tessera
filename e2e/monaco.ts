// =============================================================================
// Escribir y leer el Monaco de una consola SQL (o de la pestaña de fuente) desde una
// prueba de interfaz. Localiza el editor por el fiber de React del host VISIBLE
// (`section.db-consola:not(.hidden)`: las ocultas siguen montadas), buscando por FORMA el
// hook que guarda algo con `getModel` y `trigger`, y teclea con `trigger('keyboard',
// 'type')`, el camino de la tecla real; `setValue` solo para cargar un texto de partida.
// Decisiones: docs/decisiones/pruebas/que-va-en-e2e-y-que-en-test-mts.md
// =============================================================================

import type { Page } from '@playwright/test'

/** El host del editor de la consola visible. */
const HOST_CONSOLA = 'section.db-consola:not(.hidden) .db-consola-editor'
/** El host del editor de la pestaña de fuente visible. */
export const HOST_FUENTE = '.db-area:not(.hidden) section.db-fuente:not(.hidden) .db-fuente-host'

/** Lo que se le puede pedir al editor de la consola visible. */
export type OpMonaco =
  | { op: 'listo' }
  | { op: 'fijar'; texto: string }
  | { op: 'teclear'; texto: string }
  | { op: 'seleccionarTodo' }
  | { op: 'cursorAlFinal' }
  | { op: 'sugerir' }
  | { op: 'texto' }
  | { op: 'foco' }
  /** Decoraciones del modelo con texto inyectado (`after`), como JSON: el tiempo de cada sentencia. */
  | { op: 'inyectados' }
  /** 'si' si el editor es de solo lectura (la pestaña de fuente), 'no' si no. */
  | { op: 'soloLectura' }
  /** Pone el cursor en el desplazamiento `offset` del texto. */
  | { op: 'posicionar'; offset: number }
  /** Ejecuta una acción del editor buscándola por su etiqueta visible, sin acorde. */
  | { op: 'accionPorEtiqueta'; etiqueta: string }
  /** Lanza un comando del editor por su id (`undo`, `editor.action.quickFix`…). */
  | { op: 'comando'; id: string }
  /** Cambia el lenguaje del modelo, tokeniza `texto` (JSON con `lineas` y `restaurado`) y lo deja todo como estaba. */
  | { op: 'tokens'; lenguaje: string; texto: string }

/**
 * Ejecuta una operación sobre el Monaco de la consola VISIBLE y devuelve su
 * resultado como texto (`''` si no aplica). Lanza si no hay editor: una prueba que
 * escribe a ciegas y no lo sabe es peor que una que falla.
 */
export async function monacoConsola(win: Page, orden: OpMonaco): Promise<string> {
  return monacoEn(win, HOST_CONSOLA, orden)
}

/**
 * Lo mismo que `monacoConsola`, sobre el editor que cuelga del nodo `host` (el
 * primero que case). Todo va en UN `evaluate` porque el editor no se puede sacar del
 * renderer (no es serializable): se localiza y se usa en la misma llamada.
 */
export async function monacoEn(win: Page, host: string, orden: OpMonaco): Promise<string> {
  return win.evaluate(async ({ o, selector }: { o: OpMonaco; selector: string }) => {
    interface LineTokens {
      getCount: () => number
      getEndOffset: (i: number) => number
      getStandardTokenType: (i: number) => number
    }
    interface Accion {
      label: string
      run: () => Promise<void>
    }
    interface Modelo {
      getFullModelRange: () => unknown
      getLineCount: () => number
      getLineMaxColumn: (l: number) => number
      getPositionAt: (n: number) => { lineNumber: number; column: number }
      getLanguageId: () => string
      setLanguage: (id: string) => void
      getValue: () => string
      setValue: (t: string) => void
      tokenization: { forceTokenization: (l: number) => void; getLineTokens: (l: number) => LineTokens }
      getAllDecorations: () => Array<{
        range: { startLineNumber: number; startColumn: number }
        options: { after?: { content: string; inlineClassName?: string } | null }
      }>
    }
    interface Editor {
      getModel: () => Modelo | null
      trigger: (fuente: string, id: string, carga: unknown) => void
      setValue: (t: string) => void
      getValue: () => string
      setSelection: (r: unknown) => void
      setPosition: (p: { lineNumber: number; column: number }) => void
      focus: () => void
      getRawOptions: () => { readOnly?: boolean }
      getSupportedActions: () => Accion[]
    }
    type Hook = { memoizedState: unknown; next: Hook | null }
    type Fiber = { memoizedState: unknown; return: Fiber | null }
    const esEditor = (v: unknown): v is Editor =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as Editor).getModel === 'function' &&
      typeof (v as Editor).trigger === 'function'
    // El valor de un hook es el editor (`useState`) o lo lleva en `.current` (`useRef`).
    const editorDelHook = (v: unknown): Editor | null => {
      if (esEditor(v)) return v
      if (v && typeof v === 'object' && 'current' in v && esEditor((v as { current: unknown }).current)) {
        return (v as { current: Editor }).current
      }
      return null
    }
    // Sube por el fiber del nodo y recorre la lista de hooks de cada componente de función.
    const buscarEditor = (nodo: Element): Editor | null => {
      const clave = Object.keys(nodo).find((k) => k.startsWith('__reactFiber$'))
      if (!clave) throw new Error('el nodo del editor no tiene fiber de React')
      let fiber = (nodo as unknown as Record<string, Fiber>)[clave] as Fiber | null
      for (let saltos = 0; fiber && saltos < 40; saltos++, fiber = fiber.return) {
        let h = fiber.memoizedState as Hook | null
        // Sólo los componentes de función tienen una LISTA de hooks (con `next`).
        for (let n = 0; h && typeof h === 'object' && 'next' in h && n < 200; n++, h = h.next) {
          const ed = editorDelHook(h.memoizedState)
          if (ed) return ed
        }
      }
      return null
    }
    // `listo` y `soloLectura` ya se despacharon: con el tipo acotado el `switch` es exhaustivo.
    const aplicar = async (
      ed: Editor,
      modelo: Modelo,
      orden: Exclude<OpMonaco, { op: 'listo' } | { op: 'soloLectura' }>
    ): Promise<string> => {
      const alFinal = (): void => {
        const l = modelo.getLineCount()
        ed.setPosition({ lineNumber: l, column: modelo.getLineMaxColumn(l) })
      }
      switch (orden.op) {
        case 'fijar':
          ed.setValue(orden.texto)
          alFinal()
          ed.focus()
          return ''
        case 'teclear':
          ed.focus()
          ed.trigger('keyboard', 'type', { text: orden.texto })
          return ''
        case 'seleccionarTodo':
          ed.setSelection(modelo.getFullModelRange())
          ed.focus()
          return ''
        case 'cursorAlFinal':
          alFinal()
          ed.focus()
          return ''
        case 'sugerir':
          ed.focus()
          ed.trigger('e2e', 'editor.action.triggerSuggest', {})
          return ''
        case 'texto':
          return ed.getValue()
        case 'foco':
          ed.focus()
          return ''
        case 'inyectados':
          return JSON.stringify(
            modelo
              .getAllDecorations()
              .filter((d) => d.options.after)
              .map((d) => ({
                linea: d.range.startLineNumber,
                columna: d.range.startColumn,
                texto: d.options.after?.content,
                clase: d.options.after?.inlineClassName
              }))
          )
        case 'posicionar':
          ed.setPosition(modelo.getPositionAt(orden.offset))
          ed.focus()
          return ''
        case 'accionPorEtiqueta': {
          const a = ed.getSupportedActions().find((x) => x.label === orden.etiqueta)
          if (!a) throw new Error(`el editor no tiene la acción «${orden.etiqueta}»`)
          await a.run()
          return ''
        }
        case 'comando':
          ed.focus()
          ed.trigger('e2e', orden.id, {})
          return ''
        case 'tokens': {
          const antes = { lenguaje: modelo.getLanguageId(), texto: modelo.getValue() }
          const r: { lenguaje: string; lineas: number[][]; restaurado: string } = { lenguaje: '', lineas: [], restaurado: '' }
          try {
            modelo.setLanguage(orden.lenguaje)
            modelo.setValue(orden.texto)
            r.lenguaje = modelo.getLanguageId()
            for (let l = 1; l <= modelo.getLineCount(); l++) {
              modelo.tokenization.forceTokenization(l)
              const lt = modelo.tokenization.getLineTokens(l)
              const tipos: number[] = []
              let desde = 0
              for (let i = 0; i < lt.getCount(); i++) {
                const hasta = lt.getEndOffset(i)
                for (let c = desde; c < hasta; c++) tipos.push(lt.getStandardTokenType(i))
                desde = hasta
              }
              r.lineas.push(tipos)
            }
          } finally {
            modelo.setLanguage(antes.lenguaje)
            modelo.setValue(antes.texto)
          }
          r.restaurado = modelo.getLanguageId()
          return JSON.stringify(r)
        }
      }
    }

    const host = document.querySelector(selector)
    if (!host) throw new Error(`no hay ningún editor visible en ${selector}`)
    const ed = buscarEditor(host)
    if (o.op === 'listo') return ed && ed.getRawOptions().readOnly !== true ? 'si' : 'no'
    if (!ed) throw new Error(`${selector} todavía no tiene editor (se crea en su primer \`visible\`)`)
    if (o.op === 'soloLectura') return ed.getRawOptions().readOnly === true ? 'si' : 'no'
    const modelo = ed.getModel()
    if (!modelo) throw new Error(`el editor de ${selector} no tiene modelo`)
    return aplicar(ed, modelo, o)
  }, { o: orden, selector: host })
}

/** Espera a que la consola visible tenga editor y ya se pueda escribir (texto cargado). */
export async function esperarConsolaLista(win: Page, msMax = 20_000): Promise<void> {
  const hasta = Date.now() + msMax
  while (Date.now() < hasta) {
    const listo = await monacoConsola(win, { op: 'listo' }).catch(() => 'no')
    if (listo === 'si') return
    await win.waitForTimeout(100)
  }
  throw new Error(`la consola visible no quedó lista para escribir en ${msMax} ms`)
}
