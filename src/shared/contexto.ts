// =============================================================================
// El contexto de los agentes: lo que reciben en cada sesión, en dos niveles. El global vale para todos los
// perfiles; el del perfil, para los suyos, y un perfil puede no usar el global. Cada nivel tiene reglas (un
// solo texto para Claude Code y Codex, en nativo y en Docker) y carpetas de documentos de referencia. Aquí,
// su forma y cómo se combinan; puro, lo importan el main y el renderer.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================

import { normalizarCarpetasDocumentos } from './documentosPerfil.ts'
import { MAX_REGLAS_PERFIL, normalizarReglas } from './reglasPerfil.ts'

/** El nivel global: reglas y documentos para los agentes de todos los perfiles que lo usan. */
export interface ContextoGlobal {
  reglas: string
  documentos: string[]
}

export const CONTEXTO_GLOBAL_VACIO: ContextoGlobal = { reglas: '', documentos: [] }

/** Lo que un perfil aporta al contexto. `contextoGlobal: false` es que no usa el global. */
export interface PerfilConContexto {
  reglas?: string
  documentos?: string[]
  contextoGlobal?: false
}

/** Lo que reciben los agentes de un perfil: cada nivel por separado, para decir de dónde sale cada parte. */
export interface ContextoEfectivo {
  usaGlobal: boolean
  reglasGlobales: string
  reglasPerfil: string
  /** Primero las del global y luego las del perfil, sin repetir. */
  documentos: string[]
}

export const usaContextoGlobal = (p: PerfilConContexto): boolean => p.contextoGlobal !== false

export function contextoEfectivo(perfil: PerfilConContexto, global: ContextoGlobal): ContextoEfectivo {
  const usaGlobal = usaContextoGlobal(perfil)
  return {
    usaGlobal,
    reglasGlobales: usaGlobal ? global.reglas : '',
    reglasPerfil: perfil.reglas ?? '',
    documentos: normalizarCarpetasDocumentos([...(usaGlobal ? global.documentos : []), ...(perfil.documentos ?? [])], Infinity)
  }
}

/** Lo que llega de fuera (disco, IPC), con su forma y sus topes; lo que no la tiene se queda vacío. */
export function leerContextoGlobal(raw: unknown): ContextoGlobal {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const reglas = typeof o.reglas === 'string' ? normalizarReglas(o.reglas) : ''
  return {
    reglas: reglas.length <= MAX_REGLAS_PERFIL ? reglas : '',
    documentos: Array.isArray(o.documentos) ? normalizarCarpetasDocumentos(o.documentos) : []
  }
}
