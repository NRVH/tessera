// =============================================================================
// El contenedor de cada sesión (el de su cuenta), la reserva del login de Codex de una cuenta sin
// credencial y el refcount del montaje `/agent-config/<tipo>/<cuenta>` por (perfil, agente, cuenta).
// La apertura lo toma ANTES de tocar Docker y el cierre lo suelta; solo al llegar a 0 se desmonta.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { IdAgente } from '../../../shared/agentesManuales'
import { PERFIL_CUENTAS_GLOBALES, esCuentaGlobal, type AgentAccount } from '../../../shared/agent-accounts-ipc'
import type { Agente, Profile } from '../../profiles/types'
import type { CapaAplicable } from '../configAgente/configCompartida'
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
  // Compartido por todos los perfiles: no toma la imagen ni la red de ninguno.
  if (esCuentaGlobal(accountId)) return perfilDeCuenta({ ...profile, id: PERFIL_CUENTAS_GLOBALES, sandbox: { ...profile.sandbox, redHost: false } }, accountId)
  return perfilDeCuenta(profile, accountId === CUENTA_AGENTE_MANUAL ? `${CUENTA_AGENTE_MANUAL}:${agente}` : accountId)
}

/** ¿La sesión `s` sigue en el contenedor `destino`, que `profile` estaba usando? El de una global lo comparten los perfiles. */
export function enElMismoContenedor(s: { host: boolean; profileId: string; agente: IdAgente; accountId: string }, profile: Profile, destino: Profile): boolean {
  return !s.host && (s.profileId === profile.id || esCuentaGlobal(s.accountId)) && contenedorDe(profile, s.agente, s.accountId).id === destino.id
}

/**
 * Las capas de configuración de una sesión. La carpeta de una global es común: la capa de un perfil pisaría la de otro,
 * así que solo recibe la global, y solo si el perfil que la abre la usa.
 */
export function capasDeSesion(n: Pick<NucleoAgente, 'capasCompartidas'>, profile: Profile, agente: Agente, accountId: string): CapaAplicable[] {
  const capas = n.capasCompartidas(profile, agente)
  return esCuentaGlobal(accountId) ? capas.filter((c) => c.origen === 'global') : capas
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
    redHost: contenedorDe(profile, agente, account.id).sandbox?.redHost === true
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

/** Clave del refcount de credencial: `${profileId}/${agente}/${accountId}`. Una global se monta una vez para todos los perfiles. */
export function cfgRefKey(profileId: string, agente: IdAgente, accountId: string): string {
  return `${esCuentaGlobal(accountId) ? PERFIL_CUENTAS_GLOBALES : profileId}/${agente}/${accountId}`
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
