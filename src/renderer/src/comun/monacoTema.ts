// =============================================================================
// Tema `atom-one-dark` de Monaco, derivado de la paleta única (theme/atomOneDark.ts) para que el
// editor sea coherente con el shell y la terminal. El objeto `colors` de un tema solo acepta HEX:
// todo color pasa por `toMonacoHex`. Depende de `../theme/atomOneDark`; `monacoSetup.ts` lo define.
// Decisiones: docs/decisiones/renderer/monaco.md
// =============================================================================

import type * as monaco from 'monaco-editor'
import { ATOM_ONE_DARK } from '../theme/atomOneDark'

type Paleta = typeof ATOM_ONE_DARK

/**
 * Convierte un color de la paleta al único formato que Monaco acepta en `colors`: HEX.
 * Acepta `#rgb`/`#rrggbb[aa]` (tal cual) y `rgb()/rgba()` (a `#rrggbbaa`); un valor no
 * convertible da magenta, para delatarlo sin fingir el rojo con el que Monaco lo sustituiría.
 */
export function toMonacoHex(color: string): string {
  const trimmed = color.trim()
  if (trimmed.startsWith('#')) return trimmed
  const m = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (!m) return '#ff00ff' // magenta chillón: delata el color no convertible sin fingir rojo
  const byte = (v: string): string =>
    Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0')
  const alpha = m[4] === undefined ? '' : byte(String(Number(m[4]) * 255))
  return `#${byte(m[1])}${byte(m[2])}${byte(m[3])}${alpha}`
}

/**
 * Color de la paleta + alfa -> '#rrggbbaa'. Los fondos del diff son translúcidos para no tapar el
 * resaltado de sintaxis; el alfa se compone aquí y siempre pasa por `toMonacoHex`.
 */
function withAlpha(color: string, a: number): string {
  const hex = toMonacoHex(color).slice(0, 7) // descarta un alfa previo si lo traía
  const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
  return hex + alpha.toString(16).padStart(2, '0')
}

/** Reglas de colores por token. */
function reglasDeTokens(c: Paleta): monaco.editor.ITokenThemeRule[] {
  const hex = (v: string): string => v.replace('#', '')
  return [
    { token: '', foreground: hex(c.fg), background: hex(c.bg) },
    { token: 'comment', foreground: hex(c.fgFaint), fontStyle: 'italic' },
    { token: 'keyword', foreground: hex(c.magenta) },
    { token: 'keyword.control', foreground: hex(c.magenta) },
    { token: 'operator', foreground: hex(c.cyan) },
    { token: 'string', foreground: hex(c.green) },
    { token: 'number', foreground: hex(c.orange) },
    { token: 'regexp', foreground: hex(c.cyan) },
    { token: 'type', foreground: hex(c.yellow) },
    { token: 'type.identifier', foreground: hex(c.yellow) },
    { token: 'class', foreground: hex(c.yellow) },
    { token: 'function', foreground: hex(c.accent) },
    { token: 'variable', foreground: hex(c.red) },
    { token: 'variable.predefined', foreground: hex(c.orange) },
    { token: 'constant', foreground: hex(c.orange) },
    { token: 'delimiter', foreground: hex(c.fg) },
    { token: 'tag', foreground: hex(c.red) },
    { token: 'attribute.name', foreground: hex(c.orange) },
    { token: 'attribute.value', foreground: hex(c.green) },
    { token: 'key', foreground: hex(c.red) }
  ]
}

/**
 * Colores del editor. Los brackets se neutralizan aquí (todos los niveles y el «inesperado» al
 * color de texto): la colorización la lee el modelo y no se apaga desde las opciones del editor.
 */
function coloresDelEditor(c: Paleta, borderSoftHex: string): Record<string, string> {
  return {
    'editorBracketHighlight.foreground1': c.fg,
    'editorBracketHighlight.foreground2': c.fg,
    'editorBracketHighlight.foreground3': c.fg,
    'editorBracketHighlight.foreground4': c.fg,
    'editorBracketHighlight.foreground5': c.fg,
    'editorBracketHighlight.foreground6': c.fg,
    'editorBracketHighlight.unexpectedBracket.foreground': c.fg,
    'editor.background': c.bg,
    'editor.foreground': c.fg,
    'editorLineNumber.foreground': c.fgFaint,
    'editorLineNumber.activeForeground': c.fgMuted,
    'editorCursor.foreground': c.accentQuiet,
    'editor.selectionBackground': c.selection,
    'editor.lineHighlightBackground': c.bgElevated,
    'editorIndentGuide.background1': borderSoftHex,
    'editorIndentGuide.activeBackground1': c.fgFaint,
    'editorWhitespace.foreground': borderSoftHex,
    'editorWidget.background': c.bgElevated,
    'editorWidget.border': borderSoftHex,
    'editorGutter.background': c.bg,
    'scrollbarSlider.background': '#4b525d80',
    'scrollbarSlider.hoverBackground': '#5c6370aa',
    'scrollbarSlider.activeBackground': '#5c6370cc'
  }
}

/**
 * Subrayados de `setModelMarkers`: la consola SQL los pinta (el error del servidor y los avisos
 * léxicos). Solo hex vía `toMonacoHex`: el tema no admite `var(--*)` ni `rgba()`.
 */
function coloresDeMarcadores(c: Paleta): Record<string, string> {
  return {
    'editorError.foreground': toMonacoHex(c.red),
    'editorWarning.foreground': toMonacoHex(c.yellow),
    'editorInfo.foreground': toMonacoHex(c.accent)
  }
}

/**
 * Colores del editor de diff, con dos intensidades por lado: un velo tenue en la línea y el doble
 * de cuerpo en el tramo de palabra que cambió. Los bordes del tramo son transparentes.
 */
function coloresDelDiff(c: Paleta, borderSoftHex: string): Record<string, string> {
  return {
    'diffEditor.insertedLineBackground': withAlpha(c.green, 0.1),
    'diffEditor.insertedTextBackground': withAlpha(c.green, 0.22),
    'diffEditor.removedLineBackground': withAlpha(c.red, 0.1),
    'diffEditor.removedTextBackground': withAlpha(c.red, 0.22),
    'diffEditor.insertedTextBorder': withAlpha(c.green, 0),
    'diffEditor.removedTextBorder': withAlpha(c.red, 0),
    'diffEditorGutter.insertedLineBackground': withAlpha(c.green, 0.14),
    'diffEditorGutter.removedLineBackground': withAlpha(c.red, 0.14),
    // Regla del overview: casi opaca para que los marcadores se lean en un archivo largo.
    'diffEditorOverview.insertedForeground': withAlpha(c.green, 0.85),
    'diffEditorOverview.removedForeground': withAlpha(c.red, 0.85),
    'diffEditor.border': borderSoftHex,
    'diffEditor.diagonalFill': withAlpha(c.borderSoft, 0.5),
    // Bloques movidos: acento, no verde/rojo, porque son reubicaciones y no altas o bajas.
    'diffEditor.move.border': withAlpha(c.accent, 0.5),
    'diffEditor.moveActive.border': withAlpha(c.accent, 0.9)
  }
}

/** Tema de Monaco derivado de la paleta Atom One Dark (misma fuente de verdad). */
export function buildAtomOneDarkTheme(): monaco.editor.IStandaloneThemeData {
  const c = ATOM_ONE_DARK
  const borderSoftHex = toMonacoHex(c.borderSoft)
  return {
    base: 'vs-dark',
    inherit: true,
    rules: reglasDeTokens(c),
    colors: {
      ...coloresDelEditor(c, borderSoftHex),
      ...coloresDeMarcadores(c),
      ...coloresDelDiff(c, borderSoftHex)
    }
  }
}
