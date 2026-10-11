// =============================================================================
// Cómo se cuenta la actividad de los agentes con `tssh` (lo que da `SSH_CHANNELS.ACTIVIDAD`): qué pidió cada
// uno, cómo acabó y cuánto tardó, en palabras del usuario, y el filtro por conexión. Los códigos de un
// rechazo son los de `CODIGOS_TSSH` (`main/ssh/controlador/puenteTssh.ts`). Puro: lo usa `DialogoActividadSsh`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

import type { SshActividad, SshUsoTssh } from '../../../../shared/ssh-ipc'

/** Qué pidió el agente. */
export function textoUso(uso: SshUsoTssh): string {
  switch (uso) {
    case 'run':
      return 'Orden remota'
    case 'cp':
      return 'Copia de archivos'
    case 'doctor':
      return 'Prueba de conexión'
  }
}

/** Cómo acabó una petición, y si fue bien ('ok'), mal ('error') o no llegó a lanzarse ('aviso'). */
export interface ResultadoActividad {
  texto: string
  tono: 'ok' | 'error' | 'aviso'
}

/** Por qué `tssh` no la lanzó, por su código. */
function textoRechazo(codigo: number | null): string {
  switch (codigo) {
    case 4:
      return 'Conexión no disponible para los agentes'
    case 5:
      return 'Huella del servidor sin confirmar'
    case 6:
      return 'La conexión no se puede usar'
    case 3:
      return 'Sin comunicación con Tessera'
    default:
      return 'Petición no válida'
  }
}

/** Por qué falló ssh, si lo dijo. */
const MOTIVOS: Readonly<Record<NonNullable<SshActividad['motivo']>, string>> = {
  'ssh-autenticacion': 'El servidor rechazó las credenciales',
  'ssh-inalcanzable': 'Servidor inalcanzable',
  'ssh-huella-cambiada': 'La huella del servidor cambió',
  'ssh-algoritmos': 'Algoritmos incompatibles'
}

/** El resultado de una petición, para su columna. */
export function resultadoActividad(e: SshActividad): ResultadoActividad {
  if (e.estado === 'rechazada') return { texto: `No se lanzó: ${textoRechazo(e.codigo)}`, tono: 'aviso' }
  if (e.estado === 'sinFinal') return { texto: 'Sin final registrado (en curso o interrumpida)', tono: 'aviso' }
  if (e.tope) return { texto: 'Cortada por su tiempo máximo', tono: 'error' }
  if (e.motivo !== undefined) return { texto: MOTIVOS[e.motivo], tono: 'error' }
  if (e.codigo === 0) return { texto: 'Correcta', tono: 'ok' }
  return { texto: e.codigo === null ? 'Terminó sin código' : `Terminó con el código ${e.codigo}`, tono: 'error' }
}

/** Lo que tardó: «0,4 s», «12 s», «3 min 5 s»; vacío si no se sabe. */
export function textoDuracion(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toLocaleString('es-ES')} s`
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
