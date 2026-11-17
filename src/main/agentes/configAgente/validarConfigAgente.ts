// =============================================================================
// Comprueba la sintaxis de la configuración de un agente antes de guardarla y detecta las claves
// que Tessera sustituye al arrancar. Solo mira la forma: qué opciones existen lo decide cada versión
// del CLI, así que ninguna se lista aquí salvo la que Tessera pisa.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================

import { parse as parseToml, TomlError } from 'smol-toml'
import type { AgenteConConfig, AvisoConfigAgente, TipoArchivoConfig } from '../../../shared/configAgente-ipc.ts'

export interface ErrorSintaxisConfig {
  linea: number | null
  columna: number | null
  detalle: string
}

/** Línea y columna (desde 1) de un desplazamiento dentro del texto. */
function posicionDe(texto: string, desplazamiento: number): { linea: number; columna: number } {
  const antes = texto.slice(0, desplazamiento).split('\n')
  return { linea: antes.length, columna: antes[antes.length - 1].length + 1 }
}

function errorJson(contenido: string): ErrorSintaxisConfig | 'raiz-json' | null {
  try {
    const valor: unknown = JSON.parse(contenido)
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? null : 'raiz-json'
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err)
    const enPosicion = /position (\d+)/.exec(detalle)
    const pos = enPosicion ? posicionDe(contenido, Number(enPosicion[1])) : null
    return { linea: pos?.linea ?? null, columna: pos?.columna ?? null, detalle }
  }
}

function errorToml(contenido: string): ErrorSintaxisConfig | null {
  try {
    parseToml(contenido)
    return null
  } catch (err) {
    if (err instanceof TomlError) return { linea: err.line, columna: err.column, detalle: err.message.split('\n')[0] }
    return { linea: null, columna: null, detalle: err instanceof Error ? err.message : String(err) }
  }
}

/** El error de sintaxis del archivo, o null. Las instrucciones son texto libre: siempre valen. */
export function errorSintaxisConfig(agente: AgenteConConfig, tipo: TipoArchivoConfig, contenido: string): ErrorSintaxisConfig | 'raiz-json' | null {
  if (tipo === 'instrucciones') return null
  return agente === 'codex' ? errorToml(contenido) : errorJson(contenido)
}

/** Lo que conviene avisar de un archivo válido; uno con errores de sintaxis no se interpreta. */
export function avisosConfig(agente: AgenteConConfig, tipo: TipoArchivoConfig, contenido: string): AvisoConfigAgente[] {
  if (agente !== 'codex' || tipo !== 'configuracion') return []
  try {
    return 'developer_instructions' in parseToml(contenido) ? ['developer-instructions'] : []
  } catch {
    return []
  }
}
