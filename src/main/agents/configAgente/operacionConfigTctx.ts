// =============================================================================
// `tctx config`: ver la configuración técnica de Docker por niveles (global, el perfil de la sesión y, en
// Docker, la cuenta) y proponer el archivo de configuración entero nuevo de un nivel. Nunca escribe: la propuesta espera a
// que el usuario la acepte. Un perfil que no usa el contexto global no ve su capa ni la propone. El perfil y el agente salen de la sesión del token, nunca de la petición; desde la
// terminal del proyecto, que es el usuario, se nombra el agente. Un agente solo propone para su perfil o el global.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================

import { randomUUID } from 'node:crypto'
import { idDeClaveSesionAgente } from '../../../shared/db-ipc.ts'
import {
  MAX_BYTES_CONFIG_AGENTE,
  type AgenteConConfig,
  type ConfigAgenteLeida,
  type PropuestaConfig,
  type RefConfigAgente
} from '../../../shared/configAgente-ipc.ts'
import type { RespuestaOperacion, SesionDelPuente } from '../../db/dbBridge.ts'
import type { PropuestasConfig } from './propuestasConfig.ts'
import { errorSintaxisConfig } from './validarConfigAgente.ts'

export const OP_CONFIG = 'ctx.config'
export const OP_CONFIG_PROPONER = 'ctx.config.proponer'

/** Lo más largo que se propone: la petición viaja por el puente, que tiene su propio tope. */
export const MAX_PROPUESTA_CONFIG = 24 * 1024
const MAX_MOTIVO = 500

export interface SesionAgenteConfig {
  profileId: string
  agente: string
  accountId: string
  host: boolean
}

export interface DepsOperacionConfig {
  sesionAgente: (sessionId: string) => SesionAgenteConfig | null
  leer: (ref: RefConfigAgente) => Promise<ConfigAgenteLeida | null>
  /** Si el perfil usa el contexto global: uno que no, ni ve su capa ni la propone. */
  usaGlobal: (profileId: string) => boolean
  propuestas: Pick<PropuestasConfig, 'guardar'>
  alProponer: (p: PropuestaConfig) => void
  ahora?: () => number
}

const esAgente = (v: unknown): v is AgenteConConfig => v === 'claude-code' || v === 'codex'

function nombreProyecto(s: SesionDelPuente): string | undefined {
  if (s.espacioDatos) return undefined
  const partes = s.projectHostPath.split(/[\\/]/).filter(Boolean)
  return partes.length > 0 ? partes[partes.length - 1] : undefined
}

/** La petición de proponer comprobada (forma, tope, motivo y sintaxis), o su rechazo. */
function leerPropuesta(
  p: Readonly<Record<string, unknown>>,
  agente: AgenteConConfig
): { nivel: 'global' | 'perfil'; tipo: PropuestaConfig['tipo']; motivo: string; texto: string } | RespuestaOperacion {
  const { nivel, texto } = p
  // Las capas solo tienen configuración técnica; las reglas se proponen con `tctx proponer`.
  const tipo = 'configuracion' as const
  if ((nivel !== 'global' && nivel !== 'perfil') || (p.tipo !== undefined && p.tipo !== tipo) || typeof texto !== 'string') {
    return { ok: false, rechazo: 'peticion' }
  }
  const motivo = typeof p.motivo === 'string' ? p.motivo.replace(/\s+/g, ' ').trim() : ''
  if (motivo.length > MAX_MOTIVO) return { ok: false, rechazo: 'motivo-largo', max: MAX_MOTIVO }
  if (Buffer.byteLength(texto, 'utf8') > Math.min(MAX_PROPUESTA_CONFIG, MAX_BYTES_CONFIG_AGENTE)) return { ok: false, rechazo: 'config-larga', max: MAX_PROPUESTA_CONFIG }
  const sintaxis = errorSintaxisConfig(agente, tipo, texto)
  if (sintaxis === 'raiz-json') return { ok: false, rechazo: 'config-sintaxis', detalle: 'JSON', linea: 1 }
  if (sintaxis) return { ok: false, rechazo: 'config-sintaxis', detalle: sintaxis.detalle, linea: sintaxis.linea }
  return { nivel, tipo, motivo, texto }
}

export class OperacionConfigTctx {
  private d: DepsOperacionConfig | null = null

  conectar(d: DepsOperacionConfig): void {
    this.d = d
  }

  /** El agente de quien pregunta y, si es una sesión de Docker, su cuenta; la terminal del usuario lo nombra. */
  private quien(p: Readonly<Record<string, unknown>>, s: SesionDelPuente, d: DepsOperacionConfig): { agente: AgenteConConfig; cuenta: string | null } | RespuestaOperacion {
    const idAgente = s.sesion ? idDeClaveSesionAgente(s.sesion) : null
    if (idAgente === null) return esAgente(p.agente) ? { agente: p.agente, cuenta: null } : { ok: false, rechazo: 'config-sin-agente' }
    const viva = d.sesionAgente(idAgente)
    if (!viva || viva.profileId !== s.profileId) return { ok: false, rechazo: 'sin-sesion' }
    if (!esAgente(viva.agente)) return { ok: false, rechazo: 'config-sin-agente' }
    return { agente: viva.agente, cuenta: viva.host ? null : viva.accountId }
  }

  async atender(op: string, p: Readonly<Record<string, unknown>>, s: SesionDelPuente): Promise<RespuestaOperacion> {
    const d = this.d
    if (!d) return { ok: false, error: 'error interno' }
    const quien = this.quien(p, s, d)
    if ('ok' in quien) return quien
    return op === OP_CONFIG_PROPONER ? this.proponer(p, s, quien.agente, d) : this.ver(s, quien.agente, quien.cuenta, d)
  }

  private async ver(s: SesionDelPuente, agente: AgenteConConfig, cuenta: string | null, d: DepsOperacionConfig): Promise<RespuestaOperacion> {
    const refs: Array<{ nivel: string; ref: RefConfigAgente }> = [
      ...(d.usaGlobal(s.profileId) ? [{ nivel: 'global', ref: { agente, accountId: null, capa: { tipo: 'global' as const } } }] : []),
      { nivel: 'perfil', ref: { agente, accountId: null, capa: { tipo: 'perfil', profileId: s.profileId } } }
    ]
    if (cuenta) refs.push({ nivel: 'cuenta', ref: { agente, accountId: cuenta } })
    const niveles = []
    for (const { nivel, ref } of refs) {
      const leida = await d.leer(ref)
      if (!leida) continue
      const configuracion = { nombre: leida.archivos.configuracion.nombre, contenido: leida.archivos.configuracion.contenido }
      // Las instrucciones solo existen en la cuenta; las de los niveles son las reglas, que da `tctx reglas`.
      const instrucciones = ref.capa ? {} : { instrucciones: { nombre: leida.archivos.instrucciones.nombre, contenido: leida.archivos.instrucciones.contenido } }
      niveles.push({ nivel, configuracion, ...instrucciones })
    }
    return { ok: true, agente, niveles }
  }

  private async proponer(p: Readonly<Record<string, unknown>>, s: SesionDelPuente, agente: AgenteConConfig, d: DepsOperacionConfig): Promise<RespuestaOperacion> {
    const leida = leerPropuesta(p, agente)
    if ('ok' in leida) return leida
    const { nivel, tipo, motivo, texto } = leida
    if (nivel === 'global' && !d.usaGlobal(s.profileId)) return { ok: false, rechazo: 'config-sin-global' }
    const actual = await d.leer({ agente, accountId: null, capa: nivel === 'global' ? { tipo: 'global' } : { tipo: 'perfil', profileId: s.profileId } })
    if (actual && actual.archivos[tipo].contenido === texto) return { ok: false, rechazo: 'config-igual' }
    const proyecto = nombreProyecto(s)
    const propuesta: PropuestaConfig = {
      id: randomUUID(),
      nivel,
      profileId: s.profileId,
      agente,
      tipo,
      texto,
      motivo,
      en: (d.ahora ?? Date.now)(),
      ...(proyecto ? { proyecto } : {})
    }
    d.propuestas.guardar(propuesta)
    d.alProponer(propuesta)
    return { ok: true }
  }
}
