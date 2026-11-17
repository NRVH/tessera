// =============================================================================
// La letra del editor de código (Configuración › Apariencia › Editor de código): la familia y el tamaño
// que llevan el editor, los diffs y los visores de archivos de Monaco. Los editores de bases de datos no
// la usan: tienen su propio tamaño. Quien crea uno de esos editores parte de `opcionesLetraEditor()` y lo
// registra con `conLetraEditor`; al cambiar el ajuste, todos los vivos se actualizan sin reabrirlos.
// =============================================================================

import type * as monaco from 'monaco-editor'
import { resolverFamiliaLetra, resolverTamanoLetra, type AparienciaTerminal } from '../theme/aparienciaTerminal'

type OpcionesLetra = Pick<monaco.editor.IEditorOptions, 'fontFamily' | 'fontSize' | 'lineHeight'>

/** Un editor de Monaco (de código o de diff) que admite opciones nuevas y avisa al destruirse. */
interface EditorConLetra {
  updateOptions(o: OpcionesLetra): void
  onDidDispose(f: () => void): unknown
}

/** El alto de línea crece con el tamaño en la proporción de 13 px y 20 px de alto. */
export function opcionesDeLetra(a: AparienciaTerminal): OpcionesLetra {
  const tamano = resolverTamanoLetra(a)
  return { fontFamily: resolverFamiliaLetra(a), fontSize: tamano, lineHeight: Math.round((tamano * 20) / 13) }
}

let actual: OpcionesLetra = opcionesDeLetra({ familiaLetra: '', tamanoLetra: 0 })
const vivos = new Set<EditorConLetra>()

/** Las opciones de letra vigentes, para crear un editor ya con ellas. */
export function opcionesLetraEditor(): OpcionesLetra {
  return { ...actual }
}

/** Registra un editor para que siga los cambios del ajuste mientras viva. */
export function conLetraEditor<T extends EditorConLetra>(editorMonaco: T): T {
  vivos.add(editorMonaco)
  editorMonaco.onDidDispose(() => vivos.delete(editorMonaco))
  return editorMonaco
}

/** Aplica la letra del ajuste a los editores vivos y a los que se creen después. */
export function fijarLetraEditor(a: AparienciaTerminal): void {
  const nuevas = opcionesDeLetra(a)
  if (nuevas.fontFamily === actual.fontFamily && nuevas.fontSize === actual.fontSize) return
  actual = nuevas
  for (const editorMonaco of vivos) editorMonaco.updateOptions(nuevas)
}
