// =============================================================================
// Las dos operaciones de la copia de la configuración desde el renderer: armar lo que se exporta
// (perfiles, agentes y ajustes, de los stores; las conexiones las pone el main) y aplicar lo que
// se importa, solo lo elegido, en su orden: perfiles nuevos y reglas de los de aquí (guardados antes de
// seguir), conexiones, historial, configuración de Docker y archivos de agentes (en el main, cada uno a su perfil de
// destino), agentes, ajustes y, si llegaron agentes Docker con instalación, su capa de imagen.
// Lo puro vive en `shared/copiaConfiguracion.ts` (qué viaja y cómo se fusiona), `shared/destinoCopia.ts`
// (a qué perfil va cada uno) y `shared/seleccionCopia.ts`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import {
  agentesParaExportar,
  ajustesConImportados,
  ajustesParaExportar,
  fusionarAgentes,
  type ApartadosCopia
} from '../../../../../shared/copiaConfiguracion'
import { destinosPorDefecto, estadoReglas, planPerfiles, reasignarAgentes, type EstadoReglas, type PlanPerfiles } from '../../../../../shared/destinoCopia'
import { agentesSeleccionados, arbolImportar, type ArbolImportar, type SeleccionImportar } from '../../../../../shared/seleccionCopia'
import { normalizarDefiniciones } from '../../../../../shared/agentesManuales'
import type { ResultadoDescifrar, ResultadoExportar, ResultadoConexiones } from '../../../../../shared/copia-configuracion-ipc'
import type { ResultadoAplicarCapa } from '../../../../../shared/agentes-manuales-ipc'
import type { Perfil } from '../../../../../main/perfiles/types'
import { despacharPestanas, leerPestanas } from '../../pestanas'
import { useStoreAgentes } from '../../agentes'
import { aplicarAjustesImportados, construirAjustes } from '../usePersistenciaAjustes'

export type Descifrado = Extract<ResultadoDescifrar, { ok: true }>

/**
 * Exporta los perfiles elegidos con sus apartados; el main pide dónde guardar. `sinFrase`: el archivo va
 * sin cifrar, a petición explícita de quien exporta. `historial`: también las conversaciones (y las nativas).
 */
export function exportarCopia(
  perfilIds: readonly string[],
  apartados: ApartadosCopia,
  frase: string,
  sinFrase = false,
  historial: { nativo: boolean } | null = null
): Promise<ResultadoExportar> {
  const perfiles = leerPestanas().perfiles.filter((p) => perfilIds.includes(p.id))
  const s = construirAjustes()
  return window.tessera.copiaConfiguracion.exportar({
    frase: sinFrase ? '' : frase,
    sinFrase,
    perfiles,
    apartados,
    ...(apartados.agentes ? { agentes: agentesParaExportar(s, perfilIds) } : {}),
    ...(apartados.ajustes ? { ajustes: ajustesParaExportar(s) } : {}),
    ...(historial ? { historial } : {})
  })
}

/** Los perfiles de la copia, sin repetir id. */
function perfilesDeLaCopia(d: Descifrado): Perfil[] {
  const vistos = new Set<string>()
  // El main validó la forma entera de cada perfil (`validarFormaDePerfil`) antes de devolverlos.
  return (d.perfiles as unknown as Perfil[]).filter((p) => !vistos.has(p.id) && vistos.add(p.id))
}

/** A qué perfil de aquí va de serie cada perfil del archivo: el del mismo id, si no el del mismo nombre. */
export function destinosDeSerie(d: Descifrado): Record<string, string | null> {
  return destinosPorDefecto(perfilesDeLaCopia(d), leerPestanas().perfiles)
}

/** Las reglas de cada perfil del archivo, para compararlas con las del perfil de aquí que lo recibe. */
export function reglasDelArchivo(d: Descifrado): Record<string, string> {
  return Object.fromEntries(perfilesDeLaCopia(d).map((p) => [p.id, p.reglas ?? '']))
}

/**
 * Lo que trae el archivo frente a lo que hay aquí, como árbol de casillas para elegir qué importar, con
 * cada perfil del archivo yendo al perfil de aquí de `destinos` (null o ausente, a uno nuevo).
 */
export function vistaPrevia(d: Descifrado, destinos: Readonly<Record<string, string | null>>): ArbolImportar {
  const aqui = leerPestanas().perfiles
  const perfiles = perfilesDeLaCopia(d)
  const reglas: Record<string, EstadoReglas> = {}
  for (const p of perfiles) {
    const destino = destinos[p.id] ?? null
    if (destino !== null) reglas[p.id] = estadoReglas(aqui.find((x) => x.id === destino)?.reglas, p.reglas)
  }
  const s = useStoreAgentes.getState()
  const c = (typeof d.agentes === 'object' && d.agentes !== null ? d.agentes : {}) as Record<string, unknown>
  const docker = (typeof c.dockerPorPerfil === 'object' && c.dockerPorPerfil !== null ? c.dockerPorPerfil : {}) as Record<string, unknown>
  const ids = (l: readonly { id: string }[]): string[] => l.map((x) => x.id)
  return arbolImportar({
    perfiles,
    destinos,
    reglas,
    conexiones: d.conexiones,
    ...(d.agentes
      ? { agentes: { nativos: normalizarDefiniciones(c.nativos, false), dockerPorPerfil: Object.fromEntries(Object.entries(docker).map(([p, l]) => [p, normalizarDefiniciones(l, true)])) } }
      : {}),
    agentesAqui: {
      nativos: new Set(ids(s.agentesNativos)),
      dockerPorPerfil: Object.fromEntries(Object.entries(s.agentesDockerPorPerfil).map(([p, l]) => [p, ids(l)]))
    },
    ajustes: d.ajustes !== undefined,
    historial: d.historial,
    configDocker: d.configDocker,
    archivosAgentes: d.archivosAgentes
  })
}

export interface ResumenImportacion {
  perfilesNuevos: string[]
  /** Los perfiles de aquí que recibieron las reglas del archivo. */
  reglas: string[]
  conexiones: ResultadoConexiones
  agentes: number
  ajustes: boolean
  capas: Array<{ perfil: string; resultado: ResultadoAplicarCapa }>
}

/**
 * Los perfiles nuevos y las reglas de los de aquí, sin cambiar el activo; guardados ya, para que el main
 * los conozca antes de recibir sus conexiones. Devuelve los perfiles de aquí que cambiaron de reglas.
 */
async function aplicarPerfiles(plan: PlanPerfiles<Perfil>): Promise<string[]> {
  const { perfilActivoId } = leerPestanas()
  for (const perfil of plan.nuevos) despacharPestanas({ tipo: 'addProfile', profile: perfil })
  const antes = new Map(leerPestanas().perfiles.map((p) => [p.id, p.reglas ?? '']))
  for (const r of plan.reglas) despacharPestanas({ tipo: 'setProfileReglas', perfilId: r.perfil, reglas: r.reglas })
  if (perfilActivoId) despacharPestanas({ tipo: 'setActiveProfile', perfilId: perfilActivoId })
  const cambiadas = leerPestanas().perfiles.filter((p) => antes.has(p.id) && antes.get(p.id) !== (p.reglas ?? '')).map((p) => p.nombre)
  if (plan.nuevos.length > 0 || cambiadas.length > 0) await window.tessera.guardarPerfiles(leerPestanas().perfiles)
  return cambiadas
}

/** La capa de imagen de cada perfil con Docker que recibió agentes con órdenes de instalación. */
async function aplicarCapas(perfiles: readonly string[]): Promise<ResumenImportacion['capas']> {
  const capas: ResumenImportacion['capas'] = []
  for (const id of perfiles) {
    const perfil = leerPestanas().perfiles.find((p) => p.id === id)
    if (!perfil?.sandbox.habilitado) continue
    const definiciones = useStoreAgentes.getState().agentesDockerPorPerfil[id] ?? []
    const resultado = await window.tessera.agentesManuales.aplicarCapa({ profileId: id, definiciones }).catch((e: unknown) => ({ ok: false, faltan: [], error: String(e) }))
    capas.push({ perfil: perfil.nombre, resultado })
  }
  return capas
}

/**
 * Importa lo elegido de lo descifrado: añade lo que falta, cada cosa a su perfil de destino, y no toca lo
 * que ya está; de un perfil de aquí solo cambian las reglas, si se eligió.
 */
export async function importarCopia(token: string, d: Descifrado, sel: SeleccionImportar): Promise<ResumenImportacion> {
  const plan = planPerfiles(leerPestanas().perfiles, perfilesDeLaCopia(d), sel)
  const reglas = await aplicarPerfiles(plan)
  const perfilesNuevos = plan.nuevos.map((p) => p.id)
  const conexiones = await window.tessera.copiaConfiguracion.conexiones(token, {
    perfiles: sel.perfiles,
    ssh: sel.ssh,
    bd: sel.bd,
    historial: sel.historial,
    configDocker: sel.configDocker,
    configGlobal: sel.configGlobal,
    archivosCuentas: sel.archivosCuentas,
    cuentasNuevas: sel.cuentasNuevas,
    reglasNativas: sel.reglasNativas,
    reasignar: plan.destinos,
    fusionados: plan.fusionados
  })
  let agentes = 0
  let conInstalacion: string[] = []
  if (d.agentes) {
    const destinos = [...new Set(Object.values(plan.destinos))]
    const f = fusionarAgentes(useStoreAgentes.getState(), reasignarAgentes(agentesSeleccionados(d.agentes, sel), plan.destinos), destinos, perfilesNuevos)
    useStoreAgentes.setState({ agentesNativos: f.agentesNativos, agentesDockerPorPerfil: f.agentesDockerPorPerfil, agentesOcultosPorPerfil: f.agentesOcultosPorPerfil })
    agentes = f.anadidos
    conInstalacion = f.perfilesConInstalacion
  }
  const ajustes = sel.ajustes && d.ajustes !== undefined
  if (ajustes) aplicarAjustesImportados(ajustesConImportados(construirAjustes(), d.ajustes))
  return {
    perfilesNuevos: plan.nuevos.map((p) => p.nombre),
    reglas,
    conexiones,
    agentes,
    ajustes,
    capas: await aplicarCapas(conInstalacion)
  }
}
