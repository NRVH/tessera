// =============================================================================
// Creación del editor de la configuración de los agentes: de dónde sale la carpeta de cada cuenta, de la
// nativa y de cada capa compartida, cuántas sesiones la usan, qué claves fija la compartida, el almacén de
// propuestas y la conexión de `tctx config`. Sus canales los registra `agentes/componer.ts`.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================

import { join } from 'node:path'
import type { AlmacenCuentas } from '../AlmacenCuentas'
import type { PerfilesVivos, Perfil } from '../../perfiles/types'
import { baseNativaAgente } from '../../conversaciones/baseAgente'
import { usaContextoGlobal } from '../../../shared/contexto'
import { CONFIG_AGENTE_CHANNELS, type AgenteConConfig, type PropuestaConfig, type RefConfigAgente } from '../../../shared/configAgente-ipc'
import type { EmisorEventos } from '../../util/emisorEventos'
import { ServicioConfigAgente } from './ServicioConfigAgente'
import { capasDe, carpetaCapa, combinarCapas, type CapaAplicable } from './configCompartida'
import type { OperacionConfigTctx, SesionAgenteConfig } from './operacionConfigTctx'
import { PropuestasConfig } from './propuestasConfig'

/** La raíz de la configuración compartida de Docker: en los datos de Tessera, fuera de toda carpeta montada. */
export function raizCompartida(datosUsuario: string): string {
  return join(datosUsuario, 'config-compartida-docker')
}

/** Las capas compartidas de una cuenta de Docker de un perfil, para quien abre su sesión. */
export function capasCompartidasDe(datosUsuario: string, perfil: Perfil, agente: string): CapaAplicable[] {
  return agente === 'claude-code' || agente === 'codex' ? capasDe(raizCompartida(datosUsuario), perfil, agente) : []
}

export interface DependenciasCrearConfigAgente {
  datosUsuario: string
  cuentas: AlmacenCuentas
  perfiles: PerfilesVivos
  sesionesDe: (agente: AgenteConConfig, cuentaId: string | null) => number
  /** `tctx config`, ya registrada en el puente: aquí recibe las sesiones, el servicio y las propuestas. */
  operacionConfigTctx: Pick<OperacionConfigTctx, 'conectar'>
  sesionAgente: (sesionId: string) => SesionAgenteConfig | null
  /** Las ventanas: se les avisa de que ha llegado una propuesta. */
  eventos: EmisorEventos
  log: (m: string) => void
}

/** El servicio y el almacén de propuestas, con `tctx config` ya conectado; los canales los registra quien llama. */
export function crearConfigAgente(d: DependenciasCrearConfigAgente): { servicio: ServicioConfigAgente; propuestas: PropuestasConfig; idsPerfiles: () => string[] } {
  const perfilDe = (id: string): Perfil | null => d.perfiles.lista.find((p) => p.id === id) ?? null
  const servicio = crearServicio(d, perfilDe)
  const propuestas = new PropuestasConfig({ ruta: join(d.datosUsuario, 'config-propuestas.json'), log: d.log })
  d.operacionConfigTctx.conectar({
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

function crearServicio(d: DependenciasCrearConfigAgente, perfilDe: (id: string) => Perfil | null): ServicioConfigAgente {
  const raiz = raizCompartida(d.datosUsuario)
  const carpetaDe = ({ agente, cuentaId, capa }: RefConfigAgente, { crear }: { crear: boolean }): string | null => {
    if (capa) return capa.tipo === 'perfil' && !perfilDe(capa.perfilId) ? null : carpetaCapa(raiz, capa, agente)
    if (cuentaId === null) return baseNativaAgente(agente)
    const cuenta = d.cuentas.obtener(cuentaId)
    if (!cuenta || cuenta.agente !== agente) return null
    return crear ? d.cuentas.dirHostDe(cuenta) : d.cuentas.rutaDe(cuenta)
  }
  return new ServicioConfigAgente({
    carpetaDe,
    sesionesAbiertas: ({ agente, cuentaId }) => d.sesionesDe(agente, cuentaId),
    fijadas: async ({ agente, cuentaId }) => {
      const cuenta = cuentaId === null ? null : d.cuentas.obtener(cuentaId)
      if (cuenta?.global) return (await combinarCapas(agente, capasDe(raiz, { id: cuenta.profileId }, agente).filter((c) => c.origen === 'global'))).fijadas
      const perfil = cuenta ? perfilDe(cuenta.profileId) : null
      if (!cuenta || !perfil) return []
      return (await combinarCapas(agente, capasDe(raiz, perfil, agente))).fijadas
    }
  })
}
