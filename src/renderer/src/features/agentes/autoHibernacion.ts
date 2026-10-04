// =============================================================================
// Reglas puras del orquestador de la hibernación por inactividad: qué proyectos están en
// pantalla, la petición de cada ronda al main, qué hacer con su respuesta (también si el
// usuario entró en el proyecto mientras viajaba) y la espera hasta la siguiente.
// Todo entra por parámetro y de otras features solo hay `import type`: corre bajo `node`.
// El temporizador y los stores viven en `useAutoHibernacion.ts`.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import type {
  AgenteHibernado,
  AgentHibernarInactivosRequest,
  AgentHibernarInactivosResult,
  ProyectoHibernable
} from '../../../../shared/agent-terminal-ipc.ts'

/** Un proyecto abierto, con lo que la ronda necesita de él. */
export interface ProyectoAbierto {
  profileId: string
  projectHostPath: string
  name: string
  /** 'active', o cualquiera de los dos hibernados. */
  estado: string
}

/** Un target de agente abierto: su clave y el proyecto del que cuelga. */
export interface TargetAbierto {
  key: string
  profileId: string
  projectHostPath: string
}

/** Lo que decide qué se ve ahora mismo. */
export interface EntradaPantalla {
  /** El proyecto activo del perfil activo (el optimista: el clic ya dado). */
  activo: { profileId: string; projectHostPath: string } | null
  /** El objetivo que el backend ya confirmó: puede ir un instante por detrás. */
  confirmado: { profileId: string; projectHostPath: string } | null
  mosaicoActivo: boolean
  /** Claves de target de las casillas del mosaico. */
  teselas: readonly string[]
  targets: readonly TargetAbierto[]
}

/** Primera ronda tras arrancar: los agentes restaurados aún están abriéndose. */
export const PRIMERA_RONDA_MS = 5000
const ESPERA_MIN_MS = 1000
const ESPERA_MAX_MS = 60_000

/** Clave de un proyecto para los conjuntos de este módulo. */
export function claveProyecto(profileId: string, projectHostPath: string): string {
  return JSON.stringify([profileId, projectHostPath])
}

/** Claves de los proyectos que se ven: el activo, el confirmado y las casillas del mosaico. */
export function proyectosEnPantalla(e: EntradaPantalla): Set<string> {
  const vistos = new Set<string>()
  if (e.activo) vistos.add(claveProyecto(e.activo.profileId, e.activo.projectHostPath))
  if (e.confirmado) vistos.add(claveProyecto(e.confirmado.profileId, e.confirmado.projectHostPath))
  if (e.mosaicoActivo) {
    const enCasilla = new Set(e.teselas)
    for (const t of e.targets) {
      if (enCasilla.has(t.key)) vistos.add(claveProyecto(t.profileId, t.projectHostPath))
    }
  }
  return vistos
}

/** Apunta la hora a la que dejó de verse cada proyecto que estaba en pantalla y ya no. */
export function apuntarSalidas(
  dejoDeVerse: Map<string, number>,
  antes: ReadonlySet<string>,
  ahora: ReadonlySet<string>,
  t: number
): void {
  for (const clave of antes) if (!ahora.has(clave)) dejoDeVerse.set(clave, t)
}

export interface EntradaPeticion {
  minutos: number
  proyectos: readonly ProyectoAbierto[]
  targets: readonly TargetAbierto[]
  enPantalla: ReadonlySet<string>
  /** Claves de target con un resultado sin ver. */
  unseen: ReadonlySet<string>
  dejoDeVerse: ReadonlyMap<string, number>
  ahora: number
  /** Cuándo empezó a mirar el orquestador: un proyecto que nunca se vio cuenta desde ahí. */
  montadoEn: number
}

/** La petición de una ronda: un `ProyectoHibernable` por proyecto abierto. */
export function construirPeticion(e: EntradaPeticion): AgentHibernarInactivosRequest {
  const sinRevisar = new Set<string>()
  for (const t of e.targets) {
    if (e.unseen.has(t.key)) sinRevisar.add(claveProyecto(t.profileId, t.projectHostPath))
  }
  const proyectos: ProyectoHibernable[] = e.proyectos.map((p) => {
    const clave = claveProyecto(p.profileId, p.projectHostPath)
    return {
      profileId: p.profileId,
      projectHostPath: p.projectHostPath,
      enPantalla: e.enPantalla.has(clave),
      hibernado: p.estado !== 'active',
      sinRevisar: sinRevisar.has(clave),
      fueraDePantallaMs: Math.max(0, e.ahora - (e.dejoDeVerse.get(clave) ?? e.montadoEn))
    }
  })
  return { minutos: e.minutos, proyectos }
}

/** Qué hacer con un proyecto que el main acaba de hibernar. */
export interface PasoAplicacion {
  hibernado: AgenteHibernado
  /**
   * El usuario entró en el proyecto mientras viajaba la petición: se marca igual (el pane
   * suelta la sesión muerta) y se despierta en OTRA tarea, para que la reabra.
   */
  despertar: boolean
}

/** Los pasos para aplicar la respuesta de una ronda, con lo que está en pantalla AHORA. */
export function planAplicacion(resultado: AgentHibernarInactivosResult, enPantallaAhora: ReadonlySet<string>): PasoAplicacion[] {
  return resultado.hibernados.map((hibernado) => ({
    hibernado,
    despertar: enPantallaAhora.has(claveProyecto(hibernado.profileId, hibernado.projectHostPath))
  }))
}

/**
 * Cuánto esperar hasta la siguiente ronda, acotado entre 1 s y 60 s: lo que pide el main y,
 * si no hay ningún proyecto en espera, el propio umbral (un proyecto que salga de pantalla
 * justo ahora no puede cumplirlo antes). Tras un fallo, el máximo: no se martillea al main.
 */
export function siguienteEsperaMs(revisarEnMs: number | null, umbralMs: number | null, fallo = false): number {
  const pedido = revisarEnMs ?? umbralMs
  if (fallo || pedido === null || !Number.isFinite(pedido)) return ESPERA_MAX_MS
  return Math.min(ESPERA_MAX_MS, Math.max(ESPERA_MIN_MS, Math.ceil(pedido)))
}

