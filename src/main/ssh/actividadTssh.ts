// =============================================================================
// La actividad de los agentes con `tssh` de un perfil, leída de las líneas de `logs/ssh.log` (las escribe
// `controlador/puenteTssh.ts`): las peticiones rechazadas, las terminadas y las que empezaron sin fin
// apuntado, la más reciente primero. Una línea que no tiene esa forma se salta. Puro.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

import type { SshActividad, SshActividadPerfil, SshUsoTssh } from '../../shared/ssh-ipc.ts'
import type { TerminalExitReason } from '../../shared/terminal-ipc.ts'

/** Cuántas se devuelven como mucho. */
export const MAX_ACTIVIDAD = 500

const LINEA = /^\[([^\]]+)\] perfil=(\S+) sub=(run|cp|doctor) alias=("(?:[^"\\]|\\.)*") (.*)$/
const RECHAZADA = /^codigo=(-?\d+) rechazada$/
const TERMINADA = /^codigo=(-?\d+|-) ms=(\d+|-)( tope)?(?: motivo=(\S+))?$/
const MOTIVOS: readonly TerminalExitReason[] = ['ssh-huella-cambiada', 'ssh-autenticacion', 'ssh-inalcanzable', 'ssh-algoritmos']

const numero = (t: string): number | null => (t === '-' ? null : Number(t))

function aliasDe(citado: string): string | null {
  try {
    const a: unknown = JSON.parse(citado)
    return typeof a === 'string' ? a : null
  } catch {
    return null
  }
}

/** Una línea del registro, si es de ese perfil: el inicio de una petición, o cómo acabó. */
export function entradaDeLinea(linea: string, profileId: string): SshActividad | null {
  const m = LINEA.exec(linea.trimEnd())
  if (m === null || m[2] !== profileId) return null
  const alias = aliasDe(m[4])
  if (alias === null) return null
  const base = { fecha: m[1], uso: m[3] as SshUsoTssh, alias }
  if (m[5] === 'inicio') return { ...base, estado: 'sinFinal', codigo: null, ms: null, tope: false }
  const r = RECHAZADA.exec(m[5])
  if (r !== null) return { ...base, estado: 'rechazada', codigo: Number(r[1]), ms: null, tope: false }
  const t = TERMINADA.exec(m[5])
  if (t === null) return null
  const motivo = MOTIVOS.find((x) => x === t[4])
  return { ...base, estado: 'terminada', codigo: numero(t[1]), ms: numero(t[2]), tope: t[3] !== undefined, ...(motivo ? { motivo } : {}) }
}

/**
 * La actividad de un perfil en el texto del registro (el `.old` delante), la más reciente primero. Cada fin
 * se lleva el inicio más antiguo pendiente de su mismo uso y alias; el inicio que se queda sin fin (sigue en
 * curso, o el agente o Tessera murieron antes de apuntarlo) se enseña como tal: es la línea que escribe el
 * main por su cuenta, y esconderla dejaría fuera justo lo interrumpido.
 */
export function actividadDe(texto: string, profileId: string, max = MAX_ACTIVIDAD): SshActividadPerfil {
  const todas: Array<SshActividad | null> = []
  const pendientes = new Map<string, number[]>()
  for (const linea of texto.split('\n')) {
    const e = entradaDeLinea(linea, profileId)
    if (e === null) continue
    const clave = JSON.stringify([e.uso, e.alias])
    if (e.estado === 'sinFinal') {
      pendientes.set(clave, [...(pendientes.get(clave) ?? []), todas.length])
    } else if (e.estado === 'terminada') {
      const inicio = pendientes.get(clave)?.shift()
      if (inicio !== undefined) todas[inicio] = null
    }
    todas.push(e)
  }
  const vistas = todas.filter((e): e is SshActividad => e !== null).reverse()
  return { entradas: vistas.slice(0, max), mas: vistas.length > max }
}
