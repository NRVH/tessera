// =============================================================================
// Los tres modos de un archivo previsualizable (hoy Markdown, HTML y Mermaid): 'codigo' (solo
// el editor), 'dividida' (editor y vista) y 'vista' (solo la vista). Un control de tres
// posiciones en la cabecera: el archivo sigue siendo UNA pestaña con su `paneKey`.
// El Markdown se abre renderizado; los demás formatos en código. Puro: lo carga `node` a secas.
// =============================================================================

// Con extensión explícita: lo importa un `test-*.mts` que corre con `node` a secas.
import { extensionDe } from '../../util/extensionArchivo.ts'

/** Los tres modos, en el orden en que se pintan en el control segmentado. */
export type ModoVista = 'codigo' | 'dividida' | 'vista'

/** Orden del control. Exportado para que la UI y el test lean la MISMA lista. */
export const MODOS_VISTA: readonly ModoVista[] = ['codigo', 'dividida', 'vista']

/** Modo con el que se abre un archivo: el Markdown renderizado, todo lo demás en código. */
export function modoInicialPara(path: string): ModoVista {
  return vistaPreviaDe(path) === 'markdown' ? 'vista' : 'codigo'
}

/** Qué se puede previsualizar de un archivo; añadir un formato es añadir una entrada y su render. */
export type ClaseVistaPrevia = 'markdown' | 'mermaid' | 'html'

/** La clase de previsualización de una ruta, o null si no tiene. */
export function vistaPreviaDe(path: string): ClaseVistaPrevia | null {
  const ext = extensionDe(path)
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  // Un .mmd es un diagrama entero; los de un .md los detecta el render del markdown.
  if (ext === 'mmd' || ext === 'mermaid') return 'mermaid'
  // El .html se pinta en un iframe con sandbox, nunca en el DOM del renderer. `.xhtml` y las
  // plantillas de motor quedan fuera: un navegador no las pinta tal cual.
  if (ext === 'html' || ext === 'htm') return 'html'
  return null
}

/** true si el modo enseña la vista renderizada (sola o al lado del código). */
export function muestraVista(modo: ModoVista): boolean {
  return modo === 'vista' || modo === 'dividida'
}

/** true si el modo enseña el editor (solo o al lado de la vista). */
export function muestraCodigo(modo: ModoVista): boolean {
  return modo === 'codigo' || modo === 'dividida'
}

/** Un modo que no aplica al archivo se degrada a 'codigo' (un pane keep-alive puede cambiar de ruta). */
export function modoAplicable(modo: ModoVista, path: string): ModoVista {
  return vistaPreviaDe(path) === null ? 'codigo' : modo
}
