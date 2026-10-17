// =============================================================================
// filasArbolBdTextos — los textos de confirmación del árbol de BD al eliminar una conexión:
// la enumeración natural de nombres y lo que se pierde (contraseña, montajes, consolas,
// transacciones y ediciones sin enviar). Puro; lo reexporta `filasArbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-filas-y-carga.md
// =============================================================================

import { txFilasArbol } from './textosFilasArbol.ts'

/** Tope de nombres que se enumeran en un diálogo antes de resumir con «y N más». */
const ENUMERAR_MAX = 5

/** ««a»», ««a» y «b»», ««a», «b» y «c»»; con más de 5, «… y N más». */
export function listaNatural(nombres: readonly string[]): string {
  const t = txFilasArbol()
  const citados = nombres.slice(0, ENUMERAR_MAX).map((n) => t.citado(n))
  const resto = nombres.length - citados.length
  if (resto > 0) citados.push(resto === 1 ? t.unoMas : t.masN(resto))
  if (citados.length <= 1) return citados.join('')
  return `${citados.slice(0, -1).join(', ')} ${t.y} ${citados[citados.length - 1]}`
}

/**
 * Lo que se dice de las consolas de una conexión que se elimina (van a la papelera), o null si
 * no tiene. La comparten la conexión y la ajena: el main las borra igual.
 */
export function fraseConsolas(consolas: readonly string[]): string | null {
  const t = txFilasArbol()
  if (consolas.length === 1) return t.consolaALaPapelera(consolas[0])
  if (consolas.length > 1) return t.consolasALaPapelera(consolas.length)
  return null
}

/**
 * El mensaje de «Eliminar conexión…». Dice TODO lo que se pierde, porque es irreversible: la
 * contraseña, dónde estaba montada (`proyectos` null = no se sabe), las consolas, los cambios
 * sin confirmar que se revierten y las ediciones sin enviar, que se descartan sin otra pregunta.
 */
export function textoEliminarConexion(p: {
  alias: string
  proyectos: readonly string[] | null
  consolas: readonly string[]
  conTx: readonly string[]
  sinEnviar?: number
}): string {
  const t = txFilasArbol()
  const partes = [t.eliminarConexion(p.alias)]
  if (p.proyectos === null) partes.push(t.desmontarDeTodos)
  else if (p.proyectos.length > 0) partes.push(t.desmontarDe(listaNatural(p.proyectos)))
  const consolas = fraseConsolas(p.consolas)
  if (consolas !== null) partes.push(consolas)
  if (p.conTx.length > 0) partes.push(t.revertirSinConfirmar(listaNatural(p.conTx)))
  const n = p.sinEnviar ?? 0
  if (n === 1) partes.push(t.descartarUnCambio)
  else if (n > 1) partes.push(t.descartarCambios(n))
  return partes.join('\n\n')
}
