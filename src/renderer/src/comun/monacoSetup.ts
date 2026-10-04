// =============================================================================
// Setup de Monaco para el renderer: cableado de los workers con el import `?worker` de Vite
// (chunks servidos desde el propio origen; la CSP permite `worker-src 'self' blob:`), tema
// `atom-one-dark`, lenguajes propios y apagado de los validadores. El zoom global no se toca
// aquí: escala todo el renderer y cada editor re-mide con su `ResizeObserver`.
// Depende de `monacoTema.ts` y `monacoLenguajes.ts`; lo usan los paneles de editor y de BD.
// Decisiones: docs/decisiones/renderer/monaco.md
// =============================================================================

import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import {
  boostJavaHighlighting,
  registerGroovyLanguage,
  registerMermaidLanguage,
  registerPropertiesLanguage
} from './monacoLenguajes'
import { buildAtomOneDarkTheme } from './monacoTema'

/** Id del tema de Monaco alineado con Atom One Dark. */
export const MONACO_THEME = 'atom-one-dark'

/**
 * Opciones que comparten todos los editores de la app (solo lo que es igual en todos; el resto
 * lo decide cada pane). `automaticLayout: false` es deliberado: quien use estas opciones debe
 * registrar su propio `ResizeObserver` y llamar a `layout()`, o el editor mide 0×0 y el pane
 * queda en negro (ver `useVisibleLayout`). El de diff, con `layout({ width, height })`.
 */
export const OPCIONES_BASE_MONACO: monaco.editor.IEditorOptions = {
  automaticLayout: false,
  fontFamily: '"Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',
  fontSize: 13,
  lineHeight: 20,
  scrollBeyondLastLine: false,
  // Solo se apagan las guías verticales de brackets; el color de los brackets se neutraliza
  // en el tema, porque la colorización la lee el modelo y no las opciones del editor.
  guides: { bracketPairs: false, highlightActiveBracketPair: false },
  smoothScrolling: true,
  // Saca los widgets flotantes (buscador, hovers) del contexto de recorte de `.editor-host`.
  fixedOverflowWidgets: true
}

let initialized = false

/**
 * Configura los workers de Monaco (una sola vez) y registra el tema. Idempotente:
 * seguro llamarlo en cada montaje del editor.
 */
export function ensureMonaco(): typeof monaco {
  if (initialized) return monaco
  initialized = true

  // getWorker: Monaco pide un worker por `label` de lenguaje. El worker base
  // (editor.worker) cubre el resto (diff, edición, tokenización asistida).
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case 'json':
          return new JsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker()
        case 'typescript':
        case 'javascript':
          return new TsWorker()
        default:
          return new EditorWorker()
      }
    }
  }

  monaco.editor.defineTheme(MONACO_THEME, buildAtomOneDarkTheme())
  apagarDiagnosticos()
  registerPropertiesLanguage()
  registerGroovyLanguage()
  registerMermaidLanguage()
  boostJavaHighlighting()
  return monaco
}

/**
 * Apaga la validación de los servicios de lenguaje (TypeScript/JavaScript, JSON y CSS): Tessera
 * no compila y el worker ve un archivo suelto, así que solo sabe producir errores propios. No
 * toca el resaltado (Monarch) ni el autocompletado, el hover o el plegado, solo los marcadores.
 * `enableSchemaRequest: false` impide que el editor salga a la red a buscar esquemas de JSON.
 */
function apagarDiagnosticos(): void {
  const sinDiagnosticosTs = {
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true
  }
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(sinDiagnosticosTs)
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(sinDiagnosticosTs)

  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: false,
    // Redundantes con `validate: false`, pero dejan escrito que un JSONC es legítimo
    // aquí por si alguien vuelve a encender la validación.
    allowComments: true,
    trailingCommas: 'ignore',
    schemaValidation: 'ignore',
    enableSchemaRequest: false
  })

  // CSS/SCSS/LESS comparten la forma de las opciones; `setOptions` REEMPLAZA el objeto
  // entero, así que se parte de las opciones vigentes para no borrar el resto.
  for (const defaults of [
    monaco.languages.css.cssDefaults,
    monaco.languages.css.scssDefaults,
    monaco.languages.css.lessDefaults
  ]) {
    defaults.setOptions({ ...defaults.options, validate: false })
  }
}
