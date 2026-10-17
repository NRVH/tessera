// =============================================================================
// Cómo se cuenta la actividad de los agentes con `tssh` (lo que da `SSH_CHANNELS.ACTIVIDAD`): qué pidió cada
// uno, cómo acabó y cuánto tardó, en palabras del usuario, y el filtro por conexión. Los códigos de un
// rechazo son los de `CODIGOS_TSSH` (`main/ssh/controlador/puenteTssh.ts`). Puro: lo usa `DialogoActividadSsh`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

import { localeActual } from '../../../../shared/i18n.ts'
import type { SshActividad, SshUsoTssh } from '../../../../shared/ssh-ipc'
import { txSsh } from './textos.ts'

/** Qué pidió el agente. */
export function textoUso(uso: SshUsoTssh): string {
  const t = txSsh()
  switch (uso) {
    case 'run':
      return t.usoRun
    case 'cp':
      return t.usoCp
    case 'doctor':
      return t.usoDoctor
  }
}

/** Cómo acabó una petición, y si fue bien ('ok'), mal ('error') o no llegó a lanzarse ('aviso'). */
export interface ResultadoActividad {
  texto: string
  tono: 'ok' | 'error' | 'aviso'
}

/** Por qué `tssh` no la lanzó, por su código. */
function textoRechazo(codigo: number | null): string {
  const t = txSsh()
  switch (codigo) {
    case 4:
      return t.rechazo4
    case 5:
      return t.rechazo5
    case 6:
      return t.rechazo6
    case 3:
      return t.rechazo3
    default:
      return t.rechazoOtro
  }
}

/** El resultado de una petición, para su columna. Por qué falló ssh, si lo dijo: `motivoActividad`. */
export function resultadoActividad(e: SshActividad): ResultadoActividad {
  const t = txSsh()
  if (e.estado === 'rechazada') return { texto: t.noSeLanzo(textoRechazo(e.codigo)), tono: 'aviso' }
  if (e.estado === 'sinFinal') return { texto: t.sinFinal, tono: 'aviso' }
  if (e.tope) return { texto: t.cortadaPorTope, tono: 'error' }
  if (e.motivo !== undefined) return { texto: t.motivoActividad[e.motivo], tono: 'error' }
  if (e.codigo === 0) return { texto: t.correcta, tono: 'ok' }
  return { texto: e.codigo === null ? t.terminoSinCodigo : t.terminoConCodigo(e.codigo), tono: 'error' }
}

/** Lo que tardó: «0,4 s», «12 s», «3 min 5 s»; vacío si no se sabe. */
export function textoDuracion(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toLocaleString(localeActual())} s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${s % 60} s`
}

/** Para comparar sin caja, sin tildes ni espacios de más. */
function normalizar(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

/**
 * Las de las conexiones cuyo alias contiene `filtro` (todas si está vacío). Con `exacto`, solo las de ese
 * alias: la de una conexión no enseña las de otra que lo contenga («web» y «web-prod»).
 */
export function filtrarActividad(entradas: readonly SshActividad[], filtro: string, exacto = false): SshActividad[] {
  const f = normalizar(filtro)
  if (f === '') return [...entradas]
  return entradas.filter((e) => (exacto ? normalizar(e.alias) === f : normalizar(e.alias).includes(f)))
}
