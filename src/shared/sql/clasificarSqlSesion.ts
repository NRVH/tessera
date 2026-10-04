// =============================================================================
// Clasificación de SET y RESET (PG y Oracle): transacción, rol, restricciones o parámetro de
// sesión, con el parámetro que fijan o restablecen. Los usa `clasificarSqlDesde.ts`.
// Decisiones: docs/decisiones/bd/sql-solo-lectura-lista-blanca.md
// =============================================================================

import { base, lectura, leerNombre, pal, type Vista } from './clasificarSqlBase.ts'
import type { Clasificacion, SesionSentencia } from './clasificarSqlTipos.ts'

function sesionOtra(): SesionSentencia {
  return { accion: 'otra', parametros: [] }
}

/** `SET TRANSACTION`, `SET CONSTRAINTS` (y `CONSTRAINT` solo en la primera posición) y `SET ROLE`. */
function setTxORol(w: string | null, aceptaConstraint: boolean): Clasificacion | null {
  if (w === 'TRANSACTION') return lectura('tx', 'SET TRANSACTION')
  if (w === 'CONSTRAINTS' || (aceptaConstraint && w === 'CONSTRAINT')) return lectura('tx', 'SET CONSTRAINTS')
  if (w === 'ROLE') return lectura('sesion', 'SET ROLE', { sesion: sesionOtra() })
  return null
}

/** El parámetro que fija `SET [SESSION|LOCAL] …` desde `k`, en minúsculas, o null. */
function parametroDeSet(v: Vista, k: number): string | null {
  const w = pal(v, k)
  if (w === 'TIME' && pal(v, k + 1) === 'ZONE') return 'timezone'
  if (w === 'SCHEMA') return 'search_path'
  if (w === 'NAMES') return 'client_encoding'
  const n = leerNombre(v, k, false)
  return n ? n.partes.join('.').toLowerCase() : null
}

export function analizarSet(v: Vista, i: number): Clasificacion {
  const w = pal(v, i + 1)
  const primero = setTxORol(w, true)
  if (primero) return primero
  if (!v.r.setDeSesion) return base('SET')
  if (w === 'SESSION' && (pal(v, i + 2) === 'AUTHORIZATION' || pal(v, i + 2) === 'CHARACTERISTICS')) {
    return lectura('sesion', 'SET SESSION ' + pal(v, i + 2), { sesion: sesionOtra() })
  }
  const k = w === 'SESSION' || w === 'LOCAL' ? i + 2 : i + 1
  const segundo = setTxORol(pal(v, k), false)
  if (segundo) return segundo
  const parametro = parametroDeSet(v, k)
  return lectura('sesion', 'SET', { sesion: parametro ? { accion: 'set', parametros: [parametro] } : sesionOtra() })
}

export function analizarReset(v: Vista, i: number): Clasificacion {
  const w = pal(v, i + 1)
  if (w === 'ALL') return lectura('sesion', 'RESET ALL', { sesion: { accion: 'resetTodo', parametros: [] } })
  if (w === 'ROLE' || w === 'SESSION') return lectura('sesion', 'RESET', { sesion: sesionOtra() })
  if (w === 'TIME' && pal(v, i + 2) === 'ZONE') {
    return lectura('sesion', 'RESET', { sesion: { accion: 'reset', parametros: ['timezone'] } })
  }
  const n = leerNombre(v, i + 1, false)
  return lectura('sesion', 'RESET', {
    sesion: n ? { accion: 'reset', parametros: [n.partes.join('.').toLowerCase()] } : sesionOtra()
  })
}
