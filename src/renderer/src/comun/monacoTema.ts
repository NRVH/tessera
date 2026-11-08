// =============================================================================
// El tema de Monaco de un tema del código (`theme/temasCodigo.ts`): los tokens, el fondo y el diff salen
// de su paleta; las guías, los bordes y los widgets, del marco de Tessera, que no cambia. El objeto
// `colors` de un tema solo acepta HEX: todo color pasa por `toMonacoHex`. Lo aplica `comun/temaCodigo.ts`.
// Decisiones: docs/decisiones/renderer/monaco.md, docs/decisiones/renderer/temas-de-codigo.md
// =============================================================================

import type * as monaco from 'monaco-editor'
import { ATOM_ONE_DARK } from '../theme/atomOneDark'
import type { PaletaCodigo } from '../theme/temasCodigo'

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
function reglasDeTokens(p: PaletaCodigo): monaco.editor.ITokenThemeRule[] {
  const hex = (v: string): string => v.replace('#', '')
  return [
    { token: '', foreground: hex(p.texto), background: hex(p.fondo) },
    { token: 'comment', foreground: hex(p.comentario), fontStyle: 'italic' },
    { token: 'keyword', foreground: hex(p.palabraClave) },
    { token: 'keyword.control', foreground: hex(p.palabraClave) },
    { token: 'operator', foreground: hex(p.operador) },
    { token: 'string', foreground: hex(p.cadena) },
    { token: 'number', foreground: hex(p.numero) },
    { token: 'regexp', foreground: hex(p.regexp) },
    { token: 'type', foreground: hex(p.tipo) },
    { token: 'type.identifier', foreground: hex(p.tipo) },
    { token: 'class', foreground: hex(p.tipo) },
    { token: 'function', foreground: hex(p.funcion) },
    { token: 'variable', foreground: hex(p.variable) },
    { token: 'variable.predefined', foreground: hex(p.constante) },
    { token: 'constant', foreground: hex(p.constante) },
    { token: 'delimiter', foreground: hex(p.texto) },
    { token: 'tag', foreground: hex(p.etiqueta) },
    { token: 'attribute.name', foreground: hex(p.atributo) },
    { token: 'attribute.value', foreground: hex(p.cadena) },
    { token: 'key', foreground: hex(p.clave) }
  ]
}

/**
 * Colores del editor. Los brackets se neutralizan aquí (todos los niveles y el «inesperado» al
 * color de texto): la colorización la lee el modelo y no se apaga desde las opciones del editor.
 * Las guías, los bordes y las barras son del marco de Tessera y no cambian con el tema.
 */
function coloresDelEditor(p: PaletaCodigo, borderSoftHex: string): Record<string, string> {
  return {
    'editorBracketHighlight.foreground1': p.texto,
    'editorBracketHighlight.foreground2': p.texto,
    'editorBracketHighlight.foreground3': p.texto,
    'editorBracketHighlight.foreground4': p.texto,
    'editorBracketHighlight.foreground5': p.texto,
    'editorBracketHighlight.foreground6': p.texto,
    'editorBracketHighlight.unexpectedBracket.foreground': p.texto,
    'editor.background': p.fondo,
    'editor.foreground': p.texto,
    'editorLineNumber.foreground': p.numeroLinea,
    'editorLineNumber.activeForeground': p.numeroLineaActiva,
    'editorCursor.foreground': p.cursor,
    'editor.selectionBackground': p.seleccion,
    'editor.lineHighlightBackground': p.lineaActual,
    'editorIndentGuide.background1': borderSoftHex,
    'editorIndentGuide.activeBackground1': p.comentario,
    'editorWhitespace.foreground': borderSoftHex,
    'editorWidget.background': ATOM_ONE_DARK.bgElevated,
    'editorWidget.border': borderSoftHex,
    'editorGutter.background': p.fondo,
    'scrollbarSlider.background': '#4b525d80',
    'scrollbarSlider.hoverBackground': '#5c6370aa',
    'scrollbarSlider.activeBackground': '#5c6370cc'
  }
}

/**
 * Subrayados de `setModelMarkers`: la consola SQL los pinta (el error del servidor y los avisos
 * léxicos). Solo hex vía `toMonacoHex`: el tema no admite `var(--*)` ni `rgba()`.
 */
function coloresDeMarcadores(p: PaletaCodigo): Record<string, string> {
  return {
    'editorError.foreground': toMonacoHex(p.eliminado),
    'editorWarning.foreground': toMonacoHex(p.aviso),
    'editorInfo.foreground': toMonacoHex(p.info)
  }
}

/**
 * Colores del editor de diff, con dos intensidades por lado: un velo tenue en la línea y el doble
 * de cuerpo en el tramo de palabra que cambió. Los bordes del tramo son transparentes.
 */
function coloresDelDiff(p: PaletaCodigo, borderSoftHex: string): Record<string, string> {
  return {
    'diffEditor.insertedLineBackground': withAlpha(p.insertado, 0.1),
    'diffEditor.insertedTextBackground': withAlpha(p.insertado, 0.22),
    'diffEditor.removedLineBackground': withAlpha(p.eliminado, 0.1),
    'diffEditor.removedTextBackground': withAlpha(p.eliminado, 0.22),
    'diffEditor.insertedTextBorder': withAlpha(p.insertado, 0),
    'diffEditor.removedTextBorder': withAlpha(p.eliminado, 0),
    'diffEditorGutter.insertedLineBackground': withAlpha(p.insertado, 0.14),
    'diffEditorGutter.removedLineBackground': withAlpha(p.eliminado, 0.14),
    // Regla del overview: casi opaca para que los marcadores se lean en un archivo largo.
    'diffEditorOverview.insertedForeground': withAlpha(p.insertado, 0.85),
    'diffEditorOverview.removedForeground': withAlpha(p.eliminado, 0.85),
    'diffEditor.border': borderSoftHex,
    'diffEditor.diagonalFill': withAlpha(ATOM_ONE_DARK.borderSoft, 0.5),
    // Bloques movidos: el color de información, no verde/rojo, porque son reubicaciones y no altas o bajas.
    'diffEditor.move.border': withAlpha(p.info, 0.5),
    'diffEditor.moveActive.border': withAlpha(p.info, 0.9)
  }
}

/** El tema de Monaco de un tema del código (`theme/temasCodigo.ts`). */
export function temaMonacoDe(p: PaletaCodigo): monaco.editor.IStandaloneThemeData {
  const borderSoftHex = toMonacoHex(ATOM_ONE_DARK.borderSoft)
  return {
    base: 'vs-dark',
    inherit: true,
    rules: reglasDeTokens(p),
    colors: {
      ...coloresDelEditor(p, borderSoftHex),
      ...coloresDeMarcadores(p),
      ...coloresDelDiff(p, borderSoftHex)
    }
  }
}
