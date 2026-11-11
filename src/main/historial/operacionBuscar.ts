// =============================================================================
// `tctx buscar`: la operación `ctx.buscar`, con el token de SESIÓN, por el puente y por el buzón de Docker. El
// perfil, el proyecto y quién pregunta salen siempre de la sesión del token, nunca de la petición. Una sesión
// nativa (o la terminal, que es el usuario) busca en todas las bases del perfil; un agente en Docker, solo en
// la de su cuenta. Asíncrona: el puente espera su promesa. Se conecta tarde, cuando existen las sesiones.
// Decisiones: docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================
import { esCuentaGlobal } from '../../shared/agent-accounts-ipc.ts'
import type { ConvAgent } from '../../shared/conversations-ipc'
import { idDeClaveSesionAgente } from '../../shared/db-ipc.ts'
import type { RespuestaOperacion, SesionDelPuente } from '../db/dbBridge.ts'
import { MAX_TEXTO_BUSQUEDA, analizarConsulta, type Consulta } from './coincidencia.ts'
import { MAX_RESULTADOS_DEFECTO, MAX_RESULTADOS_TOPE, type FuenteHistorial, type ResultadoBusqueda } from './buscarHistorial.ts'

export const OP_BUSCAR = 'ctx.buscar'
/** Búsquedas a la vez: cada una lee disco y parsea en el hilo del main. */
export const MAX_BUSQUEDAS_EN_CURSO = 2

const AGENTES: readonly ConvAgent[] = ['claude-code', 'codex']

/** De quién es una sesión de agente viva. */
export interface SesionAgenteViva {
  profileId: string
  /** `claude-code`, `codex` o el id de un agente manual. */
  agente: string
  accountId: string
  host: boolean
}

/** Lo que necesita, ya con las sesiones compuestas. */
export interface DepsOperacionBuscar {
  /** La sesión de agente viva con ese id (sin el prefijo `agent:`), o null. */
  sesionAgente: (sessionId: string) => SesionAgenteViva | null
  /** Las cuentas de Docker de un agente en un perfil, con su nombre. */
  cuentasDelPerfil: (profileId: string, agente: ConvAgent) => ReadonlyArray<{ id: string; nombre: string }>
  /** Una cuenta por su id, o null. */
  cuenta: (accountId: string) => { profileId: string; agente: string; nombre: string } | null
  /** La carpeta de la cuenta (`BaseDeCuenta`); la del sistema con `host`. */
  baseDe: (agente: ConvAgent, accountId: string, host: boolean) => string | null
  buscar: (fuentes: readonly FuenteHistorial[], proyecto: string, consulta: Consulta, max: number) => Promise<ResultadoBusqueda>
  log?: (mensaje: string) => void
}

/** En qué se busca, y si es solo la cuenta del agente en Docker (con qué agente y cuenta, si se sabe). */
export interface Alcance {
  fuentes: FuenteHistorial[]
  soloSuCuenta: { agente: ConvAgent | null; cuenta: string | null } | null
}

function esAgente(v: string): v is ConvAgent {
  return (AGENTES as readonly string[]).includes(v)
}

/** Todas las bases del perfil: la del sistema de cada agente y cada cuenta de Docker. */
function alcanceNativo(profileId: string, d: Pick<DepsOperacionBuscar, 'cuentasDelPerfil' | 'baseDe'>): Alcance {
  const fuentes: FuenteHistorial[] = []
  for (const agente of AGENTES) {
    const sistema = d.baseDe(agente, '', true)
    if (sistema) fuentes.push({ agente, base: sistema, cuenta: null })
    for (const c of d.cuentasDelPerfil(profileId, agente)) {
      const base = d.baseDe(agente, c.id, false)
      if (base) fuentes.push({ agente, base, cuenta: c.nombre })
    }
  }
  return { fuentes, soloSuCuenta: null }
}

/**
 * Las bases que ve quien pregunta. `quien` null es una sesión que no es de agente (la terminal del proyecto,
 * en el equipo): la del usuario, como un agente nativo. Un agente en Docker ve solo su cuenta, y solo si es
 * de su perfil y de su agente; un agente manual en Docker no tiene conversaciones que Tessera lea.
 */
export function alcanceDe(profileId: string, quien: SesionAgenteViva | null, d: Pick<DepsOperacionBuscar, 'cuentasDelPerfil' | 'cuenta' | 'baseDe'>): Alcance {
  if (quien === null || quien.host) return alcanceNativo(profileId, d)
  if (!esAgente(quien.agente)) return { fuentes: [], soloSuCuenta: { agente: null, cuenta: null } }
  const c = d.cuenta(quien.accountId)
  const suya = c !== null && (c.profileId === profileId || esCuentaGlobal(quien.accountId)) && c.agente === quien.agente
  const base = suya ? d.baseDe(quien.agente, quien.accountId, false) : null
  return {
    fuentes: base ? [{ agente: quien.agente, base, cuenta: c?.nombre ?? null }] : [],
    soloSuCuenta: { agente: quien.agente, cuenta: suya ? (c?.nombre ?? null) : null }
  }
}

/** La petición comprobada, o el rechazo. */
function leerPeticion(p: Readonly<Record<string, unknown>>): { consulta: Consulta; max: number } | { rechazo: RespuestaOperacion } {
  if (typeof p.texto !== 'string' || (p.exacta !== undefined && typeof p.exacta !== 'boolean')) return { rechazo: { ok: false, rechazo: 'peticion' } }
  if (p.texto.trim().length > MAX_TEXTO_BUSQUEDA) return { rechazo: { ok: false, rechazo: 'busqueda-larga', max: MAX_TEXTO_BUSQUEDA } }
  const consulta = analizarConsulta(p.texto, p.exacta === true)
  if (consulta === null) return { rechazo: { ok: false, rechazo: 'busqueda-vacia' } }
  const pedido = p.max === undefined ? MAX_RESULTADOS_DEFECTO : p.max
  if (typeof pedido !== 'number' || !Number.isInteger(pedido) || pedido < 1) return { rechazo: { ok: false, rechazo: 'peticion' } }
  return { consulta, max: Math.min(pedido, MAX_RESULTADOS_TOPE) }
}

/** La operación; atiende en cuanto `conectar` le da las sesiones y las cuentas. */
export class OperacionBuscarHistorial {
  private d: DepsOperacionBuscar | null = null
  private enCurso = 0

  conectar(d: DepsOperacionBuscar): void {
    this.d = d
  }

  /** Quién pregunta según su token: null es la terminal; un agente que ya no vive (o de otro perfil) no busca. */
  private quien(s: SesionDelPuente, d: DepsOperacionBuscar): SesionAgenteViva | null | 'nadie' {
    if (!s.sesion) return 'nadie'
    const idAgente = idDeClaveSesionAgente(s.sesion)
    if (idAgente === null) return null
    const viva = d.sesionAgente(idAgente)
    return viva && viva.profileId === s.profileId ? viva : 'nadie'
  }

  async atender(p: Readonly<Record<string, unknown>>, s: SesionDelPuente): Promise<RespuestaOperacion> {
    const d = this.d
    if (!d) return { ok: false, error: 'error interno' }
    const peticion = leerPeticion(p)
    if ('rechazo' in peticion) return peticion.rechazo
    const quien = this.quien(s, d)
    if (quien === 'nadie') return { ok: false, rechazo: 'sin-sesion' }
    if (this.enCurso >= MAX_BUSQUEDAS_EN_CURSO) return { ok: false, rechazo: 'ocupado' }
    const alcance = alcanceDe(s.profileId, quien, d)
    this.enCurso++
    try {
      const t0 = Date.now()
      const r = await d.buscar(alcance.fuentes, s.projectHostPath, peticion.consulta, peticion.max)
      d.log?.(`búsqueda del perfil ${s.profileId}: ${r.coincidencias.length} coincidencias en ${alcance.fuentes.length} bases, ${Date.now() - t0} ms${r.corte ? `, cortada por ${r.corte}` : ''}`)
      return { ok: true, coincidencias: r.coincidencias, hayMas: r.hayMas, corte: r.corte, soloSuCuenta: alcance.soloSuCuenta }
    } finally {
      this.enCurso--
    }
  }
}
