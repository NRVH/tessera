// =============================================================================
// Qué pide cada tecla en la lista del explorador SFTP, en lógica pura y con la plataforma como
// PARÁMETRO: flechas, Inicio/Fin, Intro, Retroceso (subir un nivel), Supr y ⌘⌫ (borrar), F2
// (renombrar), F5, Mod+A, y el gesto de subir de nivel de cada sistema (⌘↑ en Mac, Alt+↑ en el
// resto). El Retroceso pelado sube de nivel y NO borra, aunque `esAtajoBorrado` lo acepte.
// Sin React ni DOM; se fija bajo `node` (`test-sftp.mts`). Depende de `util/atajos`.
// =============================================================================

import type { Plataforma } from '../../../../shared/plataforma.ts'
import { esAtajoBorrado, esModPrincipal } from '../../util/atajos.ts'
import type { Movimiento } from './seleccionSftp.ts'

/** Lo que hace falta de un evento de teclado. */
export interface TeclaSftp {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

export type AccionTeclaSftp =
  | { tipo: 'mover'; mov: Movimiento; extender: boolean }
  | { tipo: 'abrir' }
  | { tipo: 'subirNivel' }
  | { tipo: 'borrar' }
  | { tipo: 'renombrar' }
  | { tipo: 'actualizar' }
  | { tipo: 'seleccionarTodo' }

function sinModificadores(e: TeclaSftp): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
}

/** ¿Es el gesto de «subir de carpeta» de cada sistema? ⌘↑ en Mac, Alt+↑ en el resto. */
function esSubirNivelNativo(e: TeclaSftp, plataforma: Plataforma): boolean {
  if (e.key !== 'ArrowUp' || e.shiftKey) return false
  if (plataforma === 'mac') return esModPrincipal(e, plataforma) && !e.altKey
  return e.altKey && !e.ctrlKey && !e.metaKey
}

/** Qué pide esta tecla, o `null` si no es de la lista. */
export function accionTecla(e: TeclaSftp, plataforma: Plataforma): AccionTeclaSftp | null {
  if (esSubirNivelNativo(e, plataforma)) return { tipo: 'subirNivel' }
  if (e.key === 'Backspace' && sinModificadores(e)) return { tipo: 'subirNivel' }
  if (esAtajoBorrado(e, plataforma)) return { tipo: 'borrar' }
  if (e.key === 'a' && esModPrincipal(e, plataforma) && !e.altKey && !e.shiftKey) return { tipo: 'seleccionarTodo' }
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  switch (e.key) {
    case 'ArrowDown':
      return { tipo: 'mover', mov: 1, extender: e.shiftKey }
    case 'ArrowUp':
      return { tipo: 'mover', mov: -1, extender: e.shiftKey }
    case 'Home':
      return { tipo: 'mover', mov: 'inicio', extender: e.shiftKey }
    case 'End':
      return { tipo: 'mover', mov: 'fin', extender: e.shiftKey }
    case 'Enter':
      return e.shiftKey ? null : { tipo: 'abrir' }
    case 'F2':
      return e.shiftKey ? null : { tipo: 'renombrar' }
    case 'F5':
      return e.shiftKey ? null : { tipo: 'actualizar' }
    default:
      return null
  }
}
