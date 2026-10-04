// =============================================================================
// atajoCopiarHash: ¿esta pulsación debe copiar el hash del commit? Separado del handler para
// probarlo con `node` a secas. Solo el modificador principal de la plataforma, sin Shift ni
// Alt (AltGr llega como Ctrl+Alt), por `key` o por `code` (distribuciones no latinas y Dvorak)
// y sin autorrepetición. La plataforma es un parámetro con la real por defecto. La guarda de
// «hay texto seleccionado» necesita el DOM y vive en `useTeclasLog`.
// Decisiones: docs/decisiones/git/log-apertura-y-teclado.md
// =============================================================================

import type { Plataforma } from '../../../../../shared/plataforma'
import { esModPrincipal } from '../../../util/atajos'

/**
 * Lo que hace falta saber de la pulsación. A propósito NO es un `KeyboardEvent`:
 * este módulo no puede depender del DOM. Un `React.KeyboardEvent` lo satisface
 * estructuralmente, así que el handler le pasa su evento tal cual.
 */
export interface TeclaAtajo {
  key: string
  /** Tecla FÍSICA (`KeyC`). Lo que salva el atajo en distribuciones no latinas. */
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  /** ¿Viene de mantener la tecla pulsada? Entonces no se copia otra vez. */
  repeat?: boolean
}

/** ¿Esta pulsación debe copiar el hash? Ver el porqué de cada guarda arriba. */
export function esAtajoCopiarHash(
  t: TeclaAtajo,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (!esModPrincipal(t, plataforma)) return false
  if (t.shiftKey || t.altKey) return false
  if (t.repeat === true) return false
  return t.key === 'c' || t.key === 'C' || t.code === 'KeyC'
}
