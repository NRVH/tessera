// =============================================================================
// planAperturas: las dos decisiones puras de «Abrir con Tessera» en el renderer. Qué
// se le manda al main al recoger la cola (`peticionTomar`) y qué se hace con cada
// apertura resuelta (`planApertura`): activar un proyecto ya abierto o abrir uno nuevo.
// Solo tipos de shared; lo usa useAperturasExplorador.
// Decisiones: docs/decisiones/renderer/abrir-con-tessera.md
// =============================================================================

import type {
  AperturaResuelta,
  ProyectoAbierto,
  TomarAperturasRequest
} from '../../../../shared/shell-windows-ipc.ts'

/** Lo que gobierna la recogida de la cola del main. */
export interface EstadoRecogida {
  ajustesCargados: boolean
  pestanasCargadas: boolean
  abiertos: readonly ProyectoAbierto[]
}

/**
 * La petición `tomar`, o null si aún no se puede recoger (sin ajustes). No espera a las
 * pestañas: avisa al main de que faltan y él resuelve contra lo persistido.
 */
export function peticionTomar(e: EstadoRecogida): TomarAperturasRequest | null {
  if (!e.ajustesCargados) return null
  return {
    abiertos: e.abiertos.map((p) => ({ profileId: p.profileId, projectHostPath: p.projectHostPath })),
    pestanasCargadas: e.pestanasCargadas
  }
}

/**
 * Qué hacer con una apertura: activar lo que ya está abierto o abrirlo nuevo. Un proyecto
 * que nace para ver un ARCHIVO nace con el agente diferido; uno ya abierto nunca cambia.
 */
export type PlanApertura =
  /** `quitarDiferido`: se abrió como CARPETA, así que se quiere el proyecto con su agente. */
  | { tipo: 'activar'; profileId: string; projectHostPath: string; quitarDiferido: boolean }
  | { tipo: 'nuevo'; profileId: string; agenteDiferido: boolean }

/**
 * Decide con las pestañas YA cargadas. Lo que el renderer ve abierto se activa siempre,
 * diga lo que diga el main: solo un proyecto que no está abierto en ningún perfil nace
 * nuevo (y en modo nativo). Entre varios perfiles gana el que señaló el main, luego el
 * activo. La ruta se compara sin distinguir mayúsculas y se devuelve la ya abierta.
 */
export function planApertura(
  ap: AperturaResuelta,
  perfilActivo: string,
  abiertos: readonly ProyectoAbierto[]
): PlanApertura {
  const destino = ap.contenedora.projectHostPath.toLowerCase()
  const iguales = abiertos.filter((p) => p.projectHostPath.toLowerCase() === destino)
  const elegido =
    iguales.find((p) => p.profileId === ap.profileIdExistente) ??
    iguales.find((p) => p.profileId === perfilActivo) ??
    iguales[0]
  if (elegido !== undefined) {
    return {
      tipo: 'activar',
      profileId: elegido.profileId,
      projectHostPath: elegido.projectHostPath,
      quitarDiferido: ap.archivo === null
    }
  }
  return { tipo: 'nuevo', profileId: perfilActivo, agenteDiferido: ap.archivo !== null }
}
