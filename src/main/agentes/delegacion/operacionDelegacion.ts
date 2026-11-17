// =============================================================================
// `tctx cuentas`, `modelos`, `delegar`, `tarea` y `tareas`: las operaciones del puente, con el token de SESIÓN. El perfil, el
// proyecto y quién pregunta salen siempre de la sesión del token, nunca de la petición. Solo delega una sesión
// nativa (un agente nativo vivo del perfil o la terminal, que es el usuario): un agente en Docker no, y por eso
// el buzón nunca llega a delegar. Una orden de archivo se lee aquí, solo si está dentro del proyecto.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, posix, win32 } from 'node:path'
import {
  AGENTES_DELEGABLES,
  ESFUERZO_VALIDO,
  MAX_ORDEN_ARCHIVO_BYTES,
  MAX_ORDEN_BYTES,
  MODELO_VALIDO,
  OP_CUENTAS,
  OP_DELEGAR,
  OP_MODELOS,
  OP_TAREA,
  OP_TAREAS,
  type AgenteDelegable
} from '../../../shared/delegacion-ipc.ts'
import { idDeClaveSesionAgente } from '../../../shared/db-ipc.ts'
import { esWindows } from '../../../shared/plataforma.ts'
import type { RespuestaOperacion, SesionDelPuente } from '../../db/puenteBd.ts'
import type { AjustesModelo, OrigenDelegacion, ServicioDelegacion } from './ServicioDelegacion.ts'

export { OP_CUENTAS, OP_DELEGAR, OP_MODELOS, OP_TAREA, OP_TAREAS }

/** Lo que necesita, ya con las sesiones compuestas. */
export interface DependenciasOperacionDelegacion {
  servicio: Pick<ServicioDelegacion, 'cuentas' | 'delegar' | 'ver' | 'cancelar' | 'continuar' | 'listar' | 'modelos'>
  /** La sesión de agente viva con ese id (sin el prefijo `agent:`), o null. */
  sesionAgente: (sesionId: string) => { profileId: string; host: boolean } | null
}

const ID_TAREA = /^[0-9a-f]{8}$/
const rechazo = (r: string, datos: Record<string, unknown> = {}): RespuestaOperacion => ({ ok: false, rechazo: r, ...datos })

/** Quién delega, o el rechazo: solo una sesión nativa viva del perfil del token, con proyecto. */
export function origenDe(s: SesionDelPuente, sesionAgente: DependenciasOperacionDelegacion['sesionAgente']): OrigenDelegacion | RespuestaOperacion {
  if (!s.sesion) return rechazo('sin-sesion')
  const idAgente = idDeClaveSesionAgente(s.sesion)
  if (idAgente !== null) {
    const viva = sesionAgente(idAgente)
    if (!viva || viva.profileId !== s.profileId) return rechazo('sin-sesion')
    if (!viva.host) return rechazo('delegar-desde-docker')
  }
  if (!s.projectHostPath) return rechazo('delegar-sin-proyecto')
  return { perfilId: s.profileId, rutaHostProyecto: s.projectHostPath, clave: s.sesion }
}

/**
 * ¿Está `ruta` dentro de `base`? Las dos ya resueltas; en Windows sin distinguir mayúsculas, como el sistema.
 * Las rutas se parten con las reglas de la plataforma del parámetro, no con las del equipo que lo corre.
 */
export function dentroDe(base: string, ruta: string, enWindows = esWindows()): boolean {
  const p = enWindows ? win32 : posix
  const rel = enWindows ? p.relative(base.toLowerCase(), ruta.toLowerCase()) : p.relative(base, ruta)
  return rel === '' ? false : !rel.startsWith('..') && !p.isAbsolute(rel)
}

/** La orden de la petición: el texto, o el de un archivo dentro del proyecto. */
export async function ordenDe(p: Readonly<Record<string, unknown>>, proyecto: string): Promise<{ orden: string } | { rechazo: RespuestaOperacion }> {
  if (p.orden !== undefined && p.archivo !== undefined) return { rechazo: rechazo('peticion') }
  if (typeof p.archivo === 'string') return ordenDeArchivo(p.archivo, proyecto)
  if (typeof p.orden !== 'string') return { rechazo: rechazo('peticion') }
  if (p.orden.trim() === '') return { rechazo: rechazo('orden-vacia') }
  if (Buffer.byteLength(p.orden, 'utf8') > MAX_ORDEN_BYTES) return { rechazo: rechazo('orden-larga', { max: MAX_ORDEN_BYTES }) }
  return { orden: p.orden }
}

async function ordenDeArchivo(archivo: string, proyecto: string): Promise<{ orden: string } | { rechazo: RespuestaOperacion }> {
  if (!isAbsolute(archivo)) return { rechazo: rechazo('peticion') }
  let real: string
  let base: string
  try {
    base = await realpath(proyecto)
    real = await realpath(archivo)
  } catch {
    return { rechazo: rechazo('archivo-no-existe') }
  }
  // Con el destino de los enlaces ya resuelto: un enlace del proyecto que apunta fuera tampoco vale.
  if (!dentroDe(base, real)) return { rechazo: rechazo('archivo-fuera') }
  const info = await stat(real).catch(() => null)
  if (!info?.isFile()) return { rechazo: rechazo('archivo-no-existe') }
  if (info.size > MAX_ORDEN_ARCHIVO_BYTES) return { rechazo: rechazo('orden-larga', { max: MAX_ORDEN_ARCHIVO_BYTES }) }
  const orden = await readFile(real, 'utf8')
  return orden.trim() === '' ? { rechazo: rechazo('orden-vacia') } : { orden }
}

/** El modelo y el esfuerzo de la petición: terminan en una línea de arranque, así que solo pasa lo que tiene forma de nombre. */
export function ajustesDe(p: Readonly<Record<string, unknown>>): AjustesModelo | { rechazo: RespuestaOperacion } {
  if (p.modelo !== undefined && (typeof p.modelo !== 'string' || !MODELO_VALIDO.test(p.modelo))) return { rechazo: rechazo('modelo-invalido') }
  if (p.esfuerzo !== undefined && (typeof p.esfuerzo !== 'string' || !ESFUERZO_VALIDO.test(p.esfuerzo))) return { rechazo: rechazo('esfuerzo-invalido') }
  return { ...(p.modelo !== undefined ? { modelo: p.modelo as string } : {}), ...(p.esfuerzo !== undefined ? { esfuerzo: p.esfuerzo as string } : {}) }
}

export class OperacionDelegacion {
  private d: DependenciasOperacionDelegacion | null = null

  conectar(d: DependenciasOperacionDelegacion): void {
    this.d = d
  }

  async atender(op: string, p: Readonly<Record<string, unknown>>, s: SesionDelPuente): Promise<RespuestaOperacion> {
    const d = this.d
    if (!d) return { ok: false, error: 'error interno' }
    const origen = origenDe(s, d.sesionAgente)
    if ('ok' in origen) return origen
    if (op === OP_CUENTAS) return { ok: true, cuentas: await d.servicio.cuentas(origen.perfilId) }
    if (op === OP_TAREAS) return { ok: true, tareas: d.servicio.listar(origen) }
    if (op === OP_MODELOS) return this.modelos(d, origen, p)
    if (op === OP_DELEGAR) return this.delegar(d, origen, p)
    if (op === OP_TAREA) return this.tarea(d, origen, p)
    return { ok: false, error: 'operacion desconocida' }
  }

  private async modelos(d: DependenciasOperacionDelegacion, origen: OrigenDelegacion, p: Readonly<Record<string, unknown>>): Promise<RespuestaOperacion> {
    if (typeof p.agente !== 'string' || !(AGENTES_DELEGABLES as readonly string[]).includes(p.agente)) return rechazo('agente-no-delegable')
    if (p.cuenta !== undefined && typeof p.cuenta !== 'string') return rechazo('peticion')
    if (p.actualizar !== undefined && typeof p.actualizar !== 'boolean') return rechazo('peticion')
    const r = await d.servicio.modelos(origen, p.agente as AgenteDelegable, typeof p.cuenta === 'string' && p.cuenta.trim() !== '' ? p.cuenta : 'auto', p.actualizar === true)
    return r.ok ? r : { ...r, agente: p.agente }
  }

  private async delegar(d: DependenciasOperacionDelegacion, origen: OrigenDelegacion, p: Readonly<Record<string, unknown>>): Promise<RespuestaOperacion> {
    if (typeof p.agente !== 'string' || !(AGENTES_DELEGABLES as readonly string[]).includes(p.agente)) return rechazo('agente-no-delegable')
    if (p.cuenta !== undefined && typeof p.cuenta !== 'string') return rechazo('peticion')
    if (p.soloLectura !== undefined && typeof p.soloLectura !== 'boolean') return rechazo('peticion')
    const ajustes = ajustesDe(p)
    if ('rechazo' in ajustes) return ajustes.rechazo
    const o = await ordenDe(p, origen.rutaHostProyecto)
    if ('rechazo' in o) return o.rechazo
    const r = await d.servicio.delegar(origen, {
      agente: p.agente as AgenteDelegable,
      cuenta: typeof p.cuenta === 'string' && p.cuenta.trim() !== '' ? p.cuenta : 'auto',
      soloLectura: p.soloLectura === true,
      orden: o.orden,
      ...ajustes
    })
    if (r.ok) return { ok: true, tarea: r.tarea, escribiendo: r.escribiendo }
    return { ...r, agente: p.agente }
  }

  private async tarea(d: DependenciasOperacionDelegacion, origen: OrigenDelegacion, p: Readonly<Record<string, unknown>>): Promise<RespuestaOperacion> {
    if (typeof p.id !== 'string' || !ID_TAREA.test(p.id)) return rechazo('tarea-no-existe')
    if (p.accion === 'cancelar') {
      if (!(await d.servicio.cancelar(origen, p.id))) return rechazo('tarea-no-existe')
    } else if (p.accion === 'continuar') {
      const ajustes = ajustesDe(p)
      if ('rechazo' in ajustes) return ajustes.rechazo
      const o = await ordenDe(p, origen.rutaHostProyecto)
      if ('rechazo' in o) return o.rechazo
      const r = await d.servicio.continuar(origen, p.id, o.orden, ajustes)
      if (r === 'no-existe') return rechazo('tarea-no-existe')
      if (r === 'sin-conversacion') return rechazo('tarea-sin-conversacion')
      if (r === 'sigue-cerrandose') return rechazo('tarea-cerrandose')
      if ('rechazo' in r) return r
    } else if (p.accion !== undefined) return rechazo('peticion')
    const vista = d.servicio.ver(origen, p.id)
    return vista ? { ok: true, tarea: vista } : rechazo('tarea-no-existe')
  }
}
