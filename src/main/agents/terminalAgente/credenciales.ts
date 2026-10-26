// =============================================================================
// El contenedor de cada sesión (el de su cuenta), la reserva del login de Codex de una cuenta sin
// credencial y el refcount del montaje `/agent-config/<tipo>/<cuenta>` por (perfil, agente, cuenta).
// La apertura lo toma ANTES de tocar Docker y el cierre lo suelta; solo al llegar a 0 se desmonta.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { IdAgente } from '../../../shared/agentesManuales'
import type { AgentAccount } from '../../../shared/agent-accounts-ipc'
import type { Profile } from '../../profiles/types'
import { containerNameFor, perfilDeCuenta } from '../../sandbox/SandboxManager'
import type { DatosLogin, ReservaLogin } from '../loginCodex'
import { txAgentes } from '../textos'
import { clasificarErrorArranque } from '../../../shared/dockerErrors'
import { SANDBOX_RED_CHANNELS, type AvisoRed } from '../../../shared/sandbox-red-ipc'
import { CUENTA_AGENTE_MANUAL, errMsg, type NucleoAgente } from './tipos'

/**
 * El contenedor donde corre una sesión del agente en modo Docker: el de su CUENTA, para que ninguna
 * vea las credenciales de otra. La predeterminada de un agente manual tiene el mismo id en todos
 * (`CUENTA_AGENTE_MANUAL`): su contenedor se distingue por el agente.
 */
export function contenedorDe(profile: Profile, agente: IdAgente, accountId: string): Profile {
  return perfilDeCuenta(profile, accountId === CUENTA_AGENTE_MANUAL ? `${CUENTA_AGENTE_MANUAL}:${agente}` : accountId)
}

/**
 * Toma el login por navegador de Codex si la cuenta aún no tiene credencial (su línea de arranque
 * lo empezará); null si no hace falta. Lanza si otra sesión tiene uno pendiente.
 */
export function reservarLoginCodex(
  n: NucleoAgente,
  profile: Profile,
  agente: IdAgente,
  account: AgentAccount,
  sessionId?: string
): ReservaLogin | null {
  if (agente !== 'codex') return null
  const datos = datosLoginCodex(n, profile, agente, account)
  if (existsSync(datos.credencial)) return null
  return n.loginCodex.reservar(datos, sessionId)
}

function datosLoginCodex(n: NucleoAgente, profile: Profile, agente: IdAgente, account: AgentAccount): DatosLogin {
  return {
    contenedor: containerNameFor(contenedorDe(profile, agente, account.id)),
    profileId: profile.id,
    cuenta: account.isDefault ? txAgentes().loginCodex.predeterminada : account.nombre,
    perfil: profile.nombre,
    credencial: path.join(n.accounts.hostDirFor(account), 'auth.json'),
    redHost: profile.sandbox?.redHost === true
  }
}

/**
 * Codex de una sesión en contenedor empezó un login por navegador (lo dice su salida): con la sesión
 * caducada lo empieza él, sin pasar por la apertura. Se le abre el puente; si otro login lo tiene, se
 * avisa, porque Codex ya está esperando y no se le puede rechazar.
 */
export function alVerLoginCodex(n: NucleoAgente, sessionId: string): void {
  const open = n.sessions.get(sessionId)
  const profile = open ? n.profiles.get(open.profileId) : undefined
  const account = open ? n.accounts.get(open.accountId) : undefined
  if (!open || open.host || !profile || !account) return
  try {
    n.loginCodex.reservar(datosLoginCodex(n, profile, open.agente, account), sessionId)
  } catch (err) {
    const aviso = clasificarErrorArranque(errMsg(err), '')
    const payload: AvisoRed = { profileId: profile.id, motivo: 'choque-1455', titulo: aviso.titulo, detalle: aviso.sugerencia ?? '' }
    n.eventos.emitir(SANDBOX_RED_CHANNELS.AVISO, payload)
  }
}

/** Clave del refcount de credencial: `${profileId}/${agente}/${accountId}`. */
export function cfgRefKey(profileId: string, agente: IdAgente, accountId: string): string {
  return `${profileId}/${agente}/${accountId}`
}

/** +1 al refcount de una credencial. */
export function acquireConfigRef(refs: Map<string, number>, key: string): void {
  refs.set(key, (refs.get(key) ?? 0) + 1)
}

/** −1 al refcount; true si llegó a 0 y hay que desmontar la credencial. */
export function releaseConfigRef(refs: Map<string, number>, key: string): boolean {
  const n = (refs.get(key) ?? 0) - 1
  if (n <= 0) {
    refs.delete(key)
    return true
  }
  refs.set(key, n)
  return false
}
