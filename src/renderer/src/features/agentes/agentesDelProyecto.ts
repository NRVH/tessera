// =============================================================================
// Las pestañas de agente de un proyecto: los de serie y los manuales de su modo (nativos, de todo
// el equipo; Docker, solo del perfil), en el orden que eligió el perfil y sin los que ocultó.
// También la lista del perfil entero que gestiona Configuración. Puro, sin React ni DOM:
// lo usan la columna del agente, el modelo de pestañas, el mosaico y sus pruebas.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================

import type { AgentKind } from '../../../../shared/agent-terminal-ipc.ts'
import { esAgenteManual, type DefinicionAgente, type IdAgente } from '../../../../shared/agentesManuales.ts'
import { ETIQUETA_AGENTE } from '../../../../shared/etiquetasAgente.ts'
import { aplicarOrden } from './ordenAgentes.ts'

/** Los agentes de serie, en su orden de siempre. */
export const AGENTES_DE_SERIE: readonly AgentKind[] = ['claude-code', 'codex']

/** De dónde salen los agentes manuales, los ocultos y el orden (lo que se guarda en los ajustes). */
export interface FuenteAgentes {
  nativos: readonly DefinicionAgente[]
  dockerPorPerfil: Readonly<Record<string, readonly DefinicionAgente[]>>
  ocultosPorPerfil: Readonly<Record<string, readonly IdAgente[]>>
  ordenPorPerfil: Readonly<Record<string, readonly IdAgente[]>>
}

export const FUENTE_VACIA: FuenteAgentes = { nativos: [], dockerPorPerfil: {}, ocultosPorPerfil: {}, ordenPorPerfil: {} }

/** Los manuales del modo del proyecto: nativo, los de todo el equipo; Docker, los de su perfil. */
export function manualesDelModo(f: FuenteAgentes, profileId: string, hostMode: boolean): readonly DefinicionAgente[] {
  return hostMode ? f.nativos : (f.dockerPorPerfil[profileId] ?? [])
}

/** Los ids de las pestañas de un proyecto, en su orden. */
export function agentesDelProyecto(f: FuenteAgentes, profileId: string, hostMode: boolean): IdAgente[] {
  return pestanasDelProyecto(f, profileId, hostMode).map((x) => x.id)
}

/** La definición de un agente manual del proyecto, o null (uno de serie o uno que ya no existe). */
export function definicionDe(f: FuenteAgentes, profileId: string, hostMode: boolean, id: IdAgente): DefinicionAgente | null {
  if (!esAgenteManual(id)) return null
  return manualesDelModo(f, profileId, hostMode).find((d) => d.id === id) ?? null
}

/**
 * Los ids manuales ya usados en el equipo: los nativos y los Docker de TODOS los perfiles, sin
 * `excepto` (el que se edita). Un id es único entre todos: los ocultos y el orden de un perfil se
 * guardan por id y mezclan los nativos con los Docker de ese perfil.
 */
export function idsManualesOcupados(f: Pick<FuenteAgentes, 'nativos' | 'dockerPorPerfil'>, excepto?: IdAgente): string[] {
  const todos = [...f.nativos, ...Object.values(f.dockerPorPerfil).flat()].map((d) => d.id)
  return [...new Set(todos)].filter((id) => id !== excepto)
}

/** El agente a mostrar: el elegido si sigue en la lista; si no, el primero. */
export function agenteAMostrar(disponibles: readonly IdAgente[], elegido: IdAgente | undefined): IdAgente | null {
  if (elegido && disponibles.includes(elegido)) return elegido
  return disponibles[0] ?? null
}

/** ¿Se puede ocultar este agente? Solo si está a la vista y queda otro visible. */
export function sePuedeOcultar(visibles: readonly IdAgente[], id: IdAgente): boolean {
  return visibles.includes(id) && visibles.length > 1
}

/** Una pestaña de agente: su id, cómo se llama (entero y corto) y, si es manual, su definición. */
export interface PestanaAgente {
  id: IdAgente
  nombre: string
  corta: string
  manual: DefinicionAgente | null
}

const CORTA_DE_SERIE: Record<AgentKind, string> = { 'claude-code': 'CC', codex: 'Cdx' }

function pestanaDeSerie(a: AgentKind): PestanaAgente {
  return { id: a, nombre: ETIQUETA_AGENTE[a], corta: CORTA_DE_SERIE[a], manual: null }
}

function pestanaManual(d: DefinicionAgente): PestanaAgente {
  return { id: d.id, nombre: d.nombre, corta: d.nombre, manual: d }
}

/** Todas las pestañas posibles de un proyecto, ocultas incluidas, en el orden del perfil. */
export function todasDelProyecto(f: FuenteAgentes, profileId: string, hostMode: boolean): PestanaAgente[] {
  const todas = [...AGENTES_DE_SERIE.map(pestanaDeSerie), ...manualesDelModo(f, profileId, hostMode).map(pestanaManual)]
  return aplicarOrden(todas, (x) => x.id, f.ordenPorPerfil[profileId])
}

/**
 * Las pestañas de un proyecto: las de su modo sin las ocultas. Lo oculto vale para todo el perfil, y
 * en un modo donde no quedara ninguna se enseñan las de serie: un proyecto nunca se queda sin agente.
 */
export function pestanasDelProyecto(f: FuenteAgentes, profileId: string, hostMode: boolean): PestanaAgente[] {
  const todas = todasDelProyecto(f, profileId, hostMode)
  const ocultos = f.ocultosPorPerfil[profileId] ?? []
  const visibles = todas.filter((x) => !ocultos.includes(x.id))
  return visibles.length > 0 ? visibles : todas.filter((x) => x.manual === null)
}

/**
 * El estado de las casillas de mostrar u ocultar: `mostrado` es el estado guardado (no si sale en la
 * fila por el respaldo de las de serie) y `bloqueada`, que es el último sin ocultar del modo.
 */
export function casillasDeOcultar(
  todas: readonly PestanaAgente[],
  ocultos: readonly IdAgente[]
): Array<{ x: PestanaAgente; mostrado: boolean; bloqueada: boolean }> {
  const mostrados = todas.filter((x) => !ocultos.includes(x.id)).map((x) => x.id)
  return todas.map((x) => {
    const mostrado = mostrados.includes(x.id)
    return { x, mostrado, bloqueada: mostrado && !sePuedeOcultar(mostrados, x.id) }
  })
}

/** De dónde es un agente de la lista del perfil. */
export type ModoAgente = 'serie' | 'nativo' | 'docker'

/** Un agente de la lista del perfil que gestiona Configuración. */
export interface AgenteDelPerfil {
  pestana: PestanaAgente
  modo: ModoAgente
  oculto: boolean
}

/** Todos los agentes de un perfil (de serie, nativos y Docker), en su orden y con si están ocultos. */
export function agentesDelPerfil(f: FuenteAgentes, profileId: string): AgenteDelPerfil[] {
  const ocultos = f.ocultosPorPerfil[profileId] ?? []
  const vistos = new Set<string>()
  const lista: AgenteDelPerfil[] = []
  const anadir = (pestana: PestanaAgente, modo: ModoAgente): void => {
    if (vistos.has(pestana.id)) return
    vistos.add(pestana.id)
    lista.push({ pestana, modo, oculto: ocultos.includes(pestana.id) })
  }
  for (const a of AGENTES_DE_SERIE) anadir(pestanaDeSerie(a), 'serie')
  for (const d of f.nativos) anadir(pestanaManual(d), 'nativo')
  for (const d of f.dockerPorPerfil[profileId] ?? []) anadir(pestanaManual(d), 'docker')
  return aplicarOrden(lista, (x) => x.pestana.id, f.ordenPorPerfil[profileId])
}

/**
 * Las del agente de la terminal (siempre nativo): las de serie visibles y los manuales nativos
 * marcados «Activar en la terminal». Las del espacio de datos son solo las de serie.
 */
export function pestanasDeLaTerminal(f: FuenteAgentes, profileId: string): PestanaAgente[] {
  const enTerminal = { ...f, nativos: f.nativos.filter((d) => d.enTerminal === true) }
  return pestanasDelProyecto(enTerminal, profileId, true)
}

/** Dónde vive el agente: decide qué pestañas le tocan. */
export type SitioAgente = 'proyecto-nativo' | 'proyecto-docker' | 'terminal' | 'datos'

function pestanasDelSitio(f: FuenteAgentes, profileId: string, sitio: SitioAgente): PestanaAgente[] {
  if (sitio === 'terminal') return pestanasDeLaTerminal(f, profileId)
  if (sitio === 'datos') return pestanasDelProyecto(FUENTE_VACIA, profileId, true)
  return pestanasDelProyecto(f, profileId, sitio === 'proyecto-nativo')
}

const cachePestanas = new WeakMap<FuenteAgentes, Map<string, PestanaAgente[]>>()

/**
 * Las mismas pestañas, con la MISMA identidad mientras la fuente no cambie: el pane del agente va
 * memoizado y una lista nueva en cada render lo repintaría entero.
 */
export function pestanasEstables(f: FuenteAgentes, profileId: string, sitio: SitioAgente): PestanaAgente[] {
  let porClave = cachePestanas.get(f)
  if (!porClave) {
    porClave = new Map()
    cachePestanas.set(f, porClave)
  }
  const clave = `${profileId}|${sitio}`
  let pestanas = porClave.get(clave)
  if (!pestanas) {
    pestanas = pestanasDelSitio(f, profileId, sitio)
    porClave.set(clave, pestanas)
  }
  return pestanas
}

/** El siguiente de la lista (el chip del mosaico es un ciclo), o null si solo hay uno. */
export function siguienteAgente(disponibles: readonly IdAgente[], actual: IdAgente): IdAgente | null {
  const i = disponibles.indexOf(actual)
  if (i < 0 || disponibles.length <= 1) return null
  return disponibles[(i + 1) % disponibles.length]
}
