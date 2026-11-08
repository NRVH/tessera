// =============================================================================
// Las reglas de un perfil (`Profile.reglas`): el tope de caracteres y su aviso previo, su normalización al guardar y su
// aplanado para la línea de arranque de los agentes. Puro: sin electron ni node, lo importan el main y el
// renderer.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import { textoParaAviso } from './textoParaAviso.ts'

/** Cuántos caracteres puede tener el texto de las reglas: con el resto del aviso tiene que caber en la línea de arranque. */
export const MAX_REGLAS_PERFIL = 6000

/**
 * A partir de cuánto se avisa, antes del tope, de que las reglas ocupan contexto en cada sesión y de que lo que solo
 * se consulta a veces va mejor en Documentos: al 80 %, cuando aún hay margen para reorganizarlas.
 */
export const UMBRAL_AVISO_REGLAS = Math.round(MAX_REGLAS_PERFIL * 0.8)

/** Si unas reglas (ya normalizadas) están cerca del tope sin pasarlo. */
export const reglasCercaDelTope = (largo: number): boolean => largo > UMBRAL_AVISO_REGLAS && largo <= MAX_REGLAS_PERFIL

/** Cuántos caracteres puede tener el motivo de una propuesta de un agente (`tctx proponer --motivo`). */
export const MAX_MOTIVO_PROPUESTA = 500

/** Marca de salto de línea en el aviso: la línea de arranque va en una sola línea. */
export const MARCA_SALTO = ' ¶ '

/** Controles que sobran en un texto escrito a mano: todos menos el salto de línea y el tabulador. */
const CONTROLES_SOBRANTES = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(0xb)}${String.fromCharCode(0xc)}${String.fromCharCode(0xe)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]`,
  'g'
)

/**
 * El texto listo para guardar: saltos `\n`, sin controles, el tabulador como espacio, sin espacios al final
 * de cada línea y sin líneas en blanco al principio ni al final.
 */
export function normalizarReglas(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(CONTROLES_SOBRANTES, '')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((l) => l.replace(/ +$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

/**
 * Las reglas en una sola línea para el aviso de arranque: cada salto de línea es `MARCA_SALTO`, varios
 * seguidos valen uno, y cada línea pasa por el saneado de los textos del usuario (comillas, controles).
 */
export function reglasParaAviso(reglas: string): string {
  return reglas
    .split(/\r\n|\r|\n/)
    .map(textoParaAviso)
    .filter((l) => l !== '')
    .join(MARCA_SALTO)
}
