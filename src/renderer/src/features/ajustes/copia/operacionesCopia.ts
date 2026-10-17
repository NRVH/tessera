// =============================================================================
// Las dos operaciones de la copia de la configuración desde el renderer: armar lo que se exporta
// (perfiles, agentes y ajustes, de los stores; las conexiones las pone el main) y aplicar lo que
// se importa, solo lo elegido, en su orden: perfiles nuevos (guardados antes de seguir), conexiones
// (en el main), agentes, ajustes y, si llegaron agentes Docker con instalación, su capa de imagen.
// Lo puro vive en `shared/copiaConfiguracion.ts` (qué viaja y cómo se fusiona) y `shared/seleccionCopia.ts`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import {
  agentesParaExportar,
  ajustesConImportados,
  ajustesParaExportar,
  fusionarAgentes,
  perfilesAFusionar,
  type ApartadosCopia
} from '../../../../../shared/copiaConfiguracion'
import { agentesSeleccionados, arbolImportar, type ArbolImportar, type SeleccionImportar } from '../../../../../shared/seleccionCopia'
import { normalizarDefiniciones } from '../../../../../shared/agentesManuales'
import type { DescifrarResult, ExportarResult, ResultadoConexiones } from '../../../../../shared/copia-configuracion-ipc'
import type { AplicarCapaResult } from '../../../../../shared/agentes-manuales-ipc'
import type { Profile } from '../../../../../main/profiles/types'
import { despacharTabs, leerTabs } from '../../pestanas'
import { useStoreAgentes } from '../../agentes'
import { aplicarAjustesImportados, buildSettings } from '../usePersistenciaAjustes'

export type Descifrado = Extract<DescifrarResult, { ok: true }>

/** Exporta los perfiles elegidos con sus apartados; el main pide dónde guardar. */
/** `sinFrase`: el archivo va sin cifrar, a petición explícita de quien exporta. */
export function exportarCopia(perfilIds: readonly string[], apartados: ApartadosCopia, frase: string, sinFrase = false): Promise<ExportarResult> {
  const perfiles = leerTabs().profiles.filter((p) => perfilIds.includes(p.id))
  const s = buildSettings()
  return window.tessera.copiaConfiguracion.exportar({
    frase: sinFrase ? '' : frase,
    sinFrase,
    perfiles,
    apartados,
    ...(apartados.agentes ? { agentes: agentesParaExportar(s, perfilIds) } : {}),
    ...(apartados.ajustes ? { ajustes: ajustesParaExportar(s) } : {})
  })
}

/** Lo que trae el archivo frente a lo que hay aquí, como árbol de casillas para elegir qué importar. */
export function vistaPrevia(d: Descifrado): ArbolImportar {
  const { nuevos, existentes } = perfilesAFusionar(leerTabs().profiles, d.perfiles)
  const s = useStoreAgentes.getState()
  const c = (typeof d.agentes === 'object' && d.agentes !== null ? d.agentes : {}) as Record<string, unknown>
  const docker = (typeof c.dockerPorPerfil === 'object' && c.dockerPorPerfil !== null ? c.dockerPorPerfil : {}) as Record<string, unknown>
  const ids = (l: readonly { id: string }[]): string[] => l.map((x) => x.id)
  return arbolImportar({
    perfiles: [...existentes, ...nuevos].sort((a, b) => d.perfiles.indexOf(a) - d.perfiles.indexOf(b)),
    perfilesAqui: new Set(existentes.map((p) => p.id)),
    conexiones: d.conexiones,
    ...(d.agentes
      ? { agentes: { nativos: normalizarDefiniciones(c.nativos, false), dockerPorPerfil: Object.fromEntries(Object.entries(docker).map(([p, l]) => [p, normalizarDefiniciones(l, true)])) } }
      : {}),
    agentesAqui: {
      nativos: new Set(ids(s.agentesNativos)),
      dockerPorPerfil: Object.fromEntries(Object.entries(s.agentesDockerPorPerfil).map(([p, l]) => [p, ids(l)]))
    },
    ajustes: d.ajustes !== undefined
  })
}

export interface ResumenImportacion {
  perfilesNuevos: string[]
  conexiones: ResultadoConexiones
  agentes: number
  ajustes: boolean
  capas: Array<{ perfil: string; resultado: AplicarCapaResult }>
}

/** Los perfiles elegidos que faltan, sin cambiar el activo; guardados ya, para que el main los conozca. */
async function anadirPerfiles(d: Descifrado, elegidos: readonly string[]): Promise<string[]> {
  const { profiles, activeProfileId } = leerTabs()
  // El main validó la forma entera de cada perfil (`validateProfileShape`) antes de devolverlos.
  const deLaCopia = (d.perfiles as unknown as Profile[]).filter((p) => elegidos.includes(p.id))
  const { nuevos } = perfilesAFusionar(profiles, deLaCopia)
  for (const profile of nuevos) despacharTabs({ type: 'addProfile', profile })
  if (activeProfileId) despacharTabs({ type: 'setActiveProfile', profileId: activeProfileId })
  if (nuevos.length > 0) await window.tessera.saveProfiles(leerTabs().profiles)
  return nuevos.map((p) => p.id)
}

/** La capa de imagen de cada perfil con Docker que recibió agentes con órdenes de instalación. */
async function aplicarCapas(perfiles: readonly string[]): Promise<ResumenImportacion['capas']> {
  const capas: ResumenImportacion['capas'] = []
  for (const id of perfiles) {
    const perfil = leerTabs().profiles.find((p) => p.id === id)
    if (!perfil?.sandbox.habilitado) continue
    const definiciones = useStoreAgentes.getState().agentesDockerPorPerfil[id] ?? []
    const resultado = await window.tessera.agentesManuales.aplicarCapa({ profileId: id, definiciones }).catch((e: unknown) => ({ ok: false, faltan: [], error: String(e) }))
    capas.push({ perfil: perfil.nombre, resultado })
  }
  return capas
}

/** Importa lo elegido de lo descifrado: añade lo que falta y no toca lo que ya está. */
export async function importarCopia(token: string, d: Descifrado, sel: SeleccionImportar): Promise<ResumenImportacion> {
  const perfilesNuevos = await anadirPerfiles(d, sel.perfiles)
  const conexiones = await window.tessera.copiaConfiguracion.conexiones(token, { perfiles: sel.perfiles, ssh: sel.ssh, bd: sel.bd })
  let agentes = 0
  let conInstalacion: string[] = []
  if (d.agentes) {
    const f = fusionarAgentes(useStoreAgentes.getState(), agentesSeleccionados(d.agentes, sel), sel.perfiles, perfilesNuevos)
    useStoreAgentes.setState({ agentesNativos: f.agentesNativos, agentesDockerPorPerfil: f.agentesDockerPorPerfil, agentesOcultosPorPerfil: f.agentesOcultosPorPerfil })
    agentes = f.anadidos
    conInstalacion = f.perfilesConInstalacion
  }
  const ajustes = sel.ajustes && d.ajustes !== undefined
  if (ajustes) aplicarAjustesImportados(ajustesConImportados(buildSettings(), d.ajustes))
  const nombres = new Map(d.perfiles.map((p) => [p.id, p.nombre]))
  return {
    perfilesNuevos: perfilesNuevos.map((id) => nombres.get(id) ?? id),
    conexiones,
    agentes,
    ajustes,
    capas: await aplicarCapas(conInstalacion)
  }
}
