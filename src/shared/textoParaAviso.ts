// =============================================================================
// Un texto del usuario listo para la línea de arranque de un agente: una sola línea, sin caracteres de
// control y sin las comillas que PowerShell no deja pasar. Lo usan los avisos de SSH y de reglas del
// perfil. Puro: sin electron ni node, importable desde el main y el renderer.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

/**
 * Comillas que no pueden ir en la línea de arranque: PowerShell toma las simples tipográficas por comillas
 * (la línea no se analiza) y 5.1 pierde las dobles o parte el argumento al pasarlo al agente (medido).
 * Se cambian por el apóstrofo recto, que la cita de PowerShell dobla; `tssh` busca el alias igual con ellas.
 */
const COMILLAS_LINEA = new RegExp(`[${[0x22, 0x60, 0xb4, 0x2018, 0x2019, 0x201a, 0x201b, 0x201c, 0x201d, 0x201e, 0x201f].map((c) => String.fromCharCode(c)).join('')}]`, 'g')

/** Los caracteres de control (C0, DEL y C1), por su código. */
const CONTROLES = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]+`, 'g')

/** Los separadores de línea y de párrafo de Unicode, por su código (escritos tal cual romperían este archivo). */
const SEPARADORES = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]+`, 'g')

/** Un texto en una sola línea: los controles, los separadores y cualquier hueco son un espacio, y sin espacios en los bordes. */
export function enUnaLinea(texto: string): string {
  return texto.replace(CONTROLES, ' ').replace(SEPARADORES, ' ').replace(/\s+/g, ' ').trim()
}

/** Un texto del usuario listo para la línea de arranque: una sola línea, sin controles y sin esas comillas. */
export function textoParaAviso(texto: string): string {
  return enUnaLinea(texto.replace(COMILLAS_LINEA, "'"))
}
