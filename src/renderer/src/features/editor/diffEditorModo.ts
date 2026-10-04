// =============================================================================
// Aplicación del modo del visor de diff (lado a lado / unificado) sobre el editor.
// Un único punto traduce {máquina del ancho, ¿un solo lado?} a opciones de Monaco y
// modo efectivo; lo llaman el ResizeObserver, el cambio de target y el toggle.
// La máquina de estados vive en modoDiff; aquí solo se aplica.
// =============================================================================
import type { editor } from 'monaco-editor'
import {
  UMBRAL_LADO_A_LADO,
  alForzar,
  modoAutomatico,
  opcionesDeModo,
  type ModoDiff
} from './modoDiff'
import type { InstanciaDiff } from './diffEditorInstancia'

/** Aplica `modo` (o unificado si el diff es de un solo lado) y publica el modo efectivo. */
export function aplicarModo(
  inst: InstanciaDiff,
  ed: editor.IStandaloneDiffEditor,
  modo: ModoDiff,
  ancho: number
): void {
  // La máquina del ancho sigue corriendo aunque el diff sea de un solo lado: solo se
  // intercepta la traducción.
  const efectivo: ModoDiff = inst.unLado ? 'unificado' : modo
  ed.updateOptions(opcionesDeModo(efectivo, ancho > 0 ? ancho : UMBRAL_LADO_A_LADO + 1))
  inst.set.setModoEfectivo(efectivo)
}

/** El usuario pulsó un segmento del toggle: se aplica en caliente, sin recrear el editor. */
export function forzarModo(inst: InstanciaDiff, modo: ModoDiff): void {
  const ed = inst.diffEditorRef.current
  if (!ed) return
  const t = alForzar(inst.ancho, modo)
  inst.estadoModo = t.estado
  aplicarModo(inst, ed, t.modo, inst.ancho)
}

/** Al cambiar de target, devuelve el toggle al modo que dicte el ancho ya medido. */
export function reponerModo(inst: InstanciaDiff): void {
  // Con ancho 0 (pane recién montado, sin medir) `modoAutomatico` forzaría una sola
  // columna hasta que el ResizeObserver lo deshiciera; al medir dispara solo.
  const ed = inst.diffEditorRef.current
  if (ed && inst.ancho > 0) {
    aplicarModo(inst, ed, inst.estadoModo.forzado ?? modoAutomatico(inst.ancho), inst.ancho)
  }
}
