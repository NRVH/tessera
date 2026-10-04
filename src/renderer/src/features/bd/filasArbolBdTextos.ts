// =============================================================================
// filasArbolBdTextos — los textos de confirmación del árbol de BD al eliminar una conexión:
// la enumeración natural de nombres y lo que se pierde (contraseña, montajes, consolas,
// transacciones y ediciones sin enviar). Puro; lo reexporta `filasArbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-filas-y-carga.md
// =============================================================================

/** Tope de nombres que se enumeran en un diálogo antes de resumir con «y N más». */
const ENUMERAR_MAX = 5

/** ««a»», ««a» y «b»», ««a», «b» y «c»»; con más de 5, «… y N más». */
export function listaNatural(nombres: readonly string[]): string {
  const citados = nombres.slice(0, ENUMERAR_MAX).map((n) => `«${n}»`)
  const resto = nombres.length - citados.length
  if (resto > 0) citados.push(resto === 1 ? '1 más' : `${resto} más`)
  if (citados.length <= 1) return citados.join('')
  return `${citados.slice(0, -1).join(', ')} y ${citados[citados.length - 1]}`
}

/**
 * Lo que se dice de las consolas de una conexión que se elimina (van a la papelera), o null si
 * no tiene. La comparten la conexión y la ajena: el main las borra igual.
 */
export function fraseConsolas(consolas: readonly string[]): string | null {
  if (consolas.length === 1) return `Su consola «${consolas[0]}» irá a la papelera.`
  if (consolas.length > 1) return `Sus ${consolas.length} consolas irán a la papelera.`
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
  const partes = [
    `Se eliminará «${p.alias}» y su contraseña guardada. No se puede deshacer; la base de datos no se toca.`
  ]
  if (p.proyectos === null) partes.push('Se desmontará de todos los proyectos donde la tuvieras.')
  else if (p.proyectos.length > 0) partes.push(`Se desmontará de ${listaNatural(p.proyectos)}.`)
  const consolas = fraseConsolas(p.consolas)
  if (consolas !== null) partes.push(consolas)
  if (p.conTx.length > 0) partes.push(`Se revertirán los cambios sin confirmar de ${listaNatural(p.conTx)}.`)
  const n = p.sinEnviar ?? 0
  if (n === 1) partes.push('Se descartará 1 cambio sin enviar de sus pestañas de datos.')
  else if (n > 1) partes.push(`Se descartarán ${n} cambios sin enviar de sus pestañas de datos.`)
  return partes.join('\n\n')
}
