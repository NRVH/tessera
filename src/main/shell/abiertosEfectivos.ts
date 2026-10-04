// =============================================================================
// Contra qué proyectos resuelve el main una apertura de «Abrir con Tessera»: los que
// manda el renderer y, mientras este no haya restaurado sus pestañas, también los
// persistidos. Puro (solo tipos de shared); lo usan aperturasPendientes.ts y el
// almacén del workspace.
// Decisiones: docs/decisiones/renderer/abrir-con-tessera.md
// =============================================================================

import type { ProyectoAbierto, TomarAperturasRequest } from '../../shared/shell-windows-ipc.ts'
import type { WorkspaceState } from '../../shared/workspace-state-ipc.ts'

/** Los proyectos que el estado persistido tiene abiertos, de todos los perfiles. */
export function proyectosDeEstado(byProfile: WorkspaceState['byProfile']): ProyectoAbierto[] {
  const fuera: ProyectoAbierto[] = []
  for (const [profileId, tabs] of Object.entries(byProfile)) {
    for (const p of tabs.openProjects) fuera.push({ profileId, projectHostPath: p.projectHostPath })
  }
  return fuera
}

/**
 * Los proyectos de la petición, saneados. Una entrada sin `projectHostPath` de tipo
 * string haría lanzar a la aritmética de rutas con la cola ya vaciada, y se perderían
 * todas las aperturas pendientes.
 */
function abiertosDePeticion(req: TomarAperturasRequest | null | undefined): ProyectoAbierto[] {
  const crudos: readonly unknown[] = Array.isArray(req?.abiertos) ? req.abiertos : []
  const fuera: ProyectoAbierto[] = []
  for (const c of crudos) {
    const p = c as Partial<ProyectoAbierto> | null
    if (typeof p?.profileId !== 'string' || typeof p?.projectHostPath !== 'string') continue
    fuera.push({ profileId: p.profileId, projectHostPath: p.projectHostPath })
  }
  return fuera
}

/**
 * Los proyectos contra los que se aplica la regla 1 («ya está abierto»). Si el renderer
 * no confirma con `pestanasCargadas: true` que restauró sus pestañas, se suman los
 * persistidos: en ese hueco su lista vacía no significa «no hay nada abierto».
 *
 * @param persistidos Se piden solo cuando hacen falta: leerlos puede tocar el disco.
 */
export function abiertosEfectivos(
  req: TomarAperturasRequest | null | undefined,
  persistidos: () => readonly ProyectoAbierto[]
): ProyectoAbierto[] {
  const abiertos = abiertosDePeticion(req)
  if (req?.pestanasCargadas === true) return abiertos
  const vistos = new Set(abiertos.map((p) => `${p.profileId}|${p.projectHostPath.toLowerCase()}`))
  for (const p of persistidos()) {
    const clave = `${p.profileId}|${p.projectHostPath.toLowerCase()}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    abiertos.push(p)
  }
  return abiertos
}
