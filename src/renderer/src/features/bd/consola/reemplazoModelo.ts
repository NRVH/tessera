// =============================================================================
// Sustituye el texto entero de un modelo de Monaco conservando el deshacer: es la recarga
// desde el disco de las tres consolas (SQL, documentos y claves). Puro (solo tipos de
// monaco-editor) para probarlo bajo `node` con el modelo de texto real.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import type { editor } from 'monaco-editor'

/**
 * Sustituye el texto entero CONSERVANDO EL DESHACER (Ctrl+Z vuelve a lo que había): `setValue`
 * vaciaría la pila y tu versión se perdería con un clic en «Cargar la del disco». Las dos paradas
 * aíslan la recarga: sin la primera se funde con la última racha de tecleo, que nunca llegó al
 * disco, y Ctrl+Z desharía las dos. Si el texto es el mismo no toca nada.
 */
export function reemplazarConservandoDeshacer(modelo: editor.ITextModel, texto: string): void {
  if (modelo.getValue() === texto) return
  modelo.pushStackElement()
  modelo.pushEditOperations([], [{ range: modelo.getFullModelRange(), text: texto }], () => null)
  modelo.pushStackElement()
}
