// =============================================================================
// Qué pasará con la contraseña (o la frase de la clave) guardada si se guarda el borrador, y con qué
// palabras se dice en su campo: el marcador «(sin cambios)», la ayuda y el aviso de una ilegible. Lo
// decide igual que el main (`conservarAlEditarSsh.ts`): otro método, otro destino o una clave nueva la
// descartan. Puro, sin React ni DOM: se fija bajo `node` (`test-borrador-ssh.mts`).
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { usaSecreto, type BorradorSsh } from './borradorSsh.ts'

/** El secreto guardado al guardar el borrador: no hay, se conserva, se sustituye, se olvida o se descarta. */
export type DestinoSecreto = 'ninguno' | 'nuevo' | 'se-conserva' | 'se-olvida' | 'se-descarta'

/** ¿Lo guardado sigue valiendo con lo que tiene el borrador? Como el main: mismo método y, si no, nada. */
function sigueValiendo(b: BorradorSsh, original: BorradorSsh): boolean {
  if (b.metodo !== original.metodo) return false
  // La frase es de SU clave: una recién elegida la descarta (C68).
  if (b.metodo === 'clave') return b.clave?.token === null || b.clave?.token === undefined
  // Una contraseña viaja al servidor: otro host, puerto o usuario la descartan.
  return b.host.trim() === original.host.trim() && Number(b.puerto.trim()) === Number(original.puerto.trim()) && b.usuario.trim() === original.usuario.trim()
}

/** Qué pasará con el secreto si se guarda ahora. */
export function destinoSecreto(b: BorradorSsh, original: BorradorSsh): DestinoSecreto {
  if (!usaSecreto(b)) return 'ninguno'
  if (b.secreto !== '') return 'nuevo'
  if (!original.tieneSecreto) return 'ninguno'
  if (b.olvidarSecreto) return 'se-olvida'
  return sigueValiendo(b, original) ? 'se-conserva' : 'se-descarta'
}

/** El marcador del campo vacío. */
export function marcadorSecreto(d: DestinoSecreto): string {
  if (d === 'se-conserva') return '(sin cambios)'
  return d === 'se-olvida' ? '(se olvidará al guardar)' : ''
}

/** La ayuda bajo el campo, según lo que pasará con lo guardado. */
export function ayudaSecreto(d: DestinoSecreto, esFrase: boolean): string {
  if (d === 'se-conserva') return 'Hay una guardada, cifrada: si la dejas vacía, se conserva.'
  if (d === 'se-olvida') return 'Se olvidará al guardar: la pedirá la terminal.'
  if (d === 'se-descarta') {
    return esFrase
      ? 'Con otra clave, la frase guardada se descarta: escribe la de esta o la pedirá la terminal.'
      : 'Con otro servidor o usuario, la guardada se descarta: escríbela otra vez o la pedirá la terminal.'
  }
  return 'Se guarda cifrada; si la dejas vacía, la pedirá la terminal.'
}

/** El aviso de un secreto guardado que este equipo no puede leer (`almacen`: `nombresSistema(…).almacenSecretos`). */
export function avisoSecretoIlegible(esFrase: boolean, almacen: string): string {
  return `${esFrase ? 'La frase guardada' : 'La contraseña guardada'} no se puede leer con ${almacen}. Vuelve a escribirla.`
}
