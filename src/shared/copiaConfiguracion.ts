// =============================================================================
// La copia de la configuración para llevarla a otro equipo, en lo que ve el renderer: qué ajustes
// viajan (los de preferencia, no los de este equipo, sus proyectos o la integración con su
// sistema), la frase, y cómo se FUSIONA lo importado con lo que ya hay: perfiles, agentes
// definidos a mano y ajustes. Se añade lo que falta, emparejado por id, y lo que existe no se
// toca. Puro: lo usan el main, el renderer y los `test-*.mts`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import { esAgenteManual, normalizarDefiniciones, type DefinicionAgente, type IdAgente } from './agentesManuales.ts'
import { normalizeWorkspaceState, type WorkspaceSettings } from './workspace-state-ipc.ts'
import { crearTextos } from './i18n.ts'

const txCopia = crearTextos(
  {
    fraseCorta: (min: number) => `La frase tiene que tener al menos ${min} caracteres.`,
    fraseDistinta: 'Las dos frases no coinciden.'
  },
  {
    fraseCorta: (min: number) => `The passphrase must be at least ${min} characters long.`,
    fraseDistinta: 'The two passphrases do not match.'
  }
)

export const EXTENSION_COPIA = 'tessera'
export const MIN_FRASE = 8

/** Lo que se puede elegir al exportar, además de los perfiles. */
export interface ApartadosCopia {
  ssh: boolean
  bd: boolean
  agentes: boolean
  ajustes: boolean
}

/** Los agentes definidos a mano de la copia: los nativos (de todo el equipo) y los de cada perfil. */
export interface AgentesCopia {
  nativos: DefinicionAgente[]
  dockerPorPerfil: Record<string, DefinicionAgente[]>
  ocultosPorPerfil: Record<string, IdAgente[]>
}

/**
 * Los ajustes que viajan: preferencias de uso. Se quedan fuera los tamaños de los paneles (son de
 * esta pantalla), lo que cuelga de un proyecto o de una ruta de este equipo, el estado de la vista
 * por perfil y lo que instala algo en el sistema (el menú contextual, la acción rápida), que
 * activarlo sin instalarlo dejaría la casilla mintiendo.
 */
export const AJUSTES_EXPORTABLES = [
  'zoomLevel',
  'hideProfileNames',
  'defaultProjectMode',
  'activityBarOrder',
  'bottomBarOrder',
  'terminalFontFamily',
  'terminalFontSize',
  'terminalResaltado',
  'agentFontFamily',
  'agentFontSize',
  'uiFontSize',
  'explorerFontSize',
  'gitFontSize',
  'aplicarUpdateAlCerrar',
  'registroSalud',
  'volcadosCaida',
  'diffColapsarSinCambios',
  'paquetesExtraSandbox',
  'sandboxDepsNavegador',
  'mosaicoPreset',
  'coloresPerfilFijados',
  'dbFontSize',
  'dbFilasPorPagina',
  'dbTxInicial',
  'dbConsolaInactividadMin',
  'agenteInactividadMin'
] as const satisfies readonly (keyof WorkspaceSettings)[]

export type AjustesCopia = Partial<Pick<WorkspaceSettings, (typeof AJUSTES_EXPORTABLES)[number]>>

/** El error de la frase elegida al exportar, o null si vale. */
export function errorDeFrase(frase: string, repetida: string): string | null {
  const t = txCopia()
  if (frase.length < MIN_FRASE) return t.fraseCorta(MIN_FRASE)
  if (frase !== repetida) return t.fraseDistinta
  return null
}

/** Los ajustes exportables de los de ahora. */
export function ajustesParaExportar(s: WorkspaceSettings): AjustesCopia {
  const fuera: Record<string, unknown> = {}
  for (const k of AJUSTES_EXPORTABLES) fuera[k] = structuredClone(s[k])
  return fuera as AjustesCopia
}

/** Los ajustes de ahora con los importados encima (solo los exportables), saneados como al leer el archivo. */
export function ajustesConImportados(actual: WorkspaceSettings, importados: unknown): WorkspaceSettings {
  if (typeof importados !== 'object' || importados === null) return actual
  const raw = importados as Record<string, unknown>
  const mezcla: Record<string, unknown> = { ...actual }
  for (const k of AJUSTES_EXPORTABLES) if (k in raw) mezcla[k] = raw[k]
  return normalizeWorkspaceState({ settings: mezcla })?.settings ?? actual
}

/** Los agentes a exportar: los nativos y los de los perfiles elegidos. */
export function agentesParaExportar(s: Pick<WorkspaceSettings, 'agentesNativos' | 'agentesDockerPorPerfil' | 'agentesOcultosPorPerfil'>, perfiles: readonly string[]): AgentesCopia {
  const dePerfiles = <T>(r: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(r).filter(([id]) => perfiles.includes(id)))
  return {
    nativos: structuredClone(s.agentesNativos),
    dockerPorPerfil: structuredClone(dePerfiles(s.agentesDockerPorPerfil)),
    ocultosPorPerfil: structuredClone(dePerfiles(s.agentesOcultosPorPerfil))
  }
}

/** Qué perfiles de la copia faltan aquí (se crean) y cuáles ya están (se fusionan sus conexiones). */
export function perfilesAFusionar<P extends { id: string }>(actuales: readonly { id: string }[], importados: readonly P[]): { nuevos: P[]; existentes: P[] } {
  const ya = new Set(actuales.map((p) => p.id))
  const vistos = new Set<string>()
  const nuevos: P[] = []
  const existentes: P[] = []
  for (const p of importados) {
    if (vistos.has(p.id)) continue
    vistos.add(p.id)
    ;(ya.has(p.id) ? existentes : nuevos).push(p)
  }
  return { nuevos, existentes }
}

type AgentesActuales = Pick<WorkspaceSettings, 'agentesNativos' | 'agentesDockerPorPerfil' | 'agentesOcultosPorPerfil'>

export interface AgentesFusionados extends AgentesActuales {
  /** Cuántos agentes se añadieron. */
  anadidos: number
  /** Los perfiles que recibieron agentes Docker con órdenes de instalación: su capa hay que aplicarla. */
  perfilesConInstalacion: string[]
}

function anadirFaltan(actuales: readonly DefinicionAgente[], nuevos: readonly DefinicionAgente[]): DefinicionAgente[] {
  const ids = new Set(actuales.map((d) => d.id))
  return nuevos.filter((d) => !ids.has(d.id))
}

/**
 * Los ocultos de la copia para los perfiles nuevos, solo de los de serie y de los manuales que de
 * verdad hay tras importar: un oculto de un agente que no entró haría nacer oculto al que luego se
 * cree con ese mismo id.
 */
function tomarOcultosDeLaCopia(
  ocultos: Record<string, IdAgente[]>,
  crudos: unknown,
  perfilesNuevos: readonly string[],
  agentesDe: (perfil: string) => readonly DefinicionAgente[]
): void {
  const ocultosCopia: Record<string, IdAgente[]> = normalizeWorkspaceState({ settings: { agentesOcultosPorPerfil: crudos } })?.settings?.agentesOcultosPorPerfil ?? {}
  for (const perfil of perfilesNuevos) {
    const hay = new Set(agentesDe(perfil).map((d) => d.id))
    const delPerfil = ocultosCopia[perfil]?.filter((id) => !esAgenteManual(id) || hay.has(id))
    if (delPerfil) ocultos[perfil] = delPerfil
  }
}

/**
 * Los agentes de la copia fusionados con los de ahora: se añaden los que no están (por id), solo de
 * los perfiles que se importan; los ocultos de un perfil solo se toman si el perfil es nuevo.
 */
export function fusionarAgentes(actual: AgentesActuales, copia: unknown, perfiles: readonly string[], perfilesNuevos: readonly string[]): AgentesFusionados {
  const c = (typeof copia === 'object' && copia !== null ? copia : {}) as Record<string, unknown>
  const nativos = anadirFaltan(actual.agentesNativos, normalizarDefiniciones(c.nativos, false))
  const docker = { ...actual.agentesDockerPorPerfil }
  const ocultos = { ...actual.agentesOcultosPorPerfil }
  const conInstalacion: string[] = []
  let anadidos = nativos.length
  const dockerCopia = (typeof c.dockerPorPerfil === 'object' && c.dockerPorPerfil !== null ? c.dockerPorPerfil : {}) as Record<string, unknown>
  for (const perfil of perfiles) {
    const nuevos = anadirFaltan(docker[perfil] ?? [], normalizarDefiniciones(dockerCopia[perfil], true))
    if (nuevos.length === 0) continue
    docker[perfil] = [...(docker[perfil] ?? []), ...nuevos]
    anadidos += nuevos.length
    if (nuevos.some((d) => d.instalacion)) conInstalacion.push(perfil)
  }
  const agentesNativos = [...actual.agentesNativos, ...nativos]
  tomarOcultosDeLaCopia(ocultos, c.ocultosPorPerfil, perfilesNuevos, (perfil) => [...agentesNativos, ...(docker[perfil] ?? [])])
  return {
    agentesNativos,
    agentesDockerPorPerfil: docker,
    agentesOcultosPorPerfil: ocultos,
    anadidos,
    perfilesConInstalacion: conInstalacion
  }
}
