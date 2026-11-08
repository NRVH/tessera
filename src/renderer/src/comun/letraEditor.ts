// =============================================================================
// La letra del editor de código (Configuración › Apariencia › Editor de código): la familia y el tamaño
// que llevan el editor, los diffs y los visores de archivos de Monaco. Los editores de bases de datos no
// la usan: tienen su propio tamaño. Quien crea uno de esos editores parte de `opcionesLetraEditor()` y lo
// registra con `conLetraEditor`; al cambiar el ajuste, todos los vivos se actualizan sin reabrirlos.
// =============================================================================

import type * as monaco from 'monaco-editor'
import { resolveFontFamily, resolveFontSize, type TerminalAppearance } from '../theme/terminalAppearance'

type OpcionesLetra = Pick<monaco.editor.IEditorOptions, 'fontFamily' | 'fontSize' | 'lineHeight'>

/** Un editor de Monaco (de código o de diff) que admite opciones nuevas y avisa al destruirse. */
interface EditorConLetra {
  updateOptions(o: OpcionesLetra): void
  onDidDispose(f: () => void): unknown
}

/** El alto de línea crece con el tamaño en la proporción de 13 px y 20 px de alto. */
export function opcionesDeLetra(a: TerminalAppearance): OpcionesLetra {
  const tamano = resolveFontSize(a)
  return { fontFamily: resolveFontFamily(a), fontSize: tamano, lineHeight: Math.round((tamano * 20) / 13) }
}

let actual: OpcionesLetra = opcionesDeLetra({ fontFamily: '', fontSize: 0 })
const vivos = new Set<EditorConLetra>()

/** Las opciones de letra vigentes, para crear un editor ya con ellas. */
export function opcionesLetraEditor(): OpcionesLetra {
  return { ...actual }
}

/** Registra un editor para que siga los cambios del ajuste mientras viva. */
export function conLetraEditor<T extends EditorConLetra>(ed: T): T {
  vivos.add(ed)
  ed.onDidDispose(() => vivos.delete(ed))
  return ed
}

/** Aplica la letra del ajuste a los editores vivos y a los que se creen después. */
export function fijarLetraEditor(a: TerminalAppearance): void {
  const nuevas = opcionesDeLetra(a)
  if (nuevas.fontFamily === actual.fontFamily && nuevas.fontSize === actual.fontSize) return
  actual = nuevas
  for (const ed of vivos) ed.updateOptions(nuevas)
}
