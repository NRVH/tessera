// =============================================================================
// El contenedor de cada sesión (el de su cuenta), la reserva del login de Codex de una cuenta sin
// credencial y el refcount del montaje `/agent-config/<tipo>/<cuenta>` por (perfil, agente, cuenta).
// La apertura lo toma ANTES de tocar Docker y el cierre lo suelta; solo al llegar a 0 se desmonta.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { IdAgente } from '../../../shared/agentesManuales'
import { PERFIL_CUENTAS_GLOBALES, esCuentaGlobal, type CuentaAgente } from '../../../shared/agent-accounts-ipc'
import type { Agente, Perfil } from '../../perfiles/types'
import type { CapaAplicable } from '../configAgente/configCompartida'
import { nombreContenedorPara, perfilDeCuenta } from '../../sandbox/GestorSandbox'
import type { DatosLogin, ReservaLogin } from '../loginCodex'
import { txAgentes } from '../textos'
import { clasificarErrorArranque } from '../../../shared/erroresDocker'
import { SANDBOX_RED_CHANNELS, type AvisoRed } from '../../../shared/sandbox-red-ipc'
import { CUENTA_AGENTE_MANUAL, errMsg, type NucleoAgente } from './tipos'

/**
 * El contenedor donde corre una sesión del agente en modo Docker: el de su CUENTA, para que ninguna
 * vea las credenciales de otra. La predeterminada de un agente manual tiene el mismo id en todos
 * (`CUENTA_AGENTE_MANUAL`): su contenedor se distingue por el agente.
 */
export function contenedorDe(perfil: Perfil, agente: IdAgente, cuentaId: string): Perfil {
  // Compartido por todos los perfiles: no toma la imagen ni la red de ninguno.
  if (esCuentaGlobal(cuentaId)) return perfilDeCuenta({ ...perfil, id: PERFIL_CUENTAS_GLOBALES, sandbox: { ...perfil.sandbox, redHost: false } }, cuentaId)
  return perfilDeCuenta(perfil, cuentaId === CUENTA_AGENTE_MANUAL ? `${CUENTA_AGENTE_MANUAL}:${agente}` : cuentaId)
}

/** ¿La sesión `s` sigue en el contenedor `destino`, que `profile` estaba usando? El de una global lo comparten los perfiles. */
export function enElMismoContenedor(s: { host: boolean; perfilId: string; agente: IdAgente; cuentaId: string }, perfil: Perfil, destino: Perfil): boolean {
  return !s.host && (s.perfilId === perfil.id || esCuentaGlobal(s.cuentaId)) && contenedorDe(perfil, s.agente, s.cuentaId).id === destino.id
}

/**
 * Las capas de configuración de una sesión. La carpeta de una global es común: la capa de un perfil pisaría la de otro,
 * así que solo recibe la global, y solo si el perfil que la abre la usa.
 */
export function capasDeSesion(n: Pick<NucleoAgente, 'capasCompartidas'>, perfil: Perfil, agente: Agente, cuentaId: string): CapaAplicable[] {
  const capas = n.capasCompartidas(perfil, agente)
  return esCuentaGlobal(cuentaId) ? capas.filter((c) => c.origen === 'global') : capas
}

/**
 * Toma el login por navegador de Codex si la cuenta aún no tiene credencial (su línea de arranque
 * lo empezará); null si no hace falta. Lanza si otra sesión tiene uno pendiente.
 */
export function reservarLoginCodex(
  n: NucleoAgente,
  perfil: Perfil,
  agente: IdAgente,
  cuenta: CuentaAgente,
  sesionId?: string
): ReservaLogin | null {
  if (agente !== 'codex') return null
  const datos = datosLoginCodex(n, perfil, agente, cuenta)
  if (existsSync(datos.credencial)) return null
  return n.loginCodex.reservar(datos, sesionId)
}

function datosLoginCodex(n: NucleoAgente, perfil: Perfil, agente: IdAgente, cuenta: CuentaAgente): DatosLogin {
  return {
    contenedor: nombreContenedorPara(contenedorDe(perfil, agente, cuenta.id)),
    perfilId: perfil.id,
    cuenta: cuenta.isDefault ? txAgentes().loginCodex.predeterminada : cuenta.nombre,
    perfil: perfil.nombre,
    credencial: path.join(n.cuentas.dirHostDe(cuenta), 'auth.json'),
    redHost: contenedorDe(perfil, agente, cuenta.id).sandbox?.redHost === true
  }
}

/**
 * Codex de una sesión en contenedor empezó un login por navegador (lo dice su salida): con la sesión
 * caducada lo empieza él, sin pasar por la apertura. Se le abre el puente; si otro login lo tiene, se
 * avisa, porque Codex ya está esperando y no se le puede rechazar.
 */
export function alVerLoginCodex(n: NucleoAgente, sesionId: string): void {
  const sesionAbierta = n.sesiones.get(sesionId)
  const perfil = sesionAbierta ? n.perfiles.get(sesionAbierta.perfilId) : undefined
  const cuenta = sesionAbierta ? n.cuentas.obtener(sesionAbierta.cuentaId) : undefined
  if (!sesionAbierta || sesionAbierta.host || !perfil || !cuenta) return
  try {
    n.loginCodex.reservar(datosLoginCodex(n, perfil, sesionAbierta.agente, cuenta), sesionId)
  } catch (err) {
    const aviso = clasificarErrorArranque(errMsg(err), '')
    const mensaje: AvisoRed = { perfilId: perfil.id, motivo: 'choque-1455', titulo: aviso.titulo, detalle: aviso.sugerencia ?? '' }
    n.eventos.emitir(SANDBOX_RED_CHANNELS.AVISO, mensaje)
  }
}

/** Clave del refcount de credencial: `${profileId}/${agente}/${accountId}`. Una global se monta una vez para todos los perfiles. */
export function claveRefConfig(perfilId: string, agente: IdAgente, cuentaId: string): string {
  return `${esCuentaGlobal(cuentaId) ? PERFIL_CUENTAS_GLOBALES : perfilId}/${agente}/${cuentaId}`
}

/** +1 al refcount de una credencial. */
export function adquirirRefConfig(refs: Map<string, number>, clave: string): void {
  refs.set(clave, (refs.get(clave) ?? 0) + 1)
}

/** −1 al refcount; true si llegó a 0 y hay que desmontar la credencial. */
export function releaseConfigRef(refs: Map<string, number>, clave: string): boolean {
  const n = (refs.get(clave) ?? 0) - 1
  if (n <= 0) {
    refs.delete(clave)
    return true
  }
  refs.set(clave, n)
  return false
}
