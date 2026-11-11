// =============================================================================
// Creación del editor de la configuración de los agentes: de dónde sale la carpeta de cada cuenta, de la
// nativa y de cada capa compartida, cuántas sesiones la usan, qué claves fija la compartida, el almacén de
// propuestas y la conexión de `tctx config`. Sus canales los registra `agents/componer.ts`.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================

import { join } from 'node:path'
import type { AccountStore } from '../AccountStore'
import type { PerfilesVivos, Profile } from '../../profiles/types'
import { baseNativaAgente } from '../../conversations/baseAgente'
import { usaContextoGlobal } from '../../../shared/contexto'
import { CONFIG_AGENTE_CHANNELS, type AgenteConConfig, type PropuestaConfig, type RefConfigAgente } from '../../../shared/configAgente-ipc'
import type { EmisorEventos } from '../../util/emisorEventos'
import { ServicioConfigAgente } from './ServicioConfigAgente'
import { capasDe, carpetaCapa, combinarCapas, type CapaAplicable } from './configCompartida'
import type { OperacionConfigTctx, SesionAgenteConfig } from './operacionConfigTctx'
import { PropuestasConfig } from './propuestasConfig'

/** La raíz de la configuración compartida de Docker: en los datos de Tessera, fuera de toda carpeta montada. */
export function raizCompartida(userData: string): string {
  return join(userData, 'config-compartida-docker')
}

/** Las capas compartidas de una cuenta de Docker de un perfil, para quien abre su sesión. */
export function capasCompartidasDe(userData: string, perfil: Profile, agente: string): CapaAplicable[] {
  return agente === 'claude-code' || agente === 'codex' ? capasDe(raizCompartida(userData), perfil, agente) : []
}

export interface DepsConfigAgente {
  userData: string
  accounts: AccountStore
  perfiles: PerfilesVivos
  sesionesDe: (agente: AgenteConConfig, accountId: string | null) => number
  /** `tctx config`, ya registrada en el puente: aquí recibe las sesiones, el servicio y las propuestas. */
  configTctx: Pick<OperacionConfigTctx, 'conectar'>
  sesionAgente: (sessionId: string) => SesionAgenteConfig | null
  /** Las ventanas: se les avisa de que ha llegado una propuesta. */
  eventos: EmisorEventos
  log: (m: string) => void
}

/** El servicio y el almacén de propuestas, con `tctx config` ya conectado; los canales los registra quien llama. */
export function crearConfigAgente(d: DepsConfigAgente): { servicio: ServicioConfigAgente; propuestas: PropuestasConfig; idsPerfiles: () => string[] } {
  const perfilDe = (id: string): Profile | null => d.perfiles.lista.find((p) => p.id === id) ?? null
  const servicio = crearServicio(d, perfilDe)
  const propuestas = new PropuestasConfig({ ruta: join(d.userData, 'config-propuestas.json'), log: d.log })
  d.configTctx.conectar({
    sesionAgente: d.sesionAgente,
    leer: (ref) => servicio.leer(ref),
    usaGlobal: (id) => {
      const p = perfilDe(id)
      return p ? usaContextoGlobal(p) : false
    },
    propuestas,
    alProponer: (p: PropuestaConfig) => d.eventos.emitir(CONFIG_AGENTE_CHANNELS.PROPUESTA_LLEGADA, p)
  })
  return { servicio, propuestas, idsPerfiles: () => d.perfiles.lista.map((p) => p.id) }
}

function crearServicio(d: DepsConfigAgente, perfilDe: (id: string) => Profile | null): ServicioConfigAgente {
  const raiz = raizCompartida(d.userData)
  const carpetaDe = ({ agente, accountId, capa }: RefConfigAgente, { crear }: { crear: boolean }): string | null => {
    if (capa) return capa.tipo === 'perfil' && !perfilDe(capa.profileId) ? null : carpetaCapa(raiz, capa, agente)
    if (accountId === null) return baseNativaAgente(agente)
    const cuenta = d.accounts.get(accountId)
    if (!cuenta || cuenta.agente !== agente) return null
    return crear ? d.accounts.hostDirFor(cuenta) : d.accounts.rutaDe(cuenta)
  }
  return new ServicioConfigAgente({
    carpetaDe,
    sesionesAbiertas: ({ agente, accountId }) => d.sesionesDe(agente, accountId),
    fijadas: async ({ agente, accountId }) => {
      const cuenta = accountId === null ? null : d.accounts.get(accountId)
      if (cuenta?.global) return (await combinarCapas(agente, capasDe(raiz, { id: cuenta.profileId }, agente).filter((c) => c.origen === 'global'))).fijadas
      const perfil = cuenta ? perfilDe(cuenta.profileId) : null
      if (!cuenta || !perfil) return []
      return (await combinarCapas(agente, capasDe(raiz, perfil, agente))).fijadas
    }
  })
}
